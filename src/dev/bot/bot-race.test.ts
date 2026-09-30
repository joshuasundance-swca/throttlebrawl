import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../app';
import { InputFlag, quantizeInput, type SimInput } from '../../sim/api';
import { moverProblem } from '../handle/checks';
import { createBot } from './index';

// One quick headless race in the unit tier (the pre-push hook runs it); the 50-race batch is in
// tests/sim/. dev/ may not import input/, so the action state is quantized here the way input's
// toSimInput does it.
function toInput(a: ActionState): SimInput {
  let flags = 0;
  if (a.attack) flags |= InputFlag.attack;
  if (a.attackSide < 0) flags |= InputFlag.attackSideLeft;
  if (a.attackSide > 0) flags |= InputFlag.attackSideRight;
  if (a.kick) flags |= InputFlag.kick;
  if (a.skipRunBack) flags |= InputFlag.skipRunBack;
  return quantizeInput({ steer: a.steer, throttle: a.throttle, brake: a.brake, flags });
}

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

function botRace(seed: number) {
  const { sim, route, playerId } = createHeadlessRace({ seed });
  const bot = createBot();
  const edges: number[] = [];
  const hashes: number[] = [];
  let invalid: string | null = null;
  let busted = false;
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < 60 * 900) {
    const a = blank();
    bot.drive(snap, playerId, route, a);
    sim.step([toInput(a)]);
    busted ||= sim.events().some((e) => e.type === 'bust' && e.target === playerId);
    snap = sim.snapshot();
    for (const m of snap.entities) invalid ??= moverProblem(m, route);
    const me = snap.entities[playerId];
    if (me && edges[edges.length - 1] !== me.road.edge) edges.push(me.road.edge);
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
