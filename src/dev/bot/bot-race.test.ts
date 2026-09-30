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
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < 60 * 900) {
    const a = blank();
    bot.drive(snap, playerId, route, a);
    sim.step([toInput(a)]);
    snap = sim.snapshot();
    for (const m of snap.entities) invalid ??= moverProblem(m, route);
    const me = snap.entities[playerId];
    if (me && edges[edges.length - 1] !== me.road.edge) edges.push(me.road.edge);
    if (sim.tick % 60 === 0) hashes.push(sim.hash());
  }
  return { sim, playerId, edges, hashes, invalid, stats: bot.stats() };
}

describe('dev/bot: the bot races the base track headless', () => {
  it('reaches the finish with a placing, crossing its edges once each, every mover valid', () => {
    const run = botRace(7);
    const snap = run.sim.snapshot();
    console.log(
      `bot: ${run.sim.tick} ticks (${(run.sim.tick / 60).toFixed(1)} s), edges ${run.edges.join('>')}, ` +
        `finish order ${snap.race.finishOrder.join(',')}, ${JSON.stringify(run.stats)}`,
    );
    expect(run.sim.isOver()).toBe(true);
    expect(snap.race.finishOrder).toContain(run.playerId);
    expect(run.edges.length).toBeGreaterThanOrEqual(3);
    expect(new Set(run.edges).size).toBe(run.edges.length); // never goes back to an edge
    expect(run.invalid).toBeNull();
  });

  it('replays to identical state hashes in the same run', () => {
    expect(botRace(7).hashes).toEqual(botRace(7).hashes);
  });
});
