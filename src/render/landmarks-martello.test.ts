// The Martello forts on Key West (playtest 4, P4-19, run B task B5; the identity sheets' fix 9 and K4: "East
// Martello's brick fort near the airport, and West Martello's brick walls at Higgs Beach"). CX5 built both
// into the `keys-landmarks` kit; this puts them where Key West's roads pass them, as landmark features of the
// baked roads (tools/gis/networks/osm-keys-key-west.json, line `us1`). East Martello is on South Roosevelt
// Boulevard (`osm-kw-smathers-beach`) by the airport, West Martello at Higgs Beach (`osm-kw-higgs-beach`),
// each on the sea side. Their real positions come from the maintainer's world knowledge, not a source this
// session could open: the checks hold the rules (the sea side, past the verge, on drawn land, the model in
// its box, nothing else in the way, one draw call), with a control for each, and the station is checked against
// the remembered coordinates below, which are UNVERIFIED.
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  resolveVerge,
  type BakedFeature,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import { geoFrame } from './backdrop/geo';
import { readGlb } from './glb';
import { landmarkFootprints, landmarkKitsFor, LandmarkLayer, landmarkPlacements } from './landmarks';
import { createFlatLook } from './look';
import { bakeRepoModel, readAsset } from './model-files.test-util';
import { bakeLandmarkKit, landmarkKitAsset } from './models';
import { buildRoadScene, type RoadDressing } from './road-mesh';
import { KEYS_KIT, scatterRoadside } from './roadside';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const NETWORK = 'osm-keys-key-west';
const networkFiles = import.meta.glob<BakedNetwork & { crs: { originLatDeg: number; originLonDeg: number } }>(
  '../../packs/base/regions/florida-keys/networks/osm-keys-key-west.json',
  { eager: true, import: 'default' },
);
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/osm-kw-*.json', {
  eager: true,
  import: 'default',
});
const network = Object.values(networkFiles)[0]!;
const allRoads = Object.values(
  import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
    eager: true,
    import: 'default',
  }),
).filter((r) => network.roads.includes(r.id));
const road: RoadNetwork = createRoadNetwork({ network, roads: allRoads });
const dressing = Object.fromEntries(allRoads.map((r) => [r.id, r])) as unknown as RoadDressing;
const frame = geoFrame(network.crs.originLatDeg, network.crs.originLonDeg);

interface Fort {
  id: string;
  node: string;
  road: string;
  scale: number;
  /** The remembered real coordinates [lat, lon]: UNVERIFIED (no map source could be opened). */
  real: readonly [number, number];
}
const FORTS: readonly Fort[] = [
  {
    id: 'east-martello',
    node: 'east_martello',
    road: 'osm-kw-smathers-beach',
    scale: 0.47,
    real: [24.5517, -81.7561],
  },
  {
    id: 'west-martello',
    node: 'west_martello',
    road: 'osm-kw-higgs-beach',
    scale: 0.7,
    real: [24.5467, -81.7872],
  },
];

const featureOf = (f: Fort): BakedFeature | undefined =>
  (roadFiles[`../../packs/base/regions/florida-keys/roads/${f.road}.json`]?.features ?? []).find(
    (x) => x.id === f.id,
  );

/** The nearest station of a road to a world point: s, and the signed offset (positive to the right). */
function nearest(roadId: string, x: number, z: number) {
  const e = road.edges[road.edgeIndex(roadId)]!;
  let best = { s: 0, off: Infinity, d: 0 };
  for (let s = 0; s <= e.length; s += 1) {
    const p = road.toWorld(e.index, s, 0, 0);
    const off = Math.hypot(p.x - x, p.z - z);
    if (off < best.off) best = { s, off, d: 0 };
  }
  const a = road.toWorld(e.index, Math.max(0, best.s - 1), 0, 0);
  const b = road.toWorld(e.index, Math.min(e.length, best.s + 1), 0, 0);
  const n = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const c = road.toWorld(e.index, best.s, 0, 0);
  best.d = ((x - c.x) * -(b.z - a.z) + (z - c.z) * (b.x - a.x)) / n;
  return best;
}

const kit = bakeLandmarkKit(
  'keys-landmarks',
  readGlb(await readAsset(landmarkKitAsset('keys-landmarks'), 'glb')),
);
const keysRoadside = await bakeRepoModel('keysRoadside');

