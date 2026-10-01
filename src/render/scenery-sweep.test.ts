// Playtest 1c item 3 ("in concrete floating in the river lol"), as the skeptic's 1c sweep found it:
// a palm or a pole could still stand over the sea in a hole in the drawn land (SF seed 2447605036,
// a power pole on sf-switchback-street at s 506.7), and the single-seed check missed it (8 of 63
// headless builds had one). So this sweeps many seeds on every network, Keys and both regions, and
// rays straight down onto each spot of the scene actually built for that seed: land scenery must
// stand on drawn land (its anchor, and a ring round a shack or a mangrove clump), and no spot of any
// kind may sit on the bare sea except a boat.
import { Mesh, Raycaster, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { buildRoadScene, ROAD_CHUNK_M, type RoadDressing } from './road-mesh';
import { SCENERY_RADIUS_M, type ScenerySpot } from './scenery';

const look = createFlatLook();
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

/**
 * The seeds: the fixed test seeds, every seed the skeptic named (scenery over the sea, or the
 * fresh-race probes), and a spread of 32-bit seeds as the app's createRaceSeeds draws them.
 */
const NAMED = [
  1, 2, 3, 7, 11, 2447605036, 3230531489, 4052564335, 1783423519, 2901547813, 3140025420, 849069689,
];
const SPREAD = Array.from({ length: 12 }, (_, i) => Math.imul(i + 1, 0x9e3779b1) >>> 0 || 1);
const SWEEP_SEEDS: readonly number[] = [...NAMED, ...SPREAD];

const LAND = new Set(['palm', 'mangrove', 'shack', 'pole']);
/** The share of its clearance radius a shack's or a mangrove's footprint ring must stand on land. */
const RING = 0.6;

/**
 * The ground meshes by road chunk (road-mesh.ts merges static geometry per ROAD_CHUNK_M square), so
 * a ray only tests the chunks round its spot; the sea plane, in no chunk, goes with every ray.
 */
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

function firstHit(objs: Object3D[], x: number, z: number, top: number): string | null {
  const ray = new Raycaster(new Vector3(x, top, z), new Vector3(0, -1, 0), 0, 400);
  return ray.intersectObjects(objs, false)[0]?.object.name ?? null;
}

/** The points of a spot that must stand on land: the anchor, and a ring for the wide kinds. */
function footprint(s: ScenerySpot): { x: number; z: number }[] {
  const pts = [{ x: s.p.x, z: s.p.z }];
  if (s.kind === 'shack' || s.kind === 'mangrove') {
    const r = SCENERY_RADIUS_M[s.kind] * RING;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      pts.push({ x: s.p.x + r * Math.cos(a), z: s.p.z + r * Math.sin(a) });
    }
  }
  return pts;
}

/** The raced tracks get every seed; the staged OSM bake (not raced yet) gets the named ones. */
const SWEEPS: readonly [string, readonly number[]][] = [
  ['keys-m1', SWEEP_SEEDS],
  ['pnw-c1', SWEEP_SEEDS],
  ['sf-hills', SWEEP_SEEDS],
  ['osm-keys-bahia-honda', NAMED],
];

describe.each(SWEEPS)('scenery never over the sea, across %s seeds', (id, seeds) => {
  it(`stands every land spot on drawn land for ${seeds.length} seeds`, () => {
    const { road, dressing } = track(id);
    let spots = 0;
    let points = 0;
    const bad: string[] = [];
    for (const seed of seeds) {
      const built = buildRoadScene(road, look, dressing, { seed });
      const ground = groundByChunk(
        built.group,
        /^road-(land|water|road|shoulder|shortcut|deck|marking|splitZone|rampMark|boost)/,
      );
      for (const s of built.spots) {
        if (!LAND.has(s.kind)) continue;
        spots++;
        for (const p of footprint(s)) {
          points++;
          const hit = firstHit(ground(p.x, p.z), p.x, p.z, s.p.y + 30);
          if (hit !== 'road-land') {
            const e = road.edges[s.edge];
            bad.push(
              `seed ${seed}: ${s.kind} on ${e?.id} s ${s.s.toFixed(1)} d ${s.d.toFixed(1)} over ${hit}`,
            );
            break;
          }
        }
      }
      built.dispose();
    }
    console.log(
      `[examined] ${id}: ${seeds.length} seeds, ${spots} land spots, ${points} points ray-checked; ${bad.length} not on land`,
    );
    expect(bad.slice(0, 12)).toEqual([]);
  }, 240_000);
});
