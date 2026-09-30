/// <reference types="vite/client" />
// The pack loader uses import.meta.glob, so this Node-side test needs the Vite client types.
// riders-3 over real races (docs/milestones/M1.md, "riders-3"): seeded headless races on the base
// pack, with the stub bot in the player slot. Until dev-1's shared batch (tests/sim/batch.ts)
// lands, this file runs its own few races; switch it to the batch's cached results then.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { createStubBot } from '../../src/dev/bot';
import { quantizeInput, type SimEvent } from '../../src/sim/api';

const SEEDS = [1, 2, 3];

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
  const { sim, route, config, playerId } = createHeadlessRace({ seed });
  const bot = createStubBot();
  const events: SimEvent[] = [];
  let checkpointMoments = 0;
  let misplaced = 0;
  while (!sim.isOver() && sim.tick < 60 * 900) {
    const me = sim.snapshot().entities[playerId];
    if (!me) throw new Error('no player');
    const a = blank();
    bot.drive(me, route, a);
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    const now = sim.events();
    events.push(...now);
    if (!now.some((e) => e.type === 'lapOrCheckpoint')) continue;
    // At each route checkpoint: finishers in order, then the rest by distance to finish.
    checkpointMoments++;
    const snap = sim.snapshot();
    const racers = snap.entities.filter((e) => e.kind === 'rider' && e.faction !== 'law');
    const done = [...snap.race.finishOrder];
    const rest = racers
      .filter((e) => !done.includes(e.id))
      .sort((p, q) => p.distanceToFinish - q.distanceToFinish || p.id - q.id)
      .map((e) => e.id);
    const byPlace = [...racers].sort((p, q) => p.place - q.place).map((e) => e.id);
    if (byPlace.join() !== [...done, ...rest].join()) misplaced++;
  }
  const snap = sim.snapshot();
  return {
    sim,
    events,
    checkpointMoments,
    misplaced,
    checkpoints: config.route.checkpoints.length,
    racers: snap.entities.filter((e) => e.kind === 'rider' && e.faction !== 'law'),
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

  it("matches the placing to progress at every one of the route's checkpoints", () => {
    for (const r of results) {
      expect(r.checkpoints).toBeGreaterThan(0);
      expect(r.checkpointMoments).toBeGreaterThanOrEqual(r.checkpoints);
      expect(r.misplaced).toBe(0);
    }
  });

  it('emits one finish event per finisher, in place order, and places every racer at the end', () => {
    for (const r of results) {
      const finishes = r.events.filter((e) => e.type === 'finish');
      expect(new Set(finishes.map((e) => e.actor)).size).toBe(finishes.length);
      finishes.forEach((e, i) => expect(e.data['place']).toBe(i + 1));
      expect(r.racers.map((e) => e.place).sort((a, b) => a - b)).toEqual(r.racers.map((_e, i) => i + 1));
      const end = r.events.find((e) => e.type === 'raceEnd');
      console.log(
        `riders-3 seed ${r.seed}: ${r.sim.tick} ticks, ${r.checkpointMoments} checkpoint moments, raceEnd ${JSON.stringify(end?.data)}`,
      );
    }
  });
});
