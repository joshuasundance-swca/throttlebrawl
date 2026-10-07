// San Francisco's Chinatown, North Beach and Mission in the structures' plan (the maintainer, 2026-10-06, [decided]:
// "consistent physics and gameplay is important here so players know what to expect and how to interact with the
// world"). render used to place these districts as it drew them; the placement is in road/structures/ now, so the
// sim can meet what render draws. The checks run the real baked networks: the layers load lazily and plan, the plan
// is the same for the same network and seed whatever loaded or was drawn, nothing stands on a road, a roof is a
// place to come down on, and a plan with a structure moved or missing is found (negative controls).
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type RoadNetwork } from '../network';
import {
  ensureStructures,
  planStructures,
  STRUCTURE_LAYERS,
  structureLayersFor,
  structuresAt,
  structuresOf,
  topAt,
  type StructureLayerSpec,
  type StructurePlan,
} from '../structures';
import type { BakedNetwork, BakedRoad } from '../types';
import { BLOCK_TAGS, blocksLayout, blocksPlanner, blocksSolids } from './chinatown-northbeach';
import {
  FOOT_TOL_M,
  MISSION_TAGS,
  missionLayout,
  missionPlanner,
  missionSolids,
  ROOF_TOL_M,
  wallBoxes,
} from './mission';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

/** A fresh network of a baked one, with its road files (a new object each call: plans are kept per network). */
function track(id: string): { road: RoadNetwork; roads: BakedRoad[] } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  return { road: createRoadNetwork({ network, roads }), roads };
}

const CN = 'sf-chinatown-northbeach';
const MI = 'sf-mission';
const SEED = 7;
const planners = { 'chinatown-northbeach': blocksPlanner, mission: missionPlanner };
/**
 * The districts' own layers: their networks need other layers too (the landmarks), which these tests do not
 * plan, so the plans here hold the districts' solids only.
 */
const layers: Record<string, StructureLayerSpec> = Object.fromEntries(
  Object.keys(planners).map((name) => [name, STRUCTURE_LAYERS[name] as StructureLayerSpec]),
);

/** The lanes' world positions (centre, and each lane's centre) every 2 m: where a rider on the road stands. */
function roadPoints(road: RoadNetwork): { x: number; z: number; edge: number; s: number }[] {
  const out: { x: number; z: number; edge: number; s: number }[] = [];
  for (const e of road.edges)
    for (let s = 0; s <= e.length; s += 2)
      for (const lane of road.lanesAt(e.index, s)) {
        const p = road.toWorld(e.index, s, lane.dCenterM, 0);
        out.push({ x: p.x, z: p.z, edge: e.index, s });
      }
  return out;
}

describe('the layers: which network asks for which planner, and that they load lazily', () => {
  it('the districts ask for their own layer only, by their tags', () => {
    // Other layers (the downtowns, the waterfront) have rows too; this test holds the districts' own.
    const districts = (id: string) =>
      structureLayersFor(track(id).road).filter((l) => l === 'chinatown-northbeach' || l === 'mission');
    expect(Object.keys(STRUCTURE_LAYERS)).toEqual(
      expect.arrayContaining(['chinatown-northbeach', 'mission']),
    );
    expect(STRUCTURE_LAYERS['chinatown-northbeach']?.tags).toEqual([...BLOCK_TAGS]);
    expect(STRUCTURE_LAYERS['mission']?.tags).toEqual([...MISSION_TAGS]);
    expect(districts(CN)).toEqual(['chinatown-northbeach']);
    expect(districts(MI)).toEqual(['mission']);
    for (const other of ['sf-downtown', 'sf-hills', 'keys-m1', 'pnw-c1'])
      expect(districts(other), other).toEqual([]);
  });

  it('ensureStructures loads the planner (a dynamic import) and keeps one plan per network and seed', async () => {
    for (const id of [CN, MI]) {
      const { road } = track(id);
      expect(structuresOf(road, SEED)).toBeNull();
      const plan = await ensureStructures(road, SEED);
      print(`[examined] ${id} seed ${SEED}: ${plan.items.length} structures`);
      expect(plan.items.length).toBeGreaterThan(300);
      expect(structuresOf(road, SEED)).toBe(plan);
      expect(await ensureStructures(road, SEED)).toBe(plan);
      // A new seed is a new plan (the hash decides the lots), the first one kept.
      const other = await ensureStructures(road, SEED + 1);
      expect(other).not.toBe(plan);
      expect(structuresOf(road, SEED)).toBe(plan);
    }
  });
});

