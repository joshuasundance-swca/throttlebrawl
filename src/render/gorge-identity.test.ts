/// <reference types="vite/client" />
// The Gorge and Chuckanut look like themselves (playtest 4, P4-19, run B task B9; the identity sheets' fixes
// CR3, CR1 and H4). The maintainer: "The real roads do not have the characteristics of the roads in question
// in terms of scenery and feel etc". CX5 built the models (`models/landmarks/gorge-landmarks`,
// `models/scenery/pnw-identity`); this puts them where the real places are:
// - Vista House stands at Crown Point, where the real building stands against the baked road (the OSM
//   building's centre and its surveyed height are constants below, read from OpenStreetMap on 2026-10-05),
//   with its lighter form past `farM`;
// - the Historic Columbia River Highway's masonry guard walls stand in runs along the sides where the ground
//   falls away (the config's `guard-wall` side runs), never on a bridge, and Chuckanut Drive's madrones lean
//   out over its bay side (`bay-bluff`);
// - both load only for the networks whose roads carry those tags.
// Each rule has a control that must find the thing ("none" against the tag taken off, the model unloaded,
// another network), so a pass is never an empty one.
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
import { bakeLandmarkKit, landmarkKitAsset, modelKindsFor } from './models';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import {
  PNW_KIT,
  ROADSIDE_DRAW_M,
  RoadsideLayer,
  scatterRoadside,
  type RoadsideInput,
  type RoadsideItem,
} from './roadside';
import type { SideTag } from './scenery';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork & { crs: { originLatDeg: number; originLonDeg: number } }>(
  '../../packs/region-pnw/regions/*/networks/*.json',
  { eager: true, import: 'default' },
);
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
interface ConfigRun {
  tag: string;
  side: 'left' | 'right';
  s0: number;
  s1: number;
}
interface ConfigRoad {
  id: string;
  sideRuns?: ConfigRun[];
  features?: ({ id: string; kind: string } & Record<string, unknown>)[];
}
const configFiles = import.meta.glob<{ id: string; roads: ConfigRoad[] }>(
  '../../tools/gis/configs/osm-pnw-{gorge,chuckanut}.json',
  { eager: true, import: 'default' },
);
const configOf = (network: string) => Object.values(configFiles).find((c) => c.id === network)!;

const GORGE = 'osm-pnw-gorge';
const CHUCKANUT = 'osm-pnw-chuckanut';
const CROWN = 'osm-gorge-crown-point-loops';
const GORGE_ROADS = [CROWN, 'osm-gorge-latourell', 'osm-gorge-shepperds-dell'];
const CHUCKANUT_ROADS = ['osm-chuckanut-larrabee', 'osm-chuckanut-cliffs', 'osm-chuckanut-oyster-creek'];
const OTHER_NETWORKS = ['osm-pnw-portland', 'osm-pnw-samish', 'pnw-c1'];
/** The others with a forest roadside kit to scatter (Bridge City's downtown has none). */
const OTHER_FOREST = ['osm-pnw-samish', 'pnw-c1'];
const SEEDS = [1, 7, 42, 99];

function track(id: string): {
  network: BakedNetwork;
  road: RoadNetwork;
  dressing: RoadDressing;
  roads: BakedRoad[];
} {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { network, road: createRoadNetwork({ network, roads }), dressing, roads };
}
const kindsOf = (id: string) => {
  const t = track(id);
  const { tropical, tags } = networkTags(t.road, t.dressing);
  return { kinds: modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] }), tags };
};

const pnwRoadside = await bakeRepoModel('pnwRoadside');
const pnwIdentity = await bakeRepoModel('pnwIdentity');

/** The real kit scattered on a network with the identity model loaded unless `models` says otherwise. */
function scene(
  id: string,
  seed: number,
  opts: { models?: RoadsideInput['models']; dressing?: RoadDressing } = {},
) {
  const { road, dressing: own } = track(id);
  const dressing = opts.dressing ?? own;
  const built = buildRoadScene(road, look, dressing, { seed });
  const input: RoadsideInput = {
    road,
    dressing,
    seed,
    density: 1,
    kit: PNW_KIT,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
    models: opts.models ?? { pnwRoadside, pnwIdentity },
  };
  return { road, dressing, built, input };
}
const tagsOf = (road: BakedRoad): readonly SideTag[] => road.tags ?? [];
/** A dressing with one tag taken off every road (a control). */
function without(dressing: RoadDressing, tag: string): RoadDressing {
  return Object.fromEntries(
    Object.entries(dressing).map(([id, r]) => [
      id,
      {
        ...(r as unknown as BakedRoad),
        tags: tagsOf(r as unknown as BakedRoad).filter((t) => t.tag !== tag),
      },
    ]),
  );
}

