import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../app';
import { quantizeInput } from '../../sim/api';
import { createStubBot } from './index';

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

/** Runs the base pack's race with the stub bot in the player slot; returns what it saw. */
function botRace(seed: number) {
  const { sim, route, playerId } = createHeadlessRace({ seed });
  const bot = createStubBot();
  const edges: number[] = [];
  const hashes: number[] = [];
  let invalid = 0;
  let maxOffLane = 0;
  while (!sim.isOver() && sim.tick < 60 * 600) {
    const snap = sim.snapshot();
    const me = snap.entities[playerId];
    if (!me) throw new Error('no player');
    const a = blank();
    bot.drive(me, route, a);
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    for (const m of sim.snapshot().entities) {
      const fields = [m.x, m.y, m.z, m.heading, m.speed, m.road.s, m.road.d, m.road.yaw];
      if (!fields.every(Number.isFinite) || m.road.s < 0 || m.road.s > route.edgeLength(m.road.edge))
        invalid++;
    }
    const after = sim.snapshot().entities[playerId];
    if (after && edges[edges.length - 1] !== after.road.edge) edges.push(after.road.edge);
    if (after) maxOffLane = Math.max(maxOffLane, Math.abs(after.road.d - 1.7));
    if (sim.tick % 60 === 0) hashes.push(sim.hash());
  }
  return { sim, playerId, edges, hashes, invalid, maxOffLane };
}

describe('dev/bot: the stub bot races the skeleton track (M1 app-1 acceptance, headless)', () => {
  it('reaches the finish with a placing, crossing all three edges, every tick valid', () => {
    const run = botRace(7);
    const snap = run.sim.snapshot();
    console.log(
      `stub bot: ${run.sim.tick} ticks (${(run.sim.tick / 60).toFixed(1)} s), edges ${run.edges.join('>')}, ` +
        `finish order ${snap.race.finishOrder.join(',')}, max lane error ${run.maxOffLane.toFixed(2)} m`,
    );
    expect(run.sim.isOver()).toBe(true);
    expect(snap.race.finishOrder).toContain(run.playerId);
    expect(run.edges).toEqual([0, 1, 2]); // two junction crossings
    expect(run.invalid).toBe(0);
    expect(run.maxOffLane).toBeLessThan(1.7); // stays in its lane
  });

  it('replays to identical state hashes in the same run', () => {
    expect(botRace(7).hashes).toEqual(botRace(7).hashes);
  });
});
