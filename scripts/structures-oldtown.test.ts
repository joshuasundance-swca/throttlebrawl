// Old Town's street fronts are a structure plan (road/structures/oldtown.ts; the physical world, the maintainer,
// 2026-10-06: "consistent physics and gameplay is important here so players know what to expect"): the plan
// stands each building where render's street-front rule stood it, render draws the plan, and the plan's solids
// are what is drawn. Every case derives from the lane's acceptance: no visual change (held to what main drew,
// src/render/structures.golden.json), the plan the same before and after the models load and at any density,
// render drawing the plan, and each structure held to its drawn bounds, with a negative control each.
import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  OLDTOWN_RULES,
  planOldTown,
  planStructures,
  STRUCTURE_LAYERS,
  type OldTownFront,
  type StructureSpec,
} from '../src/road';
import { frontStructures, planner as oldTownPlanner } from '../src/road/structures/oldtown';
import { createFlatLook } from '../src/render/look';
import { landmarkFootprints } from '../src/render/landmarks';
import { bakeRepoModel } from '../src/render/model-files.test-util';
import { buildRoadScene } from '../src/render/road-mesh';
import { KEYS_KIT, scatterRoadside, type RoadsideItem } from '../src/render/roadside';
import golden from '../src/render/structures.golden.json';
import { holds, print, surfacePoints, track, type Solid } from '../src/render/structures.test-util';

const look = createFlatLook();
const NETWORK = 'osm-keys-duval';
const CODE: Readonly<Record<string, string>> = {
  'oldtown-front': 'f',
  'oldtown-bar': 'k',
  'oldtown-back': 'b',
};
/** How far a building may sit from where main drew it, along the road and across it, cm (its rows are in cm). */
const PLACE_TOLERANCE_CM = 1;

interface Fingerprint {
  count: Record<string, number>;
  sumS: number;
  sumD: number;
  sumV: number;
  rows?: string[];
}
const GOLDEN = golden.fronts.seeds as Readonly<Record<string, Fingerprint>>;
const SEEDS = Object.keys(GOLDEN).map(Number);

const models = {
  keysRoadside: await bakeRepoModel('keysRoadside'),
  duvalKit: await bakeRepoModel('duvalKit'),
  keysIdentity: await bakeRepoModel('keysIdentity'),
};

/** A plan's fronts against main's: their counts by rule, their sums, and seed 7's every building. */
function against(
  fronts: readonly { rule: string; variant: number; edge: number; s: number; d: number }[],
  seed: number,
) {
  const want = GOLDEN[seed];
  if (!want) throw new Error(`no golden for seed ${seed}`);
  const count: Record<string, number> = {};
  for (const f of fronts) count[f.rule] = (count[f.rule] ?? 0) + 1;
  const sumS = fronts.reduce((n, f) => n + f.s, 0);
  const sumD = fronts.reduce((n, f) => n + Math.abs(f.d), 0);
  const sumV = fronts.reduce((n, f) => n + f.variant, 0);
  const off: string[] = [];
  if (JSON.stringify(count) !== JSON.stringify(want.count)) off.push(`counts ${JSON.stringify(count)}`);
  if (Math.abs(sumS - want.sumS) > 0.01) off.push(`sum of s ${sumS.toFixed(3)} vs ${want.sumS}`);
  if (Math.abs(sumD - want.sumD) > 0.01) off.push(`sum of |d| ${sumD.toFixed(3)} vs ${want.sumD}`);
  if (sumV !== want.sumV) off.push(`sum of variants ${sumV} vs ${want.sumV}`);
  if (want.rows) {
    const rows = want.rows.map((r) => r.split(' '));
    fronts.forEach((f, i) => {
      const [kind = '', edge = '', s = '', d = ''] = rows[i] ?? [];
      const same =
        kind === `${CODE[f.rule] ?? '?'}${f.variant}` &&
        Number(edge) === f.edge &&
        Math.abs(Number(s) - f.s * 100) <= PLACE_TOLERANCE_CM &&
        Math.abs(Number(d) - f.d * 100) <= PLACE_TOLERANCE_CM;
      if (!same && off.length < 8)
        off.push(
          `building ${i}: ${CODE[f.rule]}${f.variant} ${f.edge} ${f.s} ${f.d} vs ${rows[i]?.join(' ')}`,
        );
    });
  }
  return off;
}