// ---------------------------------------------------------------------------------------------------
// Vista House
// ---------------------------------------------------------------------------------------------------

/**
 * Crown Point Vista House as OpenStreetMap has it (way 145892556, "Crown Point Vista House", `ele=223`):
 * the building's centre, read from the way's nine corner nodes on 2026-10-05. The nearest stretch of the
 * Historic Columbia River Highway in the same data (ways 676155707, 676155708 and 1413050375) passes 28.3 m
 * from it.
 */
const VISTA = { lat: 45.5395671, lon: -122.2443784, eleM: 223, realRoadM: 28.3 } as const;

const gorgeNetwork = track(GORGE);
const crownRoad = Object.values(roadFiles).find((r) => r.id === CROWN)!;
const vistaFeature = (): BakedFeature | undefined =>
  (crownRoad.features ?? []).find((f) => f.id === 'vista-house');
const gorgeKit = bakeLandmarkKit(
  'gorge-landmarks',
  readGlb(await readAsset(landmarkKitAsset('gorge-landmarks'), 'glb')),
);

/** The nearest station of a road to a world point: s, the signed offset (positive to the right), the height. */
function nearest(road: RoadNetwork, roadId: string, x: number, z: number) {
  const e = road.edges[road.edgeIndex(roadId)]!;
  let best = { s: 0, off: Infinity, d: 0, y: 0 };
  for (let s = 0; s <= e.length; s += 1) {
    const p = road.toWorld(e.index, s, 0, 0);
    const off = Math.hypot(p.x - x, p.z - z);
    if (off < best.off) best = { s, off, d: 0, y: p.y };
  }
  const a = road.toWorld(e.index, Math.max(0, best.s - 1), 0, 0);
  const b = road.toWorld(e.index, Math.min(e.length, best.s + 1), 0, 0);
  const n = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const c = road.toWorld(e.index, best.s, 0, 0);
  best.d = ((x - c.x) * -(b.z - a.z) + (z - c.z) * (b.x - a.x)) / n;
  return best;
}