describe('the plan is a function of the network and the seed only', () => {
  it('is the same for a second network built from the same data (nothing drawn or loaded is an input)', () => {
    for (const id of [CN, MI]) {
      const a = planStructures(track(id).road, SEED, planners, layers);
      const b = planStructures(track(id).road, SEED, planners, layers);
      expect(b).not.toBe(a);
      expect(JSON.stringify(b.items)).toBe(JSON.stringify(a.items));
    }
  });

  it('is the same planned from the road files as dressing: the dressing is the road data, so it is not an input', () => {
    // The game used to hand the layers `dressing` (the road files, plus a career's incident-site boards); the
    // layout reads e.tags and e.features, and they are the same files.
    const cn = track(CN);
    const dressing = Object.fromEntries(cn.roads.map((r) => [r.id, r]));
    expect(JSON.stringify(blocksLayout(cn.road, SEED, dressing))).toBe(
      JSON.stringify(blocksLayout(cn.road, SEED)),
    );
    const mi = track(MI);
    const dressingMi = Object.fromEntries(mi.roads.map((r) => [r.id, r]));
    expect(JSON.stringify(missionLayout(mi.road, SEED, dressingMi))).toBe(
      JSON.stringify(missionLayout(mi.road, SEED)),
    );
  });

  it('control: an override is not kept, and one that changes the roads changes the layout (so the check can see)', () => {
    const cn = track(CN);
    const kept = blocksLayout(cn.road, SEED);
    expect(blocksLayout(cn.road, SEED)).toBe(kept);
    const without = Object.fromEntries(
      cn.roads.map((r) => [
        r.id,
        { ...r, features: (r.features ?? []).filter((f) => f.kind !== 'landmark') },
      ]),
    );
    const bare = blocksLayout(cn.road, SEED, without);
    expect(bare).not.toBe(kept);
    expect(blocksLayout(cn.road, SEED)).toBe(kept);
    expect(JSON.stringify(bare)).not.toBe(JSON.stringify(kept));
    // A career's incident-site board is a `billboard` feature on a road: it knocks a lot out of the old render
    // placement, and the plan no longer takes it as an input (the plan is the road data's).
    const front = kept.fronts.find((f) => f.district === 'lanterns');
    if (!front) throw new Error('no front');
    const id = cn.road.edges[front.edge]?.id;
    // The cone stands 0.8 m inside where the front's row starts (the incident spot is 3.2 m past the lanes).
    const d = front.side * (front.frontD - 0.8);
    const site = {
      kind: 'billboard',
      id: 'incident-site-1',
      s0: (front.s0 + front.s1) / 2,
      s1: (front.s0 + front.s1) / 2,
      d0: d,
      d1: d,
    };
    const withSite = Object.fromEntries(
      cn.roads.map((r) => [r.id, r.id === id ? { ...r, features: [...(r.features ?? []), site] } : r]),
    );
    expect(blocksLayout(cn.road, SEED, withSite).fronts.length).toBeLessThan(kept.fronts.length);
  });
});

