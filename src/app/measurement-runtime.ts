// Private APP ownership primitive; mutable scene handles never cross the public session.
import type { AudioObservedState, AudioSuspendLease, AudioSuspendLeaseResult } from '../audio';
import type { WakeLease, WakeLeaseResult } from '../platform';
type WakeLeaseOptions = Parameters<typeof import('../platform').acquireWakeLease>[0];
import type { MeasurementSceneResult } from './measurement-scene';
import type {
  AppMeasurementEnd,
  AppMeasurementEvent,
  AppMeasurementRefusal,
  AppMeasurementRefusalReason,
  AppMeasurementRequest,
  AppMeasurementRestoration,
  AppMeasurementRuntime,
  AppMeasurementSession,
  AppMeasurementStart,
  AppMeasurementRepeat,
  TickDriver,
} from './index';
type Ready = Extract<MeasurementSceneResult, { kind: 'ready' }>;
type Cause = { kind: AppMeasurementEnd['kind']; reason: AppMeasurementEnd['reason'] };
export type MeasurementAction = 'ordinary' | 'manual-pause' | 'back' | 'quit' | 'raw';
interface Host {
  preflight(): AppMeasurementRefusalReason | null;
  prepare(signal: AbortSignal): Promise<MeasurementSceneResult>;
  acquireWake(options: WakeLeaseOptions): Promise<WakeLeaseResult>;
  acquireAudio(options: { signal: AbortSignal }): Promise<AudioSuspendLeaseResult>;
  audioState(): AudioObservedState;
  current(): boolean;
  commit(scene: Ready): void;
  restore(): AppMeasurementRestoration;
  invalidate(): void;
  quality(): AppMeasurementRuntime['quality'];
}
interface Entry {
  listener: (event: AppMeasurementEvent) => void;
  onError: (error: unknown) => void;
}
interface Owner {
  request: AppMeasurementRequest;
  controller: AbortController;
  abort: () => void;
  resolve: (start: AppMeasurementStart) => void;
  reject: (error: unknown) => void;
  phase: 'pending' | 'running' | 'ending' | 'ended';
  wake: WakeLease | null;
  audio: AudioSuspendLease | null;
  session: AppMeasurementSession | null;
  resolveEnd: ((end: AppMeasurementEnd) => void) | null;
  end: AppMeasurementEnd | null;
  final: AppMeasurementRuntime | null;
  repeats: AppMeasurementRepeat[];
  repeatIndex: number;
  tick: number;
  countdown: boolean;
  started: boolean;
  entries: Map<object, Entry>;
  priming: Set<object>;
  publishing: number;
}
function frozen<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (v: unknown) => {
    if (v && typeof v === 'object') {
      for (const child of Object.values(v)) freeze(child);
      Object.freeze(v);
    }
  };
  freeze(copy);
  return copy;
}
const refusal = (
  reason: AppMeasurementRefusalReason,
  fields: Partial<AppMeasurementRefusal> = {},
): AppMeasurementRefusal =>
  frozen({ kind: 'refused', reason, sceneRefusal: null, wakeRefusal: null, audioRefusal: null, ...fields });

// Native lease state can change while acquisition awaits; observe it afresh.
const observeWakeState = (lease: WakeLease): WakeLease['state'] => lease.state;

