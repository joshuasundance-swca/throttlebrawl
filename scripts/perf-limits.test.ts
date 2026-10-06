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
  firstLoadReport,
  floorProblem,
  GUARD_FACTOR,
  guardLimits,
  isPullRequestRun,
  judgeSoft,
  PR_FLOOR_KB,
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

describe("the start tap's main-thread work: a trend with the same 3x guard (polish F, punch item 2)", () => {
  const base: Times = { frameMs: { p50: frames(4), p95: frames(8) }, startTapMs: 120 };
  const at = (startTapMs: number | undefined) =>
    judgeSoft(
      { frameMs: { p50: frames(4), p95: frames(8) }, ...(startTapMs === undefined ? {} : { startTapMs }) },
      base,
    );

  it('is a row of the trend with its ratio and a 3x guard, with no frame slack (it is not in whole frames)', () => {
    expect(guardLimits(base).startTap).toBe(360);
    const row = at(150).rows.find((r) => r.metric === 'start tap');
    expect(row).toEqual({
      metric: 'start tap',
      value: 150,
      baseline: 120,
      ratio: 1.25,
      limit: 360,
      over: false,
    });
    expect(trendLine('classic', at(150).rows)).toContain(
      'start tap 150 ms (1.25x the baseline 120, guard 360)',
    );
  });

  it('fails only above 3x the baseline (it fires), and a missing reading fails rather than passing', () => {
    expect(at(360).failures).toEqual([]);
    expect(at(360.1).failures).toEqual([
      'start tap 360.1 ms is over the 3x guard 360 ms (baseline 120 ms): a catastrophic slowdown, not runner noise',
    ]);
    expect(at(Number.NaN).failures).toHaveLength(1);
  });

  it('stays quiet on the CI readings behind the stored baseline, and fires above 3x it', () => {
    const soft = baselineFile.soft;
    expect(soft.startTapMs).toBeGreaterThan(0);
    const limit = guardLimits(soft).startTap ?? Number.NaN;
    for (const reading of [46.8, 60.4, 44.9])
      expect(judgeSoft({ ...soft, startTapMs: reading }, soft).failures, `${reading} ms`).toEqual([]);
    expect(judgeSoft({ ...soft, startTapMs: limit + 0.1 }, soft).failures).toHaveLength(1);
  });

  it('is not judged until both the probe and the baseline have it (the negative control)', () => {
    expect(at(undefined).rows.map((r) => r.metric)).toEqual(['frame p50', 'frame p95']);
    const noBase = judgeSoft(
      { frameMs: { p50: frames(4), p95: frames(8) }, startTapMs: 9999 },
      { frameMs: base.frameMs },
    );
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

describe("a pull request's headroom floor (2026-10-03: the budget was crossed 4 times by PRs that each fit)", () => {
  const KB = 1024;
  const floor = (head: number, base: number | null, pr: boolean) =>
    floorProblem(firstLoadReport(head * KB, 500, base === null ? null : base * KB), 500, pr);

  it('is 10 KB, and only pull_request runs are judged by it', () => {
    expect(PR_FLOOR_KB).toBe(10);
    expect(isPullRequestRun({ GITHUB_EVENT_NAME: 'pull_request' })).toBe(true);
    expect(isPullRequestRun({ GITHUB_EVENT_NAME: 'push' })).toBe(false);
    expect(isPullRequestRun({})).toBe(false);
  });

  it('fails a PR that grows the first load into the last 10 KB, with the headroom it leaves (it fires)', () => {
    const msg = floor(491.7, 488, true);
    expect(msg).toMatch(/^this PR leaves 8\.3 KB of headroom; move something off the first load\./);
    expect(msg).toContain('at least 10 KB of the 500 KB first-load JavaScript budget');
    expect(msg).toContain('this one grows it by 3.7 KB');
    // One byte into the floor fails; exactly 10 KB of headroom passes.
    expect(floor(490 + 1 / KB, 480, true)).not.toBeNull();
    expect(floor(490, 480, true)).toBeNull();
    // Its change against main unknown: the floor still holds (the stated rule).
    expect(floor(495, null, true)).toContain('its change against main was not measured');
  });

  it("never fires on main's pushes, under the floor's line, over the budget, or on a PR that does not grow it", () => {
    // Main keeps the 500 KB budget alone.
    expect(floor(495, 490, false)).toBeNull();
    // Main today: about 400 KB.
    expect(floor(398.7, 398.7, true)).toBeNull();
    expect(floor(420, 398.7, true)).toBeNull();
    // Over the budget, the budget's own failure speaks.
    expect(floor(502.1, 495, true)).toBeNull();
    // Main already inside the floor (two PRs that each fit, merged): a PR that adds nothing, or
    // moves code off the first load, is not the one that ate the margin, so it never goes red.
    expect(floor(495, 495, true)).toBeNull();
    expect(floor(493, 495, true)).toBeNull();
    expect(floor(495.1, 495, true)).not.toBeNull();
  });
});