/** Render's scatter as render/index.ts runs it for the race, with the drawn land, at a density. */
function scattered(seed: number, density: number, opts: { land?: boolean; models?: boolean } = {}) {
  const { road, dressing } = track(NETWORK);
  const built = buildRoadScene(road, look, dressing, { seed, roadsideDensity: density, models });
  const items = scatterRoadside({
    road,
    dressing,
    seed,
    density,
    kit: KEYS_KIT,
    landReach: opts.land === false ? () => 0 : (e, side, s) => built.landReach(e, side, s),
    landTop: (e, side, s, across) => built.landTop(e, side, s, across),
    spots: opts.land === false ? [] : built.spots,
    reserved: landmarkFootprints(road),
    models: opts.models === false ? { keysRoadside: models.keysRoadside } : models,
  });
  built.dispose();
  return { road, items };
}

const frontsOf = (items: readonly RoadsideItem[]) => items.filter((it) => it.foot);

describe("Old Town's street fronts stand where main drew them (no visual change)", () => {
  it.each(SEEDS)('seed %i: the plan stands every building where render stood it', (seed) => {
    const { road } = track(NETWORK);
    const fronts = planOldTown(road, seed).fronts;
    const off = against(fronts, seed);
    print(
      `[examined] ${NETWORK} seed ${seed}: ${fronts.length} buildings of the plan against main's ${Object.values(
        GOLDEN[seed]?.count ?? {},
      ).reduce(
        (a, b) => a + b,
        0,
      )}${GOLDEN[seed]?.rows ? ', each within 1 cm' : ' (counts by rule and sums)'}; ${off.length} differences`,
    );
    expect(off).toEqual([]);
  });

  it('render draws the plan: the scatter stands the same buildings at the same places, turned the same way', () => {
    const seed = 7;
    const { road, items } = scattered(seed, 1);
    const drawn = frontsOf(items);
    const plan = planOldTown(road, seed).fronts;
    // Render stands each rule's buildings in the rule's turn, edge by edge: the same set, in its own order.
    const key = (f: { rule: string; edge: number; s: number; d: number }) =>
      `${f.rule} ${f.edge} ${f.s} ${f.d}`;
    const byKey = new Map(plan.map((f) => [key(f), f]));
    const bad: string[] = [];
    for (const it of drawn) {
      const f = byKey.get(key(it));
      if (!f) bad.push(`drawn, not planned: ${key(it)}`);
      else if (
        f.variant !== it.variant ||
        f.turn !== it.turn ||
        f.p.x !== it.p.x ||
        f.p.y !== it.p.y ||
        f.p.z !== it.p.z
      )
        bad.push(`drawn otherwise than planned: ${key(it)}`);
    }
    print(
      `[examined] ${NETWORK} seed ${seed}: ${drawn.length} drawn street-front buildings against ${plan.length} planned`,
    );
    expect(drawn.length).toBe(plan.length);
    expect(bad.slice(0, 8)).toEqual([]);
    expect(against(drawn, seed)).toEqual([]);
  }, 120_000);

  it('a negative control: a front row with other gaps stands elsewhere, and the comparison says so', () => {
    const { road } = track(NETWORK);
    const rules = OLDTOWN_RULES.map((r) =>
      r.id === 'oldtown-front' ? { ...r, frontage: { ...r.frontage, gap: [0.6, 3.2] as const } } : r,
    );
    const moved = planOldTown(road, 7, rules).fronts;
    expect(against(moved, 7).length).toBeGreaterThan(0);
  });
});

