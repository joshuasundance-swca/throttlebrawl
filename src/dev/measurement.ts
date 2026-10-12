import type {
  AppHandle,
  AppMeasurementEnd,
  AppMeasurementRefusal,
  AppMeasurementRuntime,
  AppMeasurementSession,
  AppMeasurementStopReason,
  TickDriver,
} from '../app';
import { createBot } from './bot';
import { createSoakFrameCollector, type SoakFrameCollector, type SoakFrameReport } from './perf/soak-frames';
import { describeValue, pageErrors } from './report/errors';

const WALL_LIMIT_MS = 1_200_000;
type RenderObservation = ReturnType<AppHandle['rendererStats']> & {
  phase: 'measurement-frame';
  timestampMs: number;
};
interface CollectedOutcome {
  schemaVersion: 1;
  build: AppHandle['build'];
  buildCapturePhase: 'consumer-start';
  device: { userAgent: string; phase: 'consumer-start' };
  scene: AppMeasurementSession['scene'];
  workload: AppMeasurementSession['workload'];
  committedAtMs: number;
  wallMs: number;
  runtime: AppMeasurementRuntime;
  runtimeCapturePhase: 'running-export' | 'runtime-ended';
  lastMeasurementRender: RenderObservation | null;
  collector: SoakFrameReport;
}
export type MeasurementOutcome =
  | { kind: 'refused'; refusal: AppMeasurementRefusal }
  | { kind: 'failed-before-start'; message: string }
  | (CollectedOutcome & { kind: 'running'; sampledAtMs: number; endedAtMs: null; end: null })
  | (CollectedOutcome & { kind: 'ended'; endedAtMs: number; end: AppMeasurementEnd });

/** Copies plain evidence only; capabilities never enter this graph. */
function frozenCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy)) as T;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) result[key] = frozenCopy(child);
  return Object.freeze(result) as T;
}

interface Attempt {
  controller: AbortController;
  collector: SoakFrameCollector;
  session: AppMeasurementSession | null;
  build: AppHandle['build'];
  userAgent: string;
  lastRender: RenderObservation | null;
  stopRequested: boolean;
  finished: boolean;
  feed: (() => void) | null;
  events: (() => void) | null;
  deadline: ReturnType<typeof setTimeout> | null;
}

export interface MeasurementConsumer {
  start(): Promise<void>;
  cancel(): void;
  dispose(): void;
  progress(): { phase: 'preparing' | 'running' | 'idle'; eligibleMs: number; state: string };
  report(): MeasurementOutcome | undefined;
}
const consumers = new WeakMap<AppHandle, MeasurementConsumer>();