export function createMeasurementRuntime(host: Host) {
  let owner: Owner | null = null;
  let deliveryDepth = 0;
  const live = (o: Owner) => owner === o && o.phase === 'running';
  const release = (o: Owner) => {
    const wake = o.wake,
      audio = o.audio;
    o.wake = null;
    o.audio = null;
    try {
      wake?.release();
    } catch (error) {
      console.error('Measurement wake cleanup failed', error);
    }
    try {
      audio?.release();
    } catch (error) {
      console.error('Measurement audio cleanup failed', error);
    }
  };
  const detach = (o: Owner) => {
    o.request.signal.removeEventListener('abort', o.abort);
    o.controller.abort();
  };
  const retire = (o: Owner, result?: AppMeasurementRefusal, error?: unknown) => {
    if (owner !== o || o.phase !== 'pending') return;
    o.phase = 'ended';
    owner = null;
    detach(o);
    release(o);
    if (result) o.resolve(result);
    else o.reject(error);
  };
  const snapshot = (o: Owner): AppMeasurementRuntime => {
    const wake = o.wake?.state ?? 'released';
    if (o.final) return frozen(o.final);
    const quality = host.quality();
    if (o.final) return frozen(o.final);
    return frozen({
      phase: o.phase === 'pending' ? 'running' : o.phase,
      repeatIndex: o.repeatIndex,
      tick: o.tick,
      countdown: o.countdown,
      divisor: 1,
      quality,
      wake,
    });
  };
  const invoke = (o: Owner, token: object, event: AppMeasurementEvent) => {
    const entry = o.entries.get(token);
    if (!entry) return;
    try {
      entry.listener(event);
    } catch (error) {
      o.entries.delete(token);
      o.priming.delete(token);
      try {
        entry.onError(error);
      } catch (callbackError) {
        console.error('Measurement error callback failed', callbackError);
      }
    }
  };
  const publish = (o: Owner, event: AppMeasurementEvent) => {
    o.publishing++;
    const value = event.kind === 'ended' ? Object.freeze(event) : frozen(event);
    try {
      for (const token of [...o.entries.keys()]) {
        if (o.priming.has(token)) continue;
        invoke(o, token, value);
        if (event.kind !== 'ended' && o.phase === 'ended') break;
        if (event.kind === 'repeat-start' && !live(o)) break;
      }
    } finally {
      if (--o.publishing === 0) {
        const pending = [...o.priming];
        o.priming.clear();
        for (const token of pending) {
          if (o.end) invoke(o, token, Object.freeze({ kind: 'ended', end: o.end }));
          else if (live(o) && o.started)
            invoke(o, token, frozen({ kind: 'repeat-start', index: o.repeatIndex }));
        }
        if (o.end) o.entries.clear();
      }
    }
  };
  const endRepeat = (o: Owner, reason: AppMeasurementRepeat['reason']) => {
    if (!o.started) return;
    o.started = false;
    const repeat = frozen({ index: o.repeatIndex, finalTick: o.tick, reason });
    o.repeats.push(repeat);
    publish(o, { kind: 'repeat-end', repeat });
  };
  const finish = (o: Owner, cause: Cause, deliver?: () => void) => {
    if (!live(o)) return;
    const endedAtMs = performance.now();
    o.phase = 'ending';
    host.invalidate();
    detach(o);
    endRepeat(o, 'session-ended');
    release(o);
    const finalQuality = host.quality();
    let restored: AppMeasurementRestoration;
    try {
      restored = host.restore();
    } catch (error) {
      console.error('Measurement restoration failed', error);
      restored = { logical: 'menu', visible: 'draw-failed' };
    }
    o.phase = 'ended';
    o.final = frozen({ ...snapshot(o), quality: finalQuality });
    o.end = frozen({ ...cause, endedAtMs, repeats: o.repeats, restored } as AppMeasurementEnd);
    try {
      if (deliver) {
        deliveryDepth++;
        try {
          deliver();
        } finally {
          deliveryDepth--;
        }
      }
    } finally {
      if (owner === o) owner = null;
      publish(o, { kind: 'ended', end: o.end });
      if (o.publishing === 0) {
        o.entries.clear();
        o.priming.clear();
      }
      o.resolveEnd?.(o.end);
    }
  };
  const pendingCurrent = (o: Owner) => {
    if (owner !== o || o.phase !== 'pending') return false;
    if (!host.current()) {
      retire(o, refusal('superseded-before-start'));
      return false;
    }
    return owner === o && o.phase === 'pending';
  };
  const prepare = async (o: Owner) => {
    try {
      const scene = await host.prepare(o.controller.signal);
      if (!pendingCurrent(o)) return;
      if (scene.kind === 'refused') {
        retire(o, refusal('scene-refused', { sceneRefusal: scene }));
        return;
      }
      const wake = await host.acquireWake({
        signal: o.controller.signal,
        onLost: (loss) => {
          if (o.phase === 'pending') retire(o, refusal('wake-lost-before-start'));
          else if (live(o)) {
            const mapped = {
              visibility: 'hidden',
              pagehide: 'pagehide',
              fullscreen: 'fullscreen',
              rotate: 'rotate',
              'native-release': 'wake-lost',
              'observation-failed': 'wake-observation-failed',
            } as const;
            finish(o, { kind: 'failed', reason: mapped[loss.reason] });
          }
        },
      });
      if (!pendingCurrent(o)) {
        if (wake.kind === 'acquired') wake.lease.release();
        return;
      }
      if (wake.kind === 'refused') {
        retire(o, refusal('wake-refused', { wakeRefusal: wake }));
        return;
      }
      o.wake = wake.lease;
      if (o.wake.state === 'lost') {
        retire(o, refusal('wake-lost-before-start'));
        return;
      }
      if (!pendingCurrent(o)) return;
      if (o.wake.state !== 'held') throw new Error('Unpublished wake lease released without cancellation');
      let audio: AudioSuspendLeaseResult;
      try {
        audio = await host.acquireAudio({ signal: o.controller.signal });
      } catch {
        if (pendingCurrent(o))
          retire(
            o,
            refusal('audio-suspend-refused', {
              audioRefusal: { kind: 'refused', reason: 'suspend-failed', observedState: null },
            }),
          );
        return;
      }
      if (!pendingCurrent(o)) {
        if (audio.kind === 'acquired') audio.lease.release();
        return;
      }
      if (audio.kind === 'refused') {
        if (audio.reason === 'aborted') throw new Error('Audio aborted without cancellation');
        retire(o, refusal('audio-suspend-refused', { audioRefusal: audio }));
        return;
      }
      o.audio = audio.lease;
      if (observeWakeState(o.wake) === 'lost') {
        retire(o, refusal('wake-lost-before-start'));
        return;
      }
      if (!pendingCurrent(o)) return;
      if (o.wake.state !== 'held' || o.audio.state !== 'held')
        throw new Error('Measurement lease released without cancellation');
      let observed: AudioObservedState;
      try {
        observed = host.audioState();
      } catch {
        retire(
          o,
          refusal('audio-suspend-refused', {
            audioRefusal: { kind: 'refused', reason: 'observation-failed', observedState: null },
          }),
        );
        return;
      }
      if (observed !== 'none' && observed !== 'suspended' && observed !== 'closed') {
        retire(
          o,
          refusal('audio-suspend-refused', {
            audioRefusal: { kind: 'refused', reason: 'not-suspended', observedState: observed },
          }),
        );
        return;
      }
      if (!pendingCurrent(o)) return;
      const committedAtMs = performance.now();
      o.phase = 'running';
      const ended = new Promise<AppMeasurementEnd>((resolve) => {
        o.resolveEnd = resolve;
      });
      const workload = frozen({
        simulation: 'qualified-default-isolated-repeat',
        replay: { policy: 'omitted', normalRecorder: 'untouched' },
        audio: {
          policy: 'omitted',
          normalAudioPolicy: 'suspend-if-running',
          commitEvidence: 'no-context-or-suspended-or-closed',
        },
        graphics: { policy: 'retain-current-setting', governor: 'separate-fresh-windows', frameDivisor: 1 },
      } as const);
      o.session = Object.freeze({
        committedAtMs,
        scene: frozen(scene.scene),
        workload,
        ended,
        inspect: () => frozen(o.final ?? snapshot(o)),
        subscribe(listener: Entry['listener'], onError: Entry['onError']) {
          const token = {};
          o.entries.set(token, { listener, onError });
          if (o.publishing > 0) o.priming.add(token);
          else if (o.end) {
            invoke(o, token, Object.freeze({ kind: 'ended', end: o.end }));
            o.entries.delete(token);
          } else if (o.started) invoke(o, token, frozen({ kind: 'repeat-start', index: o.repeatIndex }));
          return () => {
            o.entries.delete(token);
            o.priming.delete(token);
          };
        },
        stop: (reason) => finish(o, { kind: 'stopped', reason }),
      } satisfies AppMeasurementSession);
      try {
        host.commit(scene);
      } catch {
        finish(o, { kind: 'failed', reason: 'draw-failed' });
      }
      o.resolve(Object.freeze({ kind: 'started', session: o.session }));
    } catch (error) {
      retire(o, undefined, error);
    }
  };
  return {
    get owned() {
      return owner !== null;
    },
    get running() {
      return owner?.phase === 'running';
    },
    get intercepted() {
      return owner !== null && deliveryDepth === 0;
    },
    begin(request: AppMeasurementRequest): Promise<AppMeasurementStart> {
      if (request.signal.aborted) return Promise.resolve(refusal('aborted'));
      if (owner) return Promise.resolve(refusal('owner-busy'));
      const reason = host.preflight();
      if (reason) return Promise.resolve(refusal(reason));
      return new Promise((resolve, reject) => {
        const o: Owner = {
          request,
          controller: new AbortController(),
          abort: () => {},
          resolve,
          reject,
          phase: 'pending',
          wake: null,
          audio: null,
          session: null,
          resolveEnd: null,
          end: null,
          final: null,
          repeats: [],
          repeatIndex: 0,
          tick: 0,
          countdown: false,
          started: false,
          entries: new Map(),
          priming: new Set(),
          publishing: 0,
        };
        owner = o;
        o.abort = () => {
          if (o.phase === 'pending') retire(o, refusal('aborted'));
          else finish(o, { kind: 'cancelled', reason: 'signal' });
        };
        request.signal.addEventListener('abort', o.abort, { once: true });
        if (request.signal.aborted) o.abort();
        else void prepare(o);
      });
    },
    action(action: MeasurementAction, deliver: () => void, prepareDelivery: () => void = () => {}) {
      const o = owner;
      if (!o || deliveryDepth > 0) {
        prepareDelivery();
        deliver();
        return;
      }
      if (o.phase === 'pending') {
        try {
          prepareDelivery();
        } catch (error) {
          retire(o, undefined, error);
          throw error;
        }
        if (owner !== o || o.phase !== 'pending') return;
        retire(o, refusal('superseded-before-start'));
        deliver();
        return;
      }
      if (!live(o) || action === 'raw') return;
      if (action === 'ordinary') {
        try {
          prepareDelivery();
        } catch (error) {
          finish(o, { kind: 'failed', reason: 'action-gate-failed' });
          throw error;
        }
        if (!live(o)) return;
        finish(o, { kind: 'cancelled', reason: 'superseded' }, deliver);
      } else finish(o, { kind: 'cancelled', reason: action });
    },
    fail(reason: Extract<AppMeasurementEnd, { kind: 'failed' }>['reason']) {
      if (owner) {
        if (owner.phase === 'pending') retire(owner, refusal('superseded-before-start'));
        else finish(owner, { kind: 'failed', reason });
      }
    },
    current() {
      const o = owner;
      return () => o !== null && live(o);
    },
    progress(tick: number, countdown: boolean) {
      if (owner && live(owner)) {
        owner.tick = tick;
        owner.countdown = countdown;
      }
    },
    factory(index: number): TickDriver | null {
      const o = owner;
      if (!o || !live(o)) return null;
      o.repeatIndex = index;
      o.tick = 0;
      try {
        const driver = o.request.driverForRepeat(frozen({ index }));
        if (!live(o)) return null;
        if (typeof driver !== 'function')
          throw new Error('Measurement driver factory did not return a function');
        return driver;
      } catch {
        finish(o, { kind: 'failed', reason: 'driver-factory-failed' });
        return null;
      }
    },
    repeatStart() {
      const o = owner;
      if (!o || !live(o)) return;
      o.started = true;
      publish(o, { kind: 'repeat-start', index: o.repeatIndex });
    },
    repeatEnd(reason: 'finished' | 'busted') {
      if (owner && live(owner)) endRepeat(owner, reason);
    },
  };
}
