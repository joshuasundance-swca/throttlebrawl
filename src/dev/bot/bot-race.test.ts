import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../app';
import { moverProblem } from '../handle/checks';
import { blankActions, botInput, createBot } from './index';

// One quick headless race in the unit tier (the pre-push hook runs it); the 50-race batch is in
// tests/sim/.
function botRace(seed: number) {
  const { sim, route, playerId } = createHeadlessRace({ seed });
  const bot = createBot();
  const edges: number[] = [];
  const hashes: number[] = [];
  let invalid: string | null = null;
  let busted = false;
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < 60 * 900) {
    const a = blankActions();
    bot.drive(snap, playerId, route, a);
    sim.step([botInput(a)]);
    busted ||= sim.events().some((e) => e.type === 'bust' && e.target === playerId);
    snap = sim.snapshot();
    for (const m of snap.entities) invalid ??= moverProblem(m, route);
    const me = snap.entities[playerId];
    // The route is the edges the bot rides: a crash's tumble body can flick across a junction and
    // back within a tick or two (seed 7 after a box-truck hit, edge 8 -> 4 -> 8), which is not the
    // bot turning back, so edges are counted only while riding.
    const riding = me?.mode === 'Road' || me?.mode === 'Airborne';
    if (me && riding && edges[edges.length - 1] !== me.road.edge) edges.push(me.road.edge);
    if (sim.tick % 60 === 0) hashes.push(sim.hash());
  }
  return { sim, playerId, edges, hashes, invalid, busted, stats: bot.stats() };
}

// A whole race with the full field, traffic both ways and pedestrians takes a few seconds, so
// these tests carry their own timeouts rather than Vitest's 5 s default.
const RACE_TIMEOUT_MS = 60_000;

describe('dev/bot: the bot races the base track headless', () => {
  it(
    'ends the race finished with a placing or busted (the batch rule), crossing its edges once each, every mover valid',
    () => {
      const run = botRace(7);
      const snap = run.sim.snapshot();
      const finished = snap.race.finishOrder.includes(run.playerId);
      console.log(
        `bot: ${run.sim.tick} ticks (${(run.sim.tick / 60).toFixed(1)} s), edges ${run.edges.join('>')}, ` +
          `finish order ${snap.race.finishOrder.join(',')}${run.busted ? ' (the bot was busted)' : ''}, ${JSON.stringify(run.stats)}`,
      );
      expect(run.sim.isOver()).toBe(true);
      // Finished with a placing, or taken out by the law (a busted player never finishes), never both.
      expect(finished !== run.busted).toBe(true);
      expect(run.edges.length).toBeGreaterThanOrEqual(3);
      expect(new Set(run.edges).size).toBe(run.edges.length); // never goes back to an edge
      expect(run.invalid).toBeNull();
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'replays to identical state hashes in the same run',
    () => {
      expect(botRace(7).hashes).toEqual(botRace(7).hashes);
    },
    RACE_TIMEOUT_MS * 2,
  );
});
