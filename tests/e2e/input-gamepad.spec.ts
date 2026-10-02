import { expect, test, type Page } from '@playwright/test';
import { InputFlag, type SimInput } from '../../src/sim/types.ts';

// input-2 browser spec (docs/milestones/M2.md, "input-2"): a mocked Gamepad API in the production
// build drives the player's recorded SimInput, including a kick. navigator.getGamepads is replaced
// before the page loads with one standard-mapping pad whose state the test sets through
// window.__pad; the game polls it on every sim tick. The bot is off; the test handle's inputs()
// reads the player slot's recorded command per tick.
//
// Presses are held and released by sim ticks, never by wall-clock time. The pad is polled only
// when a tick steps, and a software-rendered CI runner draws about 10 frames a second with longer
// stalls, so a 300 ms press could start and end between two polls (main's run 36981877768 recorded
// no Cross press at all). Each press waits until the recorded inputs show it, is held for a count of
// ticks, and each release waits until a recorded input shows it.

interface Handle {
  inputs(from?: number): SimInput[];
}
interface FakePad {
  connected: boolean;
  mapping: string;
  id: string;
  index: number;
  timestamp: number;
  axes: number[];
  buttons: { pressed: boolean; touched: boolean; value: number }[];
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle; __pad?: FakePad };

const has = (s: SimInput, flag: keyof typeof InputFlag) => (s.flags & InputFlag[flag]) !== 0;

// Standard-mapping indices.
const CROSS = 0;
const TRIANGLE = 3;
const L2 = 6;
const R2 = 7;

async function setPad(page: Page, change: { axes?: number[]; buttons?: Record<number, number> }) {
  await page.evaluate((c) => {
    const pad = (window as TestWindow).__pad!;
    if (c.axes) pad.axes = c.axes;
    for (const [i, v] of Object.entries(c.buttons ?? {}))
      pad.buttons[Number(i)] = { pressed: v >= 0.5, touched: v > 0, value: v };
    pad.timestamp = performance.now();
  }, change);
}

interface Want {
  throttle?: number;
  steer?: number;
  brake?: number;
  flags?: number;
}

/** Waits until the last recorded input matches `want`, then returns it. */
async function untilLast(page: Page, want: Want, label: string) {
  await page.waitForFunction(
    (w) => {
      const all = (window as TestWindow).__game?.inputs() ?? [];
      const last = all[all.length - 1] as unknown as Record<string, number> | undefined;
      if (!last) return false;
      return Object.entries(w).every(([k, v]) => last[k] === v);
    },
    want,
    { timeout: 10_000 },
  );
  const last = await page.evaluate(() => {
    const all = (window as TestWindow).__game?.inputs() ?? [];
    return all[all.length - 1]!;
  });
  console.log(`${label}: ${JSON.stringify(last)}`);
  return last;
}

/** The number of ticks recorded this race: one SimInput, and one pad poll, per stepped tick. */
const ticks = (page: Page) => page.evaluate(() => (window as TestWindow).__game!.inputs().length);

/** Waits until a recorded input from tick `from` on has `flag` set, and returns that tick. */
async function untilSeen(page: Page, from: number, flag: number, label: string) {
  const at = await page.waitForFunction(
    ([f, bit]) => {
      const i = ((window as TestWindow).__game?.inputs(f) ?? []).findIndex((s) => (s.flags & bit) !== 0);
      return i < 0 ? false : f + i;
    },
    [from, flag] as const,
    { timeout: 10_000 },
  );
  const tick = (await at.jsonValue()) as number;
  console.log(`${label}: polled at tick ${tick} (${tick - from} after the press was set)`);
  return tick;
}

/** Waits until the sim has recorded `tick` ticks, so the pad has been polled up to there. */
async function untilTick(page: Page, tick: number) {
  await page.waitForFunction((t) => ((window as TestWindow).__game?.inputs().length ?? 0) >= t, tick, {
    timeout: 10_000,
  });
}

// The original holds, in ticks at 60 Hz: 300 ms for Cross, 100 ms for Triangle.
const CROSS_HOLD_TICKS = 18;
const TRIANGLE_HOLD_TICKS = 6;

test('gamepad: a mocked standard pad steers, throttles, brakes, attacks and kicks', async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  await page.addInitScript(() => {
    const w = window as TestWindow;
    w.__GAME_TEST__ = true;
    w.__pad = {
      connected: true,
      mapping: 'standard',
      id: 'test pad (STANDARD GAMEPAD)',
      index: 0,
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => [w.__pad, null, null, null],
      configurable: true,
    });
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible();
  await page.waitForFunction(() => ((window as TestWindow).__game?.inputs().length ?? 0) > 30);

  // Left stick full right plus R2: steer and throttle.
  await setPad(page, { axes: [1, 0, 0, 0], buttons: { [R2]: 1 } });
  const driving = await untilLast(page, { throttle: 255, steer: 127 }, 'stick right + R2');
  expect(driving).toMatchObject({ throttle: 255, steer: 127 });

  // Inside the 0.12 dead zone the stick steers nothing.
  await setPad(page, { axes: [0.08, 0, 0, 0] });
  expect((await untilLast(page, { steer: 0 }, 'stick in the dead zone')).steer).toBe(0);

  // L2 brakes.
  await setPad(page, { buttons: { [R2]: 0, [L2]: 1 } });
  expect((await untilLast(page, { brake: 255, throttle: 0 }, 'L2')).brake).toBe(255);
  await setPad(page, { buttons: { [L2]: 0 } });
  await untilLast(page, { brake: 0 }, 'L2 released');

  // Cross: one attack press, however long it is held. Cross also asks to skip the run-back, a
  // held flag, so the last input reads flags 0 only once a poll has seen the release.
  let from = await ticks(page);
  await setPad(page, { buttons: { [CROSS]: 1 } });
  const crossAt = await untilSeen(page, from, InputFlag.attack, 'Cross pressed');
  await untilTick(page, crossAt + 1 + CROSS_HOLD_TICKS);
  await setPad(page, { buttons: { [CROSS]: 0 } });
  await untilLast(page, { flags: 0 }, 'Cross released');
  let seen = await page.evaluate((f) => (window as TestWindow).__game!.inputs(f), from);
  // The hold really spanned the ticks: more than CROSS_HOLD_TICKS polls read Cross down.
  expect(seen.filter((s) => has(s, 'skipRunBack')).length).toBeGreaterThan(CROSS_HOLD_TICKS);
  expect(seen.filter((s) => has(s, 'attack'))).toHaveLength(1);
  expect(seen.some((s) => has(s, 'kick'))).toBe(false);

  // Triangle: an attack press with the kick flag.
  from = await ticks(page);
  await setPad(page, { buttons: { [TRIANGLE]: 1 } });
  const triangleAt = await untilSeen(page, from, InputFlag.kick, 'Triangle pressed');
  await untilTick(page, triangleAt + 1 + TRIANGLE_HOLD_TICKS);
  await setPad(page, { buttons: { [TRIANGLE]: 0 } });
  await untilLast(page, { flags: 0 }, 'Triangle released');
  seen = await page.evaluate((f) => (window as TestWindow).__game!.inputs(f), from);
  const press = seen.findIndex((s) => has(s, 'attack'));
  expect(press).toBeGreaterThanOrEqual(0);
  expect(has(seen[press]!, 'kick')).toBe(true);
  expect(seen.filter((s) => has(s, 'attack'))).toHaveLength(1);

  expect(problems).toEqual([]);
});
