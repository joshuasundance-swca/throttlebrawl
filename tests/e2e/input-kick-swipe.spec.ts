import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { placeElement, type TouchLayout } from '../../src/core/layout.ts';
import { InputFlag, type SimEvent, type SimInput } from '../../src/sim/types.ts';

// Playtest 1 (2026-09-30), item 3: "Can't kick". A scripted 180 ms swipe down on the attack
// button, a natural swipe rather than M1's 80 ms flick, produces a kick and not a punch, end to end
// in the production build: real touches (Chrome's touch emulation) reach input, the kick flag
// reaches the sim, and the player's attack ends in a `base:kick`.
//
// Two paths:
// - burst: the whole swipe arrives at once, stamped over 180 ms, so input sees the swipe before
//   the press is sampled and the attack starts as a kick (input's window alone), with no punch
//   outcome at all;
// - real time: the swipe's end arrives about 150 ms after the press, so the punch has already
//   started and its 7-tick wind-up is over when the kick flag reaches the sim; only combat's
//   kick-conversion window (combat.kickConvertMs, 15 ticks) turns it into a kick, so the attack
//   ends in a kick (the punch's miss may be reported first when the flag arrives after its
//   active moment). The events are stamped (the gesture is judged by the stamps), but when they
//   are *delivered* depends on the runner's load: an attempt whose kick flag reached the sim
//   outside 7-15 ticks after the press, or whose punch landed before the kick flag arrived,
//   proves nothing about the conversion and is sent again, up to 4 times.

interface Handle {
  inputs(from?: number): SimInput[];
  events(): readonly SimEvent[];
  playerId(): number;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };
type ChainEvent = { tick: number; type: string; causeId: number | undefined; data: SimEvent['data'] };

/** The player's attack phase in the sim's latest snapshot ('idle' once a swing and its cooldown end). */
type PhaseWindow = Window & {
  __game?: { snapshot(): { entities: { attackPhase: string }[] } | null; playerId(): number };
};

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
    // The Classic look, through the saved record: this test times touch delivery, and the default
    // Ink + 60s film look (run W-O) loads a software-rendered CI runner enough to push the swipe's
    // delivery out of its window (PR #232's first CI run).
    localStorage.setItem(
      'mbrawl:settings',
      JSON.stringify({
        format: 'settings',
        version: 1,
        build: 'e2e',
        savedAt: '2026-10-01T00:00:00.000Z',
        data: { look: 'classic' },
      }),
    );
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible();
  await page.waitForFunction(() => ((window as TestWindow).__game?.inputs().length ?? 0) > 60);
}

/**
 * One 26 px swipe down, stamped over `durS` (default 180 ms; 24 px, kickSwipePx, is crossed only at
 * the end). `realMs` is how long to wait, in real time, before sending the end of the swipe (0: all
 * at once). `dir` is the swipe's unit direction in screen px (default straight down; playtest 2's
 * directional kick swipes up, or down to a side).
 */
