/// <reference types="vite/client" />
// tuning-1 acceptance, headless half: changing knockback on the registry changes the outcome of a
// seeded fight, compared with a control run. The fight is scripted per tick (the stub bot steers,
// and the player swings whenever a rival is in the auto-target box), so it repeats exactly; the
// change goes through the same path as the panel: registry.set -> recordTuningChange ->
// sim.applyParam between steps. The browser half waits for dev-1's attacking bot.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { createStubBot } from '../../src/dev/bot';
import { toSimInput } from '../../src/input';
import { SIM_TUNING } from '../../src/sim/api';
import { createTuningRegistry } from '../../src/tuning';

const ID = 'combat.knockbackScale';
const TICKS = 60 * 40;
const SET_AT = 30;

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

function fight(seed: number, knockback: number | null) {
  const pending: { id: string; value: number }[] = [];
  const registry = createTuningRegistry(SIM_TUNING, (id, value) => pending.push({ id, value }));
  const { sim, playerId, route } = createHeadlessRace({ seed, tuning: registry.simValues() });
  const bot = createStubBot();
  const hits: number[] = [];
  const trace: string[] = [];
  let swing = false;
  while (sim.tick < TICKS && !sim.isOver()) {
    if (sim.tick === SET_AT && knockback !== null) registry.set(ID, knockback);
    for (const c of pending.splice(0)) sim.applyParam(c.id, c.value);
    const snap = sim.snapshot();
    const me = snap.entities[playerId];
    if (!me) throw new Error('no player');
    const a = blank();
    bot.drive(me, route, a);
    const near = snap.entities.some(
      (e) =>
        e.id !== playerId &&
        e.kind === 'rider' &&
        e.road.edge === me.road.edge &&
        Math.abs(e.road.s - me.road.s) <= 4 &&
        Math.abs(e.road.d - me.road.d) <= 3,
    );
    // A fresh press every other tick while a rival is close: attacks start on the press.
    swing = near && !swing;
    a.attack = swing;
    sim.step([toSimInput(a)]);
    for (const e of sim.events()) if (e.type === 'hit') hits.push(sim.tick);
    trace.push(
      sim
        .snapshot()
        .entities.map((e) => `${e.road.s},${e.road.d}`)
        .join('|'),
    );
  }
  return { hits, trace, value: registry.get(ID) };
}

describe('tuning: knockback changes a seeded fight', () => {
  const decl = SIM_TUNING.find((d) => d.id === ID);

  it.runIf(decl)(
    'the fight repeats, lands hits, and a stronger knockback changes what follows the first hit',
    () => {
      if (!decl) return;
      const control = fight(3, null);
      const again = fight(3, null);
      const strong = fight(3, decl.max);
      const first = control.hits[0] ?? -1;
      const divergedAt = strong.trace.findIndex((t, i) => t !== control.trace[i]);
      console.log(
        `knockback ${control.value} vs ${strong.value}: control hits at ticks ${control.hits.join(', ') || 'none'}; ` +
          `strong run first differs at tick ${divergedAt + 1}`,
      );
      expect(again.trace).toEqual(control.trace);
      expect(control.hits.length, 'the scripted fight lands a hit').toBeGreaterThan(0);
      expect(divergedAt, 'a stronger knockback changes the outcome').toBeGreaterThanOrEqual(0);
      // Nothing differs before the first hit: the change acts through the shove, not elsewhere.
      expect(divergedAt + 1).toBeGreaterThanOrEqual(first);
    },
  );
});
