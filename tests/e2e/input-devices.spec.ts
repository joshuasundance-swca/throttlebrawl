import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { placeElement, type TouchLayout } from '../../src/core/layout.ts';
import { InputFlag, type SimInput } from '../../src/sim/types.ts';

// input-1 browser device-path specs (docs/milestones/M1.md, "input-1"): real touches, sent through
// Chrome's touch emulation so they arrive as real Pointer Events with real pointer ids, and real
// key presses, reach the sim as the expected SimInput in the production build. The bot is off; the
// test handle's inputs() reads the player slot's recorded command per tick.

interface Handle {
  state(): string;
  inputs(from?: number): SimInput[];
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

const has = (s: SimInput, flag: keyof typeof InputFlag) => (s.flags & InputFlag[flag]) !== 0;

async function startRace(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible();
  await page.waitForFunction(() => ((window as TestWindow).__game?.inputs().length ?? 0) > 30);
  return problems;
}

const tickCount = (page: Page) => page.evaluate(() => (window as TestWindow).__game?.inputs().length ?? 0);

/** Waits for `ticks` more sim ticks after `from`, then returns every input from `from` on. */
async function inputsSince(page: Page, from: number, ticks = 12): Promise<SimInput[]> {
  await page.waitForFunction(([f, n]) => ((window as TestWindow).__game?.inputs().length ?? 0) >= f + n, [
    from,
    ticks,
  ] as const);
  return page.evaluate((f) => (window as TestWindow).__game?.inputs(f) ?? [], from);
}

/** The game's layout record: the pack's HUD layout (the settings mirror is off by default). */
function layoutRect(element: string, width: number, height: number) {
  const hud = JSON.parse(readFileSync('packs/base/hud/classic.json', 'utf8')) as TouchLayout;
  const el = hud.elements.find((e) => e.element === element);
  if (!el) throw new Error(`no ${element} in the classic layout`);
  const r = placeElement(el, width, height, hud.mirror);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

type Point = { x: number; y: number; id: number };
/**
 * One touch event. `at` (seconds since the epoch) stamps the event: Chrome carries it into the
 * Pointer Event's timeStamp, which is what the gesture windows measure. The timed gestures below
 * stamp their events explicitly, so their timing does not depend on how fast CDP round trips are
 * on a loaded runner (about 40 ms each on the dev machine, enough to push an unstamped swipe past
 * the 80 ms window and fail at random).
 */
const touch = (
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
  points: Point[],
  at?: number,
) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points,
    ...(at === undefined ? {} : { timestamp: at }),
  });
const now = () => Date.now() / 1000;

