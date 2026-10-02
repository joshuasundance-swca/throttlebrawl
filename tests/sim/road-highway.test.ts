/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// The first multi-lane highway (W-R; interview, 2026-10-02: "multi-lane highways (4-6 lanes, lane
// splitting)"): San Francisco's race finishes on the Bridge Approach, a freeway that widens to three
// lanes each way. Raced the way the game races it (the region's full field and traffic, the bot in
// the player slot), the freeway's traffic uses every lane both ways, no two vehicles ever share a
// spot in a lane, the cars heading back to the city are in the two-lane road's lanes before they
// reach it (they merged out of the lanes that end), and the bot still finishes.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';
import { NO_ROAD_EVENTS } from './batch';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENT = 'region-sf:sf-hill-sprint';
const MAX_TICKS = 60 * 60 * 8;
const SEEDS = [1, 2];
const print = (line: string) => process.stdout.write(line + '\n');

function highwayRace(seed: number) {
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, EVENT), {
    seed,
    eventId: EVENT,
    // Road events off: this watches the traffic, and an event reshuffles every seeded race.
    tuning: NO_ROAD_EVENTS,
  });
  const sim = createSim(config);
  const road = config.road;
  const freeway = road.edgeIndex('sf-bridge-approach');
  const ramp = road.edgeIndex('sf-bridge-onramp');
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const lengthOf = new Map(config.trafficTypes.map((t) => [t.contentId, t.lengthM]));
  const bot = createBot();
  const lanesUsed = new Set<string>();
  const bad: string[] = [];
  let vehicleTicks = 0;
  let nearMisses = 0;
  let splits = 0;
  let maxVehicles = 0;
  /** Wall-clock sim step time (this machine, not the phone) with the player on the freeway, and elsewhere. */
  const stepMs = { freeway: 0, freewayTicks: 0, rest: 0, restTicks: 0 };
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < MAX_TICKS && !snap.race.finishOrder.includes(playerId)) {
    const actions = emptyActions();
    bot.drive(snap, playerId, config.route, actions);
    const onFreeway = snap.entities[playerId]?.road.edge === freeway;
    const t0 = performance.now();
    sim.step([toSimInput(actions)]);
    const dt = performance.now() - t0;
    if (onFreeway) {
      stepMs.freeway += dt;
      stepMs.freewayTicks++;
    } else {
      stepMs.rest += dt;
      stepMs.restTicks++;
    }
    snap = sim.snapshot();
    maxVehicles = Math.max(maxVehicles, snap.entities.filter((m) => m.kind === 'vehicle').length);
    for (const e of sim.events()) {
      if (e.type !== 'nearMiss') continue;
      nearMisses++;
      if (e.data['split'] === true) splits++;
    }
    // Vehicles on the freeway: which drive lane each is in (the nearest lane centre its way).
    const inLane: { s: number; lane: string; len: number; id: number }[] = [];
    for (const m of snap.entities) {
      if (m.kind !== 'vehicle' || m.mode !== 'Road') continue;
      // On the two-lane on-ramp, inside the road (lanes and shoulders, 5.5 m each side): a car still
      // out in a lane that ended would be 6 to 10 m out. A kerb rider rides the shoulder (4.75).
      if (m.road.edge === ramp && Math.abs(m.road.d) > 5.5) {
        bad.push(
          `tick ${snap.tick}: ${m.contentId} ${m.id} on the on-ramp off its road (d ${m.road.d.toFixed(2)})`,
        );
      }
      if (m.road.edge !== freeway) continue;
      vehicleTicks++;
      const lanes = road
        .lanesAt(freeway, m.road.s)
        .filter((l) => l.kind === 'drive' && l.direction === m.road.dir);
      let best = lanes[0];
      for (const l of lanes) {
        if (Math.abs(l.dCenterM - m.road.d) < Math.abs((best?.dCenterM ?? 0) - m.road.d)) best = l;
      }
      if (!best) continue;
      // Settled in a lane (not mid lane change): counts toward the lanes used, and the overlap check.
      if (Math.abs(best.dCenterM - m.road.d) > 0.5) continue;
      if (m.road.s > 70) lanesUsed.add(best.id);
      inLane.push({ s: m.road.s, lane: best.id, len: lengthOf.get(m.contentId) ?? 4.6, id: m.id });
    }
    inLane.sort((a, b) => (a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : a.s - b.s));
    for (let i = 1; i < inLane.length; i++) {
      const a = inLane[i - 1];
      const b = inLane[i];
      if (!a || !b || a.lane !== b.lane) continue;
      if (b.s - a.s < (a.len + b.len) / 2 - 0.05) {
        bad.push(`tick ${snap.tick}: vehicles ${a.id} and ${b.id} overlap in lane ${a.lane}`);
      }
    }
  }
  return {
    finished: snap.race.finishOrder.includes(playerId),
    lanesUsed: [...lanesUsed].sort(),
    bad,
    vehicleTicks,
    nearMisses,
    splits,
    maxVehicles,
    stepMs: {
      freeway: stepMs.freeway / Math.max(1, stepMs.freewayTicks),
      rest: stepMs.rest / Math.max(1, stepMs.restTicks),
    },
    seconds: sim.tick / 60,
  };
}

describe('the first multi-lane highway: San Francisco (W-R; interview, 2026-10-02)', () => {
  it('fills every freeway lane both ways, never overlaps, merges before the lanes end, and the bot finishes', () => {
    for (const seed of SEEDS) {
      const r = highwayRace(seed);
      print(
        `[highway] seed ${seed}: bot ${r.finished ? 'finished' : 'did not finish'} in ${r.seconds.toFixed(1)} s; ` +
          `${r.vehicleTicks} vehicle-ticks on the freeway, lanes used ${r.lanesUsed.join(' ')}; ` +
          `bot near misses ${r.nearMisses}, lane splits ${r.splits}; problems ${r.bad.length}; ` +
          `vehicles up to ${r.maxVehicles}; sim step mean ${r.stepMs.freeway.toFixed(3)} ms on the freeway, ` +
          `${r.stepMs.rest.toFixed(3)} ms elsewhere (this machine, not a phone)`,
      );
      expect(r.finished).toBe(true);
      expect(r.vehicleTicks).toBeGreaterThan(0);
      expect(r.lanesUsed).toEqual(['L1', 'L2', 'L3', 'R1', 'R2', 'R3']);
      expect(r.bad.slice(0, 5)).toEqual([]);
    }
  }, 600_000);
});
