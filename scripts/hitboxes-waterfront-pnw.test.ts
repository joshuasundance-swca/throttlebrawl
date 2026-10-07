// The hitbox audit for the waterfront's and the Pacific Northwest's places (the physical world, the maintainer,
// 2026-10-06: "consistent physics and gameplay is important here so players know what to expect and how to interact
// with the world"; the twin of scripts/hitboxes.test.ts for the structures road/structures/waterfront.ts and
// road/structures/pnw-places.ts plan). A structure's solids are the plan's: an oriented box on the ground, a base
// and a roof. What render draws for them is built from boxes it marks `solid` (`Shape.solids` for the waterfront,
// `BoxPart.solid` for the places). This holds each plan solid to the drawn one, in world metres: footprint (its
// middle and its half sizes), its top, and its base (the drawn foot, or the ground under the building where the
// drawing goes below it to hide a slope), within TOLERANCE_M. Whatever is drawn but not marked is trim or overhead
// (the audit's rule: a cornice, an awning, a flag), and its overshoot past the solids is measured and bounded
// (RELIEF_LIMITS), so a drawing that grows past what the sim meets is found.
//
// It lives under scripts/ because it reads both sides, the plan (road/) and the drawing (render/), which no module
// may import together (docs/architecture.md, module map).
import { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  FERRY_DIM,
  loadPnwPlacesLayout,
  loadWaterfrontLayout,
  modelFoot,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
  type StructureSpec,
} from '../src/road';
import type { BoxPart } from '../src/render/geometry';
import {
  bannerParts,
  ferryTopParts,
  hullParts,
  shopParts,
  sideStreetParts,
  spotAt,
  type Item,
} from '../src/render/pnw-places';
import { LAND_TOP_M as RENDER_LAND_TOP_M } from '../src/render/scenery';
import {
  backTower,
  block,
  ferryHall,
  pierShed,
  TOWER_U,
  type DrawnSolid,
  type Shape,
} from '../src/render/waterfront';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);

/** How far a drawn solid's footprint, top or base may sit from the plan's, m (float noise, nothing more). */
const TOLERANCE_M = 0.02;
/**
 * What may be drawn past a building's solids (its trim, awnings, signs, flags: left out of the plan by the audit's
 * rule), by rule and per side, m: measured at seed 7 and held with a hand of room, so the drawing cannot grow past
 * what the sim meets unseen. `side` is across the front (x), `front` toward the road (+z), `back` away (-z), `top` up.
 */
const RELIEF_LIMITS: Readonly<Record<string, { side: number; front: number; back: number; top: number }>> = {
  'pier-shed': { side: 0.1, front: 0.5, back: 0.1, top: 0.5 },
  'ferry-hall': { side: 0.1, front: 0.2, back: 0.1, top: 5.6 },
  'block-loft': { side: 0.3, front: 1.7, back: 0.1, top: 0.1 },
  'block-arcade': { side: 0.4, front: 1.5, back: 0.1, top: 0.6 },
  'block-crab': { side: 0.3, front: 1.7, back: 0.1, top: 2.4 },
  'block-startup': { side: 0.3, front: 1.7, back: 0.1, top: 0.1 },
  'block-hotel': { side: 0.3, front: 2.2, back: 0.1, top: 0.1 },
  'block-garage': { side: 0.1, front: 0.2, back: 0.1, top: 0.1 },
  'back-tower': { side: 0.1, front: 0.1, back: 0.1, top: 0.1 },
};

const networkFiles = import.meta.glob<BakedNetwork>(
  [
    '../packs/region-sf/regions/*/networks/sf-waterfront.json',
    '../packs/region-pnw/regions/*/networks/pnw-c1.json',
  ],
  { eager: true, import: 'default' },
);
const roadFiles = import.meta.glob<BakedRoad>(
  ['../packs/region-sf/regions/*/roads/*.json', '../packs/region-pnw/regions/*/roads/*.json'],
  { eager: true, import: 'default' },
);
function network(id: string): RoadNetwork {
  const [path, n] = Object.entries(networkFiles).find(([, x]) => x.id === id) ?? [];
  if (!n || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && n.roads.includes(r.id))
    .map(([, r]) => r);
  return createRoadNetwork({ network: n, roads });
}