describe('the Martello forts, as landmark features of the baked Key West roads', () => {
  it('are on the roads the sheets name, each naming a node the shipped kit answers for, near and far', () => {
    for (const f of FORTS) {
      const feat = featureOf(f);
      expect(feat, f.id).toBeDefined();
      expect(feat!.kind).toBe('landmark');
      expect(feat!.params?.['model']).toBe(`models/landmarks/keys-landmarks#${f.node}`);
      expect(feat!.params?.['scale']).toBeCloseTo(f.scale, 6);
      expect(kit.nodes.has(f.node) || kit.nodes.has(`${f.node}_lod0`), `${f.node} in the kit`).toBe(true);
    }
    // East Martello has a lighter form for past `farM`; West Martello has none, and sets no farM.
    expect(kit.nodes.has('east_martello_lod1')).toBe(true);
    expect(featureOf(FORTS[0]!)!.params?.['farM']).toBeGreaterThan(0);
    const placed = landmarkPlacements(road).filter((p) => FORTS.some((f) => f.node === p.node));
    expect(placed.map((p) => p.node).sort()).toEqual(['east_martello', 'west_martello']);
    expect(landmarkKitsFor(road)).toEqual(['keys-landmarks']);
  });

  it('stand where the real forts are along their roads: near the remembered coordinates (unverified), on the sea side', () => {
    for (const f of FORTS) {
      const feat = featureOf(f)!;
      const [x, z] = frame.toWorld(f.real[0], f.real[1]);
      const real = nearest(f.road, x, z);
      const sMid = (feat.s0 + feat.s1) / 2;
      const dMid = (feat.d0 + feat.d1) / 2;
      print(
        `${f.id}: s ${sMid.toFixed(0)}, d ${dMid.toFixed(1)} on ${f.road}; the remembered real point projects to s ${real.s.toFixed(0)}, d ${real.d.toFixed(0)} (${real.off.toFixed(0)} m off the road)`,
      );
      // Along the road: within a few lengths of the real station (the baked line is smoothed up to 43 m).
      expect(Math.abs(sMid - real.s)).toBeLessThan(60);
      // The sea (left, d < 0) side of both roads: Smathers Beach and Higgs Beach lie to the left.
      expect(dMid).toBeLessThan(0);
      expect(real.d).toBeLessThan(0);
    }
  });

  it('stand wholly past the verge, on the drawn land, and the baked model fits the box', () => {
    const built = buildRoadScene(road, look, dressing, { seed: 7 });
    for (const f of FORTS) {
      const feat = featureOf(f)!;
      const r = allRoads.find((x) => x.id === f.road)!;
      const e = road.edges[road.edgeIndex(f.road)]!;
      const near = kit.nodes.get(f.node) ?? kit.nodes.get(`${f.node}_lod0`)!;
      near.geometry.computeBoundingBox();
      const b = near.geometry.boundingBox!;
      const along = feat.s1 - feat.s0;
      const across = Math.abs(feat.d1 - feat.d0);
      // The model, scaled, as long and as wide as its box (the box is the footprint the lint and the props use).
      const sizeX = (b.max.x - b.min.x) * f.scale;
      const sizeZ = (b.max.z - b.min.z) * f.scale;
      expect(Math.abs(sizeX - across), `${f.id} across`).toBeLessThan(0.1);
      expect(Math.abs(sizeZ - along), `${f.id} along`).toBeLessThan(0.1);
      // Past the verge band over its whole length (the road lint's `landmark-clear`, read here from the data).
      let worstGap = Infinity;
      let landLeft = Infinity;
      for (let s = feat.s0; s <= feat.s1; s += 1) {
        const sec = [...r.laneSections].reverse().find((c) => c.s0 <= s) ?? r.laneSections[0]!;
        const dOuter = resolveVerge(r, sec, 'left', s).dOuter;
        worstGap = Math.min(worstGap, dOuter - feat.d1);
        // The land is a strip `reach` m past the verge's outer edge: the box's far edge must be on it.
        landLeft = Math.min(landLeft, built.landReach(e.index, -1, s) - (dOuter - feat.d0));
      }
      print(
        `${f.id}: box ${along.toFixed(1)} by ${across.toFixed(1)} m (the model is ${(b.max.x - b.min.x).toFixed(0)} m at scale ${f.scale}), ` +
          `${worstGap.toFixed(2)} m past the verge at the nearest, ${landLeft.toFixed(2)} m of drawn land to spare at its far edge`,
      );
      expect(worstGap).toBeGreaterThanOrEqual(0);
      expect(worstGap).toBeLessThan(2);
      expect(landLeft).toBeGreaterThanOrEqual(0);
      // Control: at full size, with its near edge where it is, the fort's far edge would hang past the land
      // over the sea (the land is 24 m past the verge), which is why the scale is set.
      const fullFar = worstGap + (b.max.x - b.min.x);
      expect(fullFar, `${f.id} at full size`).toBeGreaterThan(24);
    }
    built.dispose();
  });

  it('keep every other prop out: no scenery spot and no roadside prop stands inside either fort, on any of 6 seeds', () => {
    const inside = (fort: Fort, edge: number, s: number, d: number, pad = 0) => {
      const feat = featureOf(fort)!;
      return (
        edge === road.edgeIndex(fort.road) &&
        s >= feat.s0 - pad &&
        s <= feat.s1 + pad &&
        d >= Math.min(feat.d0, feat.d1) - pad &&
        d <= Math.max(feat.d0, feat.d1) + pad
      );
    };
    let spotsSeen = 0;
    let propsSeen = 0;
    let unreservedInside = 0;
    for (const seed of [1, 7, 42, 99, 123, 2024]) {
      const built = buildRoadScene(road, look, dressing, { seed });
      const input = {
        road,
        dressing,
        seed,
        density: 1,
        kit: KEYS_KIT,
        landReach: (e: number, side: -1 | 1, s: number) => built.landReach(e, side, s),
        spots: built.spots,
        models: { keysRoadside },
      };
      const reserved = landmarkFootprints(road);
      const kept = scatterRoadside({ ...input, reserved });
      const loose = scatterRoadside(input);
      for (const f of FORTS) {
        for (const sp of built.spots) {
          spotsSeen++;
          expect(
            inside(f, sp.edge, sp.s, sp.d),
            `${f.id}: a ${sp.kind} at s ${sp.s.toFixed(0)}, d ${sp.d.toFixed(1)}, seed ${seed}`,
          ).toBe(false);
        }
        for (const it of kept) {
          propsSeen++;
          expect(
            inside(f, it.edge, it.s, it.d),
            `${f.id}: ${it.rule} at s ${it.s.toFixed(0)}, d ${it.d.toFixed(1)}, seed ${seed}`,
          ).toBe(false);
        }
        unreservedInside += loose.filter((it) => inside(f, it.edge, it.s, it.d)).length;
      }
      built.dispose();
    }
    // Control: the roadside layer given no reserved ground does stand props in a fort, so the check can see one.
    expect(unreservedInside).toBeGreaterThan(0);
    // Control: a landmark marked `overRoad` takes no ground, so the scenery stands in it as it would in
    // any open land: the same two forts so marked have scenery in them on some of these seeds (a bait shack
    // stood in West Martello on seed 1 before the scatter kept off landmarks).
    const free = Object.fromEntries(
      allRoads.map((r) => [
        r.id,
        {
          ...r,
          features: (r.features ?? []).map((x) =>
            x.kind === 'landmark' ? { ...x, params: { ...x.params, overRoad: true } } : x,
          ),
        },
      ]),
    ) as unknown as RoadDressing;
    let withoutKeepOff = 0;
    for (const seed of [1, 7, 42]) {
      const built = buildRoadScene(road, look, free, { seed });
      for (const f of FORTS)
        withoutKeepOff += built.spots.filter((sp) => inside(f, sp.edge, sp.s, sp.d)).length;
      built.dispose();
    }
    print(
      `${spotsSeen} scenery spots and ${propsSeen} roadside props checked over 6 seeds; without the footprints reserved, ${unreservedInside} props would stand inside a fort; ` +
        `with the forts marked overRoad, ${withoutKeepOff} scenery spots stand in them over 3 seeds`,
    );
    expect(withoutKeepOff).toBeGreaterThan(0);
  });

  it('draw in the landmark layer: both placed, none skipped, one draw call, a few hundred triangles', () => {
    const layer = new LandmarkLayer(new Map([['keys-landmarks', kit]]), look, { road });
    expect(layer.counts()).toMatchObject({ placed: 2, skipped: 0 });
    const placements = landmarkPlacements(road);
    // Standing at the East fort: it is near (the full model), and the whole layer is one draw call.
    const east = placements.find((p) => p.node === 'east_martello')!;
    layer.update(east.x, east.z);
    const near = layer.counts();
    // Far away down the road: its lighter form.
    const far = road.toWorld(road.edgeIndex('osm-kw-smathers-beach'), 400, 0, 0);
    layer.update(far.x, far.z);
    const farCounts = layer.counts();
    print(
      `landmark layer: ${near.trianglesDrawn} triangles at the East fort in ${near.drawCalls} draw call, ${farCounts.trianglesDrawn} from 2 km`,
    );
    expect(near.drawCalls).toBe(1);
    expect(near.trianglesDrawn).toBeGreaterThan(250);
    expect(near.trianglesDrawn).toBeLessThan(700);
    expect(farCounts.trianglesDrawn).toBe(0);
    layer.dispose();
  });

  it('are on the Key West network only', () => {
    expect(NETWORK).toBe('osm-keys-key-west');
    const others = Object.values(
      import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
        eager: true,
        import: 'default',
      }),
    ).filter((r) => !network.roads.includes(r.id));
    const owners = others.filter((r) =>
      (r.features ?? []).some((x) => /martello/.test(String(x.params?.['model']))),
    );
    expect(owners.map((r) => r.id)).toEqual([]);
  });
});
