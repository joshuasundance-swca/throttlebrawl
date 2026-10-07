// The perf check's rules for the numbers it prints (docs/engineering.md, "Perf check"), kept in
// one place so the Playwright probes, scripts/perf.mjs and a unit test (perf-limits.test.ts) agree.
//
// - Soft tier: frame time p50 and p95, sim step p95 and the start tap's main-thread work are a TREND.
//   CI prints them on every run
//   with their ratio to the stored baseline (tests/perf/baseline.json). They fail the gate only
//   above GUARD_FACTOR times the baseline, a catastrophe guard that runner noise cannot reach (the
//   maintainer, 2026-10-02: "Trend plus 3x guard"). On 2026-10-02 the same game code printed a
//   classic frame p95 of 100.1 ms and then 150 ms on CI's software renderer, so a 2x limit
//   flipped on noise.
// - Download size: the first-load JavaScript stays a hard budget; this file words its headroom and
//   a pull request's own change against main, warns on a big change, and holds a pull request that
//   grows the first load to a floor of PR_FLOOR_KB headroom (main's pushes keep the budget alone).
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

/**
 * A pull request's floor: a PR that grows the first-load JavaScript must leave at least this much
 * headroom under the budget, or the perf check fails it. Main's pushes keep the budget alone.
 * [default] (the coordinator, 2026-10-03: the 500 KB budget was crossed 4 times on 10-02 and 10-03
 * by PRs that each fit alone, so main went red; the floor turns the PR that eats the margin red.)
 */
export const PR_FLOOR_KB = 10;

/**
 * The start tap is a printed trend with no guard until its baseline rests on this many CI readings
 * (the frame baseline rests on 8). The K2 review found a 3x guard on 3 readings could redden a train
 * for a change that did nothing to the tap: a model arriving between the click and the next frame
 * can add 400 to 650 ms to one reading, and 3 or 4 readings cannot bound how often that happens.
 */
export const START_TAP_GUARD_MIN_READINGS = 8;

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * `startTapMs` is the start tap's main-thread work (tests/perf/perf.spec.ts): the tap's click handlers,
 * the audio calls between them and the next frame, and the next frame's work up to the probe's own
 * frame callback, in ms. It is a trend row once both the probe and the baseline have it, and a
 * guarded one only when the baseline's `startTapReadings` (how many CI readings it rests on) is
 * START_TAP_GUARD_MIN_READINGS or more (polish F's live check, punch item 2: the menu came 215 ms
 * after the tap, then 461 ms, and nothing on CI measured it).
 * @typedef {{ frameMs: { p50: number, p95: number }, stepMs?: { p95: number }, startTapMs?: number, startTapReadings?: number }} SoftTimes
 * @typedef {{ metric: string, value: number, baseline: number, ratio: number, limit: number | null, over: boolean }} TrendRow
 */

/**
 * Whether the baseline's start tap rests on enough CI readings to guard it.
 * @param {SoftTimes} baseline
 */
function startTapGuarded(baseline) {
  return (
    baseline.startTapMs !== undefined && (baseline.startTapReadings ?? 0) >= START_TAP_GUARD_MIN_READINGS
  );
}

/**
 * The guard's limits for a baseline, rounded to 0.1 ms. The start tap's work is not counted in whole
 * frames, so like the sim step it gets no slack.
 * @param {SoftTimes} baseline
 * @param {number} [factor]
 * @returns {{ frameP50: number, frameP95: number, stepP95?: number, startTap?: number }}
 */
export function guardLimits(baseline, factor = GUARD_FACTOR) {
  /** @type {{ frameP50: number, frameP95: number, stepP95?: number, startTap?: number }} */
  const out = {
    frameP50: round1(baseline.frameMs.p50 * factor + FRAME_SLACK_MS),
    frameP95: round1(baseline.frameMs.p95 * factor + FRAME_SLACK_MS),
  };
  if (baseline.stepMs) out.stepP95 = round1(baseline.stepMs.p95 * factor);
  if (startTapGuarded(baseline)) out.startTap = round1((baseline.startTapMs ?? 0) * factor);
  return out;
}

