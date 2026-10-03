// San Francisco's waterfront (run W-U; the pitch deck's #8: "the waterfront (palms, piers, sea lions,
// an invented clock-tower ferry building)"). The checks plan the real baked network with the real
// palm, car and boat GLBs and look at what stands where: the pier sheds and the ferry hall with their
// fronts on the sim's hard edge at the seawall, numbered even before the hall and odd after it; the
// four clocks each at their own time; the city blocks' fronts on the sidewalk's hard edge and never
// across a side street; nothing on the road or in a sign's, a pad's or a lot's way; the sea lions
// only on their stretch of water; the seawall's land and its sheer drop; and the layer's cost.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { readGlb } from './glb';
import { createFlatLook } from './look';
import { bakeModel, MODEL_ASSETS, modelKindsFor, type SceneryModels } from './models';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import { SEAWALL_LAND_M, themeAt } from './scenery';
import { VergeLayer } from './verge';
import {
  BLOCK_WIDTH,
  CLOCK_TIMES,
  EVEN_PIERS,
  fontCovers,
  hasWaterfront,
  ODD_PIERS,
  planWaterfront,
  TOWER_TOP_M,
  WATERFRONT_DRAW_M,
  WaterfrontLayer,
  type WaterfrontPlan,
} from './waterfront';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
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

async function readRepoFile(rel: string): Promise<ArrayBuffer> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const buf = fs.readFileSync(rel);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const wf = track('sf-waterfront');
const needs = (id: string) => {
  const { road, dressing } = track(id);
  const { tropical, tags } = networkTags(road, dressing);
  return modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
};
const MODELS: SceneryModels = {};
for (const k of needs('sf-waterfront'))
  MODELS[k] = bakeModel(k, readGlb(await readRepoFile(`packs/base/assets/${MODEL_ASSETS[k]}.glb`)));
const plan: WaterfrontPlan = planWaterfront({ road: wf.road, dressing: wf.dressing, seed: 7 }, MODELS);
const byRule = (rule: string) => plan.items.filter((i) => i.rule === rule);
const tagsOf = (edge: number) => wf.road.edges[edge]?.tags ?? [];
const has = (edge: number, side: 'left' | 'right', s: number, tag: string) =>
  tagsOf(edge).some((t) => t.tag === tag && (t.side === side || t.side === 'both') && s >= t.s0 && s <= t.s1);
/** An item's footprint along x of its own frame (its width along the road for a block). */
const widthOf = (it: { geometry: { boundingBox: unknown; computeBoundingBox(): void } }) => {
  it.geometry.computeBoundingBox();
  const b = it.geometry.boundingBox as { min: { x: number }; max: { x: number } };
  return b.max.x - b.min.x;
};

