import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { placeElement, type TouchLayout } from '../../src/core/layout.ts';
import { InputFlag, type SimEvent, type SimInput } from '../../src/sim/types.ts';

// Playtest 1 (2026-09-30), item 3: "Can't kick". A scripted 180 ms swipe down on the attack
// button, a natural swipe rather than M1's 80 ms flick, produces a kick and not a punch, end to end
// in the production build: real touches (Chrome's touch emulation) reach input, the kick flag
// reaches the sim, and the player's attack chain is a `base:kick` with no punch landing or
// missing in it.
//
// Two paths:
// - burst: the whole swipe arrives at once, stamped over 180 ms, so input sees the swipe before
//   the press is sampled and the attack starts as a kick (input's window alone);
// - real time: the swipe's end arrives about 150 ms after the press, so the punch has already
//   started and its 7-tick wind-up is over when the kick flag reaches the sim; only combat's
//   kick-conversion window (combat.kickConvertMs, 15 ticks) turns it into a kick. The events are
//   stamped (the gesture is judged by the stamps), but when they are *delivered* depends on the
//   runner's load: an attempt whose kick flag reached the sim outside 7-15 ticks after the press,
//   or whose punch landed before the kick flag arrived, proves nothing about the conversion and
//   is sent again, up to 4 times.

interface Handle {
  inputs(from?: number): SimInput[];
  events(): readonly SimEvent[];
  playerId(): number;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };
type ChainEvent = { tick: number; type: string; causeId: number | undefined; data: SimEvent['data'] };

type Point = { x: number; y: number; id: number };
const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[], at: number) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points, timestamp: at });

function attackCenter(width: number, height: number) {
  const hud = JSON.parse(readFileSync('packs/base/hud/classic.json', 'utf8')) as TouchLayout;
  const el = hud.elements.find((e) => e.element === 'touch-attack');
  if (!el) throw new Error('no touch-attack in the classic layout');
  const r = placeElement(el, width, height, hud.mirror);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

async function startRace(page: Page, problems: string[]) {
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible();
  await page.waitForFunction(() => ((window as TestWindow).__game?.inputs().length ?? 0) > 60);
}

/**
 * One 26 px swipe down, stamped over 180 ms (24 px, kickSwipePx, is crossed only at the end).
 * `realMs` is how long to wait, in real time, before sending the end of the swipe (0: all at once).
 */
async function swipe(page: Page, cdp: CDPSession, id: number, realMs: number) {
  const view = page.viewportSize() ?? { width: 915, height: 412 };
  const attack = attackCenter(view.width, view.height);
  const from = await page.evaluate(() => (window as TestWindow).__game!.inputs().length);
  const after = await page.evaluate(() => {
    const ev = (window as TestWindow).__game!.events();
    return ev.length ? ev[ev.length - 1]!.tick : 0;
  });
  const t0 = Date.now() / 1000;
  const moves = [
    [8, 0.06],
    [16, 0.12],
    [26, 0.18],
  ] as const;
  if (realMs === 0) {
    await Promise.all([
      touch(cdp, 'touchStart', [{ ...attack, id }], t0),
      ...moves.map(([dy, dt]) => touch(cdp, 'touchMove', [{ x: attack.x, y: attack.y + dy, id }], t0 + dt)),
    ]);
  } else {
    await touch(cdp, 'touchStart', [{ ...attack, id }], t0);
    await page.waitForTimeout(realMs);
    await Promise.all(
      moves.map(([dy, dt]) => touch(cdp, 'touchMove', [{ x: attack.x, y: attack.y + dy, id }], t0 + dt)),
    );
  }
  await touch(cdp, 'touchEnd', [], t0 + 0.19);
  // The kick's wind-up, active moment, recovery and cooldown all play out.
  await page.waitForTimeout(1500);

  const inputs = await page.evaluate((f) => (window as TestWindow).__game!.inputs(f), from);
  const press = inputs.findIndex((s) => (s.flags & InputFlag.attack) !== 0);
  const kick = inputs.findIndex((s) => (s.flags & InputFlag.kick) !== 0);
  const events = await page.evaluate((t) => {
    const g = (window as TestWindow).__game!;
    const player = g.playerId();
    return g
      .events()
      .filter((e) => e.tick > t && e.actor === player)
      .map((e) => ({ tick: e.tick, type: e.type, causeId: e.causeId, data: e.data }));
  }, after);
  const first = events.find((e) => e.type === 'attackStart');
  const chain: ChainEvent[] = first ? events.filter((e) => e.causeId === first.causeId) : [];
  return { press, kick, chain };
}

const isKickChain = (chain: ChainEvent[]) =>
  chain.some((e) => e.type === 'attackStart' && e.data['weapon'] === 'base:kick');
const hasPunchOutcome = (chain: ChainEvent[]) =>
  chain.some((e) => (e.type === 'hit' || e.type === 'attackMiss') && e.data['weapon'] === 'base:punch');

test('a scripted 180 ms swipe down on the attack button kicks, not punches', async ({ page }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  await startRace(page, problems);
  const cdp = await page.context().newCDPSession(page);

  // Burst: input recognises the 180 ms swipe before the press is sampled.
  const burst = await swipe(page, cdp, 1, 0);
  console.log(
    `burst swipe: attack at +${burst.press}, kick flag at +${burst.kick}; ${JSON.stringify(burst.chain)}`,
  );
  expect(burst.press, 'the press reached the sim').toBeGreaterThanOrEqual(0);
  expect(burst.kick, 'the 180 ms swipe set the kick flag').toBeGreaterThanOrEqual(burst.press);
  expect(isKickChain(burst.chain), 'the attack is a kick').toBe(true);
  expect(hasPunchOutcome(burst.chain), 'no punch landed or missed').toBe(false);

  // Real time: the kick flag reaches the sim after the punch's wind-up; combat converts it.
  let judged = false;
  for (let attempt = 1; attempt <= 4 && !judged; attempt++) {
    const r = await swipe(page, cdp, 10 + attempt, 150);
    const lag = r.kick - r.press;
    console.log(
      `real-time swipe, attempt ${attempt}: attack at +${r.press}, kick flag at +${r.kick} (${lag} ticks after the press); ${JSON.stringify(r.chain)}`,
    );
    // Delivered outside the window under test, or the punch landed first (combat keeps a landed
    // jab and kicks after it, by design): inconclusive, send it again.
    const landed = r.chain.some((e) => e.type === 'hit' && e.data['weapon'] === 'base:punch');
    if (r.press < 0 || r.kick < 0 || lag < 7 || lag > 15 || landed) continue;
    judged = true;
    expect(isKickChain(r.chain), 'the punch converted into a kick').toBe(true);
    expect(hasPunchOutcome(r.chain), 'no punch landed or missed').toBe(false);
  }
  expect(
    judged,
    'a real-time swipe reached the sim 7-15 ticks after its press at least once in 4 attempts',
  ).toBe(true);
  expect(problems).toEqual([]);
});