// ---- boxes in world metres ------------------------------------------------------------------------

/** A box in a place's own frame (+Z toward the road or along it, +X across, y up from its origin), m. */
interface Local {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}
/** Where a place stands: its origin in the world, its turn about up and its size. */
interface At {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}
/** A solid in the world: the footprint, and the heights of its underside and top. */
interface World {
  x: number;
  z: number;
  ux: number;
  uz: number;
  hu: number;
  hv: number;
  base: number;
  top: number;
}

/** The world box of a drawn solid. */
function drawn(l: Local, at: At): World {
  const f = modelFoot({ ...l, what: 'drawn' }, at);
  return { ...f, base: at.y + l.y0 * at.scale, top: at.y + l.y1 * at.scale };
}
/** The world box of a plan solid. */
function planned(s: StructureSpec): World {
  const f = s.foot;
  const top = s.roof.kind === 'flat' ? s.baseY + s.roof.topM : s.baseY + s.roof.ridgeM;
  return { x: f.x, z: f.z, ux: f.ux, uz: f.uz, hu: f.hu, hv: f.hv, base: s.baseY, top };
}
/** The union of local boxes (a barricade drawn as four rails is one solid). */
function union(list: readonly Local[]): Local {
  return {
    x0: Math.min(...list.map((b) => b.x0)),
    x1: Math.max(...list.map((b) => b.x1)),
    y0: Math.min(...list.map((b) => b.y0)),
    y1: Math.max(...list.map((b) => b.y1)),
    z0: Math.min(...list.map((b) => b.z0)),
    z1: Math.max(...list.map((b) => b.z1)),
  };
}

/** What a drawn building says it is: each solid's name (the rule's suffix) and its local box. */
interface DrawnSolidLocal {
  name: string;
  box: Local;
}

/** The worst gap between the drawn solids of a place and the plan's, m, and the first thing off. */
function compareItem(
  rule: string,
  drawnSolids: readonly DrawnSolidLocal[],
  at: At,
  specs: readonly StructureSpec[],
  /** The ground under the place, world y: a plan solid may stand on it where the drawing goes below. */
  ground: number,
): { worst: number; why: string; solids: number } {
  const byName = new Map<string, DrawnSolidLocal[]>();
  for (const d of drawnSolids) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);
  const specsBy = new Map<string, StructureSpec[]>();
  for (const s of specs) {
    const name = s.rule === rule ? '' : s.rule.slice(rule.length + 1);
    specsBy.set(name, [...(specsBy.get(name) ?? []), s]);
  }
  let worst = 0;
  let why = '';
  const flag = (gap: number, what: string) => {
    if (gap > worst) {
      worst = gap;
      why = `${rule} ${what}`;
    }
  };
  let solids = 0;
  for (const name of new Set([...byName.keys(), ...specsBy.keys()])) {
    let d = byName.get(name) ?? [];
    const s = specsBy.get(name) ?? [];
    if (d.length !== s.length && s.length === 1 && d.length > 1)
      d = [{ name, box: union(d.map((x) => x.box)) }];
    if (d.length !== s.length) {
      flag(Infinity, `:${name} drawn ${d.length} planned ${s.length}`);
      continue;
    }
    const worlds = d.map((x) => drawn(x.box, at));
    const key = (w: World) => [Math.round(w.x * 10), Math.round(w.z * 10), Math.round(w.base * 10)] as const;
    const order = (a: readonly number[], b: readonly number[]) =>
      a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
    const dw = [...worlds].sort((p, q) => order(key(p), key(q)));
    const sw = s.map(planned).sort((p, q) => order(key(p), key(q)));
    dw.forEach((w, i) => {
      const p = sw[i]!;
      solids++;
      const tag = `:${name}`;
      flag(Math.abs(w.x - p.x), `${tag} x`);
      flag(Math.abs(w.z - p.z), `${tag} z`);
      flag(Math.abs(w.hu - p.hu), `${tag} half width`);
      flag(Math.abs(w.hv - p.hv), `${tag} half depth`);
      flag(Math.abs(w.ux - p.ux) + Math.abs(w.uz - p.uz), `${tag} turn`);
      flag(Math.abs(w.top - p.top), `${tag} top`);
      // The base: the drawn underside, or the ground where the drawing goes below it (and not above it).
      const onFoot = Math.abs(w.base - p.base);
      const onGround = Math.abs(p.base - ground) <= TOLERANCE_M && w.base <= ground + TOLERANCE_M;
      flag(onFoot <= TOLERANCE_M || onGround ? 0 : onFoot, `${tag} base`);
    });
  }
  return { worst, why, solids };
}

