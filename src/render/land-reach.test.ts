// The land past the verge, as the road reads it (road/drawn-ground.ts `landReachOf`) and as the road scene draws it
// (road-mesh.ts `buildRoadScene`, `RoadScene.landReach`): the same rule, so a building the road's plan stands
// on land stands on drawn ground (the physical world, 2026-10-06: downtown Portland's blocks are planned in
// road/structures/downtown.ts from the network alone, where render read the drawn scene's reach).
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { landReachOf, type LandReach } from '../road/structures/downtown';
import { createFlatLook } from './look';
import { buildRoadScene, type RoadDressing } from './road-mesh';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing; roads: BakedRoad[] } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing, roads };
}

/** Every metre of every edge, both sides, where the two reaches differ by more than a millimetre. */
function differences(road: RoadNetwork, a: LandReach, b: LandReach): { at: string[]; samples: number } {
  const at: string[] = [];
  let samples = 0;
  for (const e of road.edges)
    for (const side of [-1, 1] as const)
      for (let s = 0; s <= e.length; s += 1) {
        samples++;
        const x = a(e.index, side, s);
        const y = b(e.index, side, s);
        if (Math.abs(x - y) > 1e-3) at.push(`${e.id} ${side} s ${s}: ${x} vs ${y}`);
      }
  return { at, samples };
}

const look = createFlatLook();

describe("the land's reach: the road's rule is the road scene's", () => {
  it('keeps the tagged Mill Yard ground behind its wall without removing the wall', () => {
    const { road, dressing } = track('pnw-c1');
    const edge = road.edgeIndex('pnw-sawmill-yard');
    const scene = buildRoadScene(road, look, dressing, { seed: 1 });
    const reach = landReachOf(road);
    for (const s of [230, 570]) {
      expect(road.barrierAt(edge, s, 'right')?.kind).toBe('wall');
      expect(scene.landReach(edge, 1, s), `drawn ground at ${s}`).toBeGreaterThan(0);
      expect(reach(edge, 1, s), `physical ground at ${s}`).toBe(scene.landReach(edge, 1, s));
    }
    scene.dispose();
  });
  // Downtown Portland plans its blocks on it; San Francisco's downtown is the other network with a downtown.
  for (const id of ['osm-pnw-portland', 'sf-downtown']) {
    it(`${id}: every metre of every road, both sides`, () => {
      const { road, dressing, roads } = track(id);
      // The rule reads the network's own barriers, which keep a road file's; a file without the key would
      // read differently (road/drawn-ground.ts), and none of these lacks it.
      expect(roads.filter((r) => r.barriers === undefined).map((r) => r.id)).toEqual([]);
      const scene = buildRoadScene(road, look, dressing, { seed: 1, models: {}, roadsideDensity: 1 });
      const drawn: LandReach = (e, side, s) => scene.landReach(e, side, s);
      const { at, samples } = differences(road, landReachOf(road), drawn);
      let land = 0;
      for (const e of road.edges)
        for (const side of [-1, 1] as const)
          for (let s = 0; s <= e.length; s += 1) if (drawn(e.index, side, s) > 0) land++;
      stdout.write(`[examined] ${id}: ${samples} samples (${land} with land), ${at.length} differ\n`);
      expect(land, 'the check saw land').toBeGreaterThan(samples / 10);
      expect(at).toEqual([]);
      scene.dispose();
    });
  }

  it('finds a reach that differs by a metre at one place (the control)', () => {
    const { road } = track('osm-pnw-portland');
    const reach = landReachOf(road);
    const e = road.edges.find((x) => x.tags.some((t) => t.tag === 'pdx-blocks'));
    if (!e) throw new Error('no blocks road');
    const off: LandReach = (edge, side, s) =>
      reach(edge, side, s) + (edge === e.index && side === 1 && s === 40 ? 1 : 0);
    expect(differences(road, reach, off).at).toHaveLength(1);
  });
});
