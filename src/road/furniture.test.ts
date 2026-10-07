// The street furniture's plan (playtest 4, "solid but forgiving"; road/furniture.ts): one plan, read by
// the sim to meet the pieces and by render to draw them. The checks plan real networks: the same seed
// gives the same plan, every kerb piece stands on its sidewalk (a ridable, paved band), each kind has its
// class, and a piece's footprint in the road frame follows its turn.
import { describe, expect, it } from 'vitest';
import {
  FURNITURE,
  FURNITURE_KINDS,
  kitOfNetwork,
  onRidableBand,
  planStreetFurniture,
  rimOf,
  type FurnitureShape,
} from './furniture';
import { createRoadNetwork, type RoadNetwork } from './network';
import type { BakedNetwork, BakedRoad } from './types';

/** The examined lines, printed even when the tests pass. */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function network(id: string) {
  const [path, n] = Object.entries(networkFiles).find(([, x]) => x.id === id) ?? [];
  if (!n || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && n.roads.includes(r.id))
    .map(([, r]) => r);
  return createRoadNetwork({ network: n, roads });
}

describe('the street furniture plan', () => {
  const downtown = network('sf-downtown');
  const duval = network('osm-keys-duval');
  const hills = network('osm-sf-russian-hill');

  it('picks the kit each network draws', () => {
    expect(kitOfNetwork(hills)).toBe('sf');
    expect(kitOfNetwork(duval)).toBe('keys');
    expect(kitOfNetwork(network('osm-pnw-gorge'))).toBe('pnw');
  });

  it('is the same for the same seed, and another seed moves the scattered pieces', () => {
    const a = planStreetFurniture(hills, 7);
    expect(planStreetFurniture(hills, 7)).toBe(a); // kept: worked out once
    const key = (p: { rule: string; edge: number; s: number; d: number }) =>
      `${p.rule}:${p.edge}:${p.s}:${p.d}`;
    const again = planStreetFurniture(network('osm-sf-russian-hill'), 7).items.map(key);
    expect(again).toEqual(a.items.map(key));
    const other = planStreetFurniture(hills, 8).items.map(key);
    expect(other).not.toEqual(again);
    stdout.write(
      `[examined] osm-sf-russian-hill: ${a.items.length} pieces at seed 7, ${other.length} at seed 8\n`,
    );
  });

  it('stands every kerb piece on its sidewalk, and every piece of every kind has its class and footprint', () => {
    let pieces = 0;
    const kinds = new Set<string>();
    for (const road of [downtown, duval, hills]) {
      for (const p of planStreetFurniture(road, 7).items) {
        pieces++;
        kinds.add(p.kind);
        expect(p.cls).toBe(FURNITURE[p.kind].cls);
        expect(p.shape.reachS).toBeGreaterThan(0);
        if (p.layer === 'kit') expect(onRidableBand(road, p), `${p.rule} at ${p.edge}:${p.s}`).toBe(true);
      }
    }
    stdout.write(`[examined] ${pieces} pieces of ${kinds.size} kinds over 3 networks\n`);
    expect(pieces).toBeGreaterThan(1500);
    // The waterfront's kinds are its own network's; the rest are here.
    for (const k of FURNITURE_KINDS.filter((x) => !['palm', 'wf-lamp', 'wf-bench', 'parked-car'].includes(x)))
      expect(kinds.has(k), k).toBe(true);
  });

  it("turns a piece's footprint with it: a bench facing the road lies along it", () => {
    const bench = planStreetFurniture(downtown, 7).items.find((p) => p.kind === 'dt-bench');
    if (!bench) throw new Error('no bench');
    // The bench's 2 m length is its x; facing the road, x runs along the road.
    expect(bench.shape.reachS).toBeCloseTo(1, 1);
    expect(bench.shape.reachD).toBeCloseTo(0.31, 1);
  });

  it('has a class and a footprint for every kind (the docs table and the hitbox audit read them)', () => {
    for (const k of FURNITURE_KINDS) {
      const f = FURNITURE[k];
      expect(['solid', 'light']).toContain(f.cls);
      expect(f.foot.length).toBeGreaterThan(0);
      expect(f.heightM).toBeGreaterThan(0);
    }
  });
});