/** One capability owner and one latest outcome for this APP, without persistence. */
export function measurementConsumer(app: AppHandle): MeasurementConsumer {
  const existing = consumers.get(app);
  if (existing) return existing;
  let active: Attempt | null = null;
  let latestAttempt: Attempt | null = null;
  let latest: MeasurementOutcome | undefined;
  const owns = (a: Attempt) => active === a && !a.finished;
  const detach = (a: Attempt) => {
    const feed = a.feed;
    a.feed = null;
    feed?.();
    const events = a.events;
    a.events = null;
    events?.();
    if (a.deadline !== null) clearTimeout(a.deadline);
    a.deadline = null;
  };
  const collected = (a: Attempt, ended: boolean): CollectedOutcome => {
    const s = a.session!;
    return {
      schemaVersion: 1,
      build: a.build,
      buildCapturePhase: 'consumer-start',
      device: { userAgent: a.userAgent, phase: 'consumer-start' },
      scene: s.scene,
      workload: s.workload,
      committedAtMs: s.committedAtMs,
      wallMs: 0,
      runtime: s.inspect(),
      runtimeCapturePhase: ended ? 'runtime-ended' : 'running-export',
      lastMeasurementRender: a.lastRender,
      collector: a.collector.report(),
    };
  };
  const finish = (a: Attempt, end: AppMeasurementEnd) => {
    if (a.finished) return;
    a.finished = true;
    detach(a);
    if (active === a) active = null;
    a.collector.cancel(`${end.kind}:${end.reason}`);
    const outcome = frozenCopy<MeasurementOutcome>({
      ...collected(a, true),
      kind: 'ended',
      end,
      endedAtMs: end.endedAtMs,
      wallMs: end.endedAtMs - a.session!.committedAtMs,
    });
    if (latestAttempt === a) latest = outcome;
  };
  const stop = (a: Attempt, reason: AppMeasurementStopReason) => {
    if (!owns(a) || a.stopRequested || !a.session) return;
    a.stopRequested = true;
    a.session.stop(reason);
  };
  const armDeadline = (a: Attempt) => {
    if (!owns(a) || a.stopRequested || !a.session) return;
    const remaining = a.session.committedAtMs + WALL_LIMIT_MS - performance.now();
    a.deadline = setTimeout(
      () => {
        a.deadline = null;
        if (!owns(a) || a.stopRequested) return;
        if (performance.now() >= a.session!.committedAtMs + WALL_LIMIT_MS) {
          stop(a, 'collector-deadline');
          return;
        }
        armDeadline(a);
      },
      Math.max(0, remaining),
    );
  };
  const consumer: MeasurementConsumer = {
    async start() {
      if (active) return;
      const a: Attempt = {
        controller: new AbortController(),
        collector: createSoakFrameCollector(),
        session: null,
        build: frozenCopy(app.build),
        userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
        lastRender: null,
        stopRequested: false,
        finished: false,
        feed: null,
        events: null,
        deadline: null,
      };
      active = a;
      latestAttempt = a;
      try {
        const result = await app.beginMeasurement({
          signal: a.controller.signal,
          driverForRepeat: () => {
            const player = app.playerId();
            if (!owns(a)) throw new Error('Measurement attempt retired');
            const road = app.roadQueries();
            if (!owns(a)) throw new Error('Measurement attempt retired');
            if (player === null || player === undefined || !road)
              throw new Error('Measurement player/road unavailable');
            const bot = createBot();
            if (!owns(a)) throw new Error('Measurement attempt retired');
            const drive: TickDriver = (snapshot, actions) => bot.drive(snapshot, player, road, actions);
            return drive;
          },
        });
        if (result.kind === 'refused') {
          if (active === a) active = null;
          if (latestAttempt === a) latest = frozenCopy({ kind: 'refused', refusal: result });
          return;
        }
        a.session = result.session;
        // Attach terminal reconciliation even for a retired late start, without replacing its successor.
        void result.session.ended.then((end) => finish(a, end));
        const unsubscribe = result.session.subscribe(
          (event) => {
            if (event.kind === 'ended') finish(a, event.end);
          },
          () => stop(a, 'collector-feed-failed'),
        );
        if (a.finished) {
          unsubscribe();
          return;
        }
        a.events = unsubscribe;
        if (!owns(a)) {
          result.session.stop('caller-cancelled');
          return;
        }
        const runtime = result.session.inspect();
        if (!owns(a) || runtime.phase !== 'running') return;
        const removeFeed = app.subscribeFrames(
          (frame) => {
            if (!owns(a) || a.stopRequested) return;
            try {
              const observed = a.session!.inspect();
              if (!owns(a) || observed.phase !== 'running') return;
              if (Number.isFinite(frame.timestampMs) && frame.timestampMs >= 0) {
                const stats = app.rendererStats();
                if (!owns(a)) return;
                a.lastRender = { ...stats, phase: 'measurement-frame', timestampMs: frame.timestampMs };
              }
              if (performance.now() >= a.session!.committedAtMs + WALL_LIMIT_MS) {
                stop(a, 'collector-deadline');
                return;
              }
              try {
                a.collector.record(frame);
              } catch (error) {
                stop(a, error instanceof RangeError ? 'collector-bad-timestamp' : 'collector-feed-failed');
                return;
              }
              if (!owns(a)) return;
              if (a.collector.state === 'target-reached') {
                stop(a, 'collector-target');
                return;
              }
              if (a.collector.state === 'incomplete') {
                stop(a, 'collector-overflow');
                return;
              }
            } catch {
              stop(a, 'collector-feed-failed');
              return;
            }
          },
          () => stop(a, 'collector-feed-failed'),
        );
        if (!owns(a) || a.stopRequested) {
          removeFeed();
          return;
        }
        a.feed = removeFeed;
        armDeadline(a);
      } catch (error) {
        pageErrors().add(`Measurement preparation failed: ${describeValue(error)}`);
        if (a.session) {
          stop(a, 'collector-feed-failed');
          return;
        }
        detach(a);
        if (active === a) active = null;
        if (latestAttempt === a)
          latest = frozenCopy({
            kind: 'failed-before-start',
            message: 'Could not prepare frame measurement.',
          });
      }
    },
    cancel() {
      const a = active;
      if (!a) return;
      if (a.session) stop(a, 'caller-cancelled');
      else {
        active = null;
        a.controller.abort();
      }
    },
    dispose() {
      const owned = active;
      consumer.cancel();
      if (owned) detach(owned);
    },
    progress() {
      return {
        phase: active ? (active.session ? 'running' : 'preparing') : 'idle',
        eligibleMs: active?.collector.eligibleMs ?? 0,
        state: active?.collector.state ?? 'idle',
      };
    },
    report() {
      const a = active;
      if (a?.session && !a.finished) {
        const sampledAtMs = performance.now();
        const evidence = collected(a, false);
        if (!owns(a)) return consumer.report();
        return frozenCopy({
          ...evidence,
          kind: 'running',
          sampledAtMs,
          endedAtMs: null,
          end: null,
          wallMs: sampledAtMs - a.session.committedAtMs,
        });
      }
      return latest === undefined ? undefined : frozenCopy(latest);
    },
  };
  consumers.set(app, consumer);
  return consumer;
}

export function measurementReport(app: AppHandle): MeasurementOutcome | undefined {
  return consumers.get(app)?.report();
}