/**
 * Judges a probe's times against its baseline. Every metric becomes a trend row (the value, its
 * ratio to the baseline, the guard's limit); only a value above its guard is a failure. Sim step
 * p95 and the start tap are judged when both the baseline and the probe have them; the start tap
 * is a trend row with no guard (and so no failure) until its baseline has 8 CI readings.
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
  if (measured.startTapMs !== undefined && baseline.startTapMs !== undefined)
    metrics.push(['start tap', measured.startTapMs, baseline.startTapMs, limits.startTap]);
  /** @type {TrendRow[]} */
  const rows = [];
  /** @type {string[]} */
  const failures = [];
  for (const [metric, value, base, guard] of metrics) {
    // A metric with no guard yet (the start tap, below 8 readings) is a printed trend row only.
    if (guard === undefined && metric !== 'start tap') continue;
    const limit = guard ?? null;
    const over = limit !== null && !(value <= limit);
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
      `${r.metric} ${r.value} ms (${r.ratio.toFixed(2)}x the baseline ${r.baseline}, ${r.limit === null ? 'no guard yet' : `guard ${r.limit}`}${r.over ? ', OVER' : ''})`,
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
 * Whether this run judges a pull request: GitHub's `pull_request` event (a push to main is `push`).
 * @param {Record<string, string | undefined>} env
 */
export function isPullRequestRun(env) {
  return env.GITHUB_EVENT_NAME === 'pull_request';
}

/**
 * The floor's verdict on a pull request's build: a failure message when it leaves less than
 * `floorKB` of headroom, or null. Null on a run that is not a pull request (main keeps the budget
 * alone), and over the budget (the budget's own failure speaks). A PR whose measured change does
 * not grow the first load never fails it: when main itself has drifted inside the floor (two PRs
 * that each fit, merged), only the PR that adds to it goes red, never every PR or the one that
 * shrinks it. A change that was not measured is held to the floor.
 * @param {{ headroomBytes: number, deltaBytes: number | null }} report firstLoadReport's numbers
 * @param {number} budgetKB
 * @param {boolean} pullRequest
 * @param {number} [floorKB]
 * @returns {string | null}
 */
export function floorProblem(report, budgetKB, pullRequest, floorKB = PR_FLOOR_KB) {
  const { headroomBytes, deltaBytes } = report;
  if (!pullRequest || headroomBytes < 0 || headroomBytes >= floorKB * 1024) return null;
  if (deltaBytes !== null && deltaBytes <= 0) return null;
  const change =
    deltaBytes === null
      ? 'its change against main was not measured'
      : `this one grows it by ${fmtBytes(deltaBytes)}`;
  return (
    `this PR leaves ${fmtBytes(headroomBytes)} of headroom; move something off the first load. ` +
    `A pull request must leave at least ${floorKB} KB of the ${budgetKB} KB first-load JavaScript budget, ` +
    `and ${change}: move code the first screen does not need into a lazy import() chunk ` +
    '(docs/engineering.md, perf check)'
  );
}

/**
 * The CI step summary (GitHub's job page): the size line and one table row per probe metric.
 * @param {{ size: string[], probes: { label: string, rows: TrendRow[] }[] }} parts
 */
export function summaryMarkdown({ size, probes }) {
  const out = ['### perf', '', ...size.map((s) => `- ${s}`), ''];
  if (probes.length) {
    out.push(
      `Frame times, the sim step and the start tap are a trend; the gate fails only above ${GUARD_FACTOR}x the baseline.`,
      '',
      '| probe | metric | ms | x baseline | baseline | guard |',
      '|---|---|---|---|---|---|',
    );
    for (const p of probes)
      for (const r of p.rows)
        out.push(
          `| ${p.label} | ${r.metric} | ${r.value}${r.over ? ' **OVER**' : ''} | ${r.ratio.toFixed(2)} | ${r.baseline} | ${r.limit ?? 'none yet'} |`,
        );
  } else {
    out.push('No probe results were written (the probes did not run, or failed before measuring).');
  }
  return `${out.join('\n')}\n`;
}
