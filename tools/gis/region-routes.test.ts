/// <reference types="vite/client" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import {
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
  type RoadNetwork,
} from '../../src/road';
import { GroundTris, openLandEnds, type OpenLandEnd } from '../../src/render/land-probe.test-util';
import { createFlatLook } from '../../src/render/look';
import { buildRoadScene, ROAD_CHUNK_M, type RoadDressing } from '../../src/render/road-mesh';
import { DEPTH_M, HALF_ALONG_M, SCENERY_RADIUS_M, type ScenerySpot } from '../../src/render/scenery';

// The real roads landed in the region packs as routes (the maintainer, 2026-10-01: "Yes, add as
// routes"; the landing steps of the gis head-start run): each region pack carries base's ODbL
// licence rule and its licence text, every baked file passes the road lint, and the roadside
// scenery the renderer scatters on them stands on drawn land for every seed tried, never on a
// bridge, the road or the water (playtest 1c item 3). The bot races are the sim tier's
// (tests/sim/road-real-routes.test.ts).

// Run W-S added the real-road networks (`tbgis network`: several real roads joined at their real
// junctions, a junction choice and a multi-lane highway each): Key West in the base pack and I-5 by
// Lake Samish in the Pacific Northwest. `osmFiles` counts each pack's osm- networks and routes (the
// base pack's gis-1 Bahia Honda stretch among them; its scenery predates these checks). Playtest 3
// (T9.2) added Duval Street and the Seven Mile Bridge with its old road to the base pack.
const PACKS = [
  {
    pack: 'base',
    region: 'florida-keys',
    networks: ['osm-keys-key-west', 'osm-keys-duval', 'osm-keys-seven-mile'],
    osmFiles: 4,
  },
  {
    pack: 'region-pnw',
    region: 'pacific-northwest',
    networks: ['osm-pnw-chuckanut', 'osm-pnw-gorge', 'osm-pnw-samish', 'osm-pnw-portland'],
    osmFiles: 4,
  },
  {
    pack: 'region-sf',
    region: 'san-francisco',
    // Playtest 3 (T9.3) added the Golden Gate and Lombard Street.
    networks: ['osm-sf-russian-hill', 'osm-sf-twin-peaks', 'osm-sf-golden-gate', 'osm-sf-lombard'],
    osmFiles: 4,
  },
] as const;

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/osm-*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/osm-*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<BakedRoute>('../../packs/*/regions/*/routes/osm-*.json', {
  eager: true,
  import: 'default',
});

function baked(id: string) {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const routes = Object.values(routeFiles).filter((r) => r.network === id);
  return { network, roads, routes };
}