describe('the plan is the same before and after the models load, and at any roadside density', () => {
  it('stands the same buildings with no drawn land, no scenery, no models and the density at 0 or 3', () => {
    const seed = 42;
    const { road } = track(NETWORK);
    const plan = planOldTown(road, seed).fronts;
    const key = (f: { rule: string; edge: number; s: number; d: number; variant: number }) =>
      `${f.rule} ${f.variant} ${f.edge} ${f.s} ${f.d}`;
    const want = plan.map(key).sort();
    // A plan of a fresh network (nothing kept), and the scatter's buildings with the density at 0 and 3 (render
    // stood none at 0 before) and with the drawn land and the scenery missing: the plan reads none of them.
    const fresh = planOldTown(track(NETWORK).road, seed).fronts.map(key).sort();
    const zero = frontsOf(scattered(seed, 0).items).map(key).sort();
    const three = frontsOf(scattered(seed, 3).items).map(key).sort();
    const bare = frontsOf(scattered(seed, 1, { land: false }).items)
      .map(key)
      .sort();
    print(
      `[examined] ${NETWORK} seed ${seed}: ${want.length} planned buildings; a fresh plan ${fresh.length}, drawn at density 0 ${zero.length}, at 3 ${three.length}, with no drawn land or scenery ${bare.length}`,
    );
    expect(fresh).toEqual(want);
    expect(zero).toEqual(want);
    expect(three).toEqual(want);
    expect(bare).toEqual(want);
  }, 180_000);

  it("draws nothing of a front whose model has not loaded; with them in, nothing else stands on a front's ground", () => {
    const seed = 42;
    expect(frontsOf(scattered(seed, 1, { models: false }).items)).toEqual([]);
    // The kit's other props (the yards' trees, the sidewalk's pieces) keep off the plan's buildings: no anchor
    // inside a building's ground.
    const { road, items } = scattered(seed, 1);
    const plan = planOldTown(road, seed).fronts;
    const others = items.filter((it) => !it.foot);
    const inside = others.filter((it) =>
      plan.some((f) => f.discs.some((c) => Math.hypot(c.x - it.p.x, c.z - it.p.z) < f.r * 0.9)),
    );
    print(
      `[examined] ${NETWORK} seed ${seed}: ${others.length} other props against ${plan.length} buildings' ground`,
    );
    expect(others.length).toBeGreaterThan(100);
    expect(inside.map((it) => `${it.rule} s ${it.s.toFixed(0)}`)).toEqual([]);
  }, 120_000);

  it("keeps the kit's order: each rule's place in KEYS_KIT is its seeded stream", () => {
    for (const r of OLDTOWN_RULES) {
      const i = KEYS_KIT.rules.findIndex((k) => k.id === r.id);
      expect(i, r.id).toBe(r.index);
      expect(KEYS_KIT.rules[i]?.structure, r.id).toBe(true);
      expect(!!KEYS_KIT.rules[i]?.first, r.id).toBe(!!r.first);
    }
  });
});

/** Where render draws a front's model (roadside.ts: turned about +Y by `turn`, at `p`, scale 1). */
function drawnMatrix(f: Pick<OldTownFront, 'p' | 'turn'>): Matrix4 {
  return new Matrix4().compose(
    new Vector3(f.p.x, f.p.y, f.p.z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), f.turn),
    new Vector3(1, 1, 1),
  );
}