test('touch: the stick, the brake and the attack gestures produce the expected SimInput', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = await startRace(page);
  const view = page.viewportSize() ?? { width: 915, height: 412 };
  const cdp = await page.context().newCDPSession(page);
  const attack = layoutRect('touch-attack', view.width, view.height);
  const brake = layoutRect('touch-brake', view.width, view.height);

  // Stick: drag up and right for throttle and steer; a pointercancel releases it.
  let from = await tickCount(page);
  await touch(cdp, 'touchStart', [{ x: 150, y: 250, id: 1 }]);
  await touch(cdp, 'touchMove', [{ x: 185, y: 200, id: 1 }]);
  await touch(cdp, 'touchMove', [{ x: 220, y: 160, id: 1 }]);
  let seen = await inputsSince(page, from);
  const driving = seen[seen.length - 1]!;
  console.log(`stick held: ${JSON.stringify(driving)}`);
  expect(driving.throttle).toBe(255);
  expect(driving.steer).toBe(127);
  from = await tickCount(page);
  await touch(cdp, 'touchCancel', []);
  seen = await inputsSince(page, from, 6);
  expect(seen[seen.length - 1]).toMatchObject({ throttle: 0, steer: 0 });

  // Brake: held while the finger is down.
  from = await tickCount(page);
  await touch(cdp, 'touchStart', [{ ...brake, id: 2 }]);
  seen = await inputsSince(page, from, 6);
  expect(seen[seen.length - 1]?.brake).toBe(255);
  await touch(cdp, 'touchEnd', []);

  // A tap on attack: attack on exactly one tick, auto side, no kick.
  from = await tickCount(page);
  await touch(cdp, 'touchStart', [{ ...attack, id: 3 }]);
  await touch(cdp, 'touchEnd', []);
  seen = await inputsSince(page, from);
  expect(seen.filter((s) => has(s, 'attack'))).toHaveLength(1);
  expect(seen.some((s) => has(s, 'kick') || has(s, 'attackSideLeft') || has(s, 'attackSideRight'))).toBe(
    false,
  );

  // A quick 30 px drag to the right (in 40 ms) picks the right side.
  from = await tickCount(page);
  let t0 = now();
  await Promise.all([
    touch(cdp, 'touchStart', [{ ...attack, id: 4 }], t0),
    touch(cdp, 'touchMove', [{ x: attack.x + 15, y: attack.y, id: 4 }], t0 + 0.02),
    touch(cdp, 'touchMove', [{ x: attack.x + 30, y: attack.y, id: 4 }], t0 + 0.04),
  ]);
  seen = await inputsSince(page, from);
  await touch(cdp, 'touchEnd', []);
  expect(seen.filter((s) => has(s, 'attack'))).toHaveLength(1);
  expect(seen.some((s) => has(s, 'attackSideRight'))).toBe(true);

  // A 32 px swipe down in 50 ms: attack, then kick, with the kick seen before the 7-tick punch
  // wind-up ends. The events go out back to back, as a phone's digitizer (60 Hz or faster) would.
  from = await tickCount(page);
  t0 = now();
  await Promise.all([
    touch(cdp, 'touchStart', [{ ...attack, id: 5 }], t0),
    touch(cdp, 'touchMove', [{ x: attack.x, y: attack.y + 15, id: 5 }], t0 + 0.025),
    touch(cdp, 'touchMove', [{ x: attack.x, y: attack.y + 32, id: 5 }], t0 + 0.05),
  ]);
  await touch(cdp, 'touchEnd', [], t0 + 0.06);
  seen = await inputsSince(page, from);
  const pressTick = seen.findIndex((s) => has(s, 'attack'));
  const kickTick = seen.findIndex((s) => has(s, 'kick'));
  console.log(`swipe down: attack at +${pressTick}, kick at +${kickTick} ticks`);
  expect(pressTick).toBeGreaterThanOrEqual(0);
  expect(kickTick).toBeGreaterThanOrEqual(pressTick);
  expect(kickTick - pressTick).toBeLessThan(7);
  expect(seen.filter((s) => has(s, 'attack'))).toHaveLength(1);

  // A slow drag down (30 px over 300 ms) stays a punch.
  from = await tickCount(page);
  t0 = now();
  await touch(cdp, 'touchStart', [{ ...attack, id: 6 }], t0);
  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(30);
    await touch(cdp, 'touchMove', [{ x: attack.x, y: attack.y + 3 * i, id: 6 }], t0 + 0.03 * i);
  }
  await touch(cdp, 'touchEnd', [], t0 + 0.31);
  seen = await inputsSince(page, from);
  expect(seen.filter((s) => has(s, 'attack'))).toHaveLength(1);
  expect(seen.some((s) => has(s, 'kick'))).toBe(false);

  expect(problems, 'no console errors or page errors').toEqual([]);
});

test('keyboard: keys produce the expected SimInput', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = await startRace(page);

  // Throttle ramps to full while held; steer and brake.
  let from = await tickCount(page);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ArrowLeft');
  let seen = await inputsSince(page, from, 30);
  expect(seen[seen.length - 1]).toMatchObject({ throttle: 255, steer: -127 });
  expect(seen[0]!.throttle).toBeLessThan(255); // it ramps, it does not jump
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ArrowLeft');
  from = await tickCount(page);
  await page.keyboard.down('KeyS');
  seen = await inputsSince(page, from, 6);
  expect(seen[seen.length - 1]).toMatchObject({ throttle: 0, steer: 0, brake: 255 });
  await page.keyboard.up('KeyS');

  // J: one attack per press, even when held.
  from = await tickCount(page);
  await page.keyboard.down('KeyJ');
  seen = await inputsSince(page, from, 20);
  await page.keyboard.up('KeyJ');
  expect(seen.filter((s) => has(s, 'attack'))).toHaveLength(1);

  // O: attack forced right; K: kick.
  from = await tickCount(page);
  await page.keyboard.press('KeyO');
  seen = await inputsSince(page, from);
  expect(seen.filter((s) => has(s, 'attack'))).toHaveLength(1);
  expect(seen.some((s) => has(s, 'attackSideRight'))).toBe(true);
  from = await tickCount(page);
  await page.keyboard.press('KeyK');
  seen = await inputsSince(page, from);
  expect(seen.some((s) => has(s, 'attack') && has(s, 'kick'))).toBe(true);

  expect(problems, 'no console errors or page errors').toEqual([]);
});
