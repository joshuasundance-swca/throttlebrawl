// San Francisco's waterfront as solid structures (road/structures/waterfront.ts; the maintainer, 2026-10-06: "consistent
// physics and gameplay is important here so players know what to expect and how to interact with the world"). The
// checks plan the real baked network: the layer asks for the planner and loads it lazily, every building is a plan of
// solids at the heights the drawing has, the plan is the layout's, the same for the same seed, and no solid stands on
// the road. (The drawing's agreement with the plan is scripts/hitboxes.test.ts's; render's with main's, render/waterfront.test.ts.)
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type RoadNetwork } from '../network';
import {
  ensureStructures,
  footContains,
  planStructures,
  requireStructures,
  STRUCTURE_LAYERS,
  structureLayersFor,
  structuresAt,
  structuresOf,
  topAt,
} from '../structures';
import type { BakedNetwork, BakedRoad } from '../types';
import {
  BLOCK_WIDTH,
  blockHeight,
  EVEN_PIERS,
  FOOT_M,
  ODD_PIERS,
  waterfrontLayout,
  waterfrontPlanner,
  WATERFRONT_LAYER,
} from './waterfront';

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
function network(id: string): RoadNetwork {
  const [path, n] = Object.entries(networkFiles).find(([, x]) => x.id === id) ?? [];
  if (!n || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && n.roads.includes(r.id))
    .map(([, r]) => r);
  return createRoadNetwork({ network: n, roads });
}

const wf = network('sf-waterfront');
const layout = waterfrontLayout(wf, 7);
const specsOf = () => [
  ...layout.fronts.flatMap((f) => f.specs),
  ...layout.blocks.flatMap((b) => b.specs),
  ...layout.towers.flatMap((t) => t.specs),
];