describe('the region packs carry the real roads under ODbL', () => {
  for (const p of PACKS) {
    it(`${p.pack}: the ODbL rule covers every osm- file, with the attribution and the licence text`, () => {
      const manifest = JSON.parse(readFileSync(`packs/${p.pack}/pack.json`, 'utf8')) as {
        licenseRules?: { paths: string[]; spdx: string; attribution: string; licenseFile?: string }[];
      };
      const odbl = (manifest.licenseRules ?? []).filter((r) => r.spdx === 'ODbL-1.0');
      const glob = (g: string) => new RegExp(`^${g.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`);
      const files = ['networks', 'roads', 'routes'].flatMap((dir) =>
        readdirSync(`packs/${p.pack}/regions/${p.region}/${dir}`)
          .filter((f) => f.startsWith('osm-'))
          .map((f) => `regions/${p.region}/${dir}/${f}`),
      );
      // The networks, their roads and one route each.
      expect(files.filter((f) => f.includes('/networks/'))).toHaveLength(p.osmFiles);
      expect(files.filter((f) => f.includes('/routes/'))).toHaveLength(p.osmFiles);
      for (const f of files) {
        const rule = odbl.find((r) => r.paths.some((g) => glob(g).test(f)));
        expect(rule, `${f} is under an ODbL rule`).toBeDefined();
        expect(rule?.attribution).toMatch(/OpenStreetMap contributors/);
        expect(existsSync(`packs/${p.pack}/${rule?.licenseFile ?? 'missing'}`)).toBe(true);
      }
      // Negative control: a hand-made road file (no osm- prefix) stays under the pack's own MIT.
      const handMade = `regions/${p.region}/roads/hand-made-road.json`;
      expect(odbl.some((r) => r.paths.some((g) => glob(g).test(handMade)))).toBe(false);
    });

    it(`${p.pack}: the region lists its real-road networks, and each bake passes the road lint`, () => {
      const region = JSON.parse(readFileSync(`packs/${p.pack}/regions/${p.region}/region.json`, 'utf8')) as {
        networks: string[];
      };
      for (const id of p.networks) {
        expect(region.networks).toContain(id);
        const { network, roads, routes } = baked(id);
        // The network file names its region (the content schema's field; the road module's type
        // leaves it out), which is how app/ finds a region's real routes.
        expect((network as BakedNetwork & { region?: string }).region).toBe(p.region);
        expect(routes).toHaveLength(1);
        expect(lintRoadNetwork({ network, roads, routes })).toEqual([]);
        // The hand-made roads' lanes (4 m since playtest 1), so weaving feels the same: one to three
        // each way (the network bakes' highways have two; the Golden Gate's deck has three), and a
        // junction's turn-off and rejoin carry one shortcut lane instead, so traffic never takes them.
        // A one-way street is the exception (playtest 3, T9.3): Lombard's crooked block is one
        // forward lane and nothing else, so its 5 m hairpins pass the width rule.
        for (const r of roads) {
          const lanes = r.laneSections[0]?.lanes ?? [];
          const drive = lanes.filter((l) => l.kind === 'drive');
          for (const l of drive) expect(l.widthM, r.id).toBe(4);
          const each = drive.filter((l) => l.direction === 1).length;
          if (drive.length === 0)
            expect(
              lanes.map((l) => l.kind),
              r.id,
            ).toEqual(['shortcut']);
          else if (lanes.length === 1) expect(drive.length === 1 && each === 1, r.id).toBe(true);
          else expect(drive.length === 2 * each && each >= 1 && each <= 3, r.id).toBe(true);
        }
      }
    });
  }
});

// ---- Scenery stands on drawn land (the render lane's sweep, run on the real roads) ------------

const look = createFlatLook();
/** The fixed test seeds and the seeds the skeptics named (scenery-sweep.test.ts's NAMED). */
const SEEDS = [1, 2, 3, 7, 11, 2447605036, 3230531489, 4052564335, 1783423519, 2901547813];
// Every land kind, the region scenery included (conifers, row houses, the sawmill: #234).
const LAND = new Set(['palm', 'mangrove', 'shack', 'pole', 'conifer', 'house', 'sawmill']);
const WIDE = new Set(['shack', 'mangrove', 'house', 'sawmill']);
const RING = 0.6;

function groundByChunk(group: Object3D, keep: RegExp): (x: number, z: number) => Object3D[] {
  const byKey = new Map<string, Object3D[]>();
  const loose: Object3D[] = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!(o instanceof Mesh) || !keep.test(o.name)) return;
    const key = /^road-chunk-(.+)$/.exec(o.parent?.name ?? '')?.[1];
    if (key === undefined) loose.push(o);
    else byKey.set(key, [...(byKey.get(key) ?? []), o]);
  });
  return (x, z) => {
    const cx = Math.floor(x / ROAD_CHUNK_M);
    const cz = Math.floor(z / ROAD_CHUNK_M);
    const out = [...loose];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) out.push(...(byKey.get(`${cx + i},${cz + j}`) ?? []));
    return out;
  };
}

