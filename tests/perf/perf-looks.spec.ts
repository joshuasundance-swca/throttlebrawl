import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// The perf check for the ink looks (render/looks): "Ink + 1960s film" (`kodak`, playtest 1b item 6),
// and "Sun-bleached wasteland" (`wasteland`) and "Kodachrome brush" (`brush`) from playtest 1c item 5.
// The same run as perf.spec.ts (seed 1 bot race, phone-landscape at device pixel ratio 1,
// CPU-throttled 4x from the race start), once per look, with the look set through the saved
// settings record, the way a player picks it. Every ink look draws the scene into an offscreen
// target and adds one full-screen pass; they share one shader per material, so they differ only in
// uniforms (the brush line adds 4 hash taps of arithmetic per pixel, no texture taps).
// - Hard gate: draw calls and triangles at the same fixed ticks stay within tests/perf/budget.json.
// - Soft tier: frame-time p50/p95 within twice the stored baseline (tests/perf/baseline.json, `soft`),
//   the same limits as the classic look. The numbers are printed with the renderer string.
// CI renders in software (SwiftShader), where a full-screen pass costs CPU time a phone GPU does not
// spend; the phone number (a Mali-G68 at 60 fps) comes from the maintainer's playtest.

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
}
interface Handle {
  snapshot(): { tick: number; entities: unknown[] } | null;
  setBot(on: boolean): void;
  perf(): PerfReport;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

const budget = JSON.parse(readFileSync('tests/perf/budget.json', 'utf8')) as {
  drawCallsMax: number;
  trianglesMax: number;
};
const baseline = JSON.parse(readFileSync('tests/perf/baseline.json', 'utf8')) as {
  soft?: { frameMs: { p50: number; p95: number } };
};

const CPU_THROTTLE = 4;
const SOFT_SECONDS = 20;
const CHECKPOINT_TICKS = [120, 480, 840] as const;
const SOFT_FACTOR = 2;

const INK_LOOKS = ['kodak', 'wasteland', 'brush'] as const;

for (const look of INK_LOOKS) {
  test(`perf, the ${look} look: draw calls and triangles at fixed ticks, and the 4x-throttled frame times`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.addInitScript((lk) => {
      (window as TestWindow).__GAME_TEST__ = true;
      // The saved settings record (save/'s format), with the look picked in Settings.
      const record = {
        format: 'settings',
        version: 1,
        build: 'perf',
        savedAt: '2026-09-30T00:00:00.000Z',
        data: { look: lk },
      };
      localStorage.setItem('mbrawl:settings', JSON.stringify(record));
    }, look);
    await page.goto('./');
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    const cdp = await page.context().newCDPSession(page);
    await page.locator('#menu-race').click();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    const started = Date.now();

    const checkpoints: { tick: number; drawCalls: number; triangles: number }[] = [];
    for (const tick of CHECKPOINT_TICKS) {
      await page.waitForFunction((t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) >= t, tick, {
        timeout: 120_000,
        polling: 50,
      });
      checkpoints.push(
        await page.evaluate(() => {
          const g = (window as TestWindow).__game;
          const r = g?.perf();
          return {
            tick: g?.snapshot()?.tick ?? 0,
            drawCalls: r?.drawCalls ?? 0,
            triangles: r?.triangles ?? 0,
          };
        }),
      );
    }
    const wait = SOFT_SECONDS * 1000 - (Date.now() - started);
    if (wait > 0) await page.waitForTimeout(wait);
    const report = (await page.evaluate(() => (window as TestWindow).__game?.perf())) as PerfReport;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    const printed = {
      scene: `${look} look, bot race, seed 1, base event; checkpoints at ticks ${CHECKPOINT_TICKS.join('/')}`,
      renderer: report.renderer,
      viewport: `${report.width}x${report.height} @${report.pixelRatio}`,
      cpuThrottle: CPU_THROTTLE,
      seconds: SOFT_SECONDS,
      checkpoints,
      frameMs: report.frameMs,
      fps: Math.round(report.fps * 10) / 10,
      stepMs: report.stepMs,
    };
    console.log(`perf probe (${look} look): ${JSON.stringify(printed)}`);
    mkdirSync('test-results', { recursive: true });
    writeFileSync(`test-results/perf-probe-${look}.json`, `${JSON.stringify(printed, null, 2)}\n`);

    for (const c of checkpoints) {
      expect(c.drawCalls, `draw calls at tick ${c.tick}`).toBeGreaterThan(0);
      expect(c.drawCalls, `draw calls at tick ${c.tick}`).toBeLessThanOrEqual(budget.drawCallsMax);
      expect(c.triangles, `triangles at tick ${c.tick}`).toBeLessThanOrEqual(budget.trianglesMax);
    }
    expect(report.frameMs.samples, 'frames sampled').toBeGreaterThan(30);
    const soft = baseline.soft;
    if (!soft) {
      console.log('[assert] soft tier: NOT ACTIVE (tests/perf/baseline.json has no `soft` block yet)');
      return;
    }
    const limits = { frameP50: soft.frameMs.p50 * SOFT_FACTOR, frameP95: soft.frameMs.p95 * SOFT_FACTOR };
    console.log(`[assert] soft tier (${look} look): ACTIVE, limits ${JSON.stringify(limits)}`);
    expect(report.frameMs.p50, 'frame p50 within 2x the baseline').toBeLessThanOrEqual(limits.frameP50);
    expect(report.frameMs.p95, 'frame p95 within 2x the baseline').toBeLessThanOrEqual(limits.frameP95);
  });
}
