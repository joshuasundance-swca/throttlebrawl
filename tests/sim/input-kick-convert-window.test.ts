// The kick-conversion window, tick-exact, in the real race (playtest 1, 2026-09-30, item 3: "Can't
// kick"; combat-3's rule in src/sim/combat/index.ts). A natural swipe down on the attack button is
// recognised after the press has already been sampled, so the punch starts first and the kick flag
// reaches the sim some ticks later. combat converts the attack into a kick while it is at most
// combat.kickConvertMs (250 ms, 15 ticks) old, in any phase; at 16 ticks the punch stands.
//
// tests/e2e/input-kick-swipe.spec.ts used to prove this in the browser, with a real-time swipe whose
// end reached the sim 7-15 ticks after its press only when the runner's load allowed (up to four
// attempts). Here the SimInputs arrive at exact ticks, in the race the app builds (the base event,
// the full field, drafts included as the CI build loads them), for every lag in the window and
// past it. The browser spec keeps the touch paths: a swipe reaches the kick flag.
//
// The inputs are what the touch device sends for a swipe on the attack button (src/input/devices/
// touch.ts): `attack` on the press tick, `skipRunBack` while the finger is down, and `kick` on the
// tick the swipe is recognised, which is also the release. The player sits on the grid, as in the
// browser spec (no throttle).
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { InputFlag, type SimEvent, type SimInput } from '../../src/sim/api';
import { NO_ROAD_EVENTS } from './batch';

const print = (line: string) => process.stdout.write(`[kick-window] ${line}\n`);

const SEED = 1;
/** The press tick: two seconds in, as the browser spec's first swipe. */
const PRESS = 120;
/** Ticks run after the press: a kick's 13 + 6 + 27 ticks plus hit-stop fit with room to spare. */
const AFTER = 150;
/** combat.kickConvertMs (250 ms) in ticks, as the browser spec's 7-15 judged it. */
const WINDOW = 15;

const idle: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };

/** The touch device's SimInputs for a swipe whose kick flag reaches the sim `lag` ticks after the press. */
function swipeInput(tick: number, lag: number): SimInput {
  const at = tick - PRESS;
  if (at < 0 || at > lag) return idle;
  let flags = InputFlag.skipRunBack;
  if (at === 0) flags |= InputFlag.attack;
  if (at === lag) flags |= InputFlag.kick;
  return { ...idle, flags };
}

interface Chain {
  starts: string[];
  /** The chain's events, in order: `type weapon @tick` (ticks from the press). */
  line: string[];
  endsInKick: boolean;
  punchMissedFirst: boolean;
}

/** One race: the swipe at `lag`, then the player's first attack chain (one causeId). */
function swipeChain(lag: number): Chain {
  const { sim, playerId } = createHeadlessRace(
    { seed: SEED, tuning: NO_ROAD_EVENTS },
    { includeDrafts: true },
  );
  const mine: SimEvent[] = [];
  while (sim.tick < PRESS + AFTER && !sim.isOver()) {
    sim.step([swipeInput(sim.tick, lag)]);
    for (const e of sim.events()) if (e.actor === playerId && e.tick >= PRESS) mine.push(e);
  }
  const first = mine.find((e) => e.type === 'attackStart');
  const chain = first ? mine.filter((e) => e.causeId === first.causeId) : [];
  const weapon = (e: SimEvent) => String(e.data['weapon'] ?? '');
  const starts = chain.filter((e) => e.type === 'attackStart');
  const last = starts[starts.length - 1];
  const resolves = (e: SimEvent) => e.type === 'hit' || e.type === 'attackMiss';
  const kickStartAt = starts.find((e) => weapon(e) === 'base:kick')?.tick ?? Infinity;
  return {
    starts: starts.map(weapon),
    line: chain.map((e) => `${e.type} ${weapon(e)} @${e.tick - PRESS}`),
    // The chain's last attack is a kick, and that kick resolves (lands or misses).
    endsInKick:
      !!last &&
      weapon(last) === 'base:kick' &&
      chain.some((e) => e.tick >= last.tick && resolves(e) && weapon(e) === 'base:kick'),
    punchMissedFirst: chain.some(
      (e) => e.type === 'attackMiss' && weapon(e) === 'base:punch' && e.tick <= kickStartAt,
    ),
  };
}

describe('the kick-conversion window in the real race (playtest 1 item 3, at exact ticks)', () => {
  it('the kick flag on the press tick starts a kick and no punch (the burst swipe)', () => {
    const c = swipeChain(0);
    print(`lag 0: ${c.line.join(', ')}`);
    expect(c.starts).toEqual(['base:kick']);
    expect(c.endsInKick, 'the kick lands or misses').toBe(true);
  });

  it(`a kick flag 1 to ${WINDOW} ticks after the press turns the punch into a kick that lands or misses`, () => {
    const whiffedFirst: number[] = [];
    for (let lag = 1; lag <= WINDOW; lag++) {
      const c = swipeChain(lag);
      print(`lag ${lag}: ${c.line.join(', ')}`);
      expect(c.starts[0], `lag ${lag}: the press starts a punch`).toBe('base:punch');
      expect(c.starts, `lag ${lag}: the punch becomes a kick`).toContain('base:kick');
      expect(c.endsInKick, `lag ${lag}: the swipe ends in a kick that lands or misses`).toBe(true);
      if (c.punchMissedFirst) whiffedFirst.push(lag);
    }
    // The browser case the old real-time swipe hit: the flag arrives after the punch's active
    // moment (7-tick wind-up, 5 active ticks) has ended and its miss was reported, and the attack
    // still converts. With nobody in reach of the grid, every lag from the end of the active moment
    // to the window's edge is that case.
    print(`the punch's miss was reported before the kick at lags ${whiffedFirst.join(', ')}`);
    expect(whiffedFirst, 'converts after the punch has whiffed').toContain(WINDOW);
  });

  it(`a kick flag ${WINDOW + 1} or more ticks after the press leaves the punch alone`, () => {
    for (const lag of [WINDOW + 1, WINDOW + 5]) {
      const c = swipeChain(lag);
      print(`lag ${lag}: ${c.line.join(', ')}`);
      expect(c.starts, `lag ${lag}: only the punch`).toEqual(['base:punch']);
      expect(c.endsInKick).toBe(false);
    }
  });
});
