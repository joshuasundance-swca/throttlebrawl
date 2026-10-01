/// <reference types="vite/client" />
// Playtest 1c ([decided] 2026-09-30, the maintainer: "I'd like to also watch oncoming go up and up as
// you ride"): the snapshot carries each racer's style run in progress, so the HUD can show a live,
// ticking counter. On the real track with the real sim, the player rides stretches in the oncoming
// lane (no traffic, so nothing ends a stretch early): while a stretch runs, its seconds and cash only
// go up, and the cash the snapshot showed on the last tick of the stretch is exactly what the
// `style` event then awards.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, DEFAULT_EVENT, type ActionState } from '../../src/app';
import { loadBasePack, lookup } from '../../src/content';
import { createSim, quantizeInput, type EntitySnapshot, type SimEvent } from '../../src/sim/api';
import { activateRegion } from '../../src/stream';

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

function soloSim(seed: number) {
  const reg = loadBasePack();
  const event = lookup(reg.events, DEFAULT_EVENT);
  const routeFile = lookup(reg.routes, event.lengths[0]?.route ?? '');
  const network = lookup(reg.networks, routeFile.network);
  const stream = activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
  const built = buildSimConfig(reg, stream, {
    seed,
    tuning: { 'ai.aggressionScale': 0, 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 },
  });
  const config = { ...built, riders: built.riders.filter((r) => r.controller.kind === 'player') };
  return { sim: createSim(config), config };
}

describe('playtest 1c: the live style run matches the cash finally awarded', () => {
  it('oncoming stretches tick up in the snapshot, and the last value is the award, exactly', () => {
    const { sim, config } = soloSim(5);
    const awards: { points: number; shown: EntitySnapshot['styleRun'] }[] = [];
    let last: EntitySnapshot | undefined = sim.snapshot().entities[0];
    let rises = 0;
    let falls = 0;
    for (let t = 0; t < 60 * 70 && !sim.isOver(); t++) {
      const me = sim.snapshot().entities[0] as EntitySnapshot;
      const { edge, s, d, dir, yaw } = me.road;
      // Alternate: 8 s in the oncoming lane (d −2 facing +s), 4 s back in our own (d +2).
      const target = (t % (60 * 12) < 60 * 8 ? -2 : 2) * dir;
      const v = Math.max(me.speed, 5);
      const kappa = config.road.kappaAt(edge, s) * dir;
      const a = blank();
      a.throttle = 1;
      a.steer = Math.max(-1, Math.min(1, 0.35 * (target - d) * dir - 2.5 * yaw + (kappa * v * v) / 22));
      sim.step([quantizeInput({ ...a, flags: 0 })]);
      const now = sim.snapshot().entities[0] as EntitySnapshot;
      const was = last?.styleRun;
      const run = now.styleRun;
      if (was && run && was.kind === 'oncoming' && run.kind === 'oncoming') {
        if (run.seconds > was.seconds && run.cash >= was.cash) rises++;
        else falls++;
      }
      const events: readonly SimEvent[] = sim.events();
      for (const e of events) {
        if (e.type === 'style' && e.data['kind'] === 'oncoming' && e.actor === 0) {
          awards.push({ points: Number(e.data['points']), shown: was ?? null });
        }
      }
      last = now;
    }
    console.log(
      `style run: ${awards.length} oncoming awards; ${rises} ticks rising, ${falls} not; ` +
        awards
          .map((w) => `$${w.points} (shown $${w.shown?.cash}, ${w.shown?.seconds.toFixed(2)} s)`)
          .join(', '),
    );
    expect(awards.length).toBeGreaterThanOrEqual(3);
    expect(falls).toBe(0);
    expect(rises).toBeGreaterThan(60 * 10);
    for (const w of awards) {
      expect(w.shown?.kind).toBe('oncoming');
      expect(w.shown?.qualifies).toBe(true);
      expect(w.shown?.cash).toBe(w.points);
    }
  }, 60_000);
});
