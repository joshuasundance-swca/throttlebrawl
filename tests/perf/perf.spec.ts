import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { GUARD_FACTOR, guardLimits, judgeSoft, trendLine } from '../../scripts/perf-limits.mjs';

// The perf check (docs/engineering.md, "Perf check"; M1 dev-2), run by `npm run perf` after the
// download-size budget. One seeded bot race (seed 1, the test flag's seed), CPU-throttled 4x from
// the race start, phone-landscape viewport at device pixel ratio 1:
// - Hard gate: draw calls and triangles at fixed sim ticks stay within tests/perf/budget.json.
// - Soft tier, a trend: after 20 s of racing, frame-time p50/p95 and sim-step p95 from dev/perf are
//   printed on every run with their ratio to the stored baseline (tests/perf/baseline.json, `soft`)
//   and the renderer string, and written to test-results/perf-probe.json; scripts/perf.mjs puts
//   them in CI's step summary. They fail only above 3x the baseline, a catastrophe guard that
//   runner noise cannot reach (scripts/perf-limits.mjs; the maintainer, 2026-10-02: "Trend plus
//   3x guard"). On 2026-10-02 the same code printed p95 100.1 ms, then 150 ms, against a 2x limit.
// - Slow-motion pile-up checkpoint (M2 dev-4): the first frame the sim's takedown slow motion is
//   active during the run is a checkpoint too, held to the same draw-call and triangle budget. It
//   prints NOT ACTIVE while no slow motion happens in the run: combat-4's slow motion needs a
//   player-involved takedown, which the seeded bot race may not have in its first seconds. A staged
//   pile-up scene can replace the seeded race's luck once the test handle can set one up.
// Not active yet: forcing quality tier `low` with dynamic resolution off through the test flag
// (render has no quality tiers or dynamic resolution in M1; the DPR is pinned to 1 by the config).

interface Pct {
  samples: number;
  p50: number;
  p95: number;
  max: number;
}
interface PerfReport {
  renderer: string;
  pixelRatio: number;
  width: number;
  height: number;
  drawCalls: number;
  triangles: number;
  frameMs: Pct;
  fps: number;
  stepMs: Pct;
  refreshHz: number | null;
  heapMB: number | null;
}
interface Handle {
  snapshot(): { tick: number; entities: unknown[]; slowmo?: { active: boolean } } | null;
  setBot(on: boolean): void;
  perf(): PerfReport;
}
interface Checkpoint {
  tick: number;
  drawCalls: number;
  triangles: number;
  movers: number;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle; __slowmoCheckpoint?: Checkpoint };

interface Budget {
  drawCallsMax: number;
  trianglesMax: number;
}
interface SoftBaseline {
  cpuThrottle: number;
  seconds: number;
  frameMs: { p50: number; p95: number };
  stepMs: { p95: number };
}

const budget = JSON.parse(readFileSync('tests/perf/budget.json', 'utf8')) as Budget;
const baseline = JSON.parse(readFileSync('tests/perf/baseline.json', 'utf8')) as { soft?: SoftBaseline };

const CPU_THROTTLE = 4;
const SOFT_SECONDS = 20;
const CHECKPOINT_TICKS = [120, 480, 840] as const;

