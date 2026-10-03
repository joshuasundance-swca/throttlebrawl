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
// - late: the rest of the swipe is sent only after the sim has sampled the press, so the punch has
//   already started when the kick flag arrives. The gesture is judged by the events' stamps, so
//   the kick flag must still reach the sim, on a later tick than the press.
// Whether a late kick flag converts the punch depends only on how many ticks after the press it
// arrives (combat.kickConvertMs, 15 ticks). tests/sim/input-kick-convert-window.test.ts checks that
// at exact ticks, for every lag. This spec used to check it here, with a real-time swipe that
// reached the sim 7-15 ticks after its press only when the runner's load allowed (up to four
// attempts), and it waited a fixed 1.5 s between swipes. Every wait below is on the sim's own state.

interface Handle {
  inputs(from?: number): SimInput[];
  events(): readonly SimEvent[];
  playerId(): number;
  /** The player's attack phase is 'idle' once a swing and its cooldown end ('cooldown' until then). */
  snapshot(): { entities: { attackPhase: string }[] } | null;
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
    // The Classic look, through the saved record: the lighter look keeps a software-rendered CI
    // runner's frames short (PR #232's first CI run timed the old real-time swipe out in the Ink look).
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
 * the end). With `late`, the rest of the swipe is sent only once the sim has sampled the press;
 * otherwise the whole swipe goes at once. `dir` is the swipe's unit direction in screen px (default
 * straight down; playtest 2's directional kick swipes up, or down to a side).
 */
async function swipe(
  page: Page,
  cdp: CDPSession,
  id: number,
  late: boolean,
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
  const sendMoves = () =>
    Promise.all(
      moves.map(([r, dt]) =>
        touch(cdp, 'touchMove', [{ x: attack.x + r * dir.x, y: attack.y + r * dir.y, id }], t0 + dt),
      ),
    );
  if (late) {
    await touch(cdp, 'touchStart', [{ ...attack, id }], t0);
    // The sim has sampled the press: its attack flag is in the recorded inputs.
    await page.waitForFunction(
      ([f, attackFlag]) =>
        ((window as TestWindow).__game?.inputs(f) ?? []).some((s) => (s.flags & attackFlag) !== 0),
      [from, InputFlag.attack] as const,
      { timeout: 30_000 },
    );
    await sendMoves();
  } else {
    await Promise.all([touch(cdp, 'touchStart', [{ ...attack, id }], t0), sendMoves()]);
  }
  await touch(cdp, 'touchEnd', [], t0 + durS + 0.01);
  // The swing plays out: the press reached the sim, the player's attack from it started, and the
  // attack phase is back to 'idle' (the snapshot says 'cooldown' until the kick's 30-tick cooldown
  // ends, and a kick asked for while the last one cools down is a punch by design). The start is
  // latched in the page (an attackStart event, or a phase other than 'idle', after the press), as the
  // page keeps only its latest events. All of it is sim state, so a slow runner only takes longer;
  // the timeout is a hang guard.
  await page.waitForFunction(
    ([f, attackFlag]) => {
      const w = window as TestWindow & { __swingFrom?: number };
      const g = w.__game;
      if (!g) return false;
      const ins = g.inputs(f);
      const press = ins.findIndex((s) => (s.flags & attackFlag) !== 0);
      if (press < 0 || ins.length <= press + 1) return false;
      const player = g.playerId();
      const phase = g.snapshot()?.entities[player]?.attackPhase;
      const started = g
        .events()
        .some((e) => e.actor === player && e.type === 'attackStart' && e.tick >= f + press);
      if (started || (phase !== undefined && phase !== 'idle')) w.__swingFrom = f;
      return w.__swingFrom === f && phase === 'idle';
    },
    [from, InputFlag.attack] as const,
    { timeout: 60_000 },
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
  const burst = await swipe(page, cdp, 1, false);
  console.log(
    `burst swipe: attack at +${burst.press}, kick flag at +${burst.kick}; ${JSON.stringify(burst.chain)}`,
  );
  expect(burst.press, 'the press reached the sim').toBeGreaterThanOrEqual(0);
  expect(burst.kick, 'the 180 ms swipe set the kick flag').toBeGreaterThanOrEqual(burst.press);
  expect(isKickChain(burst.chain), 'the attack is a kick').toBe(true);
  expect(hasPunchOutcome(burst.chain), 'no punch landed or missed').toBe(false);

  // Playtest 1b: a quicker natural swipe, about 150 ms, kicks too.
  const quick = await swipe(page, cdp, 2, false, 0.15);
  console.log(
    `150 ms burst swipe: attack at +${quick.press}, kick flag at +${quick.kick}; ${JSON.stringify(quick.chain)}`,
  );
  expect(quick.press, 'the press reached the sim').toBeGreaterThanOrEqual(0);
  expect(quick.kick, 'the 150 ms swipe set the kick flag').toBeGreaterThanOrEqual(quick.press);
  expect(isKickChain(quick.chain), 'the 150 ms swipe is a kick').toBe(true);
  expect(hasPunchOutcome(quick.chain), 'no punch landed or missed after the 150 ms swipe').toBe(false);

  // Late: the swipe's end reaches the page after the sim has sampled the press. The stamped gesture
  // is still a kick swipe, so the kick flag reaches the sim, after the press, and finds the punch
  // already started. Whether it converts depends only on the lag in ticks: printed here, checked at
  // exact ticks in tests/sim/input-kick-convert-window.test.ts.
  const late = await swipe(page, cdp, 11, true);
  console.log(
    `late swipe: attack at +${late.press}, kick flag at +${late.kick} (${late.kick - late.press} ticks ` +
      `after the press; ends in a kick: ${endsInKick(late.chain)}); ${JSON.stringify(late.chain)}`,
  );
  expect(late.press, 'the press reached the sim').toBeGreaterThanOrEqual(0);
  expect(late.kick, 'the late swipe still set the kick flag, after the press').toBeGreaterThan(late.press);
  expect(late.chain[0]?.data['weapon'], 'the press started a punch before the flag arrived').toBe(
    'base:punch',
  );
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

  const up = await swipe(page, cdp, 21, false, 0.15, { x: 0, y: -1 });
  console.log(`swipe up: attack at +${up.press}, kick flag at +${up.kick}; ${JSON.stringify(up.chain)}`);
  const upStart = up.chain.find((e) => e.type === 'attackStart' && e.data['weapon'] === 'base:kick');
  expect(upStart, 'the swipe up starts a kick').toBeDefined();
  expect(upStart?.data['straight'], 'and it is the straight kick').toBe(true);

  const left = await swipe(page, cdp, 22, false, 0.15, { x: -0.75, y: 0.66 });
  console.log(`swipe down-left: attack at +${left.press}; ${JSON.stringify(left.chain)}`);
  const leftStart = left.chain.find((e) => e.type === 'attackStart' && e.data['weapon'] === 'base:kick');
  expect(leftStart, 'the swipe down-left starts a kick').toBeDefined();
  expect(leftStart?.data['side'], 'to the left').toBe(-1);
  expect(leftStart?.data['straight']).toBeUndefined();
  expect(problems).toEqual([]);
});