function footprint(s: ScenerySpot, road: RoadNetwork): { x: number; z: number }[] {
  const pts = [{ x: s.p.x, z: s.p.z }];
  const depth = DEPTH_M[s.kind];
  const along = HALF_ALONG_M[s.kind];
  if (depth !== undefined && along !== undefined) {
    // A house or the sawmill: the four corners of its real footprint, back from its front wall, so
    // the whole building stands on the land, not only the ring around its front (run W-P).
    const out = Math.sign(s.d);
    for (const u of [-along + 0.3, along - 0.3])
      for (const back of [0.3, depth - 0.3]) {
        const w = road.toWorld(s.edge, s.s + u, s.d + out * back, 0);
        pts.push({ x: w.x, z: w.z });
      }
  } else if (WIDE.has(s.kind)) {
    const r = SCENERY_RADIUS_M[s.kind] * RING;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      pts.push({ x: s.p.x + r * Math.cos(a), z: s.p.z + r * Math.sin(a) });
    }
  }
  return pts;
}

type Tag = { s0: number; s1: number; side?: string; tag: string };

/**
 * Conifers this far out (|d|, m) are the render lane's far forest on the terrain skirt (#234), past
 * the verge's 24 m strip that the road's own tags make. Run W-O's skeptic found 71, 124 and 46 of
 * them over the water on Chuckanut, the Gorge and Twin Peaks over these seeds, printed here and
 * never asserted. Since run W-P each stands on the skirt's flat ground exactly as drawn, and the
 * count over water is asserted to be 0 (Russian Hill has no forest, so it is skipped there).
 */
const FAR_FOREST_D = 40;

/** Land spots of one network's scene, per seed, that stand on a bridge or off drawn land. */
function offLand(id: string, seeds: readonly number[], redress?: (r: BakedRoad) => BakedRoad) {
  const { network, roads } = baked(id);
  const road = createRoadNetwork({ network, roads });
  const dressed = roads.map((r) => (redress ? redress(r) : r));
  const dressing = Object.fromEntries(dressed.map((r) => [r.id, r])) as unknown as RoadDressing;
  let spots = 0;
  let farSpots = 0;
  const bad: string[] = [];
  const farBad: string[] = [];
  for (const seed of seeds) {
    const built = buildRoadScene(road, look, dressing, { seed });
    const ground = groundByChunk(
      built.group,
      /^road-(land|water|road|shoulder|shortcut|deck|marking|splitZone|rampMark|boost)/,
    );
    for (const s of built.spots) {
      if (!LAND.has(s.kind)) continue;
      const far = s.kind === 'conifer' && Math.abs(s.d) > FAR_FOREST_D;
      if (far) farSpots++;
      else spots++;
      const list = far ? farBad : bad;
      const edge = road.edges[s.edge];
      const tags = (roads.find((r) => r.id === edge?.id)?.tags ?? []) as Tag[];
      if (tags.some((t) => t.tag === 'bridge' && s.s >= t.s0 && s.s <= t.s1))
        list.push(`seed ${seed}: ${s.kind} on the ${edge?.id} bridge at s ${s.s.toFixed(1)}`);
      for (const p of footprint(s, road)) {
        const ray = new Raycaster(new Vector3(p.x, s.p.y + 30, p.z), new Vector3(0, -1, 0), 0, 400);
        const hit = ray.intersectObjects(ground(p.x, p.z), false)[0]?.object.name ?? null;
        if (hit !== 'road-land') {
          list.push(
            `seed ${seed}: ${s.kind} on ${edge?.id} s ${s.s.toFixed(1)} d ${s.d.toFixed(1)} over ${hit}`,
          );
          break;
        }
      }
    }
    built.dispose();
  }
  return { spots, bad, farSpots, farBad };
}

