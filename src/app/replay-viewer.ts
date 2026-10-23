// Same-session viewer ownership. App supplies the result receipt and renderer; this owner never
// visits race launch, recording, awards, settings or saved-attempt paths.
import type { ReplayCamera, ReplayCameraMode } from '../camera';
import { SIM_DT } from '../sim/api';
import type { ReplayViewState } from '../ui';
import type { ReplayPlayback } from './replay-playback';

interface Lease {
  release(): void;
}
type Acquisition = { kind: 'acquired'; lease: Lease } | { kind: 'refused' };
export interface ReplayViewerPrepared {
  playback: ReplayPlayback;
  camera: ReplayCamera;
}
export interface ReplayViewerPorts {
  prepare: (signal: AbortSignal) => Promise<ReplayViewerPrepared>;
  acquireInput: () => Lease;
  acquireAudio: (signal: AbortSignal) => Promise<Acquisition>;
  acquireWake: (options: { signal: AbortSignal; onLost(): void }) => Promise<Acquisition>;
  held: () => boolean;
  commit: (prepared: ReplayViewerPrepared) => void;
  restore: () => void;
  show: (view: ReplayViewState) => void;
  resetClock: () => void;
  invalidatePose: () => void;
  entryFailed: () => void;
}

export function createReplayViewer(ports: ReplayViewerPorts) {
  const input = ports.acquireInput();
  const lifetime = new AbortController();
  let active = true;
  let generation = 0;
  let loadAbort: AbortController | null = null;
  let wakeAbort: AbortController | null = null;
  let wakeGeneration = 0;
  let wake: Lease | null = null;
  let audio: Lease | null = null;
  let audioPending: Promise<boolean> | null = null;
  let prepared: ReplayViewerPrepared | null = null;
  let status: ReplayViewState['status'] = 'loading';
  let mode: ReplayCameraMode = 'trackside';
  let interrupted = false;
  let started = false;

  const show = () =>
    ports.show({
      status,
      camera: mode,
      elapsedSeconds: (prepared?.playback.curr.tick ?? 0) * SIM_DT,
      durationSeconds: (prepared?.playback.durationTicks ?? 0) * SIM_DT,
      ...(status === 'failed'
        ? { message: 'This replay stopped because it no longer matches the race.' }
        : {}),
    });
  const releaseWake = () => {
    wakeGeneration++;
    wakeAbort?.abort();
    wakeAbort = null;
    wake?.release();
    wake = null;
  };
  const pause = () => {
    if (!active) return;
    interrupted = true;
    if (status === 'playing') status = 'paused';
    releaseWake();
    show();
  };
  const resume = () => {
    if (!active || !prepared || status !== 'paused' || ports.held()) return;
    interrupted = false;
    status = 'playing';
    ports.resetClock();
    ports.invalidatePose();
    releaseWake();
    const request = new AbortController();
    wakeAbort = request;
    const owner = wakeGeneration;
    // Wake is best effort. A granted lease's later loss pauses this owner, never a replacement.
    void ports
      .acquireWake({
        signal: request.signal,
        onLost() {
          if (active && owner === wakeGeneration) pause();
        },
      })
      .then(
        (result) => {
          if (result.kind !== 'acquired') return;
          if (!active || owner !== wakeGeneration || status !== 'playing') result.lease.release();
          else wake = result.lease;
        },
        () => {
          /* unsupported or failed wake does not prevent playback */
        },
      );
    show();
  };
  const dispose = () => {
    if (!active) return;
    active = false;
    generation++;
    loadAbort?.abort();
    releaseWake();
    audio?.release();
    audio = null;
    lifetime.abort();
    input.release();
    ports.restore();
  };
  const quiet = () =>
    (audioPending ??= ports.acquireAudio(lifetime.signal).then((result) => {
      if (result.kind !== 'acquired') return false;
      if (!active) {
        result.lease.release();
        return false;
      }
      audio = result.lease;
      return true;
    }));
  const load = async () => {
    if (!active) return;
    const owner = ++generation;
    loadAbort?.abort();
    const abort = new AbortController();
    loadAbort = abort;
    releaseWake();
    interrupted = false;
    status = 'loading';
    show();
    try {
      if (!(await quiet())) throw new Error('Replay audio could not be suspended');
      if (!active || owner !== generation) return;
      const next = await ports.prepare(abort.signal);
      if (!active || owner !== generation || abort.signal.aborted) return;
      prepared = next;
      ports.commit(next);
      ports.invalidatePose();
      status = 'paused';
      if (!interrupted && !ports.held()) resume();
      else show();
    } catch {
      if (!active || owner !== generation) return;
      dispose();
      ports.entryFailed();
    }
  };
  return {
    get prepared() {
      return prepared;
    },
    get playing() {
      return active && status === 'playing';
    },
    get mode() {
      return mode;
    },
    get active() {
      return active;
    },
    start(): Promise<void> {
      if (started) return Promise.resolve();
      started = true;
      return load();
    },
    restart: load,
    pause,
    toggle() {
      if (status === 'playing') pause();
      else resume();
    },
    cycleCamera() {
      if (!active || !prepared || status === 'loading') return;
      mode = mode === 'trackside' ? 'orbit' : 'trackside';
      ports.invalidatePose();
      show();
    },
    step() {
      if (!active || status !== 'playing' || !prepared) return;
      if (ports.held()) {
        pause();
        return;
      }
      try {
        prepared.playback.step();
        if (prepared.playback.complete) {
          status = 'complete';
          releaseWake();
        }
      } catch {
        status = 'failed';
        releaseWake();
      }
      show();
    },
    dispose,
  };
}

export type ReplayViewer = ReturnType<typeof createReplayViewer>;
