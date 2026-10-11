import { describe, expect, it } from 'vitest';
import {
  createSoakFrameCollector,
  SOAK_RETAINED_INTERVAL_CAP,
  SOAK_TARGET_ELIGIBLE_MS,
  type SoakFrameSample,
} from './soak-frames';

function fromIntervals(values: number[]) {
  const collector = createSoakFrameCollector();
  let timestampMs = 0;
  collector.record({ timestampMs, epoch: 0, eligible: true });
  for (const value of values) {
    timestampMs += value;
    collector.record({ timestampMs, epoch: 0, eligible: true });
  }
  return collector;
}

describe('full-run soak frame measurement', () => {
  it('accepts the smallest positive finite interval without rounding it out of its window', () => {
    const report = fromIntervals([Number.MIN_VALUE]).report();
    expect(report.distribution.medianMs).toBe(Number.MIN_VALUE);
    expect(report.minutes[0]).toMatchObject({ samples: 1, complete: false });
  });
  it('reports empty metrics and a baseline without manufacturing intervals', () => {
    const collector = createSoakFrameCollector();
    expect(collector.report().distribution).toEqual({
      samples: 0,
      medianMs: null,
      p95Ms: null,
      p99Ms: null,
      maxMs: null,
      slowestOnePercent: { samples: 0, meanMs: null },
    });
    collector.record({ timestampMs: 42, epoch: 0, eligible: true });
    expect(collector.report()).toMatchObject({
      firstTimestampMs: 42,
      lastTimestampMs: 42,
      observedSpanMs: 0,
      eligibleMs: 0,
    });
  });

  it.each([
    { values: [7], median: 7 },
    { values: [2, 9, 4], median: 4 },
    { values: [2, 9, 4, 6], median: 5 },
  ])('uses the true median for $values', ({ values, median }) => {
    expect(fromIntervals(values).report().distribution.medianMs).toBe(median);
  });

  it('uses nearest rank and a distinct largest-one-percent mean', () => {
    expect(fromIntervals(Array.from({ length: 100 }, (_, i) => i + 1)).report().distribution).toEqual({
      samples: 100,
      medianMs: 50.5,
      p95Ms: 95,
      p99Ms: 99,
      maxMs: 100,
      slowestOnePercent: { samples: 1, meanMs: 100 },
    });
    const distribution = fromIntervals(Array.from({ length: 200 }, (_, i) => i + 1)).report().distribution;
    expect(distribution).toMatchObject({
      p99Ms: 198,
      maxMs: 200,
      slowestOnePercent: { samples: 2, meanMs: 199.5 },
    });
  });

  it('retains early raw hitches past 600 intervals and copies input and nested reports', () => {
    const collector = createSoakFrameCollector();
    const sample = { timestampMs: 0, epoch: 0, eligible: true };
    collector.record(sample);
    sample.timestampMs = 999_999;
    collector.record({ timestampMs: 1000, epoch: 0, eligible: true });
    for (let i = 1; i <= 700; i++) collector.record({ timestampMs: 1000 + 10 * i, epoch: 0, eligible: true });
    const report = collector.report();
    expect(report.distribution).toMatchObject({
      samples: 701,
      maxMs: 1000,
      slowestOnePercent: { samples: 8, meanMs: 133.75 },
    });
    const expected = collector.report();
    report.distribution.slowestOnePercent.meanMs = -1;
    report.minutes[0]!.samples = -1;
    report.minutes.pop();
    report.eligibleMs = -1;
    expect(collector.report()).toEqual(expected);
  });

  it('counts only same-epoch eligible endpoints and reconciles transition accounting', () => {
    const collector = createSoakFrameCollector();
    const points = [
      [0, 0, true],
      [10, 0, true],
      [20, 0, false],
      [30, 0, false],
      [40, 0, true],
      [50, 1, true],
      [60, 1, true],
    ] as const;
    for (const [timestampMs, epoch, eligible] of points) collector.record({ timestampMs, epoch, eligible });
    const report = collector.report();
    expect(report).toMatchObject({
      eligibleMs: 20,
      excludedObservedMs: 40,
      excludedIntervals: 4,
      epochBreaks: 1,
      observedSpanMs: 60,
      distribution: { samples: 2 },
    });
    expect(report.observedSpanMs).toBe(report.eligibleMs + report.excludedObservedMs);
  });

  it('replaces metadata on equal timestamps without adding interval accounting', () => {
    const collector = createSoakFrameCollector();
    for (const sample of [
      { timestampMs: 0, epoch: 0, eligible: true },
      { timestampMs: 0, epoch: 1, eligible: false },
      { timestampMs: 10, epoch: 1, eligible: true },
      { timestampMs: 10, epoch: 2, eligible: true },
      { timestampMs: 20, epoch: 2, eligible: true },
    ])
      collector.record(sample);
    expect(collector.report()).toMatchObject({
      eligibleMs: 10,
      excludedObservedMs: 10,
      excludedIntervals: 1,
      distribution: { samples: 1 },
    });
  });

  it('assigns exact boundaries to preceding windows and reaches the shared production target', () => {
    expect(SOAK_TARGET_ELIGIBLE_MS).toBe(15 * 60_000);
    const collector = fromIntervals(Array.from({ length: 15 }, () => 60_000));
    const report = collector.report();
    expect(report).toMatchObject({
      state: 'target-reached',
      targetEligibleMs: SOAK_TARGET_ELIGIBLE_MS,
      eligibleMs: SOAK_TARGET_ELIGIBLE_MS,
      overrunMs: 0,
    });
    expect(report.minutes).toHaveLength(15);
    for (const [i, minute] of report.minutes.entries())
      expect(minute).toEqual({
        minute: i + 1,
        complete: true,
        samples: 1,
        medianMs: 60_000,
        medianFps: 1000 / 60_000,
      });
  });

  it('keeps partial window medians null and reports median per-frame FPS', () => {
    const collector = fromIntervals([20_000]);
    expect(collector.report().minutes[0]).toMatchObject({
      complete: false,
      samples: 1,
      medianMs: null,
      medianFps: null,
    });
    collector.record({ timestampMs: 60_000, epoch: 0, eligible: true });
    expect(collector.report().minutes[0]).toEqual({
      minute: 1,
      complete: true,
      samples: 2,
      medianMs: 30_000,
      medianFps: (1000 / 20_000 + 1000 / 40_000) / 2,
    });
    expect(collector.report().minutes[0]!.medianFps).not.toBe(1000 / 30_000);
  });

  it('does not split long intervals or invent skipped-window medians; retains final overrun', () => {
    const report = fromIntervals([120_001, SOAK_TARGET_ELIGIBLE_MS - 120_001 + 123]).report();
    expect(report).toMatchObject({
      state: 'target-reached',
      eligibleMs: SOAK_TARGET_ELIGIBLE_MS + 123,
      overrunMs: 123,
      distribution: { samples: 2, maxMs: 780_122 },
    });
    expect(report.minutes[0]).toMatchObject({ complete: true, samples: 0, medianMs: null, medianFps: null });
    expect(report.minutes[1]).toMatchObject({ complete: true, samples: 0 });
    expect(report.minutes[2]).toMatchObject({ complete: true, samples: 1, medianMs: 120_001 });
    expect(report.minutes[14]).toMatchObject({ complete: true, samples: 1, medianMs: 780_122 });
  });

  it('rejects invalid input transactionally, including unsafe epochs and backwards metadata', () => {
    const collector = createSoakFrameCollector();
    collector.record({ timestampMs: 10, epoch: 2, eligible: true });
    const before = collector.report();
    const invalid = [
      { timestampMs: NaN },
      { timestampMs: Infinity },
      { timestampMs: -1 },
      { timestampMs: 9 },
      { epoch: -1 },
      { epoch: 1 },
      { epoch: 2.5 },
      { epoch: Infinity },
      { epoch: NaN },
      { epoch: Number.MAX_SAFE_INTEGER + 1 },
      { eligible: 1 },
      { eligible: 'true' },
      { timestampMs: '11' },
      { epoch: '2' },
    ];
    for (const patch of invalid) {
      expect(() =>
        collector.record({ timestampMs: 11, epoch: 2, eligible: true, ...patch } as SoakFrameSample),
      ).toThrow(RangeError);
      expect(collector.report()).toEqual(before);
    }
    collector.record({ timestampMs: 20, epoch: 2, eligible: true });
    expect(collector.report().eligibleMs).toBe(10);
  });

  it('freezes cancellation with its reason and ignores malformed terminal calls', () => {
    const collector = fromIntervals([10, 20]);
    collector.cancel('context lost');
    const before = collector.report();
    expect(before).toMatchObject({
      state: 'incomplete',
      incompleteReason: 'cancelled',
      cancellationReason: 'context lost',
      eligibleMs: 30,
      distribution: { samples: 2 },
    });
    collector.record(null as unknown as SoakFrameSample);
    collector.cancel('replaced');
    expect(collector.report()).toEqual(before);
  });

  it('freezes target before validating later samples or accepting cancellation', () => {
    const collector = fromIntervals([SOAK_TARGET_ELIGIBLE_MS]);
    const before = collector.report();
    collector.record(null as unknown as SoakFrameSample);
    collector.cancel('late cancellation');
    expect(collector.report()).toEqual(before);
    expect(Object.keys(before).sort()).toEqual(
      [
        'cancellationReason',
        'distribution',
        'eligibleMs',
        'epochBreaks',
        'excludedIntervals',
        'excludedObservedMs',
        'firstTimestampMs',
        'incompleteReason',
        'lastTimestampMs',
        'minutes',
        'observedSpanMs',
        'overrunMs',
        'state',
        'targetEligibleMs',
      ].sort(),
    );
  });

  it('enforces the production cap before target and freezes the accepted prefix', () => {
    expect(SOAK_RETAINED_INTERVAL_CAP).toBe(1_000_000);
    const collector = createSoakFrameCollector();
    collector.record({ timestampMs: 0, epoch: 0, eligible: true });
    for (let i = 1; i <= SOAK_RETAINED_INTERVAL_CAP; i++)
      collector.record({ timestampMs: i / 2, epoch: 0, eligible: true });
    // Excluded data still fits: the cap applies only to retained eligible intervals.
    collector.record({ timestampMs: 500_010, epoch: 1, eligible: true });
    const prefix = collector.report();
    collector.record({ timestampMs: SOAK_TARGET_ELIGIBLE_MS + 10, epoch: 1, eligible: true });
    const frozen = collector.report();
    expect(frozen).toEqual({ ...prefix, state: 'incomplete', incompleteReason: 'retention-overflow' });
    expect(frozen).toMatchObject({
      eligibleMs: 500_000,
      lastTimestampMs: 500_010,
      observedSpanMs: 500_010,
      excludedObservedMs: 10,
      distribution: { samples: SOAK_RETAINED_INTERVAL_CAP, medianMs: 0.5 },
    });
    collector.record(null as unknown as SoakFrameSample);
    collector.cancel('late cancellation');
    expect(collector.report()).toEqual(frozen);
  });
});
