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
//
// The check is split by region into three files (tests/sim/cops-parking.test.ts, -pnw and -sf), so
// CI can run them on different runners: as one file it took 300 to 440 s, the slowest sim file on
// 2026-10-05, and it grows with every new event and route. Every race is checked, in exactly one of
// them; `covers every region` fails if a region appears that none of them runs.
import { expect } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createSim, quantizeInput } from '../../src/sim/api';

export const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();

/** The regions the three files split the races by. */
export const PARKING_REGIONS = ['florida-keys', 'pacific-northwest', 'san-francisco'] as const;

/** Every live event at each length, then on each real-road route: [event id, length id, route]. */
export const RACES = Object.entries(REG.events).flatMap(([id, e]) => [
  ...e.lengths.map((l) => [id, l.id, ''] as const),
  ...realRoutes(REG, id).map((r) => [id, 'standard', r] as const),
]);

/** The races of one region's events. */
export const racesIn = (region: (typeof PARKING_REGIONS)[number]) =>
  RACES.filter(([id]) => REG.events[id]?.region === region);

/** The test name, with the race filled in by it.each. */
export const PARKING_TEST = '%s (%s) %s: each cop waits clear of every drive lane until he pulls out';

/** From the first tick until he pulls out, each cop of the race sits clear of every drive lane. */
export function checkParking(eventId: string, length: string, route: string): void {
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
  const spot = new Map<number, { s: number; d: number }>();
  let roadblockAt = -1;
  // The lot cop pulls out after cops.spawnDelayS (20 s on Normal) when the race brings him; since
  // playtest 2 the starting cops patrol up the road instead and pull out as the player arrives,
  // and the lot's cop waits for a speed trap or chaos. 30 s of every cop's wait is examined.
  for (let t = 0; t < 60 * 30 && waiting.size > 0; t++) {
    const snap = sim.snapshot();
    // Heat tier 3 is the roadblock: it parks waiting cops across the player's lanes on purpose
    // (sim/cops, "The roadblock"), and the steady cruise can build the heat that far, so the wait
    // spots are examined up to then (T10.1's slower Keys field reached it at 28 s on Key West).
    if ((snap.law?.tier ?? 0) >= 3) {
      roadblockAt = t;
      break;
    }
    for (const id of [...waiting]) {
      const cop = snap.entities[id];
      if (!cop) throw new Error(`no cop ${id}`);
      // Pulling out starts with a sideways ease off the lot before the speed builds (SF's
      // burn-rate cop slid 0.8 m toward the road at under 0.5 m/s), so any move off the spot
      // he waited on last tick is the pull-out, as is the speed.
      const last = spot.get(id);
      spot.set(id, { s: cop.road.s, d: cop.road.d });
      const moved = last !== undefined && Math.hypot(cop.road.s - last.s, cop.road.d - last.d) > 0.005;
      if (cop.speed > 0.5 || moved) {
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
  console.log(
    `[examined] ${eventId} (${length}): ${cops.length} cops; ${pulledOut.join('; ') || 'none pulled out'}; ` +
      `${waiting.size} still waiting at ${roadblockAt >= 0 ? `the roadblock, ${(roadblockAt / 60).toFixed(1)} s` : '30 s'}`,
  );
  expect(where.slice(0, 3)).toEqual([]);
}
