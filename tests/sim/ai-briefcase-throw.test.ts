/// <reference types="vite/client" />
// Rivals throw Kevin's briefcase (#388's follow-up; run W-T's live check, mustFix 5). On the live
// game a rival holding the briefcase rode up to 63 s with it: the AI threw it only at punch range,
// so in 73 seeded races rivals threw it 3 times. Here every rival starts the race holding it (the
// rider file's `startingWeapon` seam, as a cop's baton, so nothing reaches into the sim), in Keys
// free-play races under the isolation profile (tests/sim/batch.ts ISOLATED: no traffic, events,
// cops or crash weapons), and the dev bot rides the player. For each holder the test counts the
// ticks a rider it would fight is inside the briefcase's 14 m x 3 m box ahead of it (the live
// check's box), and asserts that it throws before that count passes THROW_WITHIN_S.
// "A rider it would fight" keeps each rival's personality, as sim/ai and styles.ts write it:
//   - never a cop, a rider down or off the road, or one who has finished (sim/ai canFight);
//   - Deacon (slow burn) picks no fight while calm or simmering: only his relentless ticks count;
//   - the showboat (Chad) fights only when it looks good: never the race leader, never anyone
//     healthier than him;
//   - the crowd-pleaser (the Mayor) whose fight has turned (health under 60%) rides away instead;
//   - and nobody swings in the first START_HOLD ticks (sim/ai: "no swings off the start line").
// The fight cadence (no new swing until the last one's cycle is over) is not excluded: a holder busy
// kicking someone beside it counts its box time all the same.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { relativeS } from '../../src/sim/ai';
import { createSim, type EntitySnapshot, type SimConfig } from '../../src/sim/api';
import { ISOLATED, seedRange } from './batch';

const print = (line: string) => process.stdout.write(`[ai-briefcase-throw] ${line}\n`);

const ALL = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const KEYS = 'm1-skeleton-sprint';
const BRIEFCASE = 'base:kevins-briefcase';
const SEEDS = seedRange(1, 8);
/** Each race runs at most this long; every rival holds one from the start, so the throws come early. */
const MAX_TICKS = 90 * 60;
/** The briefcase's reach box (packs/base/weapons/kevins-briefcase.json): metres ahead, and to a side. */
const BOX_S = 14;
const BOX_D = 3;
/** A holder throws before a rider it would fight has been in its box this long, seconds. [default] */
const THROW_WITHIN_S = 8;
/** No AI swing before this tick (sim/ai's init: no swings off the start line). */
const START_HOLD = 120;
/** The crowd-pleaser rides away below this share of his health (styles.ts `fleeBelow`). */
const FLEE_BELOW = 0.6;

interface Holding {
  rider: string;
  seed: number;
  /** Ticks a rider it would fight was in the box while it held the briefcase. */
  boxTicks: number;
  /** boxTicks when it threw, or -1 when it never threw. */
  threwAt: number;
}

/** Every rival starts holding the briefcase (the rider's `startingWeapon`, as a cop's baton). */
function armed(config: SimConfig): SimConfig {
  return {
    ...config,
    riders: config.riders.map((r) => (r.role === 'rival' ? { ...r, startingWeapon: BRIEFCASE } : r)),
  };
}

const share = (e: EntitySnapshot): number => e.health / Math.max(1, e.healthMax);

