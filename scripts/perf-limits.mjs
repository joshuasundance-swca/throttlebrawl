// The perf check's rules for the numbers it prints (docs/engineering.md, "Perf check"), kept in
// one place so the Playwright probes, scripts/perf.mjs and a unit test (perf-limits.test.ts) agree.
//
// - Soft tier: frame time p50 and p95 and sim step p95 are a TREND. CI prints them on every run
//   with their ratio to the stored baseline (tests/perf/baseline.json). They fail the gate only
//   above GUARD_FACTOR times the baseline, a catastrophe guard that runner noise cannot reach (the
//   maintainer, 2026-10-02: "Trend plus 3x guard"). On 2026-10-02 the same game code printed a
//   classic frame p95 of 100.1 ms and then 150 ms on CI's software renderer, so a 2x limit
//   flipped on noise.
// - Download size: the first-load JavaScript stays a hard budget; this file only words its
//   headroom and a pull request's own change against main, and warns on a big change.
import { fmtBytes } from './lib.mjs';

/** The soft tier fails only above this multiple of the baseline. */
export const GUARD_FACTOR = 3;

/**
 * Frame times come in whole display frames (16.7 ms steps at 60 Hz) and print a hair either side of
 * the step (four frames show as 66.6 or 66.7 ms), so a frame limit gets half a frame of slack:
 * exactly GUARD_FACTOR times the baseline's frames passes, one frame more fails. Sim step times are
 * not stepped and get no slack.
 */
export const FRAME_SLACK_MS = 1000 / 60 / 2;

/** A pull request that grows the first-load JavaScript by at least this much gets a warning. */
export const DELTA_WARN_KB = 5;

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * @typedef {{ frameMs: { p50: number, p95: number }, stepMs?: { p95: number } }} SoftTimes
 * @typedef {{ metric: string, value: number, baseline: number, ratio: number, limit: number, over: boolean }} TrendRow
 */

/**
 * The guard's limits for a baseline, rounded to 0.1 ms.
 * @param {SoftTimes} baseline
 * @param {number} [factor]
 * @returns {{ frameP50: number, frameP95: number, stepP95?: number }}
 */
export function guardLimits(baseline, factor = GUARD_FACTOR) {
  /** @type {{ frameP50: number, frameP95: number, stepP95?: number }} */
  const out = {
    frameP50: round1(baseline.frameMs.p50 * factor + FRAME_SLACK_MS),
    frameP95: round1(baseline.frameMs.p95 * factor + FRAME_SLACK_MS),
  };
  if (baseline.stepMs) out.stepP95 = round1(baseline.stepMs.p95 * factor);
  return out;
}

/**
 * Judges a probe's times against its baseline. Every metric becomes a trend row (the value, its
 * ratio to the baseline, the guard's limit); only a value above its guard is a failure. Sim step
 * p95 is judged when both the baseline and the probe have it.
 * @param {SoftTimes} measured
 * @param {SoftTimes} baseline
 * @param {number} [factor]
 * @returns {{ rows: TrendRow[], failures: string[] }}
 */
export function judgeSoft(measured, baseline, factor = GUARD_FACTOR) {
  const limits = guardLimits(baseline, factor);
  /** @type {[string, number, number, number | undefined][]} */
  const metrics = [
    ['frame p50', measured.frameMs.p50, baseline.frameMs.p50, limits.frameP50],
    ['frame p95', measured.frameMs.p95, baseline.frameMs.p95, limits.frameP95],
  ];
  if (measured.stepMs && baseline.stepMs)
    metrics.push(['sim step p95', measured.stepMs.p95, baseline.stepMs.p95, limits.stepP95]);
  /** @type {TrendRow[]} */
  const rows = [];
  /** @type {string[]} */
  const failures = [];
  for (const [metric, value, base, limit] of metrics) {
    if (limit === undefined) continue;
    const over = !(value <= limit);
    const ratio = base > 0 ? Math.round((value / base) * 100) / 100 : Number.NaN;
    rows.push({ metric, value, baseline: base, ratio, limit, over });
    if (over)
      failures.push(
        `${metric} ${value} ms is over the ${factor}x guard ${limit} ms (baseline ${base} ms): a catastrophic slowdown, not runner noise`,
      );
  }
  return { rows, failures };
}

/**
 * The printed trend line, one per probe.
 * @param {string} label
 * @param {TrendRow[]} rows
 */
export function trendLine(label, rows) {
  const parts = rows.map(
    (r) =>
      `${r.metric} ${r.value} ms (${r.ratio.toFixed(2)}x the baseline ${r.baseline}, guard ${r.limit}${r.over ? ', OVER' : ''})`,
  );
  return `perf trend (${label}): ${parts.join('; ')}`;
}

/**
 * The first-load JavaScript's line: its size against the budget, the headroom, and, when main's
 * size is known, the change against main. `warn` is set when the change is DELTA_WARN_KB or more.
 * @param {number} headBytes this build's first-load JavaScript, gzip bytes
 * @param {number} budgetKB
 * @param {number | null} baseBytes main's, or null when it was not measured
 * @returns {{ line: string, deltaBytes: number | null, headroomBytes: number, warn: boolean }}
 */
export function firstLoadReport(headBytes, budgetKB, baseBytes) {
  const headroomBytes = budgetKB * 1024 - headBytes;
  const deltaBytes = baseBytes === null ? null : headBytes - baseBytes;
  const warn = deltaBytes !== null && deltaBytes >= DELTA_WARN_KB * 1024;
  const room =
    headroomBytes >= 0 ? `${fmtBytes(headroomBytes)} headroom` : `${fmtBytes(-headroomBytes)} OVER`;
  const delta =
    deltaBytes === null
      ? 'change against main not measured'
      : `${deltaBytes >= 0 ? '+' : '-'}${fmtBytes(Math.abs(deltaBytes))} against main (${fmtBytes(baseBytes ?? 0)})`;
  return {
    line: `first-load JavaScript ${fmtBytes(headBytes)} gzip of ${budgetKB} KB (${room}), ${delta}`,
    deltaBytes,
    headroomBytes,
    warn,
  };
}

/**
 * The CI step summary (GitHub's job page): the size line and one table row per probe metric.
 * @param {{ size: string[], probes: { label: string, rows: TrendRow[] }[] }} parts
 */
export function summaryMarkdown({ size, probes }) {
  const out = ['### perf', '', ...size.map((s) => `- ${s}`), ''];
  if (probes.length) {
    out.push(
      `Frame and sim step times are a trend; the gate fails only above ${GUARD_FACTOR}x the baseline.`,
      '',
      '| probe | metric | ms | x baseline | baseline | guard |',
      '|---|---|---|---|---|---|',
    );
    for (const p of probes)
      for (const r of p.rows)
        out.push(
          `| ${p.label} | ${r.metric} | ${r.value}${r.over ? ' **OVER**' : ''} | ${r.ratio.toFixed(2)} | ${r.baseline} | ${r.limit} |`,
        );
  } else {
    out.push('No probe results were written (the probes did not run, or failed before measuring).');
  }
  return `${out.join('\n')}\n`;
}
