// The perf check's limit logic (scripts/perf-limits.mjs): frame and sim step times are a trend, and
// the gate fails only above 3x the baseline (the maintainer, 2026-10-02: "Trend plus 3x guard").
// These cases show the guard fires on a catastrophic slowdown, stays quiet on the CI noise
// measured on 2026-10-02, and that the size line reports a pull request's own change.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DELTA_WARN_KB,
  FRAME_SLACK_MS,
  firstLoadProblem,
  firstLoadReport,
  GUARD_FACTOR,
  guardLimits,
  headroomWarning,
  HEADROOM_WARN_KB,
  judgeSoft,
  measurementLabel,
  START_TAP_GUARD_MIN_READINGS,
  summaryMarkdown,
  trendLine,
} from './perf-limits.mjs';
import { repoRoot } from './lib.mjs';

/** One display frame at 60 Hz, the step frame times come in. */
const FRAME = 1000 / 60;
const frames = (n: number) => Math.round(n * FRAME * 10) / 10;

interface Times {
  frameMs: { p50: number; p95: number };
  stepMs?: { p95: number };
  startTapMs?: number;
  startTapReadings?: number;
  startTap?: { readings: number[] };
}
const baselineFile = JSON.parse(readFileSync(path.join(repoRoot, 'tests/perf/baseline.json'), 'utf8')) as {
  soft: Times;
  softInk: Times;
};

describe('the soft tier: a trend plus a 3x guard', () => {
  const base: Times = { frameMs: { p50: frames(4), p95: frames(8) }, stepMs: { p95: 4.9 } };

  it('is a 3x guard with half a frame of slack on frame times', () => {
    expect(GUARD_FACTOR).toBe(3);
    expect(guardLimits(base)).toEqual({
      frameP50: Math.round((frames(4) * 3 + FRAME_SLACK_MS) * 10) / 10,
      frameP95: Math.round((frames(8) * 3 + FRAME_SLACK_MS) * 10) / 10,
      stepP95: 14.7,
    });
  });

  it('passes exactly 3x the baseline in whole frames, and fails one frame more (it fires)', () => {
    const atGuard = judgeSoft({ frameMs: { p50: frames(12), p95: frames(24) }, stepMs: { p95: 14.7 } }, base);
    expect(atGuard.failures).toEqual([]);
    expect(atGuard.rows.map((r) => r.over)).toEqual([false, false, false]);

    const p50Over = judgeSoft({ frameMs: { p50: frames(13), p95: frames(8) }, stepMs: { p95: 4.9 } }, base);
    expect(p50Over.failures).toHaveLength(1);
    expect(p50Over.failures[0]).toMatch(/^frame p50 216\.7 ms is over the 3x guard/);

    const p95Over = judgeSoft({ frameMs: { p50: frames(4), p95: frames(25) }, stepMs: { p95: 4.9 } }, base);
    expect(p95Over.failures).toHaveLength(1);
    expect(p95Over.failures[0]).toMatch(/^frame p95 /);

    const stepOver = judgeSoft({ frameMs: { p50: frames(4), p95: frames(8) }, stepMs: { p95: 14.8 } }, base);
    expect(stepOver.failures).toHaveLength(1);
    expect(stepOver.failures[0]).toMatch(/^sim step p95 14\.8 ms is over the 3x guard 14\.7 ms/);

    // A broken probe (no number) fails too, rather than passing as "not over".
    expect(judgeSoft({ frameMs: { p50: Number.NaN, p95: frames(8) } }, base).failures).toHaveLength(1);
  });

  it('stays quiet on every reading CI printed on 2026-10-02, which the old 2x limit failed', () => {
    // The eight classic readings behind the 2026-10-02 baseline (tests/perf/baseline.json), on the
    // same game code: frame p95 83.4 to 150 ms, p50 up to 66.7 ms, sim step p95 up to 6.8 ms.
    const soft = baselineFile.soft;
    for (const p95 of [83.4, 100.1, 116.6, 133.3, 133.3, 149.9, 150, 150]) {
      const j = judgeSoft({ frameMs: { p50: 66.7, p95 }, stepMs: { p95: 6.8 } }, soft);
      expect(j.failures, `p95 ${p95}`).toEqual([]);
    }
    // The ink looks: frame p95 133.3 to 216.7 ms and p50 66.6 to 99.9 ms in the same runs.
    for (const p95 of [133.3, 183.4, 216.7])
      expect(judgeSoft({ frameMs: { p50: 99.9, p95 } }, baselineFile.softInk).failures).toEqual([]);
    // The old rule (2x) on the old baseline (p95 66.6 ms) failed 149.9 ms, the reading that held
    // main red on 2026-10-03.
    const old = judgeSoft({ frameMs: { p50: 66.7, p95: 149.9 } }, { frameMs: { p50: 33.3, p95: 66.6 } }, 2);
    expect(old.failures).toHaveLength(1);
  });

  it('fires on the stored baselines at 3x plus one frame', () => {
    for (const b of [baselineFile.soft, baselineFile.softInk]) {
      const limits = guardLimits(b);
      const over = judgeSoft({ frameMs: { p50: b.frameMs.p50, p95: limits.frameP95 + FRAME } }, b);
      expect(over.failures).toHaveLength(1);
      expect(
        judgeSoft({ frameMs: { p50: limits.frameP50 + 0.1, p95: b.frameMs.p95 } }, b).failures,
      ).toHaveLength(1);
    }
  });

  it('prints every metric with its ratio to the baseline and its guard', () => {
    const j = judgeSoft({ frameMs: { p50: frames(4), p95: frames(9) }, stepMs: { p95: 5.4 } }, base);
    expect(j.rows.map((r) => [r.metric, r.ratio])).toEqual([
      ['frame p50', 1],
      ['frame p95', 1.13],
      ['sim step p95', 1.1],
    ]);
    const line = trendLine('classic', j.rows);
    expect(line).toContain('perf trend (classic): frame p50 66.7 ms (1.00x the baseline 66.7, guard 208.4)');
    expect(line).toContain('sim step p95 5.4 ms (1.10x the baseline 4.9, guard 14.7)');
    expect(line).not.toContain('OVER');
    const md = summaryMarkdown({
      size: ['first-load JavaScript 1 KB'],
      probes: [{ label: 'classic', rows: j.rows }],
    });
    expect(md).toContain('| classic | frame p95 | 150 | 1.13 | 133.3 | 408.2 |');
    expect(md).toContain('- first-load JavaScript 1 KB');
    expect(summaryMarkdown({ size: [], probes: [] })).toContain('No probe results were written');
  });
});

