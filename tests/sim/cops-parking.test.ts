/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// No region's cop waits in a travel lane (W-O polish run, after the cops polish report: San
// Francisco's route had no `copSpawn` lot, so Officer Meter waited on the grid slot behind the
// field in the drive lane, and a startup shuttle hit him there at 19.8 m/s on seed 1).
//
// Every live event at every length, and on each of its region's real-road routes (RaceSetup.route,
// the maintainer 2026-10-01: "Yes, add as routes"), loaded the way the game loads it (every carried
// pack, release content only, the app's own buildSimConfig): from the first tick until he pulls
// out, each cop sits clear of every drive lane. A new route with no lot fails here; give it a `copSpawn`
// beside the road near the start (keys-m1's bait-shop lot, pnw-c1's ferry lot, sf-hills' pier lot).
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createSim, quantizeInput } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();

/** Every live event at each length, then on each real-road route: [event id, length id, route]. */
const RACES = Object.entries(REG.events).flatMap(([id, e]) => [
  ...e.lengths.map((l) => [id, l.id, ''] as const),
  ...realRoutes(REG, id).map((r) => [id, 'standard', r] as const),
]);

describe('cops: no region parks its cop in a travel lane', () => {
  it('covers every region', () => {
    const regions = new Set(Object.values(REG.events).map((e) => e.region));
    console.log(
      `[examined] ${RACES.length} races in ${regions.size} regions: ${RACES.map((r) => r.filter(Boolean).join(' ')).join('; ')}`,
    );
    expect([...regions].sort()).toEqual(['florida-keys', 'pacific-northwest', 'san-francisco']);
  });

  it.each(RACES)(
    '%s (%s) %s: each cop waits clear of every drive lane until he pulls out',
    (eventId, length, route) => {
      const stream = STREAMS.forEvent(REG, eventId, length, route || null);
      const config = buildSimConfig(REG, stream, { seed: 1, eventId, length, ...(route ? { route } : {}) });
      if (route) expect(config.event.routeId, 'the race runs the real-road route').toBe(route);
      const cops = config.riders.flatMap((r, i) => (r.faction === 'law' ? [i] : []));
      expect(cops.length, 'the event fields a cop').toBeGreaterThan(0);
      const sim = createSim(config);
      // The player rides on at a steady cruise, so the race runs as usual.
      const cruise = quantizeInput({ throttle: 0.6, brake: 0, steer: 0, flags: 0 });
      const waiting = new Set(cops);
      const where: string[] = [];
      const pulledOut: string[] = [];
      // He pulls out after cops.spawnDelayS (20 s on Normal); 30 s covers it.
      for (let t = 0; t < 60 * 30 && waiting.size > 0; t++) {
        const snap = sim.snapshot();
        for (const id of [...waiting]) {
          const cop = snap.entities[id];
          if (!cop) throw new Error(`no cop ${id}`);
          if (cop.speed > 0.5) {
            waiting.delete(id); // pulled out
            pulledOut.push(
              `cop ${id} at ${(t / 60).toFixed(1)} s from s ${cop.road.s.toFixed(1)} d ${cop.road.d.toFixed(2)}`,
            );
            continue;
          }
          const lanes = config.road.lanesAt(cop.road.edge, cop.road.s);
          for (const l of lanes) {
            if (l.kind !== 'drive') continue;
            if (Math.abs(cop.road.d - l.dCenterM) < l.widthM / 2) {
              where.push(
                `tick ${t}: cop ${id} at s ${cop.road.s.toFixed(1)} d ${cop.road.d.toFixed(2)} in lane ${l.id}`,
              );
            }
          }
        }
        sim.step([cruise]);
      }
      console.log(`[examined] ${eventId} (${length}): ${pulledOut.join('; ')}`);
      expect(where.slice(0, 3)).toEqual([]);
      expect(waiting.size, 'every cop pulled out within 30 s').toBe(0);
    },
  );
});