async function swipe(
  page: Page,
  cdp: CDPSession,
  id: number,
  realMs: number,
  durS = 0.18,
  dir: { x: number; y: number } = { x: 0, y: 1 },
) {
  const view = page.viewportSize() ?? { width: 915, height: 412 };
  const attack = attackCenter(view.width, view.height);
  const from = await page.evaluate(() => (window as TestWindow).__game!.inputs().length);
  const after = await page.evaluate(() => {
    const ev = (window as TestWindow).__game!.events();
    return ev.length ? ev[ev.length - 1]!.tick : 0;
  });
  const t0 = Date.now() / 1000;
  const moves = [
    [8, durS / 3],
    [16, (2 * durS) / 3],
    [26, durS],
  ] as const;
  if (realMs === 0) {
    await Promise.all([
      touch(cdp, 'touchStart', [{ ...attack, id }], t0),
      ...moves.map(([r, dt]) =>
        touch(cdp, 'touchMove', [{ x: attack.x + r * dir.x, y: attack.y + r * dir.y, id }], t0 + dt),
      ),
    ]);
  } else {
    await touch(cdp, 'touchStart', [{ ...attack, id }], t0);
    await page.waitForTimeout(realMs);
    await Promise.all(
      moves.map(([r, dt]) =>
        touch(cdp, 'touchMove', [{ x: attack.x + r * dir.x, y: attack.y + r * dir.y, id }], t0 + dt),
      ),
    );
  }
  await touch(cdp, 'touchEnd', [], t0 + durS + 0.01);
  // The kick's wind-up, active moment, recovery and cooldown all play out: at least 1.5 s, then
  // until the sim shows the player's attack idle again. A kick asked for while the last one cools
  // down is a punch by design (sim/combat), and a loaded runner steps fewer sim ticks per real
  // second (the loop takes at most 4 per frame), so 1.5 s alone was not always the kick's 13 + 6 +
  // 27 ticks and 30-tick cooldown: in main's CI run 36965896101 the next swipe reached the sim 69
  // ticks after the kick began, and punched.
  await page.waitForTimeout(1500);
  await page.waitForFunction(
    () => {
      const g = (window as PhaseWindow).__game;
      const me = g?.snapshot()?.entities[g.playerId()];
      return me?.attackPhase === 'idle';
    },
    null,
    { timeout: 30_000 },
  );

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
/** The chain's last attack is a kick, and that kick resolves (lands or misses). */
const endsInKick = (chain: ChainEvent[]) => {
  const starts = chain.filter((e) => e.type === 'attackStart');
  const last = starts[starts.length - 1];
  if (!last || last.data['weapon'] !== 'base:kick') return false;
  return chain.some(
    (e) =>
      e.tick >= last.tick &&
      (e.type === 'hit' || e.type === 'attackMiss') &&
      e.data['weapon'] === 'base:kick',
  );
};

test('a scripted 150 or 180 ms swipe down on the attack button kicks, not punches', async ({ page }) => {
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

  // Playtest 1b: a quicker natural swipe, about 150 ms, kicks too.
  const quick = await swipe(page, cdp, 2, 0, 0.15);
  console.log(
    `150 ms burst swipe: attack at +${quick.press}, kick flag at +${quick.kick}; ${JSON.stringify(quick.chain)}`,
  );
  expect(quick.press, 'the press reached the sim').toBeGreaterThanOrEqual(0);
  expect(quick.kick, 'the 150 ms swipe set the kick flag').toBeGreaterThanOrEqual(quick.press);
  expect(isKickChain(quick.chain), 'the 150 ms swipe is a kick').toBe(true);
  expect(hasPunchOutcome(quick.chain), 'no punch landed or missed after the 150 ms swipe').toBe(false);

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
    // combat-3's rule: the kick flag converts an attack at most combat.kickConvertMs (15 ticks) old
    // in any phase. A flag that arrives after the punch's active moment has ended still converts,
    // after the punch's miss has been reported; the swipe still ends in a kick, never a lone punch.
    const whiffed = r.chain.some((e) => e.type === 'attackMiss' && e.data['weapon'] === 'base:punch');
    console.log(`real-time swipe: the punch's miss was reported before the kick: ${whiffed}`);
    expect(endsInKick(r.chain), 'the swipe ends in a kick that lands or misses').toBe(true);
  }
  expect(
    judged,
    'a real-time swipe reached the sim 7-15 ticks after its press at least once in 4 attempts',
  ).toBe(true);
  expect(problems).toEqual([]);
});

// Playtest 2 (2026-10-02): "Kick timing requires the ability to choose kick direction as you ride up
// behind someone (directional swipe)". A swipe up is the straight kick at the rider ahead; a swipe
// down leaning left kicks to the left. End to end: the attack that starts is a kick carrying that
// choice, whoever happens to be near.
test('playtest 2: a swipe up is the straight kick, a swipe down-left kicks left', async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  await startRace(page, problems);
  const cdp = await page.context().newCDPSession(page);

  const up = await swipe(page, cdp, 21, 0, 0.15, { x: 0, y: -1 });
  console.log(`swipe up: attack at +${up.press}, kick flag at +${up.kick}; ${JSON.stringify(up.chain)}`);
  const upStart = up.chain.find((e) => e.type === 'attackStart' && e.data['weapon'] === 'base:kick');
  expect(upStart, 'the swipe up starts a kick').toBeDefined();
  expect(upStart?.data['straight'], 'and it is the straight kick').toBe(true);

  const left = await swipe(page, cdp, 22, 0, 0.15, { x: -0.75, y: 0.66 });
  console.log(`swipe down-left: attack at +${left.press}; ${JSON.stringify(left.chain)}`);
  const leftStart = left.chain.find((e) => e.type === 'attackStart' && e.data['weapon'] === 'base:kick');
  expect(leftStart, 'the swipe down-left starts a kick').toBeDefined();
  expect(leftStart?.data['side'], 'to the left').toBe(-1);
  expect(leftStart?.data['straight']).toBeUndefined();
  expect(problems).toEqual([]);
});
