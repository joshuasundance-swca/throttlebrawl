export const SOAK_TARGET_ELIGIBLE_MS = 900_000;
export const SOAK_RETAINED_INTERVAL_CAP = 1_000_000;

export interface SoakFrameSample {
  timestampMs: number;
  epoch: number;
  eligible: boolean;
}

export interface SoakFrameDistribution {
  samples: number;
  medianMs: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  slowestOnePercent: { samples: number; meanMs: number | null };
}

export interface SoakMinuteWindow {
  minute: number;
  complete: boolean;
  samples: number;
  medianMs: number | null;
  medianFps: number | null;
}

export interface SoakFrameReport {
  state: 'collecting' | 'target-reached' | 'incomplete';
  incompleteReason: 'cancelled' | 'retention-overflow' | null;
  cancellationReason: string | null;
  targetEligibleMs: number;
  eligibleMs: number;
  overrunMs: number;
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
  observedSpanMs: number;
  excludedObservedMs: number;
  excludedIntervals: number;
  epochBreaks: number;
  distribution: SoakFrameDistribution;
  minutes: SoakMinuteWindow[];
}

export interface SoakFrameCollector {
  record(sample: SoakFrameSample): void;
  cancel(reason: string): void;
  report(): SoakFrameReport;
}

const MINUTE_MS = 60_000;

function median(sorted: readonly number[], rate = false): number | null {
  if (!sorted.length) return null;
  const right = Math.floor(sorted.length / 2);
  const left = sorted.length % 2 ? right : right - 1;
  const a = sorted[left]!;
  const b = sorted[right]!;
  // Reciprocal rates reverse the order, but keep the same central pair.
  return rate ? (1000 / a + 1000 / b) / 2 : a + (b - a) / 2;
}

function distribution(values: readonly number[]): SoakFrameDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  const samples = sorted.length;
  const tailCount = Math.ceil(samples * 0.01);
  let tailSum = 0;
  for (let i = samples - tailCount; i < samples; i++) tailSum += sorted[i]!;
  return {
    samples,
    medianMs: median(sorted),
    p95Ms: samples ? sorted[Math.ceil(0.95 * samples) - 1]! : null,
    p99Ms: samples ? sorted[Math.ceil(0.99 * samples) - 1]! : null,
    maxMs: samples ? sorted[samples - 1]! : null,
    slowestOnePercent: { samples: tailCount, meanMs: samples ? tailSum / tailCount : null },
  };
}

/** Pure frame-stream measurement; collection state is never a phone qualification verdict. */
export function createSoakFrameCollector(): SoakFrameCollector {
  let state: SoakFrameReport['state'] = 'collecting';
  let incompleteReason: SoakFrameReport['incompleteReason'] = null;
  let cancellationReason: string | null = null;
  let firstTimestampMs: number | null = null;
  let endpoint: SoakFrameSample | null = null;
  let eligibleMs = 0;
  let excludedObservedMs = 0;
  let excludedIntervals = 0;
  let epochBreaks = 0;
  const intervals: number[] = [];
  const windows = Array.from({ length: SOAK_TARGET_ELIGIBLE_MS / MINUTE_MS }, () => [] as number[]);
  return {
    record(sample) {
      if (state !== 'collecting') return;
      if (
        !sample ||
        typeof sample.timestampMs !== 'number' ||
        !Number.isFinite(sample.timestampMs) ||
        sample.timestampMs < 0 ||
        !Number.isSafeInteger(sample.epoch) ||
        sample.epoch < 0 ||
        typeof sample.eligible !== 'boolean' ||
        (endpoint !== null && (sample.timestampMs < endpoint.timestampMs || sample.epoch < endpoint.epoch))
      )
        throw new RangeError('Invalid or backwards soak frame sample');
      const delta = endpoint === null ? 0 : sample.timestampMs - endpoint.timestampMs;
      if (endpoint !== null && delta > 0) {
        const eligible = endpoint.eligible && sample.eligible && endpoint.epoch === sample.epoch;
        if (eligible && intervals.length === SOAK_RETAINED_INTERVAL_CAP) {
          state = 'incomplete';
          incompleteReason = 'retention-overflow';
          return;
        }
        if (eligible) {
          intervals.push(delta);
          eligibleMs += delta;
          const minute = Math.max(
            0,
            Math.ceil(Math.min(eligibleMs, SOAK_TARGET_ELIGIBLE_MS) / MINUTE_MS) - 1,
          );
          windows[minute]!.push(delta);
          if (eligibleMs >= SOAK_TARGET_ELIGIBLE_MS) state = 'target-reached';
        } else {
          excludedObservedMs += delta;
          excludedIntervals++;
          if (sample.epoch !== endpoint.epoch) epochBreaks++;
        }
      }
      if (firstTimestampMs === null) firstTimestampMs = sample.timestampMs;
      endpoint = { timestampMs: sample.timestampMs, epoch: sample.epoch, eligible: sample.eligible };
    },
    cancel(reason) {
      if (state !== 'collecting') return;
      state = 'incomplete';
      incompleteReason = 'cancelled';
      cancellationReason = reason;
    },
    report() {
      return {
        state,
        incompleteReason,
        cancellationReason,
        targetEligibleMs: SOAK_TARGET_ELIGIBLE_MS,
        eligibleMs,
        overrunMs: Math.max(0, eligibleMs - SOAK_TARGET_ELIGIBLE_MS),
        firstTimestampMs,
        lastTimestampMs: endpoint?.timestampMs ?? null,
        observedSpanMs:
          endpoint === null || firstTimestampMs === null ? 0 : endpoint.timestampMs - firstTimestampMs,
        excludedObservedMs,
        excludedIntervals,
        epochBreaks,
        distribution: distribution(intervals),
        minutes: windows.map((values, i) => {
          const complete = eligibleMs >= (i + 1) * MINUTE_MS;
          const sorted = complete ? [...values].sort((a, b) => a - b) : [];
          return {
            minute: i + 1,
            complete,
            samples: values.length,
            medianMs: complete ? median(sorted) : null,
            medianFps: complete ? median(sorted, true) : null,
          };
        }),
      };
    },
  };
}