describe("each structure is its building's drawn shape, where render draws it", () => {
  const seed = 7;
  const tolerance = 0.4;
  const slack = 0.3;
  const asSolids = (specs: readonly StructureSpec[]): Solid[] =>
    specs.map((s) => ({ foot: s.foot, baseY: s.baseY, roof: s.roof, name: s.rule }));

  it('every building of the plan: its drawing inside its structures, each structure touched by it', () => {
    const { road } = track(NETWORK);
    const fronts = planOldTown(road, seed).fronts;
    const points = new Map<string, Float64Array>();
    for (const [kind, asset] of [
      ['duvalKit', 'models/scenery/duval-kit'],
      ['keysIdentity', 'models/scenery/keys-identity'],
    ] as const)
      models[kind].variants.forEach((g, v) => {
        const pts = surfacePoints(g, 0.5);
        points.set(`${asset}#${v}`, Float64Array.from(pts.flatMap((q) => [q.x, q.y, q.z])));
      });
    let checked = 0;
    let worst = 0;
    const bad: string[] = [];
    const v = new Vector3();
    for (const f of fronts) {
      const local = points.get(f.model);
      if (!local) throw new Error(`no drawing for ${f.model}`);
      const m = drawnMatrix(f);
      const world = [];
      for (let i = 0; i < local.length; i += 3) {
        v.set(local[i] ?? 0, local[i + 1] ?? 0, local[i + 2] ?? 0).applyMatrix4(m);
        world.push({ x: v.x, y: v.y, z: v.z });
      }
      const held = holds(asSolids(frontStructures(f)), world, tolerance, slack);
      checked += world.length;
      worst = Math.max(worst, held.worst);
      if (held.loose.length || held.slack.length)
        bad.push(
          `${f.rule} ${f.model} at ${f.edge}/${f.s.toFixed(1)}: ${held.loose.length} loose, ${held.slack.map((x) => x.slice(0, 2).join(' ')).join(', ')}`,
        );
    }
    print(
      `[examined] ${NETWORK} seed ${seed}: ${fronts.length} buildings, ${checked} drawn points placed as render draws them; the farthest ${worst.toFixed(2)} m outside its structures; ${bad.length} buildings off`,
    );
    expect(bad.slice(0, 5)).toEqual([]);
  }, 180_000);

  it('a negative control: a structure moved half a metre off its building is found', () => {
    const { road } = track(NETWORK);
    const f = planOldTown(road, seed).fronts.find((x) => x.model.endsWith('duval-kit#1'));
    if (!f) throw new Error('no balconied front on Duval');
    const g = models.duvalKit.variants[1];
    if (!g) throw new Error('no duval kit variant 1');
    const m = drawnMatrix(f);
    const world = surfacePoints(g, 0.25, (x, y, z) => {
      const p = new Vector3(x, y, z).applyMatrix4(m);
      return { x: p.x, y: p.y, z: p.z };
    });
    const specs = frontStructures(f);
    expect(holds(asSolids(specs), world, tolerance, slack)).toMatchObject({ loose: [], slack: [] });
    const moved = specs.map((s, i) => (i === 0 ? { ...s, foot: { ...s.foot, x: s.foot.x + 0.5 } } : s));
    const held = holds(asSolids(moved), world, tolerance, slack);
    expect(held.loose.length + held.slack.length).toBeGreaterThan(0);
  });

  it("is the oldtown layer's plan: the contract's registry holds every part, checked", async () => {
    const { road } = track(NETWORK);
    const spec = STRUCTURE_LAYERS['oldtown'];
    expect(spec?.tags).toContain('key-oldtown');
    const loaded = await spec?.load();
    expect(loaded).toBe(oldTownPlanner);
    const plan = planStructures(
      road,
      seed,
      { oldtown: oldTownPlanner },
      { oldtown: STRUCTURE_LAYERS['oldtown']! },
    );
    const fronts = planOldTown(road, seed).fronts;
    const parts = fronts.reduce((n, f) => n + frontStructures(f).length, 0);
    print(
      `[examined] ${NETWORK} seed ${seed}: ${plan.items.length} structures in the registry for ${fronts.length} buildings`,
    );
    expect(plan.items.length).toBe(parts);
    expect(plan.items.every((s) => s.layer === 'oldtown' && s.cls === 'building')).toBe(true);
  });
});
