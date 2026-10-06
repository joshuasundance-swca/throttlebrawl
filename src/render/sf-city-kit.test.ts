// San Francisco's city kit on its real roads (playtest 4, P4-19, run C task C1: the CX6 models that had no
// place): the apartment and corner buildings in the row-house plots (R3), the flatiron at Columbus and
// Kearny (R4), the mission chapel at the end of the Mission route (M3), and Coit Tower moved to where it
// really stands (B1 found it 200 m off). Each test asserts the rule the placement protects, read from the
// baked roads in their own metres, never from lat/lon: a kind stands only on its own roads, nothing of it
// stands on a road, and each building turns the way its model is meant to be seen.
import { Mesh, Raycaster, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { landmarkPlacements, type LandmarkPlacement } from './landmarks';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { modelKindsFor, type SceneryModels } from './models';
import { buildRoadScene, type RoadDressing } from './road-mesh';
import { scatterRoadside, SF_KIT } from './roadside';
import { APARTMENT, halfAlongOf, type ScenerySpot } from './scenery';
import { apartmentSurfaces } from './text-surfaces';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-sf/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-sf/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const otherNetworks = import.meta.glob<BakedNetwork>('../../packs/base/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const otherRoads = import.meta.glob<BakedRoad>('../../packs/base/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const regionFile = Object.values(
  import.meta.glob<{ signs: { id: string; text: string; status?: string; tags?: string[] }[] }>(
    '../../packs/region-sf/regions/san-francisco/region.json',
    { eager: true, import: 'default' },
  ),
)[0]!;

const NETWORK_IDS = Object.values(networkFiles).map((n) => n.id);

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

/** The id of the road whose drawn lanes lie under a world point, or null. */
function roadUnder(road: RoadNetwork, x: number, z: number): string | null {
  for (const e of road.edges) {
    const p = road.project(x, z, e.index);
    const at = road.edges[p.edge];
    if (at && p.s > 0.5 && p.s < at.length - 0.5 && p.d > at.dMin - 0.25 && p.d < at.dMax + 0.25)
      return at.id;
  }
  return null;
}

/** A landmark's footprint box (its feature's s and d span) as a grid of world points. */
function footprintPoints(road: RoadNetwork, p: LandmarkPlacement): { x: number; z: number }[] {
  const f = p.feature;
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i <= 6; i++)
    for (let j = 0; j <= 6; j++) {
      const w = road.toWorld(p.edge, f.s0 + ((f.s1 - f.s0) * i) / 6, f.d0 + ((f.d1 - f.d0) * j) / 6, 0);
      out.push({ x: w.x, z: w.z });
    }
  return out;
}

/** Every placement of one kit node across San Francisco's networks, by network. */
function placementsOf(node: string): { network: string; road: RoadNetwork; placement: LandmarkPlacement }[] {
  const out: { network: string; road: RoadNetwork; placement: LandmarkPlacement }[] = [];
  for (const id of NETWORK_IDS) {
    const { road } = track(id);
    for (const placement of landmarkPlacements(road))
      if (placement.node === node) out.push({ network: id, road, placement });
  }
  return out;
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('Coit Tower stands at the end of Telegraph Hill Boulevard (B1: it stood 200 m off)', () => {
  it('is placed on the Lombard network only, on the boulevard, within 30 m of its end', () => {
    const found = placementsOf('coit_tower');
    expect(found.map((f) => f.network)).toEqual(['osm-sf-lombard']);
    const { road, placement } = found[0]!;
    const edge = road.edges[placement.edge]!;
    expect(edge.id).toBe('osm-sf-lombard-telegraph-hill');
    const end = road.toWorld(placement.edge, edge.length, 0, 0);
    const away = dist(placement, end);
    print(
      `[examined] Coit Tower ${away.toFixed(1)} m from the boulevard's baked end (${edge.length.toFixed(0)} m long)`,
    );
    expect(away).toBeLessThanOrEqual(30);
    // Its base is on the hill's own height there, not at the foot: within 5 m of the road's height at the end.
    expect(Math.abs(placement.y - end.y)).toBeLessThan(5);
  });
});

describe('the flatiron stands at Columbus and Kearny (R4)', () => {
  it('is placed on the Russian Hill network only, on Kearny, beside its end where Columbus begins', () => {
    const found = placementsOf('sf_flatiron');
    expect(found.map((f) => f.network)).toEqual(['osm-sf-russian-hill']);
    const { road, placement } = found[0]!;
    const edge = road.edges[placement.edge]!;
    expect(edge.id).toBe('osm-sf-kearny');
    const corner = road.toWorld(placement.edge, edge.length, 0, 0);
    const columbus = road.edges[road.edgeIndex('osm-sf-columbus')]!;
    const join = road.toWorld(columbus.index, 0, 0, 0);
    expect(dist(corner, join), 'Kearny ends where Columbus begins').toBeLessThan(2);
    const away = dist(placement, corner);
    print(`[examined] flatiron ${away.toFixed(1)} m from the Columbus and Kearny corner`);
    // The building's own middle: its 30 m put the prow about 35 m short of the turn, where the baked Kearny runs
    // out (the real Columbus Tower stands that far south of the baked Kearny and Columbus join).
    expect(away).toBeLessThanOrEqual(60);
    // The prow (+Z, 15 m ahead of the middle) is the end nearer the corner: it points at the junction.
    const tip = {
      x: placement.x + Math.sin(placement.yaw) * 15,
      z: placement.z + Math.cos(placement.yaw) * 15,
    };
    const base = {
      x: placement.x - Math.sin(placement.yaw) * 15,
      z: placement.z - Math.cos(placement.yaw) * 15,
    };
    expect(dist(tip, corner)).toBeLessThan(dist(base, corner));
  });

  it('draws its far stand-in past a distance of its own, nearer than the default', () => {
    const { placement } = placementsOf('sf_flatiron')[0]!;
    expect(placement.feature.params?.['farM']).toBeGreaterThan(0);
    expect(placement.params.farM).toBeLessThan(400);
  });
});

describe('the mission chapel ends the Mission route (M3)', () => {
  it('is placed on the Mission network only, beside the last road, facing the rider coming down it', () => {
    const found = placementsOf('sf_mission_church');
    expect(found.map((f) => f.network)).toEqual(['sf-mission']);
    const { road, placement } = found[0]!;
    const edge = road.edges[placement.edge]!;
    expect(edge.id).toBe('sf-mi-last-coat-alley');
    const s = (placement.feature.s0 + placement.feature.s1) / 2;
    expect(s, 'near the road end').toBeGreaterThan(edge.length - 80);
    // Its facade (+Z) looks back down the road at a rider coming along it.
    const f = road.frameAt(placement.edge, s);
    const facing = Math.sin(placement.yaw) * f.tx + Math.cos(placement.yaw) * f.tz;
    expect(facing).toBeLessThan(-0.95);
  });
});

describe('every placed building stands on drawn land, not over the sea', () => {
  for (const [node, network] of [
    ['coit_tower', 'osm-sf-lombard'],
    ['sf_flatiron', 'osm-sf-russian-hill'],
    ['sf_mission_church', 'sf-mission'],
  ] as const) {
    it(`${node}: a ray down from over each corner and the middle of its footprint meets the land`, () => {
      const { road, dressing } = track(network);
      const built = buildRoadScene(road, look, dressing, { seed: 1 });
      const ground: Object3D[] = [];
      built.group.updateMatrixWorld(true);
      built.group.traverse((o) => {
        if (o instanceof Mesh && /^road-(land|water|road|shoulder|deck)/.test(o.name)) ground.push(o);
      });
      const placement = landmarkPlacements(road).find((p) => p.node === node)!;
      const f = placement.feature;
      const at: [number, number][] = [
        [f.s0, f.d0],
        [f.s0, f.d1],
        [f.s1, f.d0],
        [f.s1, f.d1],
        [(f.s0 + f.s1) / 2, (f.d0 + f.d1) / 2],
      ];
      const off: string[] = [];
      for (const [s, d] of at) {
        const w = road.toWorld(placement.edge, s, d, 0);
        const ray = new Raycaster(new Vector3(w.x, w.y + 60, w.z), new Vector3(0, -1, 0), 0, 400);
        const hit = ray.intersectObjects(ground, false)[0];
        if (!hit || !/^road-(land|road|shoulder|deck)/.test(hit.object.name))
          off.push(`s ${s.toFixed(0)} d ${d.toFixed(0)}: ${hit?.object.name ?? 'nothing'}`);
      }
      print(
        `[examined] ${node}: ${at.length} footprint points, ${off.length} not over land (${off.join('; ')})`,
      );
      expect(off).toEqual([]);
      built.dispose();
    });
  }
});

describe('no row house or apartment stands in a landmark footprint', () => {
  /** Whether a building's box (along its road, from its front wall back) overlaps a landmark's on the same road. */
  function overlaps(a: ScenerySpot, f: { s0: number; s1: number; d0: number; d1: number }): boolean {
    const half = halfAlongOf(a);
    const out = Math.sign(a.d);
    const d0 = Math.min(a.d, a.d + out * 11.5);
    const d1 = Math.max(a.d, a.d + out * 11.5);
    return a.s + half > f.s0 && a.s - half < f.s1 && d1 > Math.min(f.d0, f.d1) && d0 < Math.max(f.d0, f.d1);
  }

  for (const [node, network] of [
    ['coit_tower', 'osm-sf-lombard'],
    ['sf_flatiron', 'osm-sf-russian-hill'],
  ] as const) {
    it(`${node}: the scatter leaves its footprint empty, and would not without the landmark (the control)`, () => {
      const { road, dressing } = track(network);
      const placement = landmarkPlacements(road).find((p) => p.node === node)!;
      const f = placement.feature;
      let inside = 0;
      let without = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const built = buildRoadScene(road, look, dressing, { seed });
        inside += built.spots.filter(
          (s) =>
            (s.kind === 'house' || s.kind === 'apartment') && s.edge === placement.edge && overlaps(s, f),
        ).length;
        built.dispose();
        const bare = Object.fromEntries(
          Object.entries(dressing).map(([id, d]) => [
            id,
            { ...d, features: d.features?.filter((x) => x.kind !== 'landmark') },
          ]),
        ) as unknown as RoadDressing;
        const control = buildRoadScene(road, look, bare, { seed });
        without += control.spots.filter(
          (s) =>
            (s.kind === 'house' || s.kind === 'apartment') && s.edge === placement.edge && overlaps(s, f),
        ).length;
        control.dispose();
      }
      print(
        `[examined] ${node}: ${inside} buildings in its footprint over 6 seeds; ${without} without the landmark`,
      );
      expect(inside).toBe(0);
      expect(without, 'the control sees buildings there').toBeGreaterThan(0);
    });
  }
});

describe('the land check can see the sea (its control)', () => {
  it('a ray down from 150 m off the mission alley meets the water, not land', () => {
    const { road, dressing } = track('sf-mission');
    const built = buildRoadScene(road, look, dressing, { seed: 1 });
    const ground: Object3D[] = [];
    built.group.updateMatrixWorld(true);
    built.group.traverse((o) => {
      if (o instanceof Mesh && /^road-(land|water|road|shoulder|deck)/.test(o.name)) ground.push(o);
    });
    const edge = road.edgeIndex('sf-mi-last-coat-alley');
    const w = road.toWorld(edge, 633, -150, 0);
    const ray = new Raycaster(new Vector3(w.x, w.y + 60, w.z), new Vector3(0, -1, 0), 0, 400);
    expect(ray.intersectObjects(ground, false)[0]?.object.name).toBe('road-water');
    built.dispose();
  });
});

describe('no placed kind stands on a road', () => {
  for (const node of ['coit_tower', 'sf_flatiron', 'sf_mission_church']) {
    it(`${node}: no point of its footprint is on any road of its network`, () => {
      const found = placementsOf(node);
      expect(found.length).toBeGreaterThan(0);
      for (const { road, placement } of found) {
        const pts = footprintPoints(road, placement);
        const hit = pts.map((p) => roadUnder(road, p.x, p.z)).filter((id) => id !== null);
        expect(hit, `${node}: ${hit.join(', ')}`).toEqual([]);
        print(`[examined] ${node}: ${pts.length} footprint points, none on a road`);
      }
    });
  }
});

// The apartment and corner buildings (R3): row-house plots are 7 m along the road, so a flat takes one and an
// apartment block or a corner building two.
describe('apartments and corner buildings in the terraces (R3)', async () => {
  const models: SceneryModels = {};
  for (const k of modelKindsFor({
    tropical: false,
    tags: new Set(['row-houses']),
    palette: new Set(),
    traffic: [],
  }))
    models[k] = await bakeRepoModel(k);
  const SEEDS = [1, 2, 3, 4, 5, 6];

  function spotsOf(networkId: string, seed: number): { road: RoadNetwork; spots: readonly ScenerySpot[] } {
    const { road, dressing } = track(networkId);
    return { road, spots: buildRoadScene(road, look, dressing, { seed, models }).spots };
  }
  const buildings = (spots: readonly ScenerySpot[]) =>
    spots.filter((s) => s.kind === 'house' || s.kind === 'apartment');

  it('loads for a network with row houses, and for no other', () => {
    const urban = { tropical: false, tags: new Set(['row-houses']), palette: new Set<string>(), traffic: [] };
    expect(modelKindsFor(urban)).toContain('sfApartments');
    for (const tags of [['forest'], ['water-open'], ['pdx-blocks']])
      expect(modelKindsFor({ ...urban, tags: new Set(tags) }), tags.join()).not.toContain('sfApartments');
    expect(modelKindsFor({ ...urban, tropical: true })).not.toContain('sfApartments');
  });

  it('appear on the row-house roads of San Francisco, every one of the six, and never anywhere else', () => {
    const seen = new Map<number, number>();
    for (const seed of SEEDS)
      for (const id of ['osm-sf-russian-hill', 'osm-sf-lombard', 'osm-sf-twin-peaks']) {
        const { road, dressing } = track(id);
        const spots = buildRoadScene(road, look, dressing, { seed, models }).spots;
        for (const s of spots.filter((x) => x.kind === 'apartment')) {
          seen.set(s.variant, (seen.get(s.variant) ?? 0) + 1);
          const tags = (road.edges[s.edge]?.tags ?? []).map((t) => t.tag);
          expect(
            tags.some((t) => ['row-houses', 'painted-houses', 'gardens'].includes(t)),
            `${road.edges[s.edge]?.id}: a road of terraces`,
          ).toBe(true);
        }
      }
    print(
      `[examined] apartment variants seen over ${SEEDS.length} seeds on 3 networks: ${JSON.stringify([...seen])}`,
    );
    for (let v = 0; v < 6; v++) expect(seen.get(v) ?? 0, `variant ${v}`).toBeGreaterThan(0);
    // A Keys network has none: its scatter has no houses.
    const network = Object.values(otherNetworks).find((n) => n.id === 'keys-m1')!;
    const roads = Object.values(otherRoads).filter((r) => network.roads.includes(r.id));
    const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
    const keys = createRoadNetwork({ network, roads });
    const keysSpots = buildRoadScene(keys, look, dressing, { seed: 1, models }).spots;
    expect(keysSpots.length).toBeGreaterThan(50);
    expect(keysSpots.filter((s) => s.kind === 'apartment')).toHaveLength(0);
  });

  it('keep the terrace: no two buildings of a side overlap, and none stands on a road', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const { road, spots } = spotsOf('osm-sf-russian-hill', seed);
      const all = buildings(spots);
      for (const a of all) {
        checked++;
        const halfA = halfAlongOf(a);
        for (const b of all) {
          if (a === b || a.edge !== b.edge || Math.sign(a.d) !== Math.sign(b.d)) continue;
          expect(Math.abs(a.s - b.s), `${a.kind}/${b.kind} at s ${a.s.toFixed(0)}`).toBeGreaterThanOrEqual(
            halfA + halfAlongOf(b) - 0.2,
          );
        }
        // Its front corners and back corners, off every road.
        const out = Math.sign(a.d);
        if (a.kind !== 'apartment') continue;
        for (const u of [-halfA + 0.3, halfA - 0.3])
          for (const back of [0.3, 11.2]) {
            const w = road.toWorld(a.edge, a.s + u, a.d + out * back, 0);
            expect(roadUnder(road, w.x, w.z), `apartment at s ${a.s.toFixed(0)}`).toBeNull();
          }
      }
    }
    print(
      `[examined] ${checked} buildings over ${SEEDS.length} seeds of the Russian Hill network, none overlapping`,
    );
    expect(checked).toBeGreaterThan(100);
  });

  it('leave the terraces row houses: most plots keep their house, the taller buildings are the variety', () => {
    let houses = 0;
    let taller = 0;
    for (const seed of SEEDS) {
      const { spots } = spotsOf('osm-sf-russian-hill', seed);
      for (const s of buildings(spots)) {
        if (s.kind === 'house') houses++;
        else taller += s.plots ?? 1;
      }
    }
    const share = taller / (houses + taller);
    print(
      `[examined] over ${SEEDS.length} seeds: ${houses} row houses, ${taller} plots of taller buildings (${(share * 100).toFixed(0)} %)`,
    );
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.45);
  });

  it('keep the street props out: no parked car, corner store or meter stands inside an apartment', () => {
    let checked = 0;
    let props = 0;
    const inside: string[] = [];
    for (const seed of SEEDS)
      for (const id of ['osm-sf-russian-hill', 'osm-sf-lombard']) {
        const { road, dressing } = track(id);
        const built = buildRoadScene(road, look, dressing, { seed, models });
        const apartments = built.spots.filter((s) => s.kind === 'apartment');
        const items = scatterRoadside({
          road,
          dressing,
          seed,
          density: 1,
          kit: SF_KIT,
          landReach: (e, side, s) => built.landReach(e, side, s),
          spots: built.spots,
        });
        built.dispose();
        props += items.length;
        for (const a of apartments) {
          checked++;
          // Its body, 0.5 m in from every wall: the front at its anchor, 11.5 m deep.
          const half = halfAlongOf(a) - 0.5;
          const front = Math.abs(a.d) + 0.5;
          const back = Math.abs(a.d) + 11;
          for (const it of items)
            if (
              it.edge === a.edge &&
              Math.sign(it.d) === Math.sign(a.d) &&
              Math.abs(it.s - a.s) < half &&
              Math.abs(it.d) > front &&
              Math.abs(it.d) < back
            )
              inside.push(
                `${id} seed ${seed}: ${it.rule} at s ${it.s.toFixed(0)} in the apartment at s ${a.s.toFixed(0)}`,
              );
        }
      }
    print(
      `[examined] ${checked} apartments and ${props} street props over ${SEEDS.length} seeds of 2 networks`,
    );
    expect(checked).toBeGreaterThan(50);
    expect(inside.slice(0, 8)).toEqual([]);
  });

  it('face the road, as the row houses do', () => {
    const { road, spots } = spotsOf('osm-sf-russian-hill', 2);
    const apartments = spots.filter((s) => s.kind === 'apartment');
    expect(apartments.length).toBeGreaterThan(5);
    for (const a of apartments) {
      const toRoad = road.toWorld(a.edge, a.s, 0, 0);
      const want = new Vector3(toRoad.x - a.p.x, 0, toRoad.z - a.p.z).normalize();
      const facing = new Vector3(Math.sin(a.turn), 0, Math.cos(a.turn));
      expect(facing.dot(want)).toBeGreaterThan(0.95);
    }
  });

  it('put a corner building at the end of a terrace, its open side to the gap (the cross street)', () => {
    let corners = 0;
    let wrong = 0;
    for (const seed of SEEDS) {
      const { road, spots } = spotsOf('osm-sf-russian-hill', seed);
      const all = buildings(spots);
      for (const c of spots.filter(
        (s) => s.kind === 'apartment' && (s.variant === APARTMENT.cornerL || s.variant === APARTMENT.cornerR),
      )) {
        corners++;
        // The model's +X, and which way along the road (+s) it points here.
        const xAxis = new Vector3(Math.cos(c.turn), 0, -Math.sin(c.turn));
        const here = road.toWorld(c.edge, c.s, c.d, 0);
        const ahead = road.toWorld(c.edge, c.s + 1, c.d, 0);
        const sign = xAxis.dot(new Vector3(ahead.x - here.x, 0, ahead.z - here.z)) > 0 ? 1 : -1;
        // corner_r is open on its +X side, corner_l on its -X side: the open end, as a step along +s.
        const open = (c.variant === APARTMENT.cornerR ? 1 : -1) * sign;
        const gap = all.filter(
          (o) =>
            o !== c &&
            o.edge === c.edge &&
            Math.sign(o.d) === Math.sign(c.d) &&
            (o.s - c.s) * open > 0 &&
            (o.s - c.s) * open < halfAlongOf(c) + 3.5 + halfAlongOf(o),
        );
        // The plot beyond the open end is empty: nothing stands in the first plot of it.
        if (gap.length > 0) wrong++;
        const road2 = road.edges[c.edge]!;
        expect(road2.length).toBeGreaterThan(0);
      }
    }
    print(
      `[examined] ${corners} corner buildings over ${SEEDS.length} seeds; ${wrong} with a house in the gap`,
    );
    expect(corners).toBeGreaterThan(0);
    expect(wrong).toBe(0);
  });

  it('give each corner building a shop sign that faces the street and reads the pack text', () => {
    const { road, spots } = spotsOf('osm-sf-russian-hill', 3);
    const corners = spots.filter(
      (s) => s.kind === 'apartment' && (s.variant === APARTMENT.cornerL || s.variant === APARTMENT.cornerR),
    );
    expect(corners.length).toBeGreaterThan(0);
    const model = models.sfApartments;
    expect(model).toBeDefined();
    const placed = apartmentSurfaces(spots, model, 3);
    expect(placed).toHaveLength(corners.length);
    const live = new Set(regionFile.signs.filter((s) => (s.status ?? 'live') === 'live').map((s) => s.id));
    for (const p of placed) {
      expect(['sf-corner-l-sign', 'sf-corner-r-sign']).toContain(p.id);
      expect(live.has(p.id), `${p.id} is a live region sign`).toBe(true);
      // It faces the road: its normal points from the building toward the road's middle.
      const spot = [...corners].sort(
        (a, b) =>
          dist({ x: a.p.x, z: a.p.z }, { x: p.centre.x, z: p.centre.z }) -
          dist({ x: b.p.x, z: b.p.z }, { x: p.centre.x, z: p.centre.z }),
      )[0];
      expect(spot).toBeDefined();
      if (!spot) continue;
      const toRoad = road.toWorld(spot.edge, spot.s, 0, 0);
      const want = new Vector3(toRoad.x - spot.p.x, 0, toRoad.z - spot.p.z).normalize();
      expect(new Vector3(p.normal.x, 0, p.normal.z).normalize().dot(want)).toBeGreaterThan(0.95);
      expect(p.pick).toBeTypeOf('number');
    }
  });

  it('have shop names in the region pack for every pick, tagged as surface signs and vetoable', () => {
    for (const side of ['l', 'r']) {
      const names = regionFile.signs.filter((s) => new RegExp(`^sf-corner-${side}-sign(-[23])?$`).test(s.id));
      expect(names.map((n) => n.id).sort(), `sf-corner-${side}`).toEqual([
        `sf-corner-${side}-sign`,
        `sf-corner-${side}-sign-2`,
        `sf-corner-${side}-sign-3`,
      ]);
      for (const n of names) {
        expect(n.tags, n.id).toEqual(expect.arrayContaining(['site', 'surface', 'new']));
        expect(n.text.length, n.id).toBeGreaterThan(3);
        // A board 4 m by 0.65 m fits one short line.
        expect(n.text.length, n.id).toBeLessThanOrEqual(26);
        expect(n.text, `${n.id}: signs are upper case`).toBe(n.text.toUpperCase());
      }
    }
  });
});

describe('the flats and blocks fit the plots the scatter gives them', () => {
  it('a model of each plot count is as wide as its plots and 11.5 m deep at most', async () => {
    const model = await bakeRepoModel('sfApartments');
    const plots = [1, 1, 2, 2, 2, 2];
    model.variants.forEach((g, v) => {
      g.computeBoundingBox();
      const box = g.boundingBox!;
      const spot = { kind: 'apartment', plots: plots[v] } as const;
      expect(box.max.x - box.min.x, `variant ${v} fills its plots`).toBeLessThanOrEqual(
        2 * halfAlongOf(spot) + 0.5,
      );
      expect(box.min.z, `variant ${v} depth`).toBeGreaterThanOrEqual(-11.6);
    });
  });
});