const localOfPart = (p: BoxPart): Local => ({
  x0: p.at[0] - p.size[0] / 2,
  x1: p.at[0] + p.size[0] / 2,
  y0: p.at[1] - p.size[1] / 2,
  y1: p.at[1] + p.size[1] / 2,
  z0: p.at[2] - p.size[2] / 2,
  z1: p.at[2] + p.size[2] / 2,
});
const solidsOfParts = (parts: readonly BoxPart[]): DrawnSolidLocal[] =>
  parts.filter((p) => p.solid !== undefined).map((p) => ({ name: p.solid ?? '', box: localOfPart(p) }));
const solidsOfShape = (shape: Shape): DrawnSolidLocal[] =>
  shape.solids.map((s: DrawnSolid) => ({ name: s.name, box: s }));

/** How far a shape's drawing reaches past its marked solids, per side, m. */
function overshoot(shape: Shape): { side: number; front: number; back: number; top: number } {
  const g = shape.geometry();
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.dispose();
  if (!b) throw new Error('no box');
  const u = union(shape.solids);
  // A marked solid is inside the drawing (the geometry is what the marks were made from).
  for (const gap of [b.max.x - u.x1, u.x0 - b.min.x, b.max.z - u.z1, u.z0 - b.min.z, b.max.y - u.y1])
    expect(gap).toBeGreaterThanOrEqual(-1e-3);
  return {
    side: Math.max(b.max.x - u.x1, u.x0 - b.min.x, 0),
    front: Math.max(b.max.z - u.z1, 0),
    back: Math.max(u.z0 - b.min.z, 0),
    top: Math.max(b.max.y - u.y1, 0),
  };
}

// ---- the waterfront ---------------------------------------------------------------------------------

const wf = network('sf-waterfront');
const { waterfrontLayout } = await loadWaterfrontLayout();
const layout = waterfrontLayout(wf, 7);
const placedAt = (b: { p: { x: number; y: number; z: number }; turn: number; size: number }): At => ({
  x: b.p.x,
  y: b.p.y,
  z: b.p.z,
  yaw: b.turn,
  scale: b.size,
});