describe('San Francisco waterfront: what stands along the bay', () => {
  it('loads the palms and the city kit for the waterfront only, and draws on no other network', () => {
    expect(needs('sf-waterfront')).toEqual(expect.arrayContaining(['palms', 'sfRoadside']));
    expect(needs('sf-hills')).not.toContain('palms');
    expect(needs('sf-downtown')).not.toContain('palms');
    for (const id of ['sf-hills', 'sf-downtown', 'keys-m1', 'pnw-c1']) {
      const { road, dressing } = track(id);
      expect(hasWaterfront(networkTags(road, dressing).tags), id).toBe(false);
    }
    expect(hasWaterfront(networkTags(wf.road, wf.dressing).tags)).toBe(true);
  });

  it('numbers the piers even before the ferry hall and odd past it, every front on the hard edge at the seawall', () => {
    const halls = plan.frontages.filter((f) => f.kind === 'hall');
    expect(halls).toHaveLength(1);
    const order = plan.frontages.map((f) => (f.kind === 'hall' ? 'hall' : String(f.pier)));
    print(`[examined] ${plan.frontages.length} frontages on the seawall, in order: ${order.join(' ')}`);
    const at = order.indexOf('hall');
    const before = plan.frontages.slice(0, at).map((f) => f.pier);
    const after = plan.frontages.slice(at + 1).map((f) => f.pier);
    expect(before.length).toBeGreaterThanOrEqual(6);
    expect(after.length).toBeGreaterThanOrEqual(6);
    // Even, falling toward the hall; odd, rising past it; none repeated.
    expect(before).toEqual([...EVEN_PIERS.slice(0, before.length)].reverse());
    expect(after).toEqual(ODD_PIERS.slice(0, after.length));
    for (const f of plan.frontages) {
      for (const s of [f.s0 + 1, (f.s0 + f.s1) / 2, f.s1 - 1]) {
        const v = wf.road.vergeAt(f.edge, s, 'right');
        expect(v.edge, `${f.kind} ${f.pier} s ${s}`).toBe('hard');
        expect(Math.abs(v.dOuter - f.d)).toBeLessThan(0.05);
      }
    }
    for (const f of plan.frontages) expect(fontCovers(`PIER ${f.pier}`)).toBe(true);
    for (const w of ['FERRIES', 'STEALTH', 'CRAB', 'HOTEL', 'PARK']) expect(fontCovers(w), w).toBe(true);
  });

  it('the clock tower stands over the hall, its four clocks each telling a different time', () => {
    const hall = byRule('ferry-hall')[0];
    if (!hall) throw new Error('no ferry hall');
    hall.geometry.computeBoundingBox();
    const top = (hall.geometry.boundingBox as { max: { y: number } }).max.y;
    expect(top).toBeCloseTo(TOWER_TOP_M, 0);
    expect(new Set(CLOCK_TIMES.map(([h, m]) => `${h}:${m}`)).size).toBe(4);
  });

  it('the city blocks: fronts on the sidewalk hard edge, packed along it, never across a side street', () => {
    const blocks = plan.items.filter((i) => i.rule.startsWith('block-'));
    const kinds = new Set(blocks.map((b) => b.rule));
    let frontage = 0;
    let onEdge = 0;
    for (const b of blocks) {
      const w = widthOf(b);
      const v = wf.road.vergeAt(b.edge, b.s, 'left');
      if (v.edge === 'hard') {
        onEdge++;
        expect(Math.abs(b.d - v.dOuter), `${b.rule} at ${b.s.toFixed(0)}`).toBeLessThan(0.05);
        frontage += w;
      }
      // Never across a side street's mouth.
      for (const t of tagsOf(b.edge).filter((x) => x.tag === 'wharf-street'))
        expect(
          b.s + w / 2 <= t.s0 + 0.01 || b.s - w / 2 >= t.s1 - 0.01,
          `${b.rule} at ${b.s.toFixed(0)}`,
        ).toBe(true);
    }
    // Hard frontage along the route (2 m stations on the city side).
    let hard = 0;
    for (const e of wf.road.edges)
      for (let s = 0; s < e.length; s += 2)
        if (wf.road.vergeAt(e.index, s, 'left').edge === 'hard') hard += 2;
    print(
      `[examined] ${blocks.length} city blocks (${onEdge} on the hard edge), kinds ${[...kinds].sort().join(', ')}; frontage ${frontage.toFixed(0)} of ${hard} m (${((100 * frontage) / hard).toFixed(1)} %)`,
    );
    expect(kinds.size).toBeGreaterThanOrEqual(5);
    expect(frontage / hard).toBeGreaterThan(0.8);
    for (const [kind, [lo, hi]] of Object.entries(BLOCK_WIDTH)) expect(hi, kind).toBeGreaterThanOrEqual(lo);
    expect(plan.streets.length).toBe(9);
    expect(byRule('street-block').length).toBeGreaterThan(plan.streets.length * 6);
    expect(byRule('back-tower').length).toBeGreaterThan(20);
  });

  it('nothing stands on the road or in a sign, a pad, a zone, a truck or a lot', () => {
    const keep = new Set(['billboard', 'boostPad', 'rampTruck', 'roadsideZone', 'copSpawn']);
    let checked = 0;
    for (const it of plan.items) {
      const e = wf.road.edges[it.edge]!;
      expect(Math.abs(it.d), `${it.rule} at ${it.s.toFixed(0)}`).toBeGreaterThan(
        Math.max(-e.dMin, e.dMax) + 0.5,
      );
      if (
        ['palm', 'lamp', 'bench', 'sidewalk-lamp', 'plaza-palm', 'plaza-bench', 'parked-car'].includes(
          it.rule,
        )
      ) {
        for (const f of e.features.filter((x) => keep.has(x.kind))) {
          const inside =
            it.s > Math.min(f.s0, f.s1) - 0.5 &&
            it.s < Math.max(f.s0, f.s1) + 0.5 &&
            it.d > Math.min(f.d0, f.d1) - 0.5 &&
            it.d < Math.max(f.d0, f.d1) + 0.5;
          expect(inside, `${it.rule} at ${it.s.toFixed(0)} in ${f.id}`).toBe(false);
        }
        checked++;
      }
    }
    print(
      `[examined] ${plan.items.length} items off the road; ${checked} small items clear of every feature`,
    );
    expect(checked).toBeGreaterThan(150);
  });

  it('the promenade: palms, lamps and benches on its paving, sea lions only on their water, boats off the seawall', () => {
    for (const rule of ['palm', 'lamp', 'bench']) {
      const list = byRule(rule);
      expect(list.length, rule).toBeGreaterThan(rule === 'bench' ? 20 : 60);
      for (const it of list) {
        const v = wf.road.vergeAt(it.edge, it.s, 'right');
        expect(it.d, `${rule} at ${it.s.toFixed(0)}`).toBeGreaterThan(v.dInner);
        expect(it.d).toBeLessThan(v.dOuter);
      }
    }
    const lions = byRule('sea-lions');
    expect(lions.length).toBeGreaterThanOrEqual(3);
    for (const it of lions) {
      expect(has(it.edge, 'right', it.s, 'sea-lions')).toBe(true);
      expect(it.d).toBeGreaterThan(wf.road.vergeAt(it.edge, it.s, 'right').dOuter + 10);
    }
    for (const it of byRule('boat')) {
      expect(has(it.edge, 'right', it.s, 'sea-lions')).toBe(false);
      expect(it.d).toBeGreaterThan(wf.road.vergeAt(it.edge, it.s, 'right').dOuter + 4);
    }
    expect(byRule('parked-car').length).toBeGreaterThan(20);
    expect(byRule('plaza-palm').length).toBeGreaterThan(10);
    const counts = Object.fromEntries(
      [...new Set(plan.items.map((i) => i.rule))].sort().map((r) => [r, byRule(r).length]),
    );
    print(`[examined] items by rule: ${JSON.stringify(counts)}`);
  });

  it('the seawall: the promenade land ends at the water edge and drops sheer, with no shallows drawn', () => {
    const scene = buildRoadScene(wf.road, look, wf.dressing, { seed: 7 });
    const wall = SEAWALL_LAND_M.promenade ?? 0;
    let promenade = 0;
    let city = 0;
    for (const e of wf.road.edges) {
      for (let s = 4; s < e.length - 4; s += 10) {
        if (themeAt(e.tags, 'right', s) === 'promenade') {
          promenade++;
          expect(scene.landReach(e.index, 1, s)).toBeCloseTo(wall, 5);
          const v = wf.road.vergeAt(e.index, s, 'right');
          // The drawn land's edge is the band's: the verge 0.6 m, then the strip.
          expect(v.dOuter - (e.dMax + 0.6 + wall)).toBeCloseTo(0, 3);
        }
        if (themeAt(e.tags, 'left', s) === 'wharf') {
          city++;
          expect(scene.landReach(e.index, -1, s)).toBeGreaterThan(wall);
        }
      }
    }
    scene.dispose();
    const verge = new VergeLayer(wf.road, look, { tags: networkTags(wf.road, wf.dressing).tags });
    const shallows = verge.counts().shallowsM;
    verge.dispose();
    print(
      `[examined] ${promenade} promenade stations at the seawall, ${city} city stations; shallows drawn ${shallows} m`,
    );
    expect(promenade).toBeGreaterThan(250);
    expect(city).toBeGreaterThan(250);
    expect(shallows).toBe(0);
  });

  it('the same seed plans the same waterfront; another seed moves the palms and the blocks', () => {
    const again = planWaterfront({ road: wf.road, dressing: wf.dressing, seed: 7 }, MODELS);
    const key = (p: WaterfrontPlan) =>
      p.items.map((i) => `${i.rule}@${i.s.toFixed(2)}/${i.d.toFixed(2)}`).join(',');
    expect(key(again)).toBe(key(plan));
    const other = planWaterfront({ road: wf.road, dressing: wf.dressing, seed: 8 }, MODELS);
    expect(key(other)).not.toBe(key(plan));
    // The piers and their numbers are the network's, not the seed's.
    expect(other.frontages.map((f) => f.pier)).toEqual(plan.frontages.map((f) => f.pier));
  });

  it('keeps off the ground a staged scene stands on', () => {
    const palm = byRule('palm')[3];
    if (!palm) throw new Error('no palm');
    const held = planWaterfront(
      { road: wf.road, dressing: wf.dressing, seed: 7, reserved: [{ x: palm.p.x, z: palm.p.z, r: 3 }] },
      MODELS,
    );
    expect(
      held.items.some((i) => i.rule === 'palm' && Math.hypot(i.p.x - palm.p.x, i.p.z - palm.p.z) < 3),
    ).toBe(false);
  });

  it('draws a few meshes near the camera, inside the still scene budget, and frees them when it has gone', () => {
    const layer = new WaterfrontLayer(MODELS, look, { road: wf.road, dressing: wf.dressing, seed: 7 });
    let maxMeshes = 0;
    let maxTris = 0;
    let views = 0;
    for (const e of wf.road.edges) {
      for (let s = 10; s < e.length; s += 50) {
        const p = wf.road.toWorld(e.index, s, 0, 0);
        layer.update(p.x, p.z, 200, WATERFRONT_DRAW_M, 1000);
        const c = layer.counts();
        maxMeshes = Math.max(maxMeshes, c.meshes);
        maxTris = Math.max(maxTris, c.triangles);
        views++;
      }
    }
    const c = layer.counts();
    print(
      `[examined] ${views} camera points: at most ${maxMeshes} meshes and ${maxTris} triangles in range (before frustum culling); ${c.stretches} blocks and stretches`,
    );
    // Before frustum culling (tools: scene-cost.test.ts counts the still scene as drawn).
    expect(maxMeshes).toBeLessThanOrEqual(32);
    expect(maxTris).toBeLessThan(70_000);
    layer.update(1e7, 1e7, 200, WATERFRONT_DRAW_M, 1000);
    expect(layer.counts().meshes).toBe(0);
    layer.dispose();
  });
});