describe('Vista House at Crown Point', () => {
  it('is a landmark feature of the Crown Point Loops, naming the Gorge kit node, with a lighter form past farM', () => {
    const f = vistaFeature();
    expect(f, 'the feature').toBeDefined();
    expect(f!.kind).toBe('landmark');
    expect(f!.params?.['model']).toBe('models/landmarks/gorge-landmarks#vista_house');
    expect(gorgeKit.nodes.has('vista_house_lod0') && gorgeKit.nodes.has('vista_house_lod1')).toBe(true);
    expect(Number(f!.params?.['farM'])).toBeGreaterThan(0);
    const placed = landmarkPlacements(gorgeNetwork.road).filter((p) => p.node === 'vista_house');
    expect(placed.length).toBe(1);
    expect(landmarkKitsFor(gorgeNetwork.road)).toEqual(['gorge-landmarks']);
  });

  it('stands by the real building: the real point projects beside the road on the same side, at the same height, and it is within a few lengths of it', () => {
    const f = vistaFeature()!;
    const net = Object.values(networkFiles).find((n) => n.id === GORGE)!;
    const frame = geoFrame(net.crs.originLatDeg, net.crs.originLonDeg);
    const [x, z] = frame.toWorld(VISTA.lat, VISTA.lon);
    const real = nearest(gorgeNetwork.road, CROWN, x, z);
    const mid = gorgeNetwork.road.toWorld(
      gorgeNetwork.road.edgeIndex(CROWN),
      (f.s0 + f.s1) / 2,
      (f.d0 + f.d1) / 2,
      0,
    );
    const away = Math.hypot(mid.x - x, mid.z - z);
    print(
      `Vista House: the OSM building projects to s ${real.s.toFixed(0)}, d ${real.d.toFixed(1)} (${real.off.toFixed(1)} m off the baked road; the real highway passes ${VISTA.realRoadM} m off); the road is ${real.y.toFixed(1)} m high there, the building ${VISTA.eleM} m; the model stands at s ${((f.s0 + f.s1) / 2).toFixed(0)}, d ${((f.d0 + f.d1) / 2).toFixed(1)}, ${away.toFixed(1)} m from the real point`,
    );
    // The real building is on this side of the road, the way the baked line is smoothed from the real one
    // (it passes 24.5 m off against the real highway's 28.3).
    expect(Math.sign((f.d0 + f.d1) / 2)).toBe(Math.sign(real.d));
    expect(Math.abs(real.off - VISTA.realRoadM)).toBeLessThan(6);
    // Crown Point is the place: the road is at the building's own surveyed height there (a wrong station
    // would be tens of metres off on this road, which falls 200 m in 7 km).
    expect(Math.abs(real.y - VISTA.eleM)).toBeLessThan(3);
    // The model stands within a few building lengths of the real point: the road wraps the building's
    // site in a 28 m bend, whose inside the drawn land cannot fold over (next check), so it stands where
    // the land is, along the road from the real point.
    expect(away).toBeLessThan(35);
  });

  it('stands on drawn land, all four corners of its footprint, where the real point would not (control)', () => {
    const f = vistaFeature()!;
    const idx = gorgeNetwork.road.edgeIndex(CROWN);
    const e = gorgeNetwork.road.edges[idx]!;
    const { built } = scene(GORGE, 7);
    const stations = Array.from({ length: Math.floor(e.length) + 1 }, (_, s) => ({
      s,
      ...gorgeNetwork.road.toWorld(idx, s, 0, 0),
    }));
    const nearStation = (x: number, z: number) => {
      let best = stations[0]!;
      let off = Infinity;
      for (const st of stations) {
        const o = Math.hypot(st.x - x, st.z - z);
        if (o < off) {
          off = o;
          best = st;
        }
      }
      return { s: best.s, off };
    };
    /** How far inside the drawn land the footprint's corners and edge middles stand, at the worst, m. */
    const cover = (s: number, d: number, half: number) => {
      const c = gorgeNetwork.road.toWorld(idx, s, d, 0);
      const fr = gorgeNetwork.road.frameAt(idx, s);
      const yaw = Math.atan2(fr.tx, fr.tz);
      let worst = Infinity;
      for (const [a, b] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        const x = c.x + a * half * Math.sin(yaw) + b * half * Math.cos(yaw);
        const z = c.z + a * half * Math.cos(yaw) - b * half * Math.sin(yaw);
        const n = nearStation(x, z);
        const verge = Math.abs(gorgeNetwork.road.vergeAt(idx, n.s, 'right').dOuter);
        worst = Math.min(worst, verge + built.landReach(idx, 1, n.s) - n.off);
      }
      return worst;
    };
    const scale = Number(f.params?.['scale']);
    const half = 11 * scale;
    const placed = cover((f.s0 + f.s1) / 2, (f.d0 + f.d1) / 2, half);
    // Control: the real point's own station and offset, the same footprint, has land missing under it.
    const net = Object.values(networkFiles).find((n) => n.id === GORGE)!;
    const [rx, rz] = geoFrame(net.crs.originLatDeg, net.crs.originLonDeg).toWorld(VISTA.lat, VISTA.lon);
    const real = nearest(gorgeNetwork.road, CROWN, rx, rz);
    const atReal = cover(real.s, real.d, half);
    print(
      `Vista House's footprint is ${placed.toFixed(1)} m inside the drawn land at the worst corner; at the real point it would be ${atReal.toFixed(1)} m`,
    );
    expect(placed).toBeGreaterThanOrEqual(0.5);
    expect(atReal).toBeLessThan(0);
    built.dispose();
  });

  it('stands wholly past the verge on its side, on land and not over the arch bridge, clear of the visitors', () => {
    const f = vistaFeature()!;
    const e = gorgeNetwork.road.edges[gorgeNetwork.road.edgeIndex(CROWN)]!;
    const side = f.d0 >= 0 ? 'right' : 'left';
    let worst = Infinity;
    for (let s = f.s0; s <= f.s1; s += 1) {
      const sec = [...crownRoad.laneSections].reverse().find((c) => c.s0 <= s) ?? crownRoad.laneSections[0]!;
      const verge = resolveVerge(crownRoad, sec, side, s);
      worst = Math.min(worst, side === 'right' ? f.d0 - verge.dOuter : verge.dOuter - f.d1);
    }
    print(
      `Vista House's box: ${(f.s1 - f.s0).toFixed(0)} by ${Math.abs(f.d1 - f.d0).toFixed(0)} m, ${worst.toFixed(1)} m past the verge at the nearest, road ${e.length.toFixed(0)} m`,
    );
    expect(worst).toBeGreaterThanOrEqual(0);
    // Not over a bridge deck: the arch bridge begins where the box ends.
    for (const t of tagsOf(crownRoad).filter((x) => x.tag === 'bridge'))
      expect(f.s1 <= t.s0 + 0.5 || f.s0 >= t.s1, `bridge ${t.s0}..${t.s1}`).toBe(true);
    // The pedestrian zone for its visitors stands between the road and the box, never inside it.
    for (const z of (crownRoad.features ?? []).filter((x) => x.kind === 'roadsideZone')) {
      const overlapsS = z.s0 < f.s1 && z.s1 > f.s0;
      const overlapsD =
        Math.max(z.d0, z.d1) > Math.min(f.d0, f.d1) && Math.min(z.d0, z.d1) < Math.max(f.d0, f.d1);
      expect(overlapsS && overlapsD, `zone ${z.id}`).toBe(false);
    }
  });

  it('is the size the box says, so the model fills its footprint and no more', () => {
    const f = vistaFeature()!;
    const near = gorgeKit.nodes.get('vista_house_lod0')!;
    near.geometry.computeBoundingBox();
    const b = near.geometry.boundingBox!;
    const scale = Number(f.params?.['scale']);
    const sizeX = (b.max.x - b.min.x) * scale;
    const sizeZ = (b.max.z - b.min.z) * scale;
    expect(Math.abs(sizeX - Math.abs(f.d1 - f.d0))).toBeLessThan(0.1);
    expect(Math.abs(sizeZ - (f.s1 - f.s0))).toBeLessThan(0.1);
  });

  it('keeps every other prop out of its footprint, on 4 seeds, and the controls find props there without it', () => {
    const f = vistaFeature()!;
    const idx = gorgeNetwork.road.edgeIndex(CROWN);
    const inside = (edge: number, s: number, d: number) =>
      edge === idx && s >= f.s0 && s <= f.s1 && d >= Math.min(f.d0, f.d1) && d <= Math.max(f.d0, f.d1);
    // Control: the same road with the landmark marked `overRoad` (it takes no ground): the scenery stands in it.
    const free = Object.fromEntries(
      Object.entries(gorgeNetwork.dressing).map(([id, r]) => [
        id,
        {
          ...(r as unknown as BakedRoad),
          features: ((r as unknown as BakedRoad).features ?? []).map((x) =>
            x.kind === 'landmark' ? { ...x, params: { ...x.params, overRoad: true } } : x,
          ),
        },
      ]),
    ) as unknown as RoadDressing;
    let spots = 0;
    let props = 0;
    let withoutKeepOff = 0;
    let loose = 0;
    for (const seed of SEEDS) {
      const { built, input, road } = scene(GORGE, seed);
      for (const sp of built.spots) {
        spots++;
        expect(inside(sp.edge, sp.s, sp.d), `${sp.kind} at s ${sp.s.toFixed(0)}, seed ${seed}`).toBe(false);
      }
      const kept = scatterRoadside({ ...input, reserved: landmarkFootprints(road) });
      for (const it of kept) {
        props++;
        expect(inside(it.edge, it.s, it.d), `${it.rule} at s ${it.s.toFixed(0)}`).toBe(false);
      }
      loose += scatterRoadside(input).filter((it) => inside(it.edge, it.s, it.d)).length;
      built.dispose();
      const open = scene(GORGE, seed, { dressing: free });
      withoutKeepOff += open.built.spots.filter((sp) => inside(sp.edge, sp.s, sp.d)).length;
      open.built.dispose();
    }
    print(
      `${spots} scenery spots and ${props} roadside props checked over ${SEEDS.length} seeds; without the keep-off, ${withoutKeepOff} scenery spots and ${loose} roadside props would stand in Vista House's box`,
    );
    expect(withoutKeepOff + loose).toBeGreaterThan(0);
  });

  it('draws in the landmark layer in one call: the full form near, the light one past farM, nothing past the mid distance', () => {
    const f = vistaFeature()!;
    const layer = new LandmarkLayer(new Map([['gorge-landmarks', gorgeKit]]), look, {
      road: gorgeNetwork.road,
    });
    expect(layer.counts()).toMatchObject({ placed: 1, skipped: 0 });
    const at = landmarkPlacements(gorgeNetwork.road).find((p) => p.node === 'vista_house')!;
    const e = gorgeNetwork.road.edgeIndex(CROWN);
    const along = (m: number) => gorgeNetwork.road.toWorld(e, Math.max(0, at.feature.s0 - m), 0, 0);
    layer.update(at.x, at.z);
    const near = layer.counts();
    const nearP = along(120);
    layer.update(nearP.x, nearP.z);
    const mid = layer.counts();
    layer.update(at.x + 5000, at.z);
    const gone = layer.counts();
    const far = Number(f.params?.['farM']);
    const lod0 = gorgeKit.nodes.get('vista_house_lod0')!.geometry.getAttribute('position').count / 3;
    const lod1 = gorgeKit.nodes.get('vista_house_lod1')!.geometry.getAttribute('position').count / 3;
    print(
      `Vista House draws ${near.trianglesDrawn} triangles in ${near.drawCalls} call near (lod0 ${lod0}, lod1 ${lod1}); farM ${far} m`,
    );
    expect(near.drawCalls).toBe(1);
    expect(near.trianglesDrawn).toBe(lod0);
    expect(mid.trianglesDrawn).toBe(lod0);
    expect(lod1).toBeLessThan(lod0);
    expect(gone.trianglesDrawn).toBe(0);
    layer.dispose();
  });

  it('is on the Gorge only', () => {
    const owners = Object.values(roadFiles)
      .filter((r) => (r.features ?? []).some((x) => /vista_house/.test(String(x.params?.['model']))))
      .map((r) => r.id);
    expect(owners).toEqual([CROWN]);
  });
});

