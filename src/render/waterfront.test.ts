// San Francisco's waterfront (run W-U; the pitch deck's #8: "the waterfront (palms, piers, sea lions,
// an invented clock-tower ferry building)"). The checks plan the real baked network with the real
// palm, car and boat GLBs and look at what stands where: the pier sheds and the ferry hall with their
// fronts on the sim's hard edge at the seawall, numbered even before the hall and odd after it; the
// four clocks each at their own time; the city blocks' fronts on the sidewalk's hard edge and never
// across a side street; nothing on the road or in a sign's, a pad's or a lot's way; the sea lions
// only on their stretch of water; the seawall's land and its sheer drop; and the layer's cost.
import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import {
  createRoadNetwork,
  loadWaterfrontLayout,
  planStreetFurniture,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import { readGlb } from './glb';
import { createFlatLook } from './look';
import { bakeModel, MODEL_ASSETS, modelKindsFor, type SceneryModels } from './models';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import { ridableBandPast, SEAWALL_LAND_M, themeAt } from './scenery';
import { VergeLayer } from './verge';
import golden from './golden/waterfront-before-the-port.json';
import {
  CLOCK_TIMES,
  fontCovers,
  hasWaterfront,
  FRONT_ONLY,
  Shape,
  planWaterfront,
  TOWER_TOP_M,
  WATERFRONT_DRAW_M,
  WATERFRONT_COLOURS,
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
// Where the buildings stand is road/structures/waterfront.ts's plan, a lazy chunk of its own.
const { waterfrontLayout, BLOCK_WIDTH, EVEN_PIERS, ODD_PIERS } = await loadWaterfrontLayout();
const inputOf = (seed: number) => ({ road: wf.road, seed, layout: waterfrontLayout(wf.road, seed) });
const needs = (id: string) => {
  const { road, dressing } = track(id);
  const { tropical, tags } = networkTags(road, dressing);
  return modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
};
const MODELS: SceneryModels = {};
for (const k of needs('sf-waterfront'))
  MODELS[k] = bakeModel(k, readGlb(await readRepoFile(`packs/base/assets/${MODEL_ASSETS[k]}.glb`)));
const plan: WaterfrontPlan = planWaterfront(inputOf(7), MODELS);
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

type SignPoint = readonly [number, number, number];
/** Front-facing triangles in the raised middle, excluding its cornice and lower trim. */
function signPoints(geometry: BufferGeometry, colour: string): SignPoint[] {
  const p = geometry.getAttribute('position');
  const n = geometry.getAttribute('normal');
  const c = geometry.getAttribute('color');
  const rgb = [1, 3, 5].map((offset) => parseInt(colour.slice(offset, offset + 2), 16) / 255);
  const points: SignPoint[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const vertices = [i, i + 1, i + 2];
    if (
      vertices.every(
        (v) =>
          n.getZ(v) > 0.99 &&
          p.getY(v) > 10.4 &&
          p.getY(v) <= 13 &&
          Math.abs(c.getX(v) - rgb[0]!) < 1e-6 &&
          Math.abs(c.getY(v) - rgb[1]!) < 1e-6 &&
          Math.abs(c.getZ(v) - rgb[2]!) < 1e-6,
      )
    )
      for (const v of vertices) points.push([p.getX(v), p.getY(v), p.getZ(v)]);
  }
  return points;
}

function signChecks(backing: readonly SignPoint[], letters: readonly SignPoint[], width: number) {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;
  const numbers = letters.filter(([x]) => x > 0);
  return {
    coverage:
      backing.length === 6 &&
      near(Math.min(...backing.map(([x]) => x)), -6) &&
      near(Math.max(...backing.map(([x]) => x)), 6) &&
      near(Math.min(...backing.map(([, y]) => y)), 10.45) &&
      near(Math.max(...backing.map(([, y]) => y)), 12.95),
    height:
      numbers.length > 0 &&
      near(Math.min(...numbers.map(([, y]) => y)), 10.55) &&
      near(Math.max(...numbers.map(([, y]) => y)), 12.85),
    depth:
      backing.length > 0 &&
      letters.length > 0 &&
      backing.every(([, , z]) => near(z, 0.08)) &&
      letters.every(([, , z]) => near(z, 0.14)),
    fit:
      letters.length > 0 &&
      [...backing, ...letters].every(
        ([x, y]) => Math.abs(x) <= 6 && Math.abs(x) < width * 0.2 && y > 10.4 && y < 13,
      ) &&
      letters.every(([, y]) => y >= 10.45 && y <= 12.95),
  };
}

function expectedSign(pier: number): Shape {
  const sign = new Shape();
  sign.box([12, 2.5, 0.04], [0, 11.7, 0.06], WATERFRONT_COLOURS.pierText, { omit: FRONT_ONLY });
  sign.text('PIER', -2.1, 11.075, 0.12, 0.25, WATERFRONT_COLOURS.shedTrim);
  sign.text(String(pier), 2.1, 10.55, 0.12, 0.46, WATERFRONT_COLOURS.shedTrim);
  return sign;
}

describe('San Francisco waterfront: what stands along the bay', () => {
  it('gives every planned pier an ivory label and taller number on a fitted dark backing', () => {
    let examined = 0;
    for (const seed of [7, 8]) {
      const input = inputOf(seed);
      const drawn = planWaterfront(input, MODELS);
      const sheds = input.layout.fronts.filter((f) => f.kind === 'shed');
      expect(sheds.length).toBeGreaterThan(0);
      for (const f of sheds) {
        const item = drawn.items.find((i) => i.rule === f.rule && i.edge === f.edge && i.s === f.s);
        if (!item) throw new Error(`missing pier ${f.pier}`);
        const backing = signPoints(item.geometry, WATERFRONT_COLOURS.pierText);
        const letters = signPoints(item.geometry, WATERFRONT_COLOURS.shedTrim);
        expect(signChecks(backing, letters, f.width), `seed ${seed}, pier ${f.pier}`).toEqual({
          coverage: true,
          height: true,
          depth: true,
          fit: true,
        });
        const expected = expectedSign(f.pier).geometry();
        expect(letters).toEqual(signPoints(expected, WATERFRONT_COLOURS.shedTrim));
        expect(backing).toEqual(signPoints(expected, WATERFRONT_COLOURS.pierText));
        const old = new Shape();
        old.text(`PIER ${f.pier}`, 0, 10.8, 0.05, 0.42, WATERFRONT_COLOURS.pierText);
        expect(expected.getAttribute('position').count / 3 - old.triangles).toBe(2);
        expected.dispose();
        examined++;
      }
    }
    print(
      `[examined] ${examined} seeded pier signs: exact source numbers, contrast, height, depth, fit; two added panel triangles per shed`,
    );
  });

  it('sign controls reject old number height, missing backing, behind-wall letters and escaped letters', () => {
    const geometry = expectedSign(12).geometry();
    const backing = signPoints(geometry, WATERFRONT_COLOURS.pierText);
    const letters = signPoints(geometry, WATERFRONT_COLOURS.shedTrim);
    expect(Object.values(signChecks(backing, letters, 40))).toEqual([true, true, true, true]);
    const oldHeight = letters.map(([x, y, z]): SignPoint => [
      x,
      x > 0 ? 10.55 + ((y - 10.55) * 2.1) / 2.3 : y,
      z,
    ]);
    expect(signChecks(backing, oldHeight, 40).height).toBe(false);
    expect(signChecks([], letters, 40).coverage).toBe(false);
    expect(
      signChecks(
        backing,
        letters.map(([x, y]): SignPoint => [x, y, -0.1]),
        40,
      ).depth,
    ).toBe(false);
    expect(
      signChecks(
        backing,
        letters.map(([x, y, z]): SignPoint => [x + 10, y, z]),
        40,
      ).fit,
    ).toBe(false);
    geometry.dispose();
  });

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
    const again = planWaterfront(inputOf(7), MODELS);
    const key = (p: WaterfrontPlan) =>
      p.items.map((i) => `${i.rule}@${i.s.toFixed(2)}/${i.d.toFixed(2)}`).join(',');
    expect(key(again)).toBe(key(plan));
    const other = planWaterfront(inputOf(8), MODELS);
    expect(key(other)).not.toBe(key(plan));
    // The piers and their numbers are the network's, not the seed's.
    expect(other.frontages.map((f) => f.pier)).toEqual(plan.frontages.map((f) => f.pier));
  });

  it('draws the street furniture the sim meets, and no staged scene can stand among it', () => {
    // Playtest 4 ("solid but forgiving"): the palms, lamps, benches and the lot's cars are road/furniture.ts's
    // plan, which the sim meets; this layer draws exactly that plan.
    const key = (i: { rule: string; edge: number; s: number; d: number }) =>
      `${i.rule}:${i.edge}:${i.s.toFixed(2)}:${i.d.toFixed(2)}`;
    const planned = planStreetFurniture(wf.road, 7).items.filter((i) => i.layer === 'waterfront');
    const rules = new Set(planned.map((i) => i.rule));
    const drawn = plan.items.filter((i) => rules.has(i.rule));
    print(`[examined] ${planned.length} planned pieces (${[...rules].join(', ')}), ${drawn.length} drawn`);
    expect(planned.length).toBeGreaterThan(200);
    expect(drawn.map(key).sort()).toEqual(planned.map(key).sort());
    // A staged scene stands past the ridable band (render/scenery.ts `ridableBandPast`): on the promenade
    // that is the seawall's 12 m of paving, then the water, so no scene stands where a palm does.
    let checked = 0;
    for (const e of wf.road.edges)
      for (let s = 5; s < e.length; s += 25)
        if (has(e.index, 'right', s, 'promenade')) {
          checked++;
          expect(ridableBandPast(wf.road, e.index, 1, s, e.dMax + 0.6)).toBeGreaterThan(11);
        }
    expect(checked).toBeGreaterThan(20);
  });

  it('draws a few meshes near the camera, inside the still scene budget, and frees them when it has gone', () => {
    const layer = new WaterfrontLayer(MODELS, look, inputOf(7));
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

describe('the waterfront after the port (the physical world, 2026-10-06): placed by the road, drawn as before', () => {
  // `golden` is what origin/main (00d41c9f) drew for the moved rules: each row is [rule, edge, s, d, x, y, z, turn,
  // size, then its geometry's bounding box min xyz, max xyz], at seeds 7 and 8 (the seeds the tests here use),
  // rounded to a millimetre. The port changed the math the placement uses (road/ has core's sin, cos and atan2, and
  // no hypot), and nothing else: the picture is the same within the tolerances below.
  const POSITION_TOL_M = 0.01;
  const TURN_TOL = 0.001;
  const BOX_TOL_M = 0.01;
  const MOVED = (r: string) =>
    r === 'pier-shed' ||
    r === 'ferry-hall' ||
    r.startsWith('block-') ||
    r === 'back-tower' ||
    r === 'street-block';

  type Row = readonly [string, number, number, number, number, number, number, number, number, ...number[]];
  /** A golden row: its fields joined by commas (a rule's name, then numbers). */
  const parse = (s: string): Row => {
    const [rule = '', ...numbers] = s.split(',');
    return [rule, ...numbers.map(Number)] as unknown as Row;
  };
  const goldenOf = (seed: number) =>
    (
      golden as unknown as Record<
        string,
        { rows: string[]; frontages: string[]; streets: string[]; others: Record<string, number> }
      >
    )[`seed${seed}`]!;
  const rowsOf = (seed: number): Row[] =>
    planWaterfront(inputOf(seed), MODELS)
      .items.filter((i) => MOVED(i.rule))
      .map((it) => {
        it.geometry.computeBoundingBox();
        const b = it.geometry.boundingBox;
        if (!b) throw new Error('no box');
        return [
          it.rule,
          it.edge,
          it.s,
          it.d,
          it.p.x,
          it.p.y,
          it.p.z,
          it.turn,
          it.size,
          b.min.x,
          b.min.y,
          b.min.z,
          b.max.x,
          b.max.y,
          b.max.z,
        ];
      });
  /** How a field of a row is held: its tolerance. */
  const tolOf = (k: number) => (k === 7 ? TURN_TOL : k === 8 ? 0.001 : k <= 6 ? POSITION_TOL_M : BOX_TOL_M);
  /** The worst gap between two lists of rows as a share of its tolerance (1 is the line), and where. */
  function compare(now: readonly Row[], was: readonly Row[]): { worst: number; why: string } {
    if (now.length !== was.length) return { worst: Infinity, why: `${now.length} rows, was ${was.length}` };
    const key = (r: Row) => `${r[0]}:${r[1]}:${r[2].toFixed(2)}:${r[3].toFixed(2)}`;
    const byKey = (rows: readonly Row[]) =>
      [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    const a = byKey(now);
    const b = byKey(was);
    let worst = 0;
    let why = '';
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!;
      const y = b[i]!;
      if (x[0] !== y[0] || x[1] !== y[1]) return { worst: Infinity, why: `row ${i}: ${x[0]} vs ${y[0]}` };
      for (let k = 2; k < x.length; k++) {
        const ratio = Math.abs((x[k] as number) - (y[k] as number)) / tolOf(k);
        if (ratio > worst) {
          worst = ratio;
          why = `${key(x)} field ${k}`;
        }
      }
    }
    return { worst, why };
  }

  it('draws every pier shed, the hall, block, tower and street block where and as tall as main drew it', () => {
    let rows = 0;
    for (const seed of [7, 8]) {
      const was = goldenOf(seed).rows.map(parse);
      const now = rowsOf(seed);
      const { worst, why } = compare(now, was);
      rows += now.length;
      expect(worst, `seed ${seed}: ${why}`).toBeLessThanOrEqual(1);
    }
    print(
      `[examined] ${rows} moved items (sheds, hall, blocks, towers, street blocks) at seeds 7 and 8 against main's drawing: position, size and geometry bounds within a centimetre, turns within a milliradian`,
    );
    expect(rows).toBeGreaterThan(500);
  });

  it('control: a block moved a metre, or a tower a metre taller, is found', () => {
    const was = goldenOf(7).rows.map(parse);
    const now = rowsOf(7);
    const moved = now.map((r, i): Row =>
      i === 3 ? ([r[0], r[1], r[2], r[3], r[4] + 1, ...r.slice(5)] as unknown as Row) : r,
    );
    expect(compare(moved, was).worst).toBeGreaterThan(1);
    const tall = now.map((r, i): Row =>
      r[0] === 'back-tower' && i === now.findIndex((q) => q[0] === 'back-tower')
        ? ([...r.slice(0, 13), r[13]! + 1, r[14]!] as unknown as Row)
        : r,
    );
    expect(compare(tall, was).worst).toBeGreaterThan(1);
  });

  it('the other items (palms, lamps, benches, cars, floats, boats) are as many as main drew', () => {
    for (const seed of [7, 8]) {
      const was = goldenOf(seed).others;
      const counts: Record<string, number> = {};
      for (const i of planWaterfront(inputOf(seed), MODELS).items)
        if (!MOVED(i.rule)) counts[i.rule] = (counts[i.rule] ?? 0) + 1;
      expect(counts).toEqual(was);
    }
  });

  it("keeps the piers' numbers and the side streets where main had them", () => {
    for (const seed of [7, 8]) {
      const p = planWaterfront(inputOf(seed), MODELS);
      const g = goldenOf(seed);
      const fronts = p.frontages.map(
        (f) => `${f.kind},${f.edge},${f.s0.toFixed(3)},${f.s1.toFixed(3)},${f.d.toFixed(3)},${f.pier}`,
      );
      const was = g.frontages.map((s) => {
        const [k = '', ...n] = s.split(',');
        const [edge = 0, s0 = 0, s1 = 0, d = 0, pier = 0] = n.map(Number);
        return `${k},${edge},${s0.toFixed(3)},${s1.toFixed(3)},${d.toFixed(3)},${pier}`;
      });
      expect(fronts).toEqual(was);
      expect(p.streets.map((q) => `${q.edge},${q.s.toFixed(3)}`)).toEqual(
        g.streets.map((s) => {
          const [edge = 0, at = 0] = s.split(',').map(Number);
          return `${edge},${at.toFixed(3)}`;
        }),
      );
    }
  });

  it('plans the same before and after any model loads: the layout reads the network and the seed only', () => {
    const bare = planWaterfront(inputOf(7), {});
    const key = (p: WaterfrontPlan) =>
      p.items
        .filter((i) => MOVED(i.rule))
        .map((i) => `${i.rule}@${i.s.toFixed(3)}/${i.d.toFixed(3)}/${i.p.y.toFixed(3)}`)
        .join(',');
    expect(key(bare)).toBe(key(plan));
    expect(bare.frontages).toEqual(plan.frontages);
  });

  it("reads the road files' own tags and features: render's `dressing` was the network's, field for field", () => {
    let edges = 0;
    for (const e of wf.road.edges) {
      const baked = wf.dressing?.[e.id];
      if (!baked) throw new Error(`no road file for ${e.id}`);
      expect(baked.tags ?? [], e.id).toEqual(e.tags);
      // The network sorts an edge's features by s0; the plan only asks whether one lies somewhere, never in what order.
      const byId = (list: readonly { id?: string | undefined }[]) =>
        [...list].sort((a, b) => ((a.id ?? '') < (b.id ?? '') ? -1 : 1));
      expect(byId(baked.features ?? []), e.id).toEqual(byId(e.features));
      edges++;
    }
    print(`[examined] ${edges} waterfront edges: the road files' tags and features equal the network's`);
    expect(edges).toBeGreaterThanOrEqual(5);
  });
});