test('perf: draw calls and triangles at fixed ticks, and the 4x-throttled frame and sim times', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    // This check's budgets and baseline are the Classic look's; Ink + 60s film is the default
    // since run W-O, so the run picks Classic through the saved record, as a player would
    // (perf-looks.spec.ts measures the ink looks against their own baseline).
    const record = {
      format: 'settings',
      version: 1,
      build: 'perf',
      savedAt: '2026-10-01T00:00:00.000Z',
      data: { look: 'classic' },
    };
    localStorage.setItem('mbrawl:settings', JSON.stringify(record));
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  const cdp = await page.context().newCDPSession(page);
  await page.locator('#menu-race').click();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  const started = Date.now();
  // The slow-motion checkpoint: the first animation frame with the takedown slow motion active.
  await page.evaluate(() => {
    const w = window as TestWindow;
    const watch = () => {
      const g = w.__game;
      const s = g?.snapshot();
      if (g && s?.slowmo?.active && !w.__slowmoCheckpoint) {
        const r = g.perf();
        w.__slowmoCheckpoint = {
          tick: s.tick,
          drawCalls: r.drawCalls,
          triangles: r.triangles,
          movers: s.entities.length,
        };
      }
      if (!w.__slowmoCheckpoint) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });

  // Hard gate: the scene at fixed sim ticks.
  const checkpoints: Checkpoint[] = [];
  for (const tick of CHECKPOINT_TICKS) {
    await page.waitForFunction((t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) >= t, tick, {
      timeout: 120_000,
      polling: 50,
    });
    const at = await page.evaluate(() => {
      const g = (window as TestWindow).__game;
      const r = g?.perf();
      const s = g?.snapshot();
      return {
        tick: s?.tick ?? 0,
        drawCalls: r?.drawCalls ?? 0,
        triangles: r?.triangles ?? 0,
        movers: s?.entities.length ?? 0,
      };
    });
    checkpoints.push(at);
  }

  // Soft tier: the probe's numbers after SOFT_SECONDS of throttled racing.
  const wait = SOFT_SECONDS * 1000 - (Date.now() - started);
  if (wait > 0) await page.waitForTimeout(wait);
  const report = (await page.evaluate(() => (window as TestWindow).__game?.perf())) as PerfReport;
  const slowmo = await page.evaluate<Checkpoint | null>(
    () => (window as TestWindow).__slowmoCheckpoint ?? null,
  );
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const soft = baseline.soft;
  const judged = soft ? judgeSoft(report, soft) : null;
  // The hard tier's headroom, printed every run so a scene creeping toward its budget shows early.
  const scenes = slowmo ? [...checkpoints, slowmo] : checkpoints;
  const headroom = {
    drawCalls: budget.drawCallsMax - Math.max(...scenes.map((c) => c.drawCalls)),
    triangles: budget.trianglesMax - Math.max(...scenes.map((c) => c.triangles)),
  };
  const printed = {
    scene: `bot race, seed 1, base event; checkpoints at ticks ${CHECKPOINT_TICKS.join('/')}`,
    renderer: report.renderer,
    viewport: `${report.width}x${report.height} @${report.pixelRatio}`,
    cpuThrottle: CPU_THROTTLE,
    seconds: SOFT_SECONDS,
    checkpoints,
    slowmoCheckpoint: slowmo,
    frameMs: report.frameMs,
    fps: Math.round(report.fps * 10) / 10,
    stepMs: report.stepMs,
    refreshHz: report.refreshHz,
    heapMB: report.heapMB === null ? null : Math.round(report.heapMB),
    budget: { drawCallsMax: budget.drawCallsMax, trianglesMax: budget.trianglesMax },
    headroom,
    trend: judged?.rows ?? null,
  };
  console.log(`renderer: ${report.renderer}`);
  console.log(`perf probe: ${JSON.stringify(printed)}`);
  if (judged) console.log(trendLine('classic', judged.rows));
  console.log(
    `perf headroom (classic): ${headroom.drawCalls} draw calls under ${budget.drawCallsMax}, ` +
      `${headroom.triangles} triangles under ${budget.trianglesMax}, at the busiest checkpoint`,
  );
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/perf-probe.json', `${JSON.stringify(printed, null, 2)}\n`);

  // Hard gate.
  expect(report.renderer.length, 'a renderer string').toBeGreaterThan(0);
  for (const c of checkpoints) {
    expect(c.drawCalls, `draw calls at tick ${c.tick}`).toBeGreaterThan(0);
    expect(c.drawCalls, `draw calls at tick ${c.tick}`).toBeLessThanOrEqual(budget.drawCallsMax);
    expect(c.triangles, `triangles at tick ${c.tick}`).toBeLessThanOrEqual(budget.trianglesMax);
  }

  if (slowmo) {
    console.log(
      `[assert] slow-motion pile-up checkpoint: ACTIVE (tick ${slowmo.tick}, ${slowmo.movers} movers)`,
    );
    expect(slowmo.drawCalls, 'draw calls in slow motion').toBeLessThanOrEqual(budget.drawCallsMax);
    expect(slowmo.triangles, 'triangles in slow motion').toBeLessThanOrEqual(budget.trianglesMax);
  } else {
    console.log(
      `[assert] slow-motion pile-up checkpoint: NOT ACTIVE (no player-involved takedown slow motion in the first ${SOFT_SECONDS} s of the seeded race; a staged pile-up is dev-4 part 2)`,
    );
  }

  // Soft tier: a trend, with a catastrophe guard.
  expect(report.frameMs.samples, 'frames sampled').toBeGreaterThan(30);
  expect(report.stepMs.samples, 'sim steps timed').toBeGreaterThan(30);
  if (!soft || !judged) {
    console.log('[assert] soft tier: NOT ACTIVE (tests/perf/baseline.json has no `soft` block yet)');
    return;
  }
  console.log(
    `[assert] soft tier: a trend plus a ${GUARD_FACTOR}x guard, guards ${JSON.stringify(guardLimits(soft))} (frames plus half a frame)`,
  );
  expect(judged.failures, `frame and sim step times within ${GUARD_FACTOR}x the baseline`).toEqual([]);
});
