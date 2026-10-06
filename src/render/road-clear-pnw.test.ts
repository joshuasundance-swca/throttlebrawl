// Nothing drawn stands in the road, on every Pacific Northwest network (road-clear.test-util.ts says how and
// why; split by pack so CI runs the three files side by side). Bridge City is where the maintainer met it
// (playtest 4's phone play, 2026-10-06), so it also rides two more seeds, and the negative control plants
// a building on one of its branches.
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { RoadNetwork } from '../road';
import { checkNetwork, networksOf, placeLine, RIDE_HIGH_M, sweepNetwork } from './road-clear.test-util';
import { print } from './scene-cost.test-util';

describe('the ride column over every road of every Pacific Northwest network: no building cuts it', () => {
  for (const id of networksOf('region-pnw')) it(`${id}, seed 1`, () => checkNetwork(id, 1), 300_000);
  for (const seed of [2, 3])
    it(`osm-pnw-portland, seed ${seed}`, () => checkNetwork('osm-pnw-portland', seed), 300_000);
});

/** The branch the control plants on: Alder Street, the Morrison choice's own road, off the main route. */
const BRANCH = 'osm-pnw-pdx-alder';
const AT_S = 200;

/** Three boxes on the branch at AT_S: one standing on the lanes, one just past them, one hung over them. */
function plant(road: RoadNetwork): Group {
  const e = road.edgeIndex(BRANCH);
  let hi = 0;
  for (const lane of road.lanesAt(e, AT_S)) hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  const f = road.frameAt(e, AT_S);
  const turn = Math.atan2(f.tx, f.tz);
  const group = new Group();
  group.name = 'control';
  const box = (name: string, d: number, across: number, bottom: number, height: number) => {
    const p = road.toWorld(e, AT_S, d, 0);
    // 6 m along the road (the model's z, turned to the tangent), `across` wide.
    const m = new Mesh(new BoxGeometry(across, height, 6), new MeshBasicMaterial());
    m.name = name;
    m.position.set(p.x, p.y + bottom + height / 2, p.z);
    m.rotation.y = turn;
    group.add(m);
  };
  // A building on the lanes: 8 m across, standing on the asphalt.
  box('in-road', 0, 8, -0.5, 12);
  // A rail, as a verge's fence or a bridge's rail is drawn: 0.1 m thick, 1.1 m high, along the lanes (polish J2).
  box('rail', 1, 0.1, 0, 1.1);
  // The same building with its face 0.1 m past the lanes' edge (the column starts RIM_M inside it): beside them.
  box('beside', hi + 0.1 + 4, 8, -0.5, 12);
  // A sign board hung over the lanes, its bottom clear of the column's top.
  box('overhead', 0, 8, RIDE_HIGH_M + 0.3, 1.5);
  return group;
}

describe('the negative control: a building and a rail planted on a branch of Bridge City', () => {
  it('is found on the branch, by road and s; one beside the lanes and one hung over them are not', async () => {
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
    // A thin rail on the lanes is found too (the edge kit the pattern of polish J2 drew across a sibling's lanes).
    expect(
      mine.filter((p) => p.part === 'control/rail' && p.edge === BRANCH).length,
      'the rail',
    ).toBeGreaterThan(0);
    expect(mine.filter((p) => !['control/in-road', 'control/rail'].includes(p.part)).map(placeLine)).toEqual(
      [],
    );
  }, 300_000);
});
