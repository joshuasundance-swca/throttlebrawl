// riders-3 over real races (docs/milestones/M1.md, "riders-3"): seeded headless races on the base
// pack, with the stub bot in the player slot. Until dev-1's shared batch (tests/sim/batch.ts)
// lands, this file runs its own few races; it then asserts over the batch's cached results instead.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { createStubBot } from '../../src/dev/bot';
import { quantizeInput, type SimEvent } from '../../src/sim/api';

const SEEDS = [1, 2, 3];
/** The route's checkpoints for this assertion: every 250 m of the player's progress. */
const CHECK_EVERY_M = 250;

function blank(): ActionState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    attack: false,
    attackSide: 0,
    kick: false,
    lookBack: false,
    skipRunBack: false,
  };
}

function race(seed: number) {
  const { sim, route, playerId } = createHeadlessRace({ seed });
  const bot = createStubBot();
  const events: SimEvent[] = [];
  let checkpoints = 0;
  let misplaced = 0;
  let nextMark = CHECK_EVERY_M;
  while (!sim.isOver() && sim.tick < 60 * 900) {
    const me = sim.snapshot().entities[playerId];
    if (!me) throw new Error('no player');
    const a = blank();
    bot.drive(me, route, a);
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    events.push(...sim.events());
    const snap = sim.snapshot();
    const player = snap.entities[playerId];
    if (player && player.progress >= nextMark) {
      nextMark += CHECK_EVERY_M;
      checkpoints++;
      // Placing matches progress: finishers in order, then the rest by distance to finish.
      const done = [...snap.race.finishOrder];
      const rest = snap.entities
        .filter((e) => e.faction !== 'law' && !done.includes(e.id))
        .sort((p, q) => p.distanceToFinish - q.distanceToFinish || p.id - q.id)
        .map((e) => e.id);
      const byPlace = snap.entities
        .filter((e) => e.faction !== 'law')
        .sort((p, q) => p.place - q.place)
        .map((e) => e.id);
      if (byPlace.join() !== [...done, ...rest].join()) misplaced++;
    }
  }
  const snap = sim.snapshot();
  return {
    sim,
    snap,
    events,
    checkpoints,
    misplaced,
    racers: snap.entities.filter((e) => e.faction !== 'law'),
  };
}

describe('riders-3 over seeded base-pack races', () => {
  const results = SEEDS.map((seed) => ({ seed, ...race(seed) }));

  it('always ends, with one raceEnd accounting for every racer as finished, down or busted', () => {
    for (const r of results) {
      expect(r.sim.isOver()).toBe(true);
      const ends = r.events.filter((e) => e.type === 'raceEnd');
      expect(ends.length).toBe(1);
      const d = ends[0]?.data ?? {};
      expect(Number(d['finished']) + Number(d['down']) + Number(d['busted'])).toBe(r.racers.length);
    }
  });

  it('matches the placing to progress at every checkpoint', () => {
    for (const r of results) {
      expect(r.checkpoints).toBeGreaterThanOrEqual(8);
      expect(r.misplaced).toBe(0);
    }
  });

  it('emits one finish event per finisher, in place order, and places everyone at the end', () => {
    for (const r of results) {
      const finishes = r.events.filter((e) => e.type === 'finish');
      expect(new Set(finishes.map((e) => e.actor)).size).toBe(finishes.length);
      finishes.forEach((e, i) => expect(e.data['place']).toBe(i + 1));
      expect(r.racers.map((e) => e.place).sort((a, b) => a - b)).toEqual(r.racers.map((_e, i) => i + 1));
      // Printed for the lane report: how each race ended.
      const end = r.events.find((e) => e.type === 'raceEnd');
      console.log(`seed ${r.seed}: ${r.sim.tick} ticks, raceEnd ${JSON.stringify(end?.data)}`);
    }
  });
});
