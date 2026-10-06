// Playtest 4 (P4-16, "Duval St should be a party street"): what the renderer adds to Duval. The Duval
// kit's blank shop boards get invented business names, painted in neon at dusk (text-surfaces.ts, the
// words are pack signs, several names to a board so a street is not one name repeated); the street's
// party zones hang string lights beside the road at dusk (party-lights.ts). Rules, not lists: where a
// name stands, which way it faces, that it fits its board, what is lit when, and what stays off the road.
import {
  AdditiveBlending,
  Frustum,
  Matrix4,
  type Mesh,
  type MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import type { BoardCatalog } from './boards';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { textSurfaceItemId, type SceneryModel } from './models';
import {
  BULB_SIZE_M,
  CORD_W_M,
  CROSS_CLEARANCE_M,
  GLOW_R_M,
  isLitTime,
  PartyLights,
  partyRuns,
  PARTY_DRESSING,
} from './party-lights';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import { KEYS_KIT, RoadsideLayer } from './roadside';
import {
  paintSurface,
  placeSurface,
  styleOfSurface,
  TextSurfaceLayer,
  type Cell,
  type SurfaceContext,
} from './text-surfaces';

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
const regionFiles = import.meta.glob<{
  signs?: { id: string; text: string; status?: string; tags?: string[] }[];
}>('../../packs/base/regions/florida-keys/region.json', { eager: true, import: 'default' });
const keysSigns = Object.values(regionFiles)[0]?.signs ?? [];

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

/** The dressing with every party zone on one side taken out (a one-sided party, for a control). */
function stripSide(dressing: RoadDressing, side: -1 | 1): RoadDressing {
  return Object.fromEntries(
    Object.entries(dressing).map(([id, r]) => [
      id,
      {
        ...r,
        features: ((r as unknown as BakedRoad).features ?? []).filter(
          (f) =>
            !(
              f.kind === 'roadsideZone' &&
              f.params?.['dressing'] === PARTY_DRESSING &&
              Math.sign(f.d0 + f.d1) === side
            ),
        ),
      },
    ]),
  );
}

const duvalKit: SceneryModel = await bakeRepoModel('duvalKit');
const keysRoadside: SceneryModel = await bakeRepoModel('keysRoadside');
const DUVAL = 'osm-keys-duval';

/** A 2D context that records what it was asked to draw (the unit project has no DOM). */
function recorder() {
  const calls: { text: string; fill: string; glow: number }[] = [];
  const ctx: SurfaceContext = {
    font: '',
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect() {},
    fillText(text) {
      calls.push({
        text,
        fill: typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '',
        glow: ctx.shadowBlur,
      });
    },
    measureText(text) {
      return { width: text.length * Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 0) * 0.72 };
    },
  };
  return { ctx, calls };
}

const kitSurfaces = (duvalKit.surfaces ?? []).flat();

