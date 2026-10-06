// Playtest 4 run B's live check (punch item 5): "Russian Hill has open lawn where buildings should be. One
// side of California Street and part of Hyde are lawn instead of buildings". A pedestrian zone (Nob Hill's
// people on California Street, d 5.6 to 12.6 m) or a board on the sidewalk (Hyde's street sign) covers the
// line the terraces' fronts stand on (8.7 m out), and the scatter kept every house off it and its 3 m of
// room: 40 to 100 m of open lawn. Now a house there stands behind it, its people or its board in front.
// Checked on every San Francisco network with row houses, on the scatter the road scene really builds:
// along each such zone or board with land behind it, the terrace goes on behind it, and no building
// stands inside it (a pedestrian is never drawn inside a house).
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { buildRoadScene, type RoadDressing } from './road-mesh';

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-sf/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-sf/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);

interface Feature {
  kind: string;
  id?: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
}
interface RoadData {
  id: string;
  tags?: { tag: string; side?: string }[];
  features?: Feature[];
}

/** Where the terraces' fronts stand on these streets (scenery.ts: the verge, then 2.6 m of sidewalk), m. */
const FRONT_M = 8.7;
/** A plot of a terrace along the road, m (scenery.ts SCATTER_SPACING_M.house). */
const PLOT_M = 7;
/**
 * The land a house behind a feature needs past the feature's far edge, m: 0.3 m of room and its 11.5 m
 * depth, less the 6.1 m from the centre line to the verge (FRONT_M less the 2.6 m sidewalk), and a metre.
 */
const ROOM_BEHIND_M = 0.3 + 11.5 - (FRONT_M - 2.6) + 1;

interface Scene {
  road: RoadNetwork;
  spots: ReturnType<typeof buildRoadScene>['spots'];
  reach: (e: number, side: -1 | 1, s: number) => number;
}

function build(network: BakedNetwork, seed: number): Scene {
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  const road = createRoadNetwork({ network, roads });
  const rs = buildRoadScene(road, createFlatLook(), dressing, { seed, models: {}, roadsideDensity: 1 });
  return { road, spots: rs.spots, reach: (e, side, s) => rs.landReach(e, side, s) };
}

describe('a city terrace goes on behind the people and the boards on its sidewalk', () => {
  for (const network of Object.values(networkFiles)) {
    const roads = Object.values(roadFiles).filter((r) =>
      network.roads.includes(r.id),
    ) as unknown as RoadData[];
    const terraced = roads.filter((r) => (r.tags ?? []).some((t) => t.tag === 'row-houses'));
    // The zones and boards that reach the fronts' line, on a road with row houses.
    const covers = terraced.flatMap((r) =>
      (r.features ?? [])
        .filter(
          (f) =>
            (f.kind === 'roadsideZone' || f.kind === 'billboard') &&
            Math.max(Math.abs(f.d0), Math.abs(f.d1)) > FRONT_M,
        )
        .map((f) => ({ road: r.id, f })),
    );
    if (covers.length === 0) continue;
    it(`${network.id}: each zone and board with land behind it has the terrace behind it`, () => {
      let held = 0;
      for (const seed of [1, 3]) {
        const { road, spots, reach } = build(network, seed);
        for (const { road: id, f } of covers) {
          const e = road.edgeIndex(id);
          const side = Math.sign(f.d0 + f.d1) as -1 | 1;
          const far = Math.max(Math.abs(f.d0), Math.abs(f.d1));
          const near = Math.min(Math.abs(f.d0), Math.abs(f.d1));
          const lo = Math.min(f.s0, f.s1);
          const hi = Math.max(f.s0, f.s1);
          // The plots where the land goes on far enough behind it for a house (a junction may cut it short).
          let room = 0;
          for (let u = lo; u + PLOT_M <= hi; u += PLOT_M) {
            const at = [u - 3, u, u + PLOT_M / 2, u + PLOT_M, u + PLOT_M + 3];
            if (at.every((x) => reach(e, side, x) >= far + ROOM_BEHIND_M)) room++;
          }
          const buildings = spots.filter(
            (p) =>
              p.edge === e &&
              Math.sign(p.d) === side &&
              (p.kind === 'house' || p.kind === 'apartment') &&
              p.s >= lo &&
              p.s <= hi,
          );
          const plots = buildings.reduce((n, b) => n + (b.plots ?? 1), 0);
          const inside = buildings.filter((b) => Math.abs(b.d) < far && Math.abs(b.d) > near - 0.5);
          print(
            `[examined] ${network.id} seed ${seed}: ${id} ${f.kind} ${f.id ?? ''} s ${lo}-${hi} d ${f.d0}..${f.d1}: ` +
              `${room} plots with land behind it, ${plots} built (${buildings.length} buildings), ${inside.length} inside it`,
          );
          // No building ever stands inside a zone or a board (its people are never drawn in a house).
          expect(inside.map((b) => `${b.kind} at s ${b.s.toFixed(0)} d ${b.d.toFixed(1)}`)).toEqual([]);
          if (room < 2) continue;
          held++;
          // The terrace goes on: at least half the plots with room (the scatter leaves about one in five empty).
          expect(
            plots,
            `${network.id} seed ${seed}: ${id} ${f.id ?? ''} has open lawn`,
          ).toBeGreaterThanOrEqual(Math.ceil(room / 2));
        }
      }
      expect(held).toBeGreaterThan(0);
    });
  }
});
