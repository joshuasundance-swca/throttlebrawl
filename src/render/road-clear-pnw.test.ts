// Nothing drawn stands in the road, on every Pacific Northwest network (road-clear.test-util.ts says how and
// why; split by pack so CI runs the three files side by side). Bridge City is where the maintainer met it
// (playtest 4's phone play, 2026-10-06), so it also rides two more seeds, and the negative control plants
// a building on one of its branches, and land: over its lanes, under them, and beside them (the live check of
// 2026-10-06 rode under Bridge City's grass on morrison-out, which the ground rule now holds).
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { RoadNetwork } from '../road';
import { checkNetwork, networksOf, placeLine, RIDE_HIGH_M, sweepNetwork } from './road-clear.test-util';
import { print } from './scene-cost.test-util';

describe('the ride column over every road of every Pacific Northwest network: nothing drawn cuts it', () => {
  for (const id of networksOf('region-pnw')) it(`${id}, seed 1`, () => checkNetwork(id, 1), 300_000);
  for (const seed of [2, 3])
    it(`osm-pnw-portland, seed ${seed}`, () => checkNetwork('osm-pnw-portland', seed), 300_000);
});

/** The branch the control plants on: Alder Street, the Morrison choice's own road, off the main route. */
const BRANCH = 'osm-pnw-pdx-alder';
const AT_S = 200;

/** Where the land is planted along the branch: over its lanes, under them, and beside them. */
const LAND_OVER_S = 240;
const LAND_UNDER_S = 270;
const LAND_BESIDE_S = 300;

/**
 * Three boxes on the branch at AT_S: one standing on the lanes, one just past them, one hung over them; and
 * three slabs of land (named as the road's own, so the ground rule holds them): one 0.3 m over the lanes, one
 * 0.05 m under them (as the road's land lies), and one 1 m up just past their edge (land meeting the road).
 */
function plant(road: RoadNetwork): Group {
  const e = road.edgeIndex(BRANCH);
  const group = new Group();
  group.name = 'control';
  const box = (name: string, d: number, across: number, bottom: number, height: number, s = AT_S) => {
    let hi = 0;
    for (const lane of road.lanesAt(e, s)) hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    const f = road.frameAt(e, s);
    const p = road.toWorld(e, s, d === Infinity ? hi + 0.1 + across / 2 : d, 0);
    // 6 m along the road (the model's z, turned to the tangent), `across` wide.
    const m = new Mesh(new BoxGeometry(across, height, 6), new MeshBasicMaterial());
    m.name = name;
    m.position.set(p.x, p.y + bottom + height / 2, p.z);
    m.rotation.y = Math.atan2(f.tx, f.tz);
    group.add(m);
  };
  // Land: 0.3 m over the lanes, 0.05 m under them, and 1 m up beside them (its face 0.1 m past their edge).
  box('road-land', 0, 8, 0.2, 0.1, LAND_OVER_S);
  box('road-land', 0, 8, -0.15, 0.1, LAND_UNDER_S);
  box('road-land', Infinity, 6, 0.9, 0.1, LAND_BESIDE_S);
  let hi = 0;
  for (const lane of road.lanesAt(e, AT_S)) hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  // A building on the lanes: 8 m across, standing on the asphalt.
  box('in-road', 0, 8, -0.5, 12);
  // The same building with its face 0.1 m past the lanes' edge (the column starts RIM_M inside it): beside them.
  box('beside', hi + 0.1 + 4, 8, -0.5, 12);
  // A sign board hung over the lanes, its bottom clear of the column's top.
  box('overhead', 0, 8, RIDE_HIGH_M + 0.3, 1.5);
  return group;
}

describe('the negative control: a building and land planted on a branch of Bridge City', () => {
  it('the building and the land over the lanes are found, by road and s; what stands beside, over or under them is not', async () => {
    const { places } = await sweepNetwork('osm-pnw-portland', 1, plant);
    const mine = places.filter((p) => p.part.startsWith('control/'));
    for (const p of mine) print(`[examined] control: ${placeLine(p)}`);
    const inRoad = mine.filter((p) => p.part === 'control/in-road');
    expect(inRoad.length).toBeGreaterThan(0);
    expect(inRoad.map((p) => p.edge)).toContain(BRANCH);
    const on = inRoad.find((p) => p.edge === BRANCH);
    expect(on?.s0).toBeLessThanOrEqual(AT_S);
    expect(on?.s1).toBeGreaterThanOrEqual(AT_S - 3);
    expect(on?.cells, 'a building cuts many cells').toBeGreaterThan(20);
    // The land over the lanes is found there, 0.3 m up; the land under them and beside them is not.
    const land = mine.filter((p) => p.part === 'control/road-land');
    const over = land.find((p) => p.edge === BRANCH && p.s0 <= LAND_OVER_S + 3 && p.s1 >= LAND_OVER_S - 3);
    expect(over, 'land 0.3 m over the lanes').toBeDefined();
    expect(over?.over).toBeGreaterThan(0.2);
    expect(over?.over).toBeLessThan(0.45);
    expect(land.filter((p) => p !== over).map(placeLine)).toEqual([]);
    expect(
      mine.filter((p) => p.part !== 'control/in-road' && p.part !== 'control/road-land').map(placeLine),
    ).toEqual([]);
  }, 300_000);
});