describe('the waterfront: what is drawn is what the plan says is solid (road/structures/waterfront.ts)', () => {
  it('holds every drawn solid of every shed, the hall, block, tower and street block to the plan within a centimetre or two', () => {
    let items = 0;
    let solids = 0;
    let worst = 0;
    let why = '';
    const note = (r: { worst: number; why: string; solids: number }) => {
      items++;
      solids += r.solids;
      if (r.worst > worst) {
        worst = r.worst;
        why = r.why;
      }
    };
    for (const f of layout.fronts) {
      const shape = f.kind === 'shed' ? pierShed(f.width, f.pier, f.drop) : ferryHall(f.width, f.drop);
      note(compareItem(f.rule, solidsOfShape(shape), placedAt(f), f.specs, f.p.y));
    }
    for (const b of layout.blocks)
      note(compareItem(b.rule, solidsOfShape(block(b.kind, b.width, b.u)), placedAt(b), b.specs, b.p.y));
    for (const t of layout.towers)
      note(compareItem(t.rule, solidsOfShape(backTower(t.u)), placedAt(t), t.specs, t.p.y));
    print(
      `[examined] ${items} waterfront buildings, ${solids} solids: the worst gap between a drawn solid and the plan's is ${worst.toFixed(4)} m (${why || 'none'})`,
    );
    expect(worst, why).toBeLessThanOrEqual(TOLERANCE_M);
    expect(items).toBeGreaterThan(250);
    expect(solids).toBeGreaterThan(500);
  });

  it('control: a solid moved, resized, raised or left out of the plan, or a drawing changed, is found', () => {
    const f = layout.fronts.find((x) => x.kind === 'shed');
    const b = layout.blocks.find((x) => x.kind === 'loft' && x.u > 0.55);
    const t = layout.towers[0];
    if (!f || !b || !t) throw new Error('no shed, loft with a tank or tower');
    const shed = (specs: readonly StructureSpec[]) =>
      compareItem(f.rule, solidsOfShape(pierShed(f.width, f.pier, f.drop)), placedAt(f), specs, f.p.y);
    expect(shed(f.specs).worst).toBeLessThanOrEqual(TOLERANCE_M);
    const [first, ...rest] = f.specs;
    if (!first) throw new Error('no specs');
    // Moved a quarter metre along its front, widened by a quarter metre, a quarter metre taller.
    expect(
      shed([{ ...first, foot: { ...first.foot, x: first.foot.x + 0.25 } }, ...rest]).worst,
    ).toBeGreaterThan(0.2);
    expect(
      shed([{ ...first, foot: { ...first.foot, hu: first.foot.hu + 0.25 } }, ...rest]).worst,
    ).toBeGreaterThan(0.2);
    expect(
      shed([
        { ...first, roof: { kind: 'flat', topM: first.roof.kind === 'flat' ? first.roof.topM + 0.25 : 1 } },
        ...rest,
      ]).worst,
    ).toBeGreaterThan(0.2);
    // Left out of the plan (the deck), and a solid the drawing does not have.
    expect(shed(rest).worst).toBe(Infinity);
    expect(shed([...f.specs, { ...first, rule: 'pier-shed:extra' }]).worst).toBe(Infinity);
    // A base lifted off the ground under a grounded building, and a drawing that grew.
    const body = b.specs[0]!;
    const blockAgainst = (width: number, specs: readonly StructureSpec[]) =>
      compareItem(b.rule, solidsOfShape(block(b.kind, width, b.u)), placedAt(b), specs, b.p.y);
    expect(blockAgainst(b.width, b.specs).worst).toBeLessThanOrEqual(TOLERANCE_M);
    expect(
      blockAgainst(b.width, [{ ...body, baseY: body.baseY + 0.5 }, ...b.specs.slice(1)]).worst,
    ).toBeGreaterThan(0.4);
    expect(blockAgainst(b.width + 0.5, b.specs).worst).toBeGreaterThan(0.2);
    const tower = (u: number) =>
      compareItem(t.rule, solidsOfShape(backTower(u)), placedAt(t), t.specs, t.p.y);
    expect(tower(t.u).worst).toBeLessThanOrEqual(TOLERANCE_M);
    expect(tower(t.u + 0.1).worst).toBeGreaterThan(0.2);
  });

  it('bounds what is drawn past the solids (trim, awnings, signs, the flag) per kind of building', () => {
    const seen = new Map<string, { side: number; front: number; back: number; top: number }>();
    const take = (rule: string, o: { side: number; front: number; back: number; top: number }) => {
      const m = seen.get(rule) ?? { side: 0, front: 0, back: 0, top: 0 };
      seen.set(rule, {
        side: Math.max(m.side, o.side),
        front: Math.max(m.front, o.front),
        back: Math.max(m.back, o.back),
        top: Math.max(m.top, o.top),
      });
    };
    for (const f of layout.fronts)
      take(
        f.rule,
        overshoot(f.kind === 'shed' ? pierShed(f.width, f.pier, f.drop) : ferryHall(f.width, f.drop)),
      );
    for (const b of layout.blocks)
      if (b.rule !== 'street-block') take(b.rule, overshoot(block(b.kind, b.width, b.u)));
    for (const t of layout.towers) take(t.rule, overshoot(backTower(t.u)));
    const table = [...seen]
      .sort()
      .map(
        ([r, o]) =>
          `${r}: side ${o.side.toFixed(2)} front ${o.front.toFixed(2)} back ${o.back.toFixed(2)} top ${o.top.toFixed(2)}`,
      );
    print(`[examined] drawn past the solids (m):\n  ${table.join('\n  ')}`);
    for (const [rule, o] of seen) {
      const limit = RELIEF_LIMITS[rule];
      if (!limit) throw new Error(`no relief limit for ${rule}`);
      expect(o.side, `${rule} side`).toBeLessThanOrEqual(limit.side);
      expect(o.front, `${rule} front`).toBeLessThanOrEqual(limit.front);
      expect(o.back, `${rule} back`).toBeLessThanOrEqual(limit.back);
      expect(o.top, `${rule} top`).toBeLessThanOrEqual(limit.top);
    }
    // Control: a limit that is a little under what is drawn would fail (the numbers are measured, not slack).
    const crab = seen.get('block-crab');
    expect(crab?.top).toBeGreaterThan(RELIEF_LIMITS['block-crab']!.top - 0.2);
    expect(TOWER_U).toEqual([0.1, 0.3, 0.5, 0.7, 0.9]);
  });

  it("the plan's constants are the drawing's: land top, the back towers' variants", async () => {
    const plan = await loadWaterfrontLayout();
    expect(plan.LAND_TOP_M).toBe(RENDER_LAND_TOP_M);
    expect(plan.BACK_TOWER_U).toEqual(TOWER_U);
  });
});