describe("the Duval kit's blank shop boards and the signs that fill them", () => {
  it('has text surfaces on the shopfronts and the corner bar, and none on the cottages or the props', () => {
    const names = kitSurfaces.map((s) => s.name);
    expect(names.length).toBe(9);
    expect(names.every((n) => /^duval_(balcony_[abc]_shop_name_\d|corner_bar_name)$/.test(n))).toBe(true);
    for (const v of [3, 4, 6, 7]) expect(duvalKit.surfaces?.[v] ?? [], `variant ${v}`).toEqual([]);
  });

  it('every board has a live Keys sign by its node name, marked new and a surface, and pooled nowhere', () => {
    for (const s of kitSurfaces) {
      const id = textSurfaceItemId(s.name);
      const sign = keysSigns.find((x) => x.id === id);
      expect(sign, `a sign for ${s.name}`).toBeDefined();
      expect(sign?.status ?? 'live').toBe('live');
      expect(sign?.tags, id).toEqual(expect.arrayContaining(['new', 'surface', 'site']));
      expect(sign?.tags?.includes('key-oldtown'), `${id} is a board's words, not a slot's`).toBe(false);
    }
  });

  it('gives every board at least two other names, so a street of shops is not one name repeated', () => {
    for (const s of kitSurfaces) {
      const id = textSurfaceItemId(s.name);
      const names = [id, ...[2, 3, 4, 5].map((k) => `${id}-${k}`)]
        .map((x) => keysSigns.find((sign) => sign.id === x)?.text)
        .filter((t): t is string => typeof t === 'string');
      expect(names.length, id).toBeGreaterThanOrEqual(3);
      expect(new Set(names).size, `${id}: the names differ`).toBe(names.length);
    }
  });

  it('keeps every name inside its board at a size that reads: one line, in capitals', () => {
    let worst = Infinity;
    for (const s of kitSurfaces) {
      const id = textSurfaceItemId(s.name);
      // A board's 1024 px cell is as tall as its proportions give.
      const cell: Cell = { x: 0, y: 0, w: 1024, h: Math.max(48, Math.round(1024 / (s.widthM / s.heightM))) };
      for (const sign of keysSigns.filter((x) => x.id === id || x.id.startsWith(`${id}-`))) {
        const { ctx, calls } = recorder();
        const fit = paintSurface(ctx, cell, styleOfSurface(s.name), sign.text);
        expect(calls, sign.id).toHaveLength(1);
        expect(sign.text, sign.id).toBe(sign.text.toUpperCase());
        expect(fit.width, sign.id).toBeLessThanOrEqual(cell.w);
        // Letters at least a third of the board's height: they read from the street.
        worst = Math.min(worst, fit.size / cell.h);
        expect(fit.size / cell.h, `${sign.id}: "${sign.text}"`).toBeGreaterThanOrEqual(0.3);
      }
    }
    print(
      `[examined] ${kitSurfaces.length} Duval boards: the smallest letters are ${(worst * 100).toFixed(0)}% of the board's height`,
    );
  });

  it('paints neon at dusk and plain signwriting by day, never chalk, and keeps the roof sign as it was', () => {
    for (const s of kitSurfaces) {
      const lit = styleOfSurface(s.name, true);
      const day = styleOfSurface(s.name, false);
      expect(lit.glow, `${s.name} at dusk`).not.toBeNull();
      expect(day.glow, `${s.name} by day`).toBeNull();
      expect(day.bg).not.toBe(lit.bg);
    }
    // The shop boards' neon is not all one colour (a street of one pink is a cheap street).
    const glows = new Set(kitSurfaces.map((s) => styleOfSurface(s.name, true).glow));
    expect(glows.size).toBeGreaterThanOrEqual(3);
    expect(styleOfSurface('pdx_roof_sign_words')).toEqual(styleOfSurface('pdx_roof_sign_words', false));
  });
});

