/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 4, P4-8, sim tier, on the base pack's real track with the real riding model and the bot:
// - Arcade, the default steering style, is today's model to the bit: a race with the style written
//   as Arcade steps through the same state hash, every tick, as one with the slot's assists in their
//   shape from before the style existed;
// - the bot still finishes its races with the Free style;
// - the style is in the replay header, and a replay from the header reproduces every hash.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { blankActions, botInput, createBot, moverProblem } from '../../src/dev';
import {
  configFromHeader,
  createInputRecorder,
  createReplayController,
  makeReplayKey,
} from '../../src/replay';
import { createSim, type SimAssists } from '../../src/sim/api';
import { ISOLATED, NO_ROAD_EVENTS, seedRange } from './batch';

type RaceSetup = NonNullable<Parameters<typeof createHeadlessRace>[0]>;

/** The slot's assists as settings gave them before the style existed. */
const BEFORE: SimAssists = { steer: 'off', autoThrottle: false };
const style = (steerStyle: 'arcade' | 'free'): SimAssists => ({ ...BEFORE, steerStyle });

/** A whole bot race: the state hash after every tick, the edges ridden, and how it ended. */
function botRace(setup: Partial<RaceSetup>) {
  const race = createHeadlessRace(setup);
  const { sim, route, playerId } = race;
  const bot = createBot();
  const hashes: number[] = [];
  const edges: number[] = [];
  let invalid: string | null = null;
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < 60 * 900) {
    const a = blankActions();
    bot.drive(snap, playerId, route, a);
    sim.step([botInput(a)]);
    snap = sim.snapshot();
    hashes.push(sim.hash());
    for (const m of snap.entities) invalid ??= moverProblem(m, route);
    const me = snap.entities[playerId];
    const riding = me?.mode === 'Road' || me?.mode === 'Airborne';
    if (me && riding && edges[edges.length - 1] !== me.road.edge) edges.push(me.road.edge);
  }
  const finished = snap.race.finishOrder.includes(playerId);
  return { race, hashes, edges, invalid, finished, over: sim.isOver(), ticks: sim.tick };
}

// Whole races with the field take a few seconds each on a CI runner.
const RACE_TIMEOUT_MS = 120_000;

describe('P4-8: the steering style on the base track', () => {
  it(
    "Arcade is today's model to the bit: the same state hash every tick as the slot from before the style",
    () => {
      const setup = { seed: 7, tuning: NO_ROAD_EVENTS };
      const before = botRace({ ...setup, assists: [BEFORE] });
      const arcade = botRace({ ...setup, assists: [style('arcade')] });
      console.log(`[examined] ${arcade.hashes.length} ticks, one state hash each, Arcade against before`);
      expect(arcade.race.config.slots?.[0]?.assists.steerStyle).toBe('arcade');
      expect(before.over).toBe(true);
      expect(arcade.hashes).toEqual(before.hashes);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'the bot still finishes its races with Free steering, riding forward, every mover valid',
    () => {
      for (const seed of seedRange(1, 4)) {
        const setup = { seed, tuning: ISOLATED };
        const free = botRace({ ...setup, assists: [style('free')] });
        const arcade = botRace({ ...setup, assists: [style('arcade')] });
        console.log(
          `[examined] seed ${seed}: Free ${free.ticks} ticks (${free.finished ? 'finished' : 'not finished'}), ` +
            `Arcade ${arcade.ticks} ticks; Free edges ${free.edges.join('>')}`,
        );
        // The style reached the sim and changed the ride (else this would only re-test Arcade).
        expect(free.race.config.slots?.[0]?.assists.steerStyle, `seed ${seed}`).toBe('free');
        expect(free.hashes, `seed ${seed}`).not.toEqual(arcade.hashes);
        expect(free.over, `seed ${seed}`).toBe(true);
        expect(free.finished, `seed ${seed}`).toBe(true);
        expect(new Set(free.edges).size, `seed ${seed}: never goes back to an edge`).toBe(free.edges.length);
        expect(free.invalid, `seed ${seed}`).toBeNull();
      }
    },
    RACE_TIMEOUT_MS * 4,
  );

  it(
    'records Free in the replay header, and a replay from the header reproduces every hash',
    () => {
      const race = createHeadlessRace({ seed: 5, tuning: ISOLATED, assists: [style('free')] });
      const recorder = createInputRecorder();
      recorder.beginRace(race.sim, makeReplayKey('test-code', 'test-content'));
      const bot = createBot();
      let snap = race.sim.snapshot();
      for (let tick = 0; tick < 1800 && !race.sim.isOver(); tick++) {
        const a = blankActions();
        bot.drive(snap, race.playerId, race.config.route, a);
        const cmd = [botInput(a)];
        recorder.record(tick, cmd);
        race.sim.step(cmd);
        snap = race.sim.snapshot();
        if (tick % 60 === 0) recorder.checkpoint(tick, race.sim.hash());
      }
      recorder.finish(race.sim.tick - 1, race.sim.hash());
      const recording = recorder.current();
      if (!recording) throw new Error('no recording');
      expect(recording.header.config?.slots?.[0]?.assists.steerStyle).toBe('free');
      const sim = createSim(configFromHeader(recording.header, race.config.road, race.config.route));
      const result = createReplayController(recording).run(sim);
      console.log(`[examined] Free replay: ${result.ticks} ticks, ${result.checked} hashes compared`);
      expect(result.desync).toBeNull();
      expect(result.finalHash).toBe(race.sim.hash());
      expect(result.checked).toBeGreaterThanOrEqual(30);
    },
    RACE_TIMEOUT_MS,
  );
});