describe.each(PACKS.flatMap((p) => p.networks))('scenery on the real road %s', (id) => {
  it(`stands every land spot on drawn land for ${SEEDS.length} seeds, and none on a bridge`, () => {
    const { spots, bad, farSpots, farBad } = offLand(id, SEEDS);
    process.stdout.write(
      `[examined] ${id}: ${SEEDS.length} seeds, ${spots} land spots ray-checked, ${bad.length} not on land; ` +
        `far-forest conifers ${farSpots} ray-checked, ${farBad.length} past the drawn skirt` +
        `${farBad[0] ? `, e.g. ${farBad[0]}` : ''}\n`,
    );
    // A network whose land is all open grass hill (the Golden Gate's `headlands`, playtest 3, T10.6)
    // scatters nothing: its check is that nothing stands there, while any other network must have
    // spots to check (so a scatter that placed none would not pass for a clean one).
    // `gg-deck` (playtest 4) is the deck's traffic-area tag beside `bridge`; it says nothing about land.
    const OPEN = new Set(['headlands', 'bridge', 'water-open', 'water-shallow', 'fog', 'gg-deck']);
    // Downtown Portland's blocks (playtest 3, T12.6) scatter nothing either: `pdx-blocks` is a land theme of
    // its own, and render/downtown.ts stands the street fronts there (src/render/portland-blocks.test.ts
    // checks them on land). The `town`, `pdx-deck` and `rail-line` tags beside it say nothing more about it.
    const BLOCKS = new Set([...OPEN, 'pdx-blocks', 'town', 'pdx-deck', 'rail-line']);
    // Key West's Old Town (playtest 4, P4-19) is a street too: `key-oldtown` is a land theme of its own that
    // outranks the `town` and `palms` tags beside it, so the scatter puts no palm, shack or pole there
    // (the roadside kit's fronts and trees do, src/render/duval-street.test.ts).
    const OLDTOWN = new Set([...OPEN, 'key-oldtown', 'town', 'palms', 'conch-houses']);
    const tagged = baked(id).roads.flatMap((r) => (r.tags ?? []).map((t) => t.tag));
    const open =
      tagged.every((t) => OPEN.has(t)) ||
      (tagged.includes('pdx-blocks') && tagged.every((t) => BLOCKS.has(t))) ||
      (tagged.includes('key-oldtown') && tagged.every((t) => OLDTOWN.has(t)));
    if (open) expect(spots, 'open grass hills, city blocks and the Old Town scatter nothing').toBe(0);
    else expect(spots).toBeGreaterThan(0);
    expect(bad.slice(0, 12)).toEqual([]);
    // The far forest stands on drawn ground too (run W-O's skeptic, mustFix 3), on the networks
    // that grow one (Russian Hill and Key West have no forest).
    const forest = baked(id).roads.some((r) => (r.tags ?? []).some((t) => t.tag === 'forest'));
    if (forest) expect(farSpots).toBeGreaterThan(1000);
    expect(farBad.slice(0, 12)).toEqual([]);
  }, 240_000);
});

// ---- The land never ends in mid-air (run W-O's skeptic) ------------------------------------------
// "Row houses stand on flat land plates that float, with sky and bay under them, at the bridge ends"
// (Russian Hill's Hyde Street, s 1140 to 1190; Twin Peaks' Upper Market, s 2640 to 2700). The rays
// straight down above hit the floating plate, so they passed. This walk looks UNDER the land instead
// (src/render/land-probe.test-util.ts): wherever the ground drops more than 2 m in one 2 m step, a
// ray from the low side looks back under the high ground, and closed ground must stop it.

function landScene(id: string) {
  const { network, roads } = baked(id);
  const road = createRoadNetwork({ network, roads });
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  // The land is the same for every seed (only the scatter on it is seeded).
  return { road, built: buildRoadScene(road, look, dressing, { seed: 1 }) };
}

const fmtEnd = (o: OpenLandEnd) =>
  `${o.edge} s ${o.s.toFixed(0)} ${o.side < 0 ? 'left' : 'right'} ${o.across} m out, drop ${o.drop.toFixed(1)} m`;

