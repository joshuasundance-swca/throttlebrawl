import { expect, test, type Page } from '@playwright/test';
import { InputFlag, type SimInput } from '../../src/sim/types.ts';

// input-2 browser spec (docs/milestones/M2.md, "input-2"): a mocked Gamepad API in the production
// build drives the player's recorded SimInput, including a kick. navigator.getGamepads is replaced
// before the page loads with one standard-mapping pad whose state the test sets through
// window.__pad; the game polls it on every sim tick. The bot is off; the test handle's inputs()
// reads the player slot's recorded command per tick.

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
  /** At least one of these flag bits is set. */
  anyFlags?: number;
}

/** Waits until the last recorded input matches `want`, then returns it. */
async function untilLast(page: Page, want: Want, label: string) {
  await page.waitForFunction(
    (w) => {
      const all = (window as TestWindow).__game?.inputs() ?? [];
      const last = all[all.length - 1] as unknown as Record<string, number> | undefined;
      if (!last) return false;
      const { anyFlags, ...exact } = w;
      if (anyFlags !== undefined && ((last['flags'] ?? 0) & anyFlags) === 0) return false;
      return Object.entries(exact).every(([k, v]) => last[k] === v);
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

  // Cross: one attack press, however long it is held.
  let from = await page.evaluate(() => (window as TestWindow).__game!.inputs().length);
  await setPad(page, { buttons: { [CROSS]: 1 } });
  await page.waitForTimeout(300);
  await setPad(page, { buttons: { [CROSS]: 0 } });
  await untilLast(page, { flags: 0 }, 'Cross released');
  let seen = await page.evaluate((f) => (window as TestWindow).__game!.inputs(f), from);
  expect(seen.filter((s) => has(s, 'attack'))).toHaveLength(1);
  expect(seen.some((s) => has(s, 'kick'))).toBe(false);

  // Triangle: an attack press with the kick flag.
  from = await page.evaluate(() => (window as TestWindow).__game!.inputs().length);
  await setPad(page, { buttons: { [TRIANGLE]: 1 } });
  await untilLast(page, { anyFlags: InputFlag.kick }, 'Triangle held');
  await page.waitForTimeout(100);
  await setPad(page, { buttons: { [TRIANGLE]: 0 } });
  await untilLast(page, { flags: 0 }, 'Triangle released');
  seen = await page.evaluate((f) => (window as TestWindow).__game!.inputs(f), from);
  const press = seen.findIndex((s) => has(s, 'attack'));
  expect(press).toBeGreaterThanOrEqual(0);
  expect(has(seen[press]!, 'kick')).toBe(true);
  expect(seen.filter((s) => has(s, 'attack'))).toHaveLength(1);

  expect(problems).toEqual([]);
});