describe('the layer: several names to a board, one picked per building', () => {
  const sign = (id: string, text: string) => ({
    ref: `base:region/florida-keys#${id}`,
    text,
    kind: 'sign' as const,
  });
  const catalog = (ids: Record<string, string>): BoardCatalog => ({
    items: Object.fromEntries(Object.entries(ids).map(([id, text]) => [id, sign(id, text)])),
  });
  const board = kitSurfaces.find((s) => s.name === 'duval_balcony_b_shop_name_0');
  if (!board) throw new Error('no balcony b board');
  const ID = 'duval-balcony-b-shop-name-0';
  /** Six buildings in a row, each with its own pick. */
  const placed = (picks: number[]) =>
    picks.map((pick, i) => ({
      ...placeSurface(board, new Matrix4().makeTranslation(i * 12, 0, 0)),
      pick,
    }));
  const canvas = () => {
    const rec = recorder();
    return { rec, createCanvas: () => ({ ctx: rec.ctx, texture: { dispose() {} } as never }) };
  };

  it('picks among the names the catalog has, the same pick the same name, and paints each name once', () => {
    const { rec, createCanvas } = canvas();
    const layer = new TextSurfaceLayer(look, placed([0, 1, 2, 3, 4, 5]), {
      catalog: catalog({ [ID]: 'A', [`${ID}-2`]: 'B', [`${ID}-3`]: 'C' }),
      createCanvas,
    });
    expect(layer.counts().surfaces).toBe(6);
    expect(new Set(rec.calls.map((c) => c.text))).toEqual(new Set(['A', 'B', 'C']));
    expect(rec.calls).toHaveLength(3);
    layer.update(30, 0);
    expect(layer.counts()).toMatchObject({ shown: 6, drawCalls: 1 });
    // A control: with no pick, or one name only, every building shows the one name.
    const one = canvas();
    const single = new TextSurfaceLayer(look, placed([0, 1, 2]), {
      catalog: catalog({ [ID]: 'ONLY' }),
      createCanvas: one.createCanvas,
    });
    expect(single.counts().surfaces).toBe(3);
    expect(one.rec.calls.map((c) => c.text)).toEqual(['ONLY']);
  });

  it('a cut name leaves the other buildings their names, and the buildings it had fall back to the rest', () => {
    const { createCanvas } = canvas();
    const all = catalog({ [ID]: 'A', [`${ID}-2`]: 'B', [`${ID}-3`]: 'C' });
    const layer = new TextSurfaceLayer(look, placed([0, 1, 2]), { catalog: all, createCanvas });
    layer.update(12, 0);
    expect(layer.counts().shown).toBe(3);
    layer.hide([all.items[`${ID}-2`]?.ref as string]);
    layer.update(12, 0);
    // Only the building that showed `B` goes blank.
    expect(layer.counts()).toMatchObject({ shown: 2, cut: 1 });
    // The pack cutting a name takes it out of the catalog: its buildings use the names left.
    const fewer = catalog({ [ID]: 'A', [`${ID}-3`]: 'C' });
    const later = new TextSurfaceLayer(look, placed([0, 1, 2]), { catalog: fewer, createCanvas });
    later.update(12, 0);
    expect(later.counts()).toMatchObject({ surfaces: 3, shown: 3 });
    // Every name cut: the board stays blank.
    const none = new TextSurfaceLayer(look, placed([0, 1, 2]), { catalog: catalog({}), createCanvas });
    expect(none.counts().surfaces).toBe(0);
  });

  it('paints neon with a glow when lit, and signwriting with none by day', () => {
    for (const [lit, glow] of [
      [true, true],
      [false, false],
    ] as const) {
      const { rec, createCanvas } = canvas();
      new TextSurfaceLayer(look, placed([0]), { catalog: catalog({ [ID]: 'A' }), createCanvas, lit });
      expect(rec.calls[0] && rec.calls[0].glow > 0, `lit ${lit}`).toBe(glow);
    }
  });
});