// ---------------------------------------------------------------------------------------------------
// The side runs: the config says them, the baked roads carry them
// ---------------------------------------------------------------------------------------------------

describe('guard-wall and bay-bluff side runs', () => {
  it("are the config's runs, written on their side and off the bridge decks, and no road carries one by hand", () => {
    let runs = 0;
    for (const [network, ids, tag, side] of [
      [GORGE, GORGE_ROADS, 'guard-wall', 'left'],
      [CHUCKANUT, CHUCKANUT_ROADS, 'bay-bluff', 'right'],
    ] as const) {
      const cfg = configOf(network);
      for (const id of ids) {
        const road = Object.values(roadFiles).find((r) => r.id === id)!;
        const configured = (cfg.roads.find((r) => r.id === id)?.sideRuns ?? []).filter((r) => r.tag === tag);
        const baked = tagsOf(road).filter((t) => t.tag === tag);
        const decks = tagsOf(road).filter((t) => t.tag === 'bridge');
        expect(
          baked.every((t) => t.side === side),
          `${id}: every ${tag} run is on the ${side}`,
        ).toBe(true);
        // Every baked run lies inside a configured one, and every configured one is baked (less its decks).
        for (const t of baked)
          expect(
            configured.some((c) => t.s0 >= c.s0 - 0.01 && t.s1 <= c.s1 + 0.01),
            `${id}: ${tag} ${t.s0}..${t.s1}`,
          ).toBe(true);
        for (const c of configured) {
          const covered = baked.filter((t) => t.s0 < c.s1 && t.s1 > c.s0);
          const deckM = decks.reduce(
            (n, d) => n + Math.max(0, Math.min(d.s1, c.s1) - Math.max(d.s0, c.s0)),
            0,
          );
          const bakedM = covered.reduce((n, t) => n + (Math.min(t.s1, c.s1) - Math.max(t.s0, c.s0)), 0);
          expect(Math.abs(c.s1 - c.s0 - deckM - bakedM), `${id}: ${tag} ${c.s0}..${c.s1}`).toBeLessThan(1);
        }
        // Never over a deck.
        for (const t of baked)
          for (const d of decks)
            expect(t.s1 <= d.s0 + 0.01 || t.s0 >= d.s1 - 0.01, `${id}: over a deck`).toBe(true);
        runs += baked.length;
      }
    }
    expect(runs).toBeGreaterThan(10);
    // The other side of each road has none, and no other road has either tag.
    for (const r of Object.values(roadFiles)) {
      if (GORGE_ROADS.includes(r.id) || CHUCKANUT_ROADS.includes(r.id)) continue;
      expect(
        tagsOf(r).some((t) => t.tag === 'guard-wall' || t.tag === 'bay-bluff'),
        r.id,
      ).toBe(false);
    }
  });

  it('load the identity models for the Gorge and Chuckanut, and for no other Pacific Northwest network', () => {
    for (const id of [GORGE, CHUCKANUT]) {
      const { kinds, tags } = kindsOf(id);
      expect(kinds, id).toContain('pnwIdentity');
      expect(tags.has(id === GORGE ? 'guard-wall' : 'bay-bluff'), id).toBe(true);
    }
    for (const id of OTHER_NETWORKS) {
      const { kinds, tags } = kindsOf(id);
      expect(kinds, id).not.toContain('pnwIdentity');
      expect(tags.has('guard-wall') || tags.has('bay-bluff'), id).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// The guard walls
// ---------------------------------------------------------------------------------------------------

const wallsOf = (items: readonly RoadsideItem[]) => items.filter((it) => it.rule === 'gorge-wall');
const madronesOf = (items: readonly RoadsideItem[]) => items.filter((it) => it.rule === 'madrone');

describe.each(SEEDS)("the Gorge's guard walls, seed %i", (seed) => {
  const { road, dressing, input } = scene(GORGE, seed);
  const walls = wallsOf(scatterRoadside(input));

  it('stand in the guard-wall runs, on that side only, never on a bridge, and past the verge so no rider meets one', () => {
    print(`${GORGE} seed ${seed}: ${walls.length} wall sections`);
    expect(walls.length).toBeGreaterThan(20);
    for (const w of walls) {
      const id = road.edges[w.edge]!.id;
      const run = tagsOf(dressing[id] as unknown as BakedRoad).filter((t) => t.tag === 'guard-wall');
      expect(
        run.some((t) => w.s >= t.s0 && w.s <= t.s1),
        `${id} s ${w.s.toFixed(0)} is in a run`,
      ).toBe(true);
      expect(w.d, 'on the left (the cliff side)').toBeLessThan(0);
      expect(w.variant, 'the guard wall node').toBe(2);
      const bridge = tagsOf(dressing[id] as unknown as BakedRoad).some(
        (t) => t.tag === 'bridge' && w.s >= t.s0 - 3 && w.s <= t.s1 + 3,
      );
      expect(bridge, `${id} s ${w.s.toFixed(0)} is off a deck`).toBe(false);
      const verge = road.vergeAt(w.edge, w.s, 'left');
      expect(Math.abs(w.d), `${id} s ${w.s.toFixed(0)} is past the verge`).toBeGreaterThanOrEqual(
        Math.abs(verge.dOuter),
      );
    }
  });

  it('are laid end to end: sections of one run stand a section (6 m) apart along the road, turned along it', () => {
    const byRoad = new Map<number, RoadsideItem[]>();
    for (const w of walls)
      byRoad.set(
        w.edge,
        [...(byRoad.get(w.edge) ?? []), w].sort((a, b) => a.s - b.s),
      );
    let joined = 0;
    let gaps = 0;
    for (const list of byRoad.values()) {
      for (let i = 1; i < list.length; i++) {
        const gap = list[i]!.s - list[i - 1]!.s;
        if (gap < 7) {
          expect(gap).toBeGreaterThan(5.5);
          joined++;
        } else gaps++;
      }
    }
    print(`${GORGE} seed ${seed}: ${joined} section joints, ${gaps} breaks between runs`);
    expect(joined).toBeGreaterThan(walls.length / 2);
  });

  it('cover a good share of every long run, never the other side', () => {
    let total = 0;
    let covered = 0;
    for (const e of road.edges) {
      const mine = walls.filter((w) => w.edge === e.index);
      for (const t of tagsOf(dressing[e.id] as unknown as BakedRoad).filter((x) => x.tag === 'guard-wall')) {
        if (t.s1 - t.s0 < 60) continue;
        total += Math.floor((t.s1 - t.s0) / 6);
        covered += mine.filter((w) => w.s >= t.s0 && w.s <= t.s1).length;
      }
    }
    print(`${GORGE} seed ${seed}: ${covered} of ${total} six-metre slots in the long runs are walled`);
    expect(total).toBeGreaterThan(100);
    expect(covered / total).toBeGreaterThan(0.35);
    expect(covered / total).toBeLessThanOrEqual(1);
  });
});

describe('the guard walls need the tag, the model and the Gorge', () => {
  it('stand none when the tag is taken off (control: seed 7 has walls with it)', () => {
    const base = scene(GORGE, 7);
    expect(wallsOf(scatterRoadside(base.input)).length).toBeGreaterThan(0);
    const bare = scene(GORGE, 7, { dressing: without(base.dressing, 'guard-wall') });
    expect(wallsOf(scatterRoadside(bare.input))).toEqual([]);
  });

  it('stand none when the identity model has not loaded', () => {
    expect(wallsOf(scatterRoadside(scene(GORGE, 7, { models: { pnwRoadside } }).input))).toEqual([]);
  });

  it('stand none on any other Pacific Northwest network, with the model loaded', () => {
    for (const id of [CHUCKANUT, ...OTHER_FOREST]) {
      const items = scatterRoadside(scene(id, 7).input);
      expect(items.length, id).toBeGreaterThan(50);
      expect(wallsOf(items), id).toEqual([]);
    }
  });

  it('are the 6 m section of the kit, flush: 0.9 m high, as long as the slot', () => {
    const wall = pnwIdentity.variants[2]!;
    wall.computeBoundingBox();
    const b = wall.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(6, 1);
    expect(b.max.y).toBeGreaterThan(0.6);
    expect(b.max.y).toBeLessThan(1.3);
  });
});

// ---------------------------------------------------------------------------------------------------
// The madrones
// ---------------------------------------------------------------------------------------------------

describe.each(SEEDS)("Chuckanut's madrones, seed %i", (seed) => {
  const { road, dressing, input } = scene(CHUCKANUT, seed);
  const trees = madronesOf(scatterRoadside(input));

  it('stand in the bay-bluff runs on the bay side only, off the road, and lean out away from it', () => {
    print(`${CHUCKANUT} seed ${seed}: ${trees.length} madrones`);
    expect(trees.length).toBeGreaterThan(15);
    for (const t of trees) {
      const id = road.edges[t.edge]!.id;
      const runs = tagsOf(dressing[id] as unknown as BakedRoad).filter((x) => x.tag === 'bay-bluff');
      expect(
        runs.some((x) => t.s >= x.s0 && t.s <= x.s1),
        `${id} s ${t.s.toFixed(0)} is in a run`,
      ).toBe(true);
      expect(t.d, 'on the right (the bay side)').toBeGreaterThan(0);
      expect([0, 1]).toContain(t.variant);
      const e = road.edges[t.edge]!;
      expect(Math.abs(t.d)).toBeGreaterThan(Math.max(-e.dMin, e.dMax));
      // Its +Z (the lean) points away from the road.
      const toRoad = road.toWorld(t.edge, t.s, 0, 0);
      const dot = Math.sin(t.turn) * (toRoad.x - t.p.x) + Math.cos(t.turn) * (toRoad.z - t.p.z);
      expect(dot, `${id} s ${t.s.toFixed(0)} leans out`).toBeLessThan(0);
    }
  });

  it('are spread along the bluff: most 100 m windows of a long run hold one', () => {
    let windows = 0;
    let held = 0;
    for (const e of road.edges) {
      const mine = trees.filter((t) => t.edge === e.index);
      for (const x of tagsOf(dressing[e.id] as unknown as BakedRoad).filter((y) => y.tag === 'bay-bluff')) {
        if (x.s1 - x.s0 < 200) continue;
        for (let a = x.s0; a + 100 <= x.s1; a += 100) {
          windows++;
          if (mine.some((t) => t.s >= a && t.s < a + 100)) held++;
        }
      }
    }
    print(`${CHUCKANUT} seed ${seed}: ${held} of ${windows} 100 m windows of the long runs hold a madrone`);
    expect(windows).toBeGreaterThan(30);
    expect(held / windows).toBeGreaterThan(0.8);
  });
});

describe('the madrones need the tag, the model and Chuckanut', () => {
  it('stand none when the tag is taken off (control), without the model, or on any other network', () => {
    const base = scene(CHUCKANUT, 7);
    expect(madronesOf(scatterRoadside(base.input)).length).toBeGreaterThan(0);
    expect(
      madronesOf(
        scatterRoadside(scene(CHUCKANUT, 7, { dressing: without(base.dressing, 'bay-bluff') }).input),
      ),
    ).toEqual([]);
    expect(madronesOf(scatterRoadside(scene(CHUCKANUT, 7, { models: { pnwRoadside } }).input))).toEqual([]);
    for (const id of [GORGE, ...OTHER_FOREST])
      expect(madronesOf(scatterRoadside(scene(id, 7).input)), id).toEqual([]);
  });

  it('are the two madrones of CX5, red-barked trees 6 to 10 m tall, leaning toward their +Z', () => {
    const [a, b] = pnwIdentity.variants.slice(0, 2).map((g) => {
      g.computeBoundingBox();
      return g.boundingBox!;
    });
    expect(a!.max.y).toBeGreaterThan(6);
    expect(a!.max.y).toBeLessThan(10.5);
    expect(b!.max.y).toBeGreaterThan(4);
    // The lean: the crown is further out along +Z than it is toward -Z.
    expect(a!.max.z).toBeGreaterThan(Math.abs(a!.min.z) * 3);
  });
});

describe('drawing them', () => {
  it('rides the roadside stretches: the same stretches, no more meshes in view than without, and the triangles it adds are few', () => {
    for (const [id, rule] of [
      [GORGE, 'gorge-wall'],
      [CHUCKANUT, 'madrone'],
    ] as const) {
      const run = (models: RoadsideInput['models']) => {
        const { input, road } = scene(id, 7, { models });
        const layer = new RoadsideLayer(pnwRoadside, look, input);
        while (!layer.ready) layer.update(1e9, 1e9, 360);
        let peakMeshes = 0;
        let peakTris = 0;
        let seenTris = 0;
        for (const e of road.edges)
          for (let s = 0; s < e.length; s += 40) {
            const p = road.toWorld(e.index, s, 0, 0);
            for (let k = 0; k < 4; k++) layer.update(p.x, p.z, 360);
            const c = layer.counts();
            peakMeshes = Math.max(peakMeshes, c.meshes);
            peakTris = Math.max(peakTris, c.triangles);
            seenTris += c.triangles;
          }
        return {
          chunks: layer.counts().chunks,
          peakMeshes,
          peakTris,
          seenTris,
          mine: layer.items.filter((i) => i.rule === rule).length,
        };
      };
      const without = run({ pnwRoadside });
      const withIt = run({ pnwRoadside, pnwIdentity });
      print(
        `${id}: ${withIt.mine} ${rule} items; ${withIt.chunks} stretches (${without.chunks} without); at most ${withIt.peakMeshes} meshes and ${withIt.peakTris} triangles in view (${without.peakMeshes} and ${without.peakTris} without)`,
      );
      expect(without.mine).toBe(0);
      expect(withIt.mine).toBeGreaterThan(0);
      expect(withIt.chunks).toBe(without.chunks);
      // The same stretches' meshes: a model of its own adds no mesh to a stretch that already draws.
      expect(withIt.peakMeshes).toBeLessThanOrEqual(without.peakMeshes);
      // It adds triangles to what is in view, and no more than the model could add.
      expect(withIt.seenTris).toBeGreaterThan(without.seenTris);
      // ...at most every 6 m slot of the road within the draw distance, both sides, in madrones or wall sections.
      const worst = Math.max(...pnwIdentity.variants.map((g) => g.getAttribute('position').count / 3));
      expect(withIt.peakTris - without.peakTris).toBeLessThan(((4 * ROADSIDE_DRAW_M) / 6) * worst);
    }
  });
});