function race(seed: number): Holding[] {
  const config = armed(
    buildSimConfig(ALL, STREAMS.forEvent(ALL, KEYS), {
      seed,
      eventId: KEYS,
      freePlay: true,
      tuning: ISOLATED,
    }),
  );
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const ai = (i: number) => {
    const c = config.riders[i]?.controller;
    return c?.kind === 'ai' ? c : null;
  };
  /** Whether holder `r` would fight `o`, by the rules in the file header. */
  const wouldFight = (r: EntitySnapshot, o: EntitySnapshot): boolean => {
    if (o.id === r.id || o.kind !== 'rider' || o.faction === 'law' || o.mode !== 'Road') return false;
    if (o.finished || o.health <= 0) return false;
    if (ai(r.id)?.style === 'showboat' && (o.place === 1 || share(o) > share(r))) return false;
    return true;
  };
  const bot = createBot();
  const out = new Map<number, Holding>();
  let snap = sim.snapshot();
  for (const e of snap.entities) {
    if (e.kind === 'rider' && e.heldWeapon === BRIEFCASE)
      out.set(e.id, { rider: e.name, seed, boxTicks: 0, threwAt: -1 });
  }
  while (sim.tick < MAX_TICKS && !sim.isOver()) {
    const a = emptyActions();
    bot.drive(snap, playerId, config.route, a);
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    const counting = sim.tick > START_HOLD;
    for (const e of sim.events()) {
      const h = out.get(e.actor);
      if (e.type === 'throw' && h && h.threwAt < 0) h.threwAt = h.boxTicks;
    }
    for (const r of snap.entities) {
      const h = out.get(r.id);
      if (!counting || !h || h.threwAt >= 0 || r.heldWeapon !== BRIEFCASE || r.mode !== 'Road' || r.finished)
        continue;
      const c = ai(r.id);
      if (c?.personality?.signature === 'slow-burn' && r.signature?.phase !== 'act') continue;
      if (c?.style === 'crowd-pleaser' && share(r) < FLEE_BELOW) continue;
      const inBox = snap.entities.some((o) => {
        if (!wouldFight(r, o)) return false;
        const rel = relativeS(config.road, r.road, o.road, BOX_S + 6);
        if (rel === null) return false;
        const ahead = rel * r.road.dir;
        return ahead >= 0 && ahead <= BOX_S && Math.abs(o.road.d - r.road.d) <= BOX_D;
      });
      if (inBox) h.boxTicks++;
    }
  }
  return [...out.values()];
}

describe('#388: rivals holding the briefcase throw it', () => {
  const holdings = SEEDS.flatMap(race);
  const met = holdings.filter((h) => h.boxTicks > 0 || h.threwAt >= 0);
  const threw = holdings.filter((h) => h.threwAt >= 0);
  const boxS = (h: Holding) => (h.threwAt >= 0 ? h.threwAt : h.boxTicks) / 60;
  const waits = threw.map(boxS).sort((a, b) => a - b);
  const worst = met.reduce((m, h) => Math.max(m, boxS(h)), 0);
  print(
    `[examined] ${SEEDS.length} Keys free-play races (ISOLATED), ${holdings.length} rival holdings; ` +
      `${met.length} had a rider they would fight in the ${BOX_S} x ${BOX_D} m box, ${threw.length} threw`,
  );
  print(
    `box seconds before the throw: median ${(waits[Math.floor(waits.length / 2)] ?? NaN).toFixed(2)}, ` +
      `worst ${worst.toFixed(2)} (limit ${THROW_WITHIN_S})`,
  );
  for (const h of met)
    print(
      `seed ${h.seed} ${h.rider}: ${h.threwAt >= 0 ? 'threw after' : 'NO THROW,'} ${boxS(h).toFixed(2)} s in the box`,
    );

  it('every rival given the briefcase holds it at the start', () => {
    expect(holdings.length).toBe(SEEDS.length * 4);
  });

  it(`a holder throws within ${THROW_WITHIN_S} s of box time with a rider it would fight`, () => {
    const late = met
      .filter((h) => boxS(h) > THROW_WITHIN_S)
      .map((h) => `seed ${h.seed} ${h.rider}: ${boxS(h).toFixed(2)} s`);
    expect(late).toEqual([]);
  });

  it('most holders who meet a rider throw, across several rivals', () => {
    expect(met.length).toBeGreaterThan(SEEDS.length);
    expect(threw.length / met.length).toBeGreaterThan(0.6);
    expect(new Set(threw.map((h) => h.rider)).size).toBeGreaterThanOrEqual(4);
  });
}, 600_000);