/**
 * The lanes of every road of a network as points every LANE_STEP_M along and across (every lane of every edge,
 * branches and shortcuts included), in a metre grid: a check of its own, not the plan's (road/lanes-under.ts).
 */
const LANE_STEP_M = 0.25;
/** A point this near a lane point (in plan, and within 3 m of its height) is on the lanes, m: past half a cell's diagonal. */
const ON_LANE_M = 0.2;
function lanePoints(road: RoadNetwork) {
  const cells = new Map<string, number[]>();
  for (const e of road.edges)
    for (let s = 0; s <= e.length + 1e-6; s += LANE_STEP_M) {
      let lo = 0;
      let hi = 0;
      for (const lane of road.lanesAt(e.index, s)) {
        lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
        hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
      }
      for (let d = lo; d <= hi + 1e-6; d += LANE_STEP_M) {
        const p = road.toWorld(e.index, s, d, 0);
        const k = `${Math.floor(p.x)},${Math.floor(p.z)}`;
        const list = cells.get(k) ?? [];
        list.push(p.x, p.y, p.z, e.index, s);
        cells.set(k, list);
      }
    }
  return (x: number, y: number, z: number): string | null => {
    for (let i = Math.floor(x) - 1; i <= Math.floor(x) + 1; i++)
      for (let j = Math.floor(z) - 1; j <= Math.floor(z) + 1; j++) {
        const list = cells.get(`${i},${j}`) ?? [];
        for (let q = 0; q < list.length; q += 5) {
          const dx = (list[q] ?? 0) - x;
          const dz = (list[q + 2] ?? 0) - z;
          if (dx * dx + dz * dz <= ON_LANE_M * ON_LANE_M && Math.abs((list[q + 1] ?? 0) - y) <= 3)
            return `${road.edges[list[q + 3] ?? 0]?.id} s ${(list[q + 4] ?? 0).toFixed(1)}`;
        }
      }
    return null;
  };
}

/** Where a footprint on `edge` stands on a lane: the road and s, or null. */
function onLanes(road: RoadNetwork, at: ReturnType<typeof lanePoints>, edge: number, shape: FurnitureShape) {
  for (const q of rimOf(shape)) {
    const p = road.toWorld(edge, q.s, q.d, 0);
    const hit = at(p.x, p.y, p.z);
    if (hit) return hit;
  }
  return null;
}

const allNetworks = () =>
  Object.values(networkFiles)
    .map((n) => n.id)
    .sort();

describe("the street furniture keeps off every road's lanes (2026-10-06: honest edges)", () => {
  it('on every network: no piece stands on a lane of any road, its own or a branch, shortcut or neighbour', () => {
    const bad: string[] = [];
    let pieces = 0;
    let nets = 0;
    for (const id of allNetworks()) {
      const road = network(id);
      const plan = planStreetFurniture(road, 1);
      if (plan.items.length === 0) continue;
      nets++;
      const at = lanePoints(road);
      for (const p of plan.items) {
        pieces++;
        const hit = onLanes(road, at, p.edge, p.shape);
        if (hit)
          bad.push(`${id}: ${p.kind} (${p.rule}) of ${road.edges[p.edge]?.id} s ${p.s.toFixed(0)} on ${hit}`);
      }
    }
    stdout.write(
      `[examined] ${pieces} pieces on ${nets} networks with furniture, seed 1, against every lane\n`,
    );
    expect(pieces).toBeGreaterThan(1500);
    expect(bad).toEqual([]);
  }, 120_000);

  it("the negative control: a lamp on the Plaza Cut's lane is found, one just past its edge is not", () => {
    const road = network('sf-downtown');
    const at = lanePoints(road);
    const cut = road.edgeIndex('sf-dt-plaza-cut');
    let hi = 0;
    for (const lane of road.lanesAt(cut, 80)) hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    const lamp = (d: number): FurnitureShape => ({
      s: 80,
      d,
      r: 0.1,
      hu: 0,
      hv: 0,
      us: 1,
      ud: 0,
      reachS: 0.1,
      reachD: 0.1,
    });
    expect(onLanes(road, at, cut, lamp(hi - 1))).toMatch(/sf-dt-plaza-cut s 80/);
    expect(onLanes(road, at, cut, lamp(hi + 0.35))).toBeNull();
  });
});
