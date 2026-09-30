/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { createStubBot } from '../../src/dev/bot';
import { quantizeInput } from '../../src/sim/api';

// M1 road-1 acceptance: how long the bot takes on the M1 route, printed, and failing outside
// 60–240 s (the route is sized for a race of about two minutes). It rides the base pack's default
// race headless, so it measures the real baked track with the real riding model.

const blank = (): ActionState => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  attack: false,
  attackSide: 0,
  kick: false,
  lookBack: false,
  skipRunBack: false,
});

describe('road: the bot on the M1 route', () => {
  it('finishes in 60–240 s', () => {
    const { sim, route, playerId } = createHeadlessRace({ seed: 11 });
    const bot = createStubBot();
    let finishTick = -1;
    const edges: number[] = [];
    while (!sim.isOver() && sim.tick < 60 * 600) {
      const me = sim.snapshot().entities[playerId];
      if (!me) throw new Error('no player');
      if (edges[edges.length - 1] !== me.road.edge) edges.push(me.road.edge);
      if (me.finished && finishTick < 0) finishTick = sim.tick;
      const a = blank();
      bot.drive(me, route, a);
      sim.step([quantizeInput({ ...a, flags: 0 })]);
    }
    const seconds = finishTick / 60;
    const length = sim.snapshot().race.routeLength;
    console.log(
      `bot on the M1 route: ${length.toFixed(0)} m in ${seconds.toFixed(1)} s ` +
        `(${(length / seconds).toFixed(1)} m/s average), edges ${edges.join('>')}`,
    );
    expect(finishTick).toBeGreaterThan(0);
    expect(seconds).toBeGreaterThanOrEqual(60);
    expect(seconds).toBeLessThanOrEqual(240);
  });
});