describe('the waterfront layer (road/structures/waterfront.ts)', () => {
  it("is asked for by the waterfront's tags and no other network's, and loads as a lazy chunk", async () => {
    expect(STRUCTURE_LAYERS[WATERFRONT_LAYER]).toBeDefined();
    expect(structureLayersFor(wf)).toContain(WATERFRONT_LAYER);
    for (const id of ['osm-sf-russian-hill', 'osm-keys-duval', 'pnw-c1', 'sf-downtown'])
      expect(structureLayersFor(network(id)), id).not.toContain(WATERFRONT_LAYER);
    // The registry loads the planner by a dynamic import: what `ensureStructures` plans is the layout's specs.
    const road = network('sf-waterfront'); // a fresh network: plans are kept per network
    const plan = await ensureStructures(road, 7);
    const mine = plan.items.filter((s) => s.layer === WATERFRONT_LAYER);
    expect(mine.length).toBe(specsOf().length);
    expect(structuresOf(road, 7)).toBe(plan);
    expect(requireStructures(road, 7)).toBe(plan);
    expect(() => requireStructures(road, 99)).toThrow(/not planned/);
  });

  it('plans the same for the same seed, and another seed moves the blocks', () => {
    const key = (l: typeof layout) =>
      [...l.fronts, ...l.blocks, ...l.towers]
        .map((p) => `${p.rule}@${p.s.toFixed(3)}/${p.d.toFixed(3)}/${p.p.y.toFixed(3)}`)
        .join(',');
    expect(waterfrontLayout(wf, 7)).toBe(layout); // kept: worked out once
    expect(key(waterfrontLayout(network('sf-waterfront'), 7))).toBe(key(layout));
    expect(key(waterfrontLayout(wf, 8))).not.toBe(key(layout));
    // The piers and the street blocks' places are the network's, not the seed's.
    expect(waterfrontLayout(wf, 8).frontages).toEqual(layout.frontages);
    expect(waterfrontLayout(wf, 8).streets).toEqual(layout.streets);
  });

  it('plans every pier shed, the hall, the blocks, the towers and the street blocks, each with its solids', () => {
    const planned = planStructures(network('sf-waterfront'), 7, { [WATERFRONT_LAYER]: waterfrontPlanner });
    const rules = new Map<string, number>();
    for (const s of planned.items) rules.set(s.rule, (rules.get(s.rule) ?? 0) + 1);
    print(
      `[examined] ${planned.items.length} solids on the waterfront at seed 7: ${JSON.stringify(Object.fromEntries([...rules].sort()))}`,
    );
    expect(layout.fronts.filter((f) => f.kind === 'shed').length).toBeGreaterThanOrEqual(12);
    expect(layout.fronts.filter((f) => f.kind === 'hall')).toHaveLength(1);
    expect(layout.blocks.length).toBeGreaterThan(200);
    expect(layout.towers.length).toBeGreaterThan(20);
    for (const rule of [
      'pier-shed',
      'pier-shed:deck',
      'pier-shed:body',
      'ferry-hall',
      'ferry-hall:tower-cap4',
      'back-tower',
      'back-tower:crown',
      'street-block',
    ])
      expect(rules.has(rule), rule).toBe(true);
    // The layout keeps every piece of its numbers: the same piers as the old frontage list.
    const order = layout.frontages.map((f) => (f.kind === 'hall' ? 'hall' : String(f.pier)));
    const at = order.indexOf('hall');
    expect(layout.frontages.slice(0, at).map((f) => f.pier)).toEqual([...EVEN_PIERS.slice(0, at)].reverse());
    expect(layout.frontages.slice(at + 1).map((f) => f.pier)).toEqual(
      ODD_PIERS.slice(0, order.length - at - 1),
    );
  });

  it('is as tall as it is drawn: the facade 10 m with its raised middle at 13, the shed 7.5, the tower to 70.5, the blocks by kind', () => {
    const shed = layout.fronts.find((f) => f.kind === 'shed');
    const hall = layout.fronts.find((f) => f.kind === 'hall');
    if (!shed || !hall) throw new Error('no shed or hall');
    const top = (
      specs: readonly { rule: string; baseY: number; roof: { kind: string; topM?: number } }[],
      rule: string,
    ) => {
      const s = specs.find((x) => x.rule === rule);
      if (!s || s.roof.kind !== 'flat') throw new Error(`no flat ${rule}`);
      return s.baseY + (s.roof.topM ?? 0) - shed.p.y;
    };
    expect(top(shed.specs, 'pier-shed')).toBeCloseTo(10, 6);
    expect(top(shed.specs, 'pier-shed:middle')).toBeCloseTo(13, 6);
    expect(top(shed.specs, 'pier-shed:body')).toBeCloseTo(7.5, 6);
    expect(top(shed.specs, 'pier-shed:clerestory')).toBeCloseTo(9.5, 6);
    expect(top(shed.specs, 'pier-shed:deck')).toBeCloseTo(0, 6);
    expect(top(hall.specs, 'ferry-hall')).toBeCloseTo(13, 6);
    expect(top(hall.specs, 'ferry-hall:tower-cap4')).toBeCloseTo(70.5, 6);
    // A block's wall is its kind's height over the ground under its front (the plan's base, not the drawn foot).
    for (const b of layout.blocks) {
      const body = b.specs[0];
      if (!body || body.roof.kind !== 'flat') throw new Error('no body');
      expect(body.baseY, b.rule).toBeCloseTo(b.p.y, 9);
      expect(body.roof.topM, b.rule).toBeCloseTo(blockHeight(b.kind, b.u), 9);
    }
    for (const kind of Object.keys(BLOCK_WIDTH) as (keyof typeof BLOCK_WIDTH)[]) {
      expect(blockHeight(kind, 0)).toBeGreaterThan(0);
    }
    expect(FOOT_M).toBe(4);
  });

  it('puts every point of a building on its footprint, and finds it where it stands', () => {
    const planned = planStructures(network('sf-waterfront'), 7, { [WATERFRONT_LAYER]: waterfrontPlanner });
    const hall = layout.fronts.find((f) => f.kind === 'hall');
    if (!hall) throw new Error('no hall');
    // A point 20 m behind the hall's front, on its middle, is in the hall and in its deck, and the hall is higher.
    const sink = hall.specs[0];
    if (!sink) throw new Error('no hall body');
    const inside = { x: sink.foot.x, z: sink.foot.z };
    expect(footContains(sink.foot, inside.x, inside.z)).toBe(true);
    const found = structuresAt(planned, inside.x, inside.z).filter((s) => s.rule.startsWith('ferry-hall'));
    expect(found.map((s) => s.rule)).toEqual(expect.arrayContaining(['ferry-hall', 'ferry-hall:deck']));
    const tops = found.map((s) => topAt(s, inside.x, inside.z) ?? -Infinity);
    expect(Math.max(...tops)).toBeCloseTo(hall.p.y + 15.2, 6); // the hall's roof is its highest solid over its middle
  });

  /** The footprint's corners and the middles of its sides that lie on a road's lanes (a 0.5 m allowance for a chord on a bend). */
  function onLanes(s: {
    edge: number;
    foot: { x: number; z: number; ux: number; uz: number; hu: number; hv: number };
  }) {
    const f = s.foot;
    const hits: number[] = [];
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const x = f.x + a * f.hu * f.ux - b * f.hv * f.uz;
      const z = f.z + a * f.hu * f.uz + b * f.hv * f.ux;
      const at = wf.project(x, z, s.edge);
      const e = wf.edges[at.edge];
      if (e && at.d > e.dMin - 0.5 && at.d < e.dMax + 0.5) hits.push(at.d);
    }
    return hits;
  }

  it('stands no solid on the road: every corner of every footprint is past the lanes of the nearest road', () => {
    const specs = specsOf();
    const bad = specs
      .filter((s) => onLanes(s).length > 0)
      .map((s) => `${s.rule} at ${s.edge}:${s.s.toFixed(0)}`);
    print(
      `[examined] ${specs.length * 8} footprint points of ${specs.length} solids: ${bad.length} on a road's lanes`,
    );
    expect(bad.slice(0, 8)).toEqual([]);
    expect(specs.length).toBeGreaterThan(500);
    // Control: the same check finds a box planted on the lanes.
    const e = wf.edges[0];
    if (!e) throw new Error('no edge');
    const c = wf.toWorld(0, 30, (e.dMin + e.dMax) / 2, 0);
    expect(onLanes({ edge: 0, foot: { x: c.x, z: c.z, ux: 1, uz: 0, hu: 3, hv: 3 } }).length).toBeGreaterThan(
      0,
    );
  });
});