describe.each([1, 7, 42])("Old Town's shop names on Duval, seed %i", (seed) => {
  const { road, dressing } = track(DUVAL);
  const built = buildRoadScene(road, look, dressing, { seed });
  const layer = new RoadsideLayer(keysRoadside, look, {
    road,
    dressing,
    seed,
    density: 1,
    kit: KEYS_KIT,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
    models: { keysRoadside, duvalKit },
  });
  while (!layer.ready) layer.update(1e9, 1e9, 360);
  const surfaces = layer.surfaces();
  const fronts = layer.items.filter((it) => it.foot);

  it('puts every board of every street-front building in the world, one per surface of its model', () => {
    const expected = fronts.reduce((n, it) => n + (duvalKit.surfaces?.[it.variant]?.length ?? 0), 0);
    expect(surfaces.length).toBe(expected);
    expect(surfaces.length).toBeGreaterThan(30);
    print(`[examined] seed ${seed}: ${fronts.length} street-front buildings, ${surfaces.length} name boards`);
  });

  it('stands each board on its building, facing the road, in front of the wall', () => {
    const bad: string[] = [];
    for (const s of surfaces) {
      const p = road.project(s.centre.x, s.centre.z);
      const edge = road.edges[p.edge];
      if (!edge) {
        bad.push(`${s.id}: off every road`);
        continue;
      }
      // Facing: its normal points at the road's centre line from where it stands.
      const toRoad = road.toWorld(p.edge, p.s, 0, 0);
      const to = new Vector3(toRoad.x - s.centre.x, 0, toRoad.z - s.centre.z).normalize();
      if (s.normal.clone().setY(0).normalize().dot(to) < 0.9)
        bad.push(`${s.id} at s ${p.s.toFixed(0)} faces away`);
      // Beside the road past its verge, at shop-window height above the sidewalk.
      if (Math.abs(p.d) < 8) bad.push(`${s.id} at s ${p.s.toFixed(0)} is at d ${p.d.toFixed(1)}`);
      const ground = road.toWorld(p.edge, p.s, p.d, 0).y;
      const h = s.centre.y - ground;
      if (h < 1.5 || h > 5) bad.push(`${s.id} at s ${p.s.toFixed(0)} is ${h.toFixed(1)} m up`);
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it('gives neighbouring buildings of one kind different picks, so different names', () => {
    const picks = new Set(surfaces.filter((s) => s.id === 'duval-balcony-b-shop-name-0').map((s) => s.pick));
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });
});

describe('the party strings', () => {
  const { road, dressing } = track(DUVAL);
  const built = buildRoadScene(road, look, dressing, { seed: 7 });
  const landReach = (e: number, side: -1 | 1, s: number) => built.landReach(e, side, s);
  const runs = partyRuns(road, dressing);
  const zones = Object.values(dressing).flatMap((r) =>
    ((r as unknown as BakedRoad).features ?? []).filter(
      (f) => f.kind === 'roadsideZone' && f.params?.['dressing'] === PARTY_DRESSING,
    ),
  );

  it('has a run for each party zone, on its own side and stretch, and none where there is no party', () => {
    expect(zones.length).toBeGreaterThanOrEqual(6);
    expect(runs.length).toBe(zones.length);
    for (const z of zones) {
      const run = runs.find((r) => r.s0 === z.s0 && r.s1 === z.s1 && r.side === (z.d0 + z.d1 < 0 ? -1 : 1));
      expect(run, z.id).toBeDefined();
    }
    const m1 = track('keys-m1');
    expect(partyRuns(m1.road, m1.dressing)).toEqual([]);
    expect(isLitTime('dusk')).toBe(true);
    expect(isLitTime('night')).toBe(true);
    for (const t of ['noon', 'golden-hour', 'dawn', undefined]) expect(isLitTime(t), String(t)).toBe(false);
  });

  const lit = new PartyLights(look, { road, dressing, seed: 7, lit: true, landReach });

  it('hangs its bulbs along the sidewalk or across the street, high, over the party stretches only', () => {
    const bulbs = lit.bulbs();
    expect(bulbs.length).toBeGreaterThan(300);
    const bad: string[] = [];
    for (const b of bulbs) {
      const p = road.project(b.x, b.z);
      const e = road.edges[p.edge];
      const covering = runs.filter((r) => r.edge === p.edge && p.s >= r.s0 - 2 && p.s <= r.s1 + 2);
      if (!e || covering.length === 0) {
        bad.push(`a bulb at s ${p.s.toFixed(0)} d ${p.d.toFixed(1)} is over no party stretch`);
        continue;
      }
      const ground = road.toWorld(p.edge, p.s, p.d, 0).y;
      const up = b.y - ground;
      if (up < 3.2) bad.push(`a bulb at s ${p.s.toFixed(0)} hangs ${up.toFixed(1)} m up`);
      const outer = p.d < 0 ? -e.dMin : e.dMax;
      if (b.over) {
        // Across the street: only where both sides are party, and clear over the lanes.
        if (!covering.some((r) => r.side < 0) || !covering.some((r) => r.side > 0))
          bad.push(`a string over the street at s ${p.s.toFixed(0)} where only one side is party`);
        const road0 = road.toWorld(p.edge, p.s, 0, 0).y;
        if (b.y - road0 < CROSS_CLEARANCE_M - 0.3)
          bad.push(
            `a bulb over the lanes at s ${p.s.toFixed(0)} hangs ${(b.y - road0).toFixed(1)} m over the road`,
          );
      } else {
        // Along a side: on that side, past the road's edge, never over the lanes.
        if (!covering.some((r) => Math.sign(p.d) === r.side))
          bad.push(`a side bulb at s ${p.s.toFixed(0)} d ${p.d.toFixed(1)} is on the wrong side`);
        if (Math.abs(p.d) < outer + 0.5)
          bad.push(
            `a side bulb at s ${p.s.toFixed(0)} is ${(Math.abs(p.d) - outer).toFixed(1)} m past the road`,
          );
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
    expect(new Set(bulbs.map((b) => b.colour)).size, 'more than a couple of colours').toBeGreaterThanOrEqual(
      4,
    );
  });

  it('crosses the street with strings between the two sides of a block, and only there', () => {
    const counts = lit.counts();
    const over = lit.bulbs().filter((b) => b.over);
    // Five blocks with a party on both sides, 120 to 180 m each: several strings in every block.
    expect(counts.crossings).toBeGreaterThanOrEqual(10);
    expect(over.length).toBeGreaterThan(counts.crossings * 5);
    // Every crossing is within a block both sides share; the control: a one-sided party has none.
    const oneSided = runs.filter((r) => r.side > 0);
    const control = new PartyLights(look, {
      road,
      dressing: stripSide(dressing, -1),
      seed: 7,
      lit: true,
      landReach,
    });
    expect(oneSided.length).toBeGreaterThan(0);
    expect(control.counts().crossings).toBe(0);
    expect(control.bulbs().filter((b) => b.over)).toEqual([]);
    print(
      `[examined] ${counts.crossings} strings across Duval, ${over.length} bulbs over the lanes; the right-hand blocks alone cross none`,
    );
  });

  it('is two draw calls near a party stretch (the strings, and their glow), nothing far from one, and inside a small triangle budget', () => {
    const run = runs[0];
    if (!run) throw new Error('no run');
    const c = road.toWorld(run.edge, (run.s0 + run.s1) / 2, 0, 0);
    lit.update(c.x, c.z);
    const near = lit.counts();
    // Playtest 4, run A item 7: the strings are lit, so there is a second, additive mesh.
    expect(near.drawCalls).toBe(2);
    expect(near.shownBulbs).toBeGreaterThan(20);
    expect(near.triangles).toBeGreaterThan(0);
    expect(near.triangles).toBeLessThanOrEqual(9000);
    const start = road.toWorld(0, 0, 0, 0);
    lit.update(start.x + 5000, start.z);
    expect(lit.counts()).toMatchObject({ drawCalls: 0, shownBulbs: 0, triangles: 0 });
    print(
      `[examined] party strings: ${lit.counts().bulbs} bulbs over ${runs.length} stretches; near one: ${near.shownBulbs} shown, ${near.triangles} triangles, ${near.drawCalls} draw calls`,
    );
  });

  it('is unlit by day: nothing is built, nothing drawn, and a road with no party has none', () => {
    const day = new PartyLights(look, { road, dressing, seed: 7, lit: false, landReach });
    expect(day.counts()).toMatchObject({ runs: 0, bulbs: 0, drawCalls: 0 });
    expect(day.group.children).toHaveLength(0);
    const m1 = track('keys-m1');
    const none = new PartyLights(look, { road: m1.road, dressing: m1.dressing, seed: 7, lit: true });
    expect(none.counts().bulbs).toBe(0);
  });

  it('is the same every time for a seed', () => {
    const again = new PartyLights(look, { road, dressing, seed: 7, lit: true, landReach });
    expect(again.bulbs()).toEqual(lit.bulbs());
  });

  // Playtest 4, run A item 7: "the party lights read as unlit coloured diamonds floating with no string".
  /** Triangle centroids of a mesh's whole buffer (the index only picks what is near the camera). */
  const centroidsOf = (mesh: Mesh): Vector3[] => {
    const pos = mesh.geometry.getAttribute('position');
    const out: Vector3[] = [];
    for (let i = 0; i + 2 < pos.count; i += 3) {
      out.push(
        new Vector3(
          (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
          (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3,
          (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3,
        ),
      );
    }
    return out;
  };
  const meshNamed = (name: string) => lit.group.children.find((c) => c.name === name) as Mesh | undefined;

  /** Midpoints of neighbouring bulbs on one string: where the cord must be. */
  const betweenBulbs = (): Vector3[] => {
    const bulbs = lit.bulbs();
    const out: Vector3[] = [];
    for (let i = 1; i < bulbs.length; i++) {
      const a = bulbs[i - 1]!;
      const b = bulbs[i]!;
      const gap = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (gap > 0.5 && gap < 1.7) out.push(new Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2));
    }
    return out;
  };

  it('hangs every bulb on a drawn string: the cord is in the mesh between each pair of neighbours', () => {
    const mesh = meshNamed('party-lights');
    if (!mesh) throw new Error('no strings mesh');
    const tris = centroidsOf(mesh);
    const mids = betweenBulbs();
    expect(mids.length).toBeGreaterThan(900);
    const nearest = (p: Vector3) => tris.reduce((m, t) => Math.min(m, t.distanceTo(p)), Infinity);
    // A sample of the between-bulb points (every 7th): a drawn cord, drawn in segments a metre long, lies within 0.4 m of each.
    const sample = mids.filter((_, i) => i % 7 === 0);
    const missing = sample.filter((p) => nearest(p) > 0.4);
    // The control: a point a metre under each cord has nothing of the mesh near it (the bulbs, posts and cord are above).
    const under = sample.map((p) => new Vector3(p.x, p.y - 1, p.z)).filter((p) => nearest(p) <= 0.4);
    print(
      `[examined] ${sample.length} points between neighbouring bulbs: ${sample.length - missing.length} have the cord within 0.4 m; of the same points a metre lower, ${under.length} do`,
    );
    expect(missing.length).toBe(0);
    expect(under.length).toBeLessThan(sample.length * 0.05);
  });

  it('draws cord and bulbs big enough to read at riding distance: 1 px or more at 40 m, on a 915 px view', () => {
    // A 70 degree view 412 px high: one metre at 40 m is 7.4 px.
    const pxPerM = 412 / 2 / Math.tan((35 * Math.PI) / 180) / 40;
    expect(CORD_W_M * pxPerM).toBeGreaterThanOrEqual(1);
    expect(BULB_SIZE_M * pxPerM).toBeGreaterThanOrEqual(2.5);
    expect(GLOW_R_M * pxPerM).toBeGreaterThanOrEqual(5);
  });

  it('lights each bulb: an additive glow, bright at the bulb and black at its rim, at dusk and night only', () => {
    const glow = meshNamed('party-lights-glow');
    if (!glow) throw new Error('no glow mesh');
    const material = glow.material as MeshBasicMaterial;
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    const pos = glow.geometry.getAttribute('position');
    const col = glow.geometry.getAttribute('color');
    const bulbs = lit.bulbs();
    const bad: string[] = [];
    for (const b of bulbs.filter((_, i) => i % 41 === 0)) {
      let centre = 0;
      let reach = 0;
      let rimBright = 0;
      for (let i = 0; i < pos.count; i++) {
        const d = Math.hypot(pos.getX(i) - b.x, pos.getY(i) - b.y, pos.getZ(i) - b.z);
        const v = Math.max(col.getX(i), col.getY(i), col.getZ(i));
        if (d < 0.05) centre = Math.max(centre, v);
        if (d > GLOW_R_M * 0.9 && d < GLOW_R_M * 1.1) {
          reach = Math.max(reach, d);
          rimBright = Math.max(rimBright, v);
        }
      }
      if (centre < 0.3) bad.push(`a bulb's glow is dark at its centre (${centre.toFixed(2)})`);
      if (reach < GLOW_R_M * 0.9) bad.push(`a bulb's glow reaches ${reach.toFixed(2)} m, not ${GLOW_R_M} m`);
      if (rimBright > 0.01) bad.push(`a bulb's glow is ${rimBright.toFixed(2)} bright at its rim`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
    // By day there is nothing to light.
    const day = new PartyLights(look, { road, dressing, seed: 7, lit: false, landReach });
    expect(day.group.children.find((c) => c.name === 'party-lights-glow')).toBeUndefined();
  });

  it('knows the road is a party street from its zones, which the model loader reads as Old Town', () => {
    const { tropical, tags } = networkTags(road, dressing);
    expect(tropical).toBe(true);
    expect(tags.has('key-oldtown')).toBe(true);
  });
});

// Playtest 4, run A item 7: "at riding speed each frame shows 0 to 2 people, so it is not a crowd yet". The street's
// real people are the sim's pedestrians, a few to a block side, which a rider passes in a second or two. The balconies
// are full of revellers now: scenery a storey up, so a hitbox of nothing, in view all the way down a party block.
describe.each([7, 42])("a party block's balconies are full, seed %i", (seed) => {
  const { road, dressing } = track(DUVAL);
  const built = buildRoadScene(road, look, dressing, { seed });
  const landReach = (e: number, side: -1 | 1, s: number) => built.landReach(e, side, s);
  const layer = new RoadsideLayer(keysRoadside, look, {
    road,
    dressing,
    seed,
    density: 1,
    kit: KEYS_KIT,
    landReach,
    spots: built.spots,
    models: { keysRoadside, duvalKit },
  });
  while (!layer.ready) layer.update(1e9, 1e9, 360);
  const runs = partyRuns(road, dressing);
  const standing = (lit: boolean) => {
    const lights = new PartyLights(look, { road, dressing, seed, lit, landReach });
    lights.setFronts(layer.surfaces());
    return lights;
  };
  const crowd = standing(true);

  /** The chase camera of the cost test and the camera notes: 7 m back, 2.6 m up, aimed 18 m ahead. */
  function cameraAt(edge: number, s: number): PerspectiveCamera {
    const eye = road.toWorld(edge, Math.max(0, s - 7), 0, 2.6);
    const aim = road.toWorld(edge, s + 18, 0, 0.9);
    const rider = road.toWorld(edge, s, 0, 0);
    eye.y = Math.max(eye.y, rider.y + 2.6);
    const cam = new PerspectiveCamera(70, 915 / 412, 0.3, 760);
    cam.position.set(eye.x, eye.y, eye.z);
    cam.lookAt(aim.x, aim.y, aim.z);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
  }

  /** Revellers in the camera's frustum and within `reachM`. */
  function inView(lights: PartyLights, cam: PerspectiveCamera, reachM: number): number {
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    );
    return lights
      .revellers()
      .filter((r) => cam.position.distanceTo(new Vector3(r.x, r.y + 1.5, r.z)) <= reachM)
      .filter((r) => frustum.containsPoint(new Vector3(r.x, r.y + 1.5, r.z))).length;
  }

  it('stands revellers on the balconies of the party blocks, a storey up and clear of the lanes', () => {
    const figures = crowd.revellers();
    expect(figures.length).toBeGreaterThan(60);
    const bad: string[] = [];
    for (const r of figures) {
      const p = road.project(r.x, r.z);
      const e = road.edges[p.edge];
      const covering = runs.filter(
        (u) => u.edge === p.edge && p.s >= u.s0 - 6 && p.s <= u.s1 + 6 && Math.sign(p.d) === u.side,
      );
      if (!e || covering.length === 0) {
        bad.push(`a reveller at s ${p.s.toFixed(0)} d ${p.d.toFixed(1)} is off every party block`);
        continue;
      }
      const ground = road.toWorld(p.edge, p.s, p.d, 0).y;
      const up = r.y - ground;
      if (up < 3 || up > 4.2) bad.push(`a reveller at s ${p.s.toFixed(0)} stands ${up.toFixed(1)} m up`);
      const outer = p.d < 0 ? -e.dMin : e.dMax;
      if (Math.abs(p.d) < outer + 2)
        bad.push(
          `a reveller at s ${p.s.toFixed(0)} is ${(Math.abs(p.d) - outer).toFixed(1)} m past the road`,
        );
    }
    print(`[examined] seed ${seed}: ${figures.length} revellers on the party blocks' balconies`);
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('shows a crowd from the chase camera all the way down every party block, where there was none to see', () => {
    // Along each run, every 12 m from the block's start: the revellers within 120 m and in the picture.
    const poses = runs.flatMap((r) => {
      const out: { edge: number; s: number }[] = [];
      for (let s = r.s0; s <= r.s1; s += 12) out.push({ edge: r.edge, s });
      return out;
    });
    const seen = poses.map((p) => inView(crowd, cameraAt(p.edge, p.s), 120));
    const sorted = [...seen].sort((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    // The control: with no balconies stood, the same measure finds nobody (the run A frames showed 0 to 2).
    const bare = new PartyLights(look, { road, dressing, seed, lit: true, landReach });
    const none = poses.map((p) => inView(bare, cameraAt(p.edge, p.s), 120));
    print(
      `[examined] seed ${seed}: ${poses.length} poses down the party blocks; revellers in view: median ${sorted[Math.floor(sorted.length / 2)]}, the lowest tenth ${low}, most ${sorted[sorted.length - 1]}; with no crowd stood: most ${Math.max(...none)}`,
    );
    expect(Math.max(...none)).toBe(0);
    expect(low).toBeGreaterThanOrEqual(8);
  });

  it('is one draw call, near the party blocks only, inside a small triangle budget, day or night', () => {
    let worst = 0;
    for (const lights of [crowd, standing(false)]) {
      for (const run of runs) {
        const c = road.toWorld(run.edge, (run.s0 + run.s1) / 2, 0, 0);
        lights.update(c.x, c.z);
        const near = lights.counts().crowd;
        expect(near?.drawCalls).toBe(1);
        expect(near?.shownFigures).toBeGreaterThan(10);
        worst = Math.max(worst, near?.triangles ?? 0);
      }
      const start = road.toWorld(0, 0, 0, 0);
      lights.update(start.x + 5000, start.z);
      expect(lights.counts().crowd).toMatchObject({ drawCalls: 0, shownFigures: 0, triangles: 0 });
    }
    print(`[examined] seed ${seed}: the crowd's worst view is ${worst} triangles, one draw call`);
    expect(worst).toBeLessThanOrEqual(12000);
  });

  it('is the same every time for a seed, and builds on a road with no party block as nothing', () => {
    expect(standing(true).revellers()).toEqual(crowd.revellers());
    const m1 = track('keys-m1');
    const other = new PartyLights(look, { road: m1.road, dressing: m1.dressing, seed, lit: true });
    other.setFronts(layer.surfaces());
    expect(other.revellers()).toEqual([]);
    expect(other.counts().crowd).toBeNull();
  });
});