// ---- the Pacific Northwest's places ------------------------------------------------------------------

const pnw = network('pnw-c1');
const { pnwPlacesLayout, LAND_TOP_M: PLAN_LAND_TOP_M } = await loadPnwPlacesLayout();
const places = pnwPlacesLayout(pnw, 7);

/** A prop's spot as render places it (its road position, lift and turn), for the drawn side. */
function spot(kind: string, edge: number, s: number, d: number, h: number): At {
  const it: Item = { kind, edge, s, d, h, geometry: new BufferGeometry() };
  const p = spotAt(pnw, it);
  return { x: p.p.x, y: p.p.y, z: p.p.z, yaw: p.turn, scale: 1 };
}

describe('the places: what is drawn is what the plan says is solid (road/structures/pnw-places.ts)', () => {
  it("the plan's land top is the drawing's", () => {
    expect(PLAN_LAND_TOP_M).toBe(RENDER_LAND_TOP_M);
  });

  it('holds every drawn solid of the ferry, the shops, the side streets and the banners to the plan', () => {
    let items = 0;
    let solids = 0;
    let worst = 0;
    let why = '';
    const note = (r: { worst: number; why: string; solids: number }) => {
      items++;
      solids += r.solids;
      if (r.worst > worst) {
        worst = r.worst;
        why = r.why;
      }
    };
    for (const f of places.ferry) {
      const surface = pnw.toWorld(f.edge, f.s, 0, 0).y;
      if (f.kind === 'ferry-hull') {
        const parts = hullParts(f.len, surface, f.cabin, f.ring);
        note(
          compareItem(
            'ferry-hull',
            solidsOfParts(parts),
            spot('ferry-hull', f.edge, f.s, 0, 0),
            f.specs,
            surface,
          ),
        );
      } else if (f.kind === 'ferry-funnel' || f.kind === 'ferry-wheelhouse') {
        const parts = ferryTopParts(f.kind === 'ferry-funnel' ? 'funnel' : 'wheelhouse');
        note(compareItem(f.kind, solidsOfParts(parts), spot(f.kind, f.edge, f.s, 0, 0), f.specs, surface));
      }
    }
    for (const sh of places.shops) {
      const parts = shopParts(sh.width, sh.height, '#000', '#000', sh.side);
      note(
        compareItem(
          'shop',
          solidsOfParts(parts),
          spot('shop', sh.edge, sh.s, sh.d, RENDER_LAND_TOP_M),
          sh.specs,
          pnw.toWorld(sh.edge, sh.s, sh.d, RENDER_LAND_TOP_M).y,
        ),
      );
    }
    for (const st of places.streets) {
      const parts = sideStreetParts(st.width, st.side, st.k, st.run);
      note(
        compareItem(
          'side-street',
          solidsOfParts(parts),
          spot('side-street', st.edge, st.s, st.d, RENDER_LAND_TOP_M + 0.02),
          st.specs,
          pnw.toWorld(st.edge, st.s, st.d, RENDER_LAND_TOP_M + 0.02).y,
        ),
      );
    }
    for (const b of places.banners)
      note(
        compareItem(
          'banner',
          solidsOfParts(bannerParts(b.half)),
          spot('banner', b.edge, b.s, 0, 0),
          b.specs,
          pnw.toWorld(b.edge, b.s, 0, 0).y,
        ),
      );
    print(
      `[examined] ${items} places (ferry parts, shops, side streets, banners), ${solids} solids: the worst gap between a drawn solid and the plan's is ${worst.toFixed(4)} m (${why || 'none'})`,
    );
    expect(worst, why).toBeLessThanOrEqual(TOLERANCE_M);
    expect(solids).toBeGreaterThan(250);
  });

  it('control: a shop moved, a tent resized, a deck lowered, or a post left out of the plan is found', () => {
    const sh = places.shops[0];
    const st = places.streets[0];
    const hull = places.ferry.find((f) => f.kind === 'ferry-hull' && f.cabin);
    if (!sh || !st || !hull) throw new Error('no shop, side street or ferry deck');
    const shop = (specs: readonly StructureSpec[]) =>
      compareItem(
        'shop',
        solidsOfParts(shopParts(sh.width, sh.height, '#000', '#000', sh.side)),
        spot('shop', sh.edge, sh.s, sh.d, RENDER_LAND_TOP_M),
        specs,
        pnw.toWorld(sh.edge, sh.s, sh.d, RENDER_LAND_TOP_M).y,
      );
    expect(shop(sh.specs).worst).toBeLessThanOrEqual(TOLERANCE_M);
    const [body, ...rest] = sh.specs;
    if (!body) throw new Error('no body');
    expect(shop([{ ...body, foot: { ...body.foot, z: body.foot.z + 0.3 } }, ...rest]).worst).toBeGreaterThan(
      0.25,
    );
    expect(
      shop([{ ...body, foot: { ...body.foot, hv: body.foot.hv + 0.3 } }, ...rest]).worst,
    ).toBeGreaterThan(0.25);
    const tentRule = st.specs.findIndex((s) => s.rule === 'side-street:tent');
    const street = (specs: readonly StructureSpec[]) =>
      compareItem(
        'side-street',
        solidsOfParts(sideStreetParts(st.width, st.side, st.k, st.run)),
        spot('side-street', st.edge, st.s, st.d, RENDER_LAND_TOP_M + 0.02),
        specs,
        pnw.toWorld(st.edge, st.s, st.d, RENDER_LAND_TOP_M + 0.02).y,
      );
    expect(street(st.specs).worst).toBeLessThanOrEqual(TOLERANCE_M);
    const tent = st.specs[tentRule]!;
    expect(
      street(st.specs.map((s) => (s === tent ? { ...s, foot: { ...s.foot, hu: s.foot.hu + 0.3 } } : s)))
        .worst,
    ).toBeGreaterThan(0.25);
    const surface = pnw.toWorld(hull.edge, hull.s, 0, 0).y;
    const deckOf = (specs: readonly StructureSpec[]) =>
      compareItem(
        'ferry-hull',
        solidsOfParts(hullParts(hull.len, surface, hull.cabin, hull.ring)),
        spot('ferry-hull', hull.edge, hull.s, 0, 0),
        specs,
        surface,
      );
    expect(deckOf(hull.specs).worst).toBeLessThanOrEqual(TOLERANCE_M);
    const deck = hull.specs.find((s) => s.rule === 'ferry-hull:deck')!;
    expect(
      deckOf(hull.specs.map((s) => (s === deck ? { ...s, baseY: s.baseY - 0.4 } : s))).worst,
    ).toBeGreaterThan(0.3);
    const posts = hull.specs.filter((s) => s.rule === 'ferry-hull:post');
    expect(deckOf(hull.specs.filter((s) => s !== posts[0])).worst).toBe(Infinity);
    expect(FERRY_DIM.ceilingY).toBe(6.6);
  });
});
