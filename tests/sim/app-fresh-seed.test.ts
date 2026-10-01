// A fresh seed per race (playtest 1c item 2, 2026-09-30: "I want randomness so you don't see the
// same cars in the same order, ramp truck in the same place, etc"). The app's seed policy draws
// two seeds for two races in a row, the way the game does at each race start; the two races put
// different traffic on the road in a different order. A race recorded on a freshly drawn seed
// replays from its saved recording alone to identical state hashes, so randomness never costs
// determinism.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, createRaceSeeds } from '../../src/app';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import {
  configFromHeader,
  createInputRecorder,
  createReplayController,
  decodeReplay,
  encodeReplay,
  HASH_EVERY_TICKS,
  makeReplayKey,
} from '../../src/replay';
import { createSim } from '../../src/sim/api';

const TICKS = 60 * 40;

/** A bot race on `seed` for TICKS ticks: the traffic spawns in order, and the recording. */
function race(seed: number) {
  const { sim, route, playerId, config } = createHeadlessRace({ seed });
  const bot = createBot();
  const recorder = createInputRecorder();
  recorder.beginRace(sim, makeReplayKey('test-build', 'test-content'));
  const seen = new Set<number>();
  const spawns: string[] = [];
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < TICKS) {
    for (const e of snap.entities) {
      if (e.kind === 'rider' || seen.has(e.id)) continue;
      seen.add(e.id);
      spawns.push(`${e.kind}:${e.contentId}@${e.road.edge}:${Math.round(e.road.s)}`);
    }
    const actions = emptyActions();
    bot.drive(snap, playerId, route, actions);
    const input = toSimInput(actions);
    const tick = sim.tick;
    recorder.record(tick, [input]);
    sim.step([input]);
    if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
    snap = sim.snapshot();
  }
  recorder.finish(sim.tick - 1, sim.hash());
  const rec = recorder.current();
  if (!rec) throw new Error('no recording');
  return { spawns, rec, config, finalHash: sim.hash() };
}

describe('app: a fresh seed per race', () => {
  it('two races in a row draw different seeds and different traffic', () => {
    const seeds = createRaceSeeds();
    const a = seeds.next();
    const b = seeds.next();
    expect(a, 'two seeds in a row').not.toBe(b);
    const first = race(a);
    const second = race(b);
    console.log(
      `[print] seeds ${a} and ${b}: ${first.spawns.length} and ${second.spawns.length} spawns; ` +
        `first five: ${first.spawns.slice(0, 5).join(', ')} | ${second.spawns.slice(0, 5).join(', ')}`,
    );
    expect(first.config.seed).toBe(a);
    expect(second.config.seed).toBe(b);
    expect(first.spawns.length, 'traffic spawned in the first race').toBeGreaterThan(0);
    expect(second.spawns.length, 'traffic spawned in the second race').toBeGreaterThan(0);
    // The order differs, and at least one spawn (kind, type and place) is not shared.
    expect(first.spawns, 'the traffic order differs').not.toEqual(second.spawns);
    const shared = new Set(second.spawns);
    expect(
      first.spawns.some((s) => !shared.has(s)),
      'at least one spawn differs',
    ).toBe(true);
  });

  it('a race on a freshly drawn seed replays from its recording to identical hashes', () => {
    const seed = createRaceSeeds().next();
    const { rec, config, finalHash } = race(seed);
    expect(rec.header.seed, 'the recording header carries the seed').toBe(seed);
    // Save it the way the debug file does, then rebuild the race from the header alone.
    const saved = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(rec))) as unknown);
    const sim = createSim(configFromHeader(saved.header, config.road, config.route));
    const result = createReplayController(saved).run(sim);
    console.log(`[print] seed ${seed}: replayed ${result.ticks} ticks, ${result.checked} hashes compared`);
    expect(result.desync).toBeNull();
    expect(result.checked).toBeGreaterThanOrEqual(Math.floor(TICKS / HASH_EVERY_TICKS));
    expect(sim.hash()).toBe(finalHash);
  });
});