describe("the start tap's main-thread work: a trend, guarded only once the baseline has 8 CI readings (polish K2 review, must-fix)", () => {
  const frame = { p50: frames(4), p95: frames(8) };
  /** A baseline whose start tap rests on `readings` CI readings. */
  const base = (readings: number): Times => ({ frameMs: frame, startTapMs: 120, startTapReadings: readings });
  const at = (startTapMs: number | undefined, readings: number) =>
    judgeSoft({ frameMs: frame, ...(startTapMs === undefined ? {} : { startTapMs }) }, base(readings));

  it('is 8 CI readings, the same bar as the frame baseline', () => {
    expect(START_TAP_GUARD_MIN_READINGS).toBe(8);
  });

  it('prints a trend row with its ratio and no guard before then, and never fails, however slow (it was 450 ms or more on one live reading)', () => {
    for (const readings of [0, 3, 7]) {
      const row = at(150, readings).rows.find((r) => r.metric === 'start tap');
      expect(row, `${readings} readings`).toEqual({
        metric: 'start tap',
        value: 150,
        baseline: 120,
        ratio: 1.25,
        limit: null,
        over: false,
      });
      expect(guardLimits(base(readings)).startTap).toBeUndefined();
      expect(at(9999, readings).failures).toEqual([]);
      expect(at(Number.NaN, readings).failures).toEqual([]);
    }
    expect(trendLine('classic', at(150, 3).rows)).toContain(
      'start tap 150 ms (1.25x the baseline 120, no guard yet)',
    );
  });

  it('is guarded at 3x the baseline, with no frame slack, from the 8th reading (the control: it fires)', () => {
    expect(guardLimits(base(8)).startTap).toBe(360);
    const row = at(150, 8).rows.find((r) => r.metric === 'start tap');
    expect(row).toEqual({
      metric: 'start tap',
      value: 150,
      baseline: 120,
      ratio: 1.25,
      limit: 360,
      over: false,
    });
    expect(trendLine('classic', at(150, 8).rows)).toContain(
      'start tap 150 ms (1.25x the baseline 120, guard 360)',
    );
    expect(at(360, 8).failures).toEqual([]);
    expect(at(360.1, 8).failures).toEqual([
      'start tap 360.1 ms is over the 3x guard 360 ms (baseline 120 ms): a catastrophic slowdown, not runner noise',
    ]);
    expect(at(Number.NaN, 8).failures).toHaveLength(1); // a missing reading fails rather than passing
  });

  it('shows "none yet" in the step summary where the guard would be', () => {
    const md = summaryMarkdown({ size: [], probes: [{ label: 'classic', rows: at(150, 3).rows }] });
    expect(md).toContain('| classic | start tap | 150 | 1.25 | 120 | none yet |');
    const guarded = summaryMarkdown({ size: [], probes: [{ label: 'classic', rows: at(150, 8).rows }] });
    expect(guarded).toContain('| classic | start tap | 150 | 1.25 | 120 | 360 |');
  });

  it('holds for the stored baseline: its guard exists exactly when it rests on 8 or more readings', () => {
    const soft = baselineFile.soft;
    expect(soft.startTapMs).toBeGreaterThan(0);
    const readings = soft.startTap?.readings ?? [];
    expect(readings.length).toBeGreaterThan(0);
    const limit = guardLimits({ ...soft, startTapReadings: readings.length }).startTap;
    if (readings.length >= START_TAP_GUARD_MIN_READINGS) expect(limit).toBeGreaterThan(0);
    else expect(limit).toBeUndefined();
    // Whatever the baseline's readings are, the CI readings behind it are never judged slow by it.
    const judged = judgeSoft(
      { frameMs: soft.frameMs, startTapMs: Math.max(...readings) },
      { ...soft, startTapReadings: readings.length },
    );
    expect(judged.failures).toEqual([]);
  });

  it('is not judged until both the probe and the baseline have it (the negative control)', () => {
    expect(at(undefined, 8).rows.map((r) => r.metric)).toEqual(['frame p50', 'frame p95']);
    const noBase = judgeSoft({ frameMs: frame, startTapMs: 9999 }, { frameMs: frame, startTapReadings: 8 });
    expect(noBase.rows.map((r) => r.metric)).toEqual(['frame p50', 'frame p95']);
    expect(noBase.failures).toEqual([]);
  });
});