// Run W-S's I-5 by Lake Samish is the hardest case yet: East Lake Samish Drive runs within 7 m of
// the interstate's edge for 800 m at about its height, and the exit 246 off-ramp runs beside it. The
// walk found two open edges there: the one beside the off-ramp closed when the junction moved so
// its turn-off stands in for the ramp's parallel stretch (the bake's shiftM), and the one where the
// lake road leaves I-5's side closed with #377 (no sliver between the land and its slope).

describe.each(PACKS.flatMap((p) => p.networks))('the land of the real road %s', (id) => {
  it('never ends in mid-air: every raised edge of it is closed down to the ground', () => {
    const { road, built } = landScene(id);
    const ground = new GroundTris(built.group);
    const { probes, drops, open, joins } = openLandEnds(road, ground);
    process.stdout.write(
      `[examined] ${id}: ${ground.count} ground triangles, ${probes} points walked beside the road, ` +
        `${joins} steps across junctions, ${drops} drops of over 2 m looked under, ${open.length} open\n`,
    );
    built.dispose();
    // High country has drops to look under; the Keys' land shelves straight into the sea, flat, so
    // there it walks for nothing to close (the probes and joins below still count it).
    const flat = baked(id).roads.every((r) => {
      const y = r.samples.data['y'] ?? [];
      return Math.max(...y) - Math.min(...y) < 10;
    });
    if (!flat) expect(drops).toBeGreaterThan(0);
    expect(probes).toBeGreaterThan(1000);
    // The walk steps across the junctions too (run W-P's roadside verifier: Upper Market into Portola).
    expect(joins).toBeGreaterThan(0);
    expect(open.slice(0, 12).map(fmtEnd)).toEqual([]);
  }, 240_000);
});

it('negative control: a plate of land laid beside the Hyde Street bridge, nothing under it, is found open', () => {
  // The skeptic's defect, rebuilt by hand: a 14 m by 16 m plate at the road's height on the bridge's
  // left, over the bay. Rays straight down find land on it; the walk must find it open.
  const { road, built } = landScene('osm-sf-russian-hill');
  const e = road.edges.find((x) => x.id === 'osm-sf-hyde')!;
  const at = (s: number, d: number) => road.toWorld(e.index, s, d, -0.09);
  const outer = -e.dMin + 0.6;
  const corners = [at(1158, -outer - 3), at(1158, -outer - 17), at(1172, -outer - 3), at(1172, -outer - 17)];
  const geo = new BufferGeometry().setFromPoints(corners.map((c) => new Vector3(c.x, c.y, c.z)));
  geo.setIndex([0, 1, 2, 1, 3, 2]);
  const plate = new Mesh(geo, new MeshBasicMaterial({ side: DoubleSide }));
  plate.name = 'road-land';
  built.group.add(plate);
  const before = openLandEnds(road, new GroundTris(built.group)).open;
  built.dispose();
  const hyde = before.filter((o) => o.edge === 'osm-sf-hyde' && o.side < 0 && o.s > 1150 && o.s < 1180);
  process.stdout.write(
    `[negative control] a floating plate beside the Hyde Street bridge: ${hyde.length} open ends found there
`,
  );
  expect(hyde.length).toBeGreaterThan(0);
}, 240_000);

it('negative control: land laid over the Gorge bridges, rails gone, stands scenery on a deck; the check says so', () => {
  // The bake keeps land tags off its bridges and rails both sides of every deck; the renderer
  // grows nothing beside a rail. Undo both and scenery reaches the decks.
  const whole = (r: BakedRoad): BakedRoad => ({
    ...r,
    tags: [{ s0: 0, s1: r.lengthM, side: 'both', tag: 'forest' }],
    barriers: [],
  });
  const { bad } = offLand('osm-pnw-gorge', [1, 2, 3], whole);
  process.stdout.write(`[negative control] forest over the Gorge decks: ${bad.length} spots flagged\n`);
  expect(bad.some((b) => b.includes('bridge'))).toBe(true);
}, 120_000);
