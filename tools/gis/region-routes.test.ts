/// <reference types="vite/client" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Mesh, Raycaster, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { createFlatLook } from '../../src/render/look';
import { buildRoadScene, ROAD_CHUNK_M, type RoadDressing } from '../../src/render/road-mesh';
import { SCENERY_RADIUS_M, type ScenerySpot } from '../../src/render/scenery';

// The real roads landed in the region packs as routes (the maintainer, 2026-10-01: "Yes, add as
// routes"; the landing steps of the gis head-start run): each region pack carries base's ODbL
// licence rule and its licence text, every baked file passes the road lint, and the roadside
// scenery the renderer scatters on them stands on drawn land for every seed tried, never on a
// bridge, the road or the water (playtest 1c item 3). The bot races are the sim tier's
// (tests/sim/road-real-routes.test.ts).

const PACKS = [
  { pack: 'region-pnw', region: 'pacific-northwest', networks: ['osm-pnw-chuckanut', 'osm-pnw-gorge'] },
  { pack: 'region-sf', region: 'san-francisco', networks: ['osm-sf-russian-hill', 'osm-sf-twin-peaks'] },
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
      // Two networks, their roads and one route each.
      expect(files.filter((f) => f.includes('/networks/'))).toHaveLength(2);
      expect(files.filter((f) => f.includes('/routes/'))).toHaveLength(2);
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
        // The hand-made roads' lanes (4 m since playtest 1), so weaving feels the same.
        for (const r of roads)
          expect(r.laneSections[0]?.lanes.filter((l) => l.kind === 'drive').map((l) => l.widthM)).toEqual([
            4, 4,
          ]);
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

function footprint(s: ScenerySpot): { x: number; z: number }[] {
  const pts = [{ x: s.p.x, z: s.p.z }];
  if (WIDE.has(s.kind)) {
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
 * the verge's 24 m strip that the road's own tags make. A few stand past the drawn skirt, over the
 * sea, on the hand-made pnw-c1 too (3 of 7,124 land spots over seeds 1 to 3, 2026-10-01). They are
 * counted apart and reported to the render lane, so this file guards the roads' own land strictly.
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
      for (const p of footprint(s)) {
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
        `far-forest conifers ${farSpots}, ${farBad.length} past the drawn skirt (render follow-up)` +
        `${farBad[0] ? `, e.g. ${farBad[0]}` : ''}\n`,
    );
    expect(spots).toBeGreaterThan(0);
    expect(bad.slice(0, 12)).toEqual([]);
    // The far forest is the render lane's scatter, not this road data: printed above, not asserted
    // here (its home is src/render's region tests).
  }, 240_000);
});

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