describe('the first-load JavaScript line', () => {
  it('prints the headroom and the change against main, and warns on a big growth', () => {
    const KB = 1024;
    const r = firstLoadReport(489.9 * KB, 500, 482 * KB);
    expect(r.line).toBe(
      'first-load JavaScript 489.9 KB gzip of 500 KB (10.1 KB headroom), +7.9 KB against main (482.0 KB)',
    );
    expect(r.warn).toBe(true);
    expect(firstLoadReport(489.9 * KB, 500, (489.9 - DELTA_WARN_KB) * KB + 1).warn).toBe(false);
    expect(firstLoadReport(480 * KB, 500, 490 * KB).line).toContain('-10.0 KB against main');
    expect(firstLoadReport(502.1 * KB, 500, null).line).toBe(
      'first-load JavaScript 502.1 KB gzip of 500 KB (2.1 KB OVER), change against main not measured',
    );
  });
});

describe('measured first-load size: a hard cap and diagnostic composition reserve', () => {
  const KB = 1024;
  const checkout = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false };
  const measured = (jsGzip: number) => ({ jsGzip, jsFiles: 2 });
  const warning = (head: number, base: number | null, label = 'measured fixture tree') =>
    headroomWarning(firstLoadReport(head, 500, base), 500, label);

  it('keeps the 500 KiB hard cap: exactly at it passes, one byte over fails independently of delta', () => {
    const budget = JSON.parse(readFileSync(path.join(repoRoot, 'tests/perf/budget.json'), 'utf8')) as {
      jsGzipKB: number;
    };
    expect(budget.jsGzipKB).toBe(500);
    expect(firstLoadProblem(measured(500 * KB), budget.jsGzipKB)).toBeNull();
    expect(firstLoadProblem(measured(500 * KB + 1), budget.jsGzipKB)).toContain('is over 500 KB');
    expect(warning(500 * KB + 1, null)).toBeNull(); // the hard-cap failure speaks for itself
  });

  it('fails a missing or invalid current measurement, while a real below-cap measurement passes', () => {
    expect(firstLoadProblem({ jsGzip: 495 * KB }, 500)).not.toBeNull();
    expect(firstLoadProblem({ jsFiles: 2 }, 500)).not.toBeNull();
    for (const jsFiles of [0, -1, Number.NaN])
      expect(firstLoadProblem({ jsGzip: 495 * KB, jsFiles }, 500)).not.toBeNull();
    for (const jsGzip of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
      expect(firstLoadProblem({ jsGzip, jsFiles: 2 }, 500)).not.toBeNull();
    expect(firstLoadProblem(measured(495 * KB), 500)).toBeNull();
  });

  it('warns below the unchanged 10 KiB reserve, stays quiet at or above it, and never fails for reserve alone', () => {
    expect(HEADROOM_WARN_KB).toBe(10);
    const head = 490 * KB + 1;
    const msg = warning(head, 480 * KB);
    expect(msg).toContain('10239 B'); // rounding to 10.0 KB must not hide the threshold crossing
    expect(msg).toContain('below the diagnostic 10 KB reserve');
    expect(msg).toContain('500 KB hard cap');
    expect(msg).toContain('measured fixture tree');
    expect(firstLoadProblem(measured(head), 500)).toBeNull();
    expect(warning(490 * KB, 480 * KB)).toBeNull();
    expect(warning(489 * KB, 480 * KB)).toBeNull();
    expect(warning(500 * KB, null)).not.toBeNull();
  });

  it('warns for growth, no change, shrink and missing comparison; absence affects only the delta', () => {
    for (const base of [490 * KB, 495 * KB, 499 * KB, null]) {
      const msg = warning(495 * KB, base);
      expect(msg).toContain('5120 B');
      expect(msg).toContain('diagnostic');
      expect(firstLoadProblem(measured(495 * KB), 500)).toBeNull();
    }
    expect(warning(495 * KB, null)).toContain('change against main not measured');
    for (const base of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      const report = firstLoadReport(495 * KB, 500, base);
      expect(report.deltaBytes).toBeNull();
      expect(headroomWarning(report, 500, 'fixture')).toContain('change against main not measured');
    }
  });

  it('identifies the actual checkout on PR, train, main and local measurements without trusting the trigger SHA', () => {
    for (const env of [
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge', GITHUB_WORKFLOW: 'ci' },
      { GITHUB_EVENT_NAME: 'workflow_run', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW: 'train' },
      { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW: 'train' },
      { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW: 'ci' },
      {},
    ]) {
      const label = measurementLabel(checkout, { ...env, GITHUB_SHA: 'c'.repeat(40) });
      const msg = warning(495 * KB, null, label);
      expect(msg).toContain(`checkout commit ${checkout.commit}, tree ${checkout.tree}`);
      expect(msg).not.toContain('c'.repeat(40));
      expect(label).toContain(env.GITHUB_EVENT_NAME ?? 'local');
      expect(label).toContain(env.GITHUB_REF ?? 'no event ref');
      expect(msg).toContain('change against main not measured');
    }
    expect(measurementLabel({ ...checkout, dirty: true }, {})).toContain('uncommitted changes');
    expect(measurementLabel(checkout, {})).not.toContain('uncommitted changes');
  });
});