describe("Chinatown and North Beach's plan", () => {
  const { road } = track(CN);
  const plan: StructurePlan = planStructures(road, SEED, planners, layers);
  const rules = (name: string) => plan.items.filter((s) => s.rule === name);

  it('plans a solid for every front, second row, balcony, bay, rail, side-street lot and park building', () => {
    const layout = blocksLayout(road, SEED);
    const by = new Map<string, number>();
    for (const s of plan.items) by.set(s.rule, (by.get(s.rule) ?? 0) + 1);
    print(
      `[examined] ${plan.items.length} structures: ${[...by.entries()].map(([k, n]) => `${n} ${k}`).join(', ')}`,
    );
    expect(plan.items.length).toBe(blocksSolids(layout).length);
    expect(rules('lanterns-front').length + rules('cafes-front').length).toBe(layout.fronts.length);
    expect(rules('back-row').length).toBe(layout.fronts.length);
    expect(rules('patio-rail').length).toBe(layout.fronts.filter((f) => f.railF).length);
    expect(rules('park-back').length).toBe(layout.parkRows.length);
    expect(rules('balcony').length).toBeGreaterThan(100);
    expect(rules('bay-window').length).toBeGreaterThan(20);
    expect(rules('side-street').length).toBeGreaterThan(100);
    expect(rules('side-street-end').length).toBe(18);
    for (const s of plan.items) {
      expect(s.roof.kind).toBe('flat');
      expect(s.layer).toBe('chinatown-northbeach');
    }
  });

  it('every front is a wall up to its roofline: 11.7 to 20 m over the road beside it, 3 to 5 storeys', () => {
    for (const s of [...rules('lanterns-front'), ...rules('cafes-front')]) {
      if (s.roof.kind !== 'flat') throw new Error('flat');
      const top = s.baseY + s.roof.topM;
      const road0 = road.toWorld(s.edge, s.s, 0, 0).y;
      // Over the road (and its hill: a front's roof is flat, the ground is not), a roofline of 3 to 5 storeys.
      expect(top - road0, `${s.rule} at ${s.edge}@${s.s.toFixed(0)}`).toBeGreaterThan(8);
      expect(top - road0).toBeLessThan(26);
    }
  });

  it('nothing stands on a road: no lane of any road of the network lies under a structure', () => {
    let points = 0;
    let hits = 0;
    for (const p of roadPoints(road)) {
      points++;
      if (structuresAt(plan, p.x, p.z).length > 0) hits++;
    }
    print(`[examined] ${points} lane points on ${road.edges.length} roads: ${hits} under a structure`);
    expect(points).toBeGreaterThan(500);
    expect(hits).toBe(0);
  });

  it('a roof is a place to come down on: over the middle of a front, its top is what a rider lands on', () => {
    let checked = 0;
    for (const s of [...rules('lanterns-front'), ...rules('cafes-front')]) {
      const at = structuresAt(plan, s.foot.x, s.foot.z);
      expect(at.map((x) => x.id)).toContain(s.id);
      if (s.roof.kind !== 'flat') throw new Error('flat');
      expect(topAt(s, s.foot.x, s.foot.z)).toBeCloseTo(s.baseY + s.roof.topM, 9);
      checked++;
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('control: a plan with a front moved onto the road is found by the lane check', () => {
    const front = rules('lanterns-front')[0];
    if (!front) throw new Error('no front');
    const lane = road.toWorld(front.edge, front.s, 0, 0);
    const moved = planStructures(
      track(CN).road,
      SEED,
      {
        'chinatown-northbeach': {
          plan(r, seed, out) {
            for (const spec of blocksSolids(blocksLayout(r, seed))) out.add(spec);
            out.add({ ...front, foot: { ...front.foot, x: lane.x, z: lane.z } });
          },
        },
      },
      layers,
    );
    expect(structuresAt(moved, lane.x, lane.z).length).toBeGreaterThan(0);
    expect(structuresAt(plan, lane.x, lane.z)).toEqual([]);
  });
});

describe("the Mission's plan", () => {
  const { road } = track(MI);
  const plan: StructurePlan = planStructures(road, SEED, planners, layers);
  const layout = missionLayout(road, SEED);

  it('plans a run of boxes for every building and a plank for every bay and height of the mascot scaffold', () => {
    const by = new Map<string, number>();
    for (const s of plan.items) by.set(s.rule, (by.get(s.rule) ?? 0) + 1);
    const segments = layout.builds.reduce((n, b) => n + b.front.length - 1, 0);
    print(
      `[examined] ${plan.items.length} structures (${[...by.entries()].map(([k, n]) => `${n} ${k}`).join(', ')}) ` +
        `for ${layout.builds.length} buildings in ${segments} segments of 2 m`,
    );
    expect(plan.items.length).toBe(missionSolids(layout).length);
    expect(by.get('shopfront')).toBeGreaterThan(50);
    expect(by.get('alley-wall')).toBeGreaterThan(100);
    expect(by.get('mascot-wall')).toBeGreaterThan(5);
    expect(by.get('scaffold-plank')).toBeGreaterThan(100);
    // Fewer boxes than 2 m segments: a straight run is one box.
    expect(plan.items.filter((s) => s.rule !== 'scaffold-plank').length).toBeLessThan(segments);
  });

  it("a building's boxes cover its drawn front and back within the stated tolerances, end to end", () => {
    let worstFront = 0;
    let worstRoof = 0;
    let boxes = 0;
    for (const b of layout.builds) {
      const covered = new Array<boolean>(b.front.length - 1).fill(false);
      for (const box of wallBoxes(b)) {
        boxes++;
        const f = box.foot;
        for (let i = box.i0; i <= box.i1; i++) {
          if (i < box.i1) covered[i] = true;
          const p = b.front[i]!;
          const q = b.back[i]!;
          for (const c of [p, q]) {
            // The drawn corner's distance outside the box (0 inside).
            const dx = c.x - f.x;
            const dz = c.z - f.z;
            const u = dx * f.ux + dz * f.uz;
            const v = dz * f.ux - dx * f.uz;
            const out = Math.max(Math.abs(u) - f.hu, Math.abs(v) - f.hv, 0);
            worstFront = Math.max(worstFront, out);
          }
          worstRoof = Math.max(worstRoof, Math.abs(p.y + b.height - box.top));
        }
      }
      expect(covered.every(Boolean), `building at u ${b.u0.toFixed(1)}`).toBe(true);
    }
    print(
      `[examined] ${boxes} boxes: a drawn corner at most ${worstFront.toFixed(3)} m outside its box, a drawn roof at most ${worstRoof.toFixed(3)} m from its flat top`,
    );
    expect(worstFront).toBeLessThanOrEqual(FOOT_TOL_M + 1e-6);
    // One 2 m segment is always a box, and a steep grade can put its two ends more than the tolerance apart.
    expect(worstRoof).toBeLessThan(ROOF_TOL_M * 3);
  });

  it("a building's boxes are no bigger than what is drawn: 3 % more floor in all, and a box over its run's roof by half or more only where a turn fans it", () => {
    // The drawn roof of a run of segments is the strip between its front points and its back points.
    const area = (poly: { x: number; z: number }[]) => {
      let a = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % poly.length]!;
        a += p.x * q.z - q.x * p.z;
      }
      return Math.abs(a) / 2;
    };
    const cover = (scale: number) => {
      let drawn = 0;
      let boxed = 0;
      let fans = 0;
      let boxes = 0;
      let worst = 0;
      for (const b of layout.builds)
        for (const box of wallBoxes(b)) {
          const a = area([
            ...b.front.slice(box.i0, box.i1 + 1),
            ...b.back.slice(box.i0, box.i1 + 1).reverse(),
          ]);
          const bx = 4 * box.foot.hu * scale * box.foot.hv;
          drawn += a;
          boxed += bx;
          boxes++;
          if (bx / a >= 1.5) fans++;
          worst = Math.max(worst, bx / a);
        }
      return { drawn, boxed, fans, boxes, worst };
    };
    const c = cover(1);
    print(
      `[examined] ${c.boxes} boxes cover ${c.boxed.toFixed(0)} m2 for ${c.drawn.toFixed(0)} m2 drawn (${((100 * c.boxed) / c.drawn - 100).toFixed(1)} % over); ` +
        `${c.fans} are half again their run's roof or more (the fan of a turn at an alley's mouth), the worst ${c.worst.toFixed(2)} times`,
    );
    expect(c.boxed / c.drawn).toBeLessThan(1.03);
    expect(c.fans).toBeLessThan(c.boxes * 0.06);
    // Control: the same boxes 30 % longer are found.
    expect(cover(1.3).boxed / c.drawn).toBeGreaterThan(1.25);
  });

  it('control: a box moved 1 m off its building leaves its drawn corners outside it', () => {
    const b = layout.builds[0]!;
    const [box] = wallBoxes(b);
    if (!box) throw new Error('no box');
    const f = { ...box.foot, x: box.foot.x + 1, z: box.foot.z + 1 };
    let worst = 0;
    for (let i = box.i0; i <= box.i1; i++)
      for (const c of [b.front[i]!, b.back[i]!]) {
        const dx = c.x - f.x;
        const dz = c.z - f.z;
        worst = Math.max(
          worst,
          Math.abs(dx * f.ux + dz * f.uz) - f.hu,
          Math.abs(dz * f.ux - dx * f.uz) - f.hv,
        );
      }
    expect(worst).toBeGreaterThan(FOOT_TOL_M);
  });

  it('nothing stands on a road: no lane of any road of the network lies under a structure', () => {
    let points = 0;
    let hits = 0;
    for (const p of roadPoints(road)) {
      points++;
      if (structuresAt(plan, p.x, p.z).length > 0) hits++;
    }
    print(`[examined] ${points} lane points on ${road.edges.length} roads: ${hits} under a structure`);
    expect(points).toBeGreaterThan(300);
    expect(hits).toBe(0);
  });

  it("the mascot's scaffold is ledges at 3.5, 7, 10.5 and 13.5 m over the road, between the wall and the band", () => {
    const planks = plan.items.filter((s) => s.rule === 'scaffold-plank');
    const heights = new Set<number>();
    for (const p of planks) {
      if (p.roof.kind !== 'flat') throw new Error('flat');
      expect(p.roof.topM).toBeCloseTo(0.1, 9);
      expect(p.foot.hv).toBeCloseTo(0.6, 9);
      expect(p.foot.hu).toBeGreaterThan(1);
      const above = p.baseY + 0.05 - road.toWorld(p.edge, p.s, 0, 0).y;
      heights.add(Math.round(above * 2) / 2);
    }
    print(
      `[examined] ${planks.length} planks at heights over the road ${[...heights].sort((a, b) => a - b).join(', ')} m`,
    );
    for (const h of [3.5, 7, 10.5, 13.5]) expect(heights.has(h), `a plank at ${h} m`).toBe(true);
  });
});
