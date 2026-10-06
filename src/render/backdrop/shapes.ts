// The backdrop's far pieces as low-poly geometry, written into one triangle soup (soup.ts). Every
// piece is code-made from its data (data.ts): ridgelines as faceted curtains with snow, clear-cut
// patchwork and waterfalls; volcanoes and hills as jittered cones and domes; bridges as decks,
// towers and cables; skylines and city blocks as boxes; ships, ferries and sailboats as a few
// boxes and a sail; clouds and fog banks as puffs. Flat colours only (the look grades them), no
// crack, rust or grime. Fixed landmarks take their shape from their id; what varies between races
// (clear-cut patches, waterfalls, islands, boats, clouds) comes from the race's seed.
import {
  FLOOR_UNDER_M,
  type BlocksPiece,
  type BridgePiece,
  type CloudsPiece,
  type FloorPiece,
  type IslandsPiece,
  type LighthousePiece,
  type MastPiece,
  type PeakPiece,
  type Pt,
  type RidgePiece,
  type SkylinePiece,
  type VesselsPiece,
} from './data';
import { hashOf, mixRgb, rgb, rng, scale, SUN_H, type Rgb, type Soup, type V3 } from './soup';

/** What a piece builder needs from the network it is built for. */
export interface ShapeCtx {
  soup: Soup;
  /** A point of this piece's frame in world [x, z]. */
  toWorld(p: Pt): [number, number];
  /** Whether a world point lies within r of any road point. */
  nearRoad(x: number, z: number, r: number): boolean;
  /** The network's centre, world [x, z]. */
  centre: readonly [number, number];
  /** The race's seed (playtest 1c item 2): what varies between races derives from it. */
  seed: number;
}

/** How far below the sea every standing piece reaches, so no sliver of sky shows under its foot. */
export const SKIRT_M = 60;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const raceRng = (ctx: ShapeCtx, id: string) => rng(hashOf(id) ^ Math.imul(ctx.seed | 0, 0x9e3779b1));
const fixedRng = (id: string) => rng(hashOf(id));
const exag = (p: { exaggerate?: number }) => p.exaggerate ?? 1;

/** Value noise along a line: control values every `every` samples, smoothly joined. */
function noise1(n: number, every: number, r: () => number): number[] {
  const ctrl = Array.from({ length: Math.ceil(n / every) + 2 }, () => r());
  return Array.from({ length: n }, (_, i) => {
    const f = i / every;
    const k = Math.floor(f);
    const t = f - k;
    const s = t * t * (3 - 2 * t);
    return lerp(ctrl[k]!, ctrl[k + 1]!, s);
  });
}

/** Clips a convex polygon in (u, y) to lo <= y <= hi (Sutherland-Hodgman, two half-planes). */
function clipY(poly: readonly [number, number][], lo: number, hi: number): [number, number][] {
  const cut = (pts: readonly [number, number][], keep: (y: number) => boolean, at: number) => {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const ina = keep(a[1]);
      const inb = keep(b[1]);
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = (at - a[1]) / (b[1] - a[1]);
        out.push([lerp(a[0], b[0], t), at]);
      }
    }
    return out;
  };
  const a = cut(poly, (y) => y >= lo, lo);
  return a.length >= 3 ? cut(a, (y) => y <= hi, hi) : [];
}

// ---- Ridgelines ---------------------------------------------------------------------------------

export function buildRidge(p: RidgePiece, ctx: ShapeCtx): number {
  const e = exag(p);
  const keep = p.keepOutM ?? 800;
  const pts = p.path.map((q) => {
    const [x, z] = ctx.toWorld([q[0], q[1]]);
    return { x, z, env: (q.length > 2 ? q[2]! : p.heightM[1]) * e };
  });
  // Resample along the path.
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  const len = cum[cum.length - 1]!;
  if (len <= 0) return 0;
  const step = Math.min(1500, Math.max(120, len / 72));
  const n = Math.max(2, Math.ceil(len / step) + 1);
  const shape = fixedRng(p.id);
  const profile = p.profile ?? 'peaks';
  const coarse = noise1(n, profile === 'rolling' ? 7 : 3, shape);
  const fine = noise1(n, 1, shape);
  const minH = p.heightM[0] * e;
  const samples: { x: number; z: number; h: number; ok: boolean }[] = [];
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * len;
    while (seg < pts.length - 2 && cum[seg + 1]! < d) seg++;
    const a = pts[seg]!;
    const b = pts[seg + 1]!;
    const t = (d - cum[seg]!) / Math.max(1e-6, cum[seg + 1]! - cum[seg]!);
    const x = lerp(a.x, b.x, t);
    const z = lerp(a.z, b.z, t);
    const env = lerp(a.env, b.env, t);
    const lo = Math.min(minH, env * 0.9);
    let k: number;
    if (profile === 'mesa') {
      k = 0.86 + 0.14 * coarse[i]!;
      if (fine[i]! < 0.12) k *= 0.62; // a notch where a creek cuts the cliff
      k = lo / env + (1 - lo / env) * k;
    } else if (profile === 'rolling') {
      k = lo / env + (1 - lo / env) * (0.25 + 0.75 * coarse[i]!);
    } else {
      const j = 0.55 * coarse[i]! + 0.45 * fine[i]!;
      k = lo / env + (1 - lo / env) * Math.pow(j, 1.25);
    }
    samples.push({ x, z, h: env * k, ok: !ctx.nearRoad(x, z, keep) });
  }
  const s = ctx.soup;
  s.begin(p.haze ?? 0);
  const maxH = Math.max(...samples.map((q) => q.h));
  s.gradient = { y0: -SKIRT_M, fadeM: Math.max(200, maxH * 0.7), amount: 0.5 };
  const base = rgb(p.colour);
  const snow = rgb(p.snowColour ?? '#f4f5f2');
  const cut = rgb(p.clearcutColour ?? '#8f8a5e');
  // Clear-cuts in three ages: fresh (the cut colour), half grown back, and young green regrowth.
  const cuts = [mixRgb(base, cut, 0.7), mixRgb(base, cut, 0.45), mixRgb(base, rgb('#6f8a4e'), 0.45)];
  const snowM = p.snowM !== undefined ? p.snowM * e : Infinity;
  const race = raceRng(ctx, p.id);
  const fallRng = raceRng(ctx, `${p.id}#falls`);
  const fallCols = new Set<number>();
  const tall = samples.map((q, i) => (i < n - 1 && q.ok && samples[i + 1]!.ok && q.h > maxH * 0.55 ? i : -1));
  const candidates = tall.filter((i) => i >= 0);
  for (let k = 0; k < (p.falls ?? 0) && candidates.length; k++)
    fallCols.add(candidates[Math.floor(fallRng() * candidates.length)]!);
  // A ridge is a long roof: two slopes from the crest down to feet spread out either side, so it
  // has a lit side and a shaded side and still reads as a hill when seen end-on. Cliffs (mesa)
  // spread little, rolling hills a lot. The foot pulls in where it would reach toward a road.
  const spread = profile === 'mesa' ? 0.55 : profile === 'rolling' ? 2.4 : 1.5;
  const normals = samples.map((_, i) => {
    const a = samples[Math.max(0, i - 1)]!;
    const b = samples[Math.min(n - 1, i + 1)]!;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return [-(b.z - a.z) / l, (b.x - a.x) / l] as const;
  });
  const feet = samples.map((q, i) =>
    ([1, -1] as const).map((side) => {
      let w = q.h * spread + 120;
      const [nx, nz] = normals[i]!;
      while (w > q.h * 0.3 + 60 && ctx.nearRoad(q.x + nx * side * w, q.z + nz * side * w, keep * 0.5))
        w *= 0.6;
      return [q.x + nx * side * w, -SKIRT_M, q.z + nz * side * w] as V3;
    }),
  );
  const fallColour = rgb(p.fallColour ?? '#eef3f2');
  let built = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    if (!a.ok || !b.ok) continue;
    const segLen = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const tx = (b.x - a.x) / segLen;
    const tz = (b.z - a.z) / segLen;
    // The crest's own rise and fall: the slope that rises toward b faces back along -t.
    const slope = (b.h - a.h) / segLen;
    const lit = -Math.sign(slope) * (tx * SUN_H[0] + tz * SUN_H[1]) * Math.min(1, Math.abs(slope) * 3);
    const shade = 0.94 + 0.12 * lit;
    const column: [number, number][] = [
      [0, -SKIRT_M],
      [1, -SKIRT_M],
      [1, b.h],
      [0, a.h],
    ];
    // The forest bands step up and down from column to column, so the patchwork is not a grid.
    const bands = [
      -SKIRT_M,
      maxH * (0.22 + 0.16 * race()),
      maxH * (0.5 + 0.16 * race()),
      Math.min(snowM, 1e9),
      1e9,
    ].sort((u, v) => u - v);
    const colours: Rgb[] = [];
    for (let j = 0; j + 1 < bands.length; j++) {
      const lo = bands[j]!;
      if (lo >= snowM) colours.push(snow);
      else if (j > 0 && race() < (p.clearcuts ?? 0)) colours.push(cuts[Math.floor(race() * cuts.length)]!);
      else colours.push(scale(base, j === 0 ? 0.92 : 1 + 0.04 * j));
    }
    s.inside = [(a.x + b.x) / 2, Math.min(a.h, b.h) * 0.3, (a.z + b.z) / 2];
    for (const f of [0, 1]) {
      const fa = feet[i]![f]!;
      const fb = feet[i + 1]![f]!;
      // A point of this slope by (u along the column, height y): up the slope from foot to crest.
      const world = (q: [number, number]): V3 => {
        const crest = lerp(a.h, b.h, q[0]);
        const v = (q[1] + SKIRT_M) / Math.max(1, crest + SKIRT_M);
        const fx = lerp(fa[0], fb[0], q[0]);
        const fz = lerp(fa[2], fb[2], q[0]);
        return [lerp(fx, lerp(a.x, b.x, q[0]), v), q[1], lerp(fz, lerp(a.z, b.z, q[0]), v)];
      };
      for (let j = 0; j + 1 < bands.length; j++) {
        const lo = bands[j]!;
        const hi = bands[j + 1]!;
        if (hi <= lo) continue;
        const part = clipY(column, lo, hi);
        if (part.length < 3) continue;
        s.poly(part.map(world), colours[j]!, shade);
        built++;
      }
      // A waterfall: a narrow white ribbon down the slope that faces the road, a little proud of it.
      const facing = (fa[0] - a.x) * (ctx.centre[0] - a.x) + (fa[2] - a.z) * (ctx.centre[1] - a.z) > 0;
      if (fallCols.has(i) && facing) {
        const w = 0.12;
        const top = lerp(a.h, b.h, 0.5) - 4;
        const foot = top * 0.3;
        s.bias = 4;
        const saved: V3 | null = s.inside;
        s.inside = null;
        s.poly(
          [
            world([0.5 - w, foot]),
            world([0.5 + w, foot]),
            world([0.5 + w * 0.6, top]),
            world([0.5 - w * 0.6, top]),
          ],
          fallColour,
        );
        s.inside = saved;
        s.bias = 0;
      }
    }
    s.inside = null;
  }
  return built > 0 ? 1 : 0;
}

// ---- Peaks: volcanoes, hills, monoliths ---------------------------------------------------------

export function buildPeak(p: PeakPiece, ctx: ShapeCtx): number {
  const [x, z] = ctx.toWorld(p.at);
  const e = exag(p);
  if (ctx.nearRoad(x, z, p.keepOutM ?? 800)) return 0;
  const s = ctx.soup;
  s.begin(p.haze ?? 0);
  const H = p.heightM * e;
  const R = p.radiusM * e;
  const y0 = p.baseM ?? 0;
  s.gradient = { y0: -SKIRT_M, fadeM: Math.max(150, (H + y0) * 0.6), amount: 0.45 };
  const shape = p.shape ?? 'cone';
  if (shape === 'twin') {
    const r = fixedRng(p.id);
    const ang = r() * Math.PI;
    const dx = Math.cos(ang) * R * 0.5;
    const dz = Math.sin(ang) * R * 0.5;
    mound(s, p, x - dx, z - dz, y0, H, R * 0.62, 'dome', `${p.id}a`);
    mound(s, p, x + dx, z + dz, y0, H * 0.95, R * 0.6, 'dome', `${p.id}b`);
  } else mound(s, p, x, z, y0, H, R, shape, p.id);
  return 1;
}

function mound(
  s: Soup,
  p: PeakPiece,
  x: number,
  z: number,
  y0: number,
  H: number,
  R: number,
  shape: string,
  id: string,
): void {
  const r = fixedRng(id);
  const SEG = 13;
  const fr = [0, 0.16, 0.34, 0.52, 0.7, 0.86, 1];
  const crater = p.craterShare ?? 0.05;
  const radius = (f: number) => {
    if (shape === 'dome') return R * Math.max(0.1, Math.sqrt(Math.max(0, 1 - f * f * 0.96)));
    if (shape === 'rock') return R * (f < 0.85 ? 1 - 0.25 * f : 0.5);
    return R * (Math.pow(1 - f, 1.7) * (1 - crater) + crater);
  };
  const jitter = fr.map(() => Array.from({ length: SEG }, () => 0.86 + 0.28 * r()));
  const twist = fr.map(() => (r() - 0.5) * 0.25);
  const ring = (k: number): V3[] =>
    Array.from({ length: SEG }, (_, i) => {
      const a = ((i + twist[k]!) / SEG) * Math.PI * 2;
      const rr = radius(fr[k]!) * (k === fr.length - 1 ? 1 : jitter[k]![i]!);
      return [x + Math.cos(a) * rr, y0 + fr[k]! * H, z + Math.sin(a) * rr];
    });
  const rings = fr.map((_, k) => ring(k));
  const skirt: V3[] = rings[0]!.map((q) => [q[0], -SKIRT_M, q[2]]);
  const base = rgb(p.colour);
  const snow = rgb(p.snowColour ?? '#f6f6f2');
  const snowAt = p.snowAbove !== undefined ? y0 + p.snowAbove * H : Infinity;
  const saved = s.inside;
  s.inside = [x, y0 + H * 0.3, z];
  const all = [skirt, ...rings];
  for (let k = 0; k + 1 < all.length; k++) {
    const lo = all[k]!;
    const hi = all[k + 1]!;
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      const cy = (lo[i]![1] + hi[j]![1]) / 2;
      // A ragged snow line: a little up or down per facet.
      const c = cy > snowAt + (r() - 0.5) * H * 0.12 ? snow : base;
      s.poly([lo[i]!, lo[j]!, hi[j]!, hi[i]!], c);
    }
  }
  const top = rings[rings.length - 1]!;
  const cap: V3 = [x, y0 + H * (shape === 'cone' ? 0.97 : 1.02), z];
  for (let i = 0; i < SEG; i++) s.tri(top[i]!, top[(i + 1) % SEG]!, cap, H + y0 > snowAt ? snow : base);
  s.inside = saved;
}

// ---- Bridges ------------------------------------------------------------------------------------

export function buildBridge(p: BridgePiece, ctx: ShapeCtx): number {
  const [ax, az] = ctx.toWorld(p.from);
  const [bx, bz] = ctx.toWorld(p.to);
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 1) return 0;
  const tx = (bx - ax) / L;
  const tz = (bz - az) / L;
  const keep = p.keepOutM ?? 800;
  const e = exag(p);
  const s = ctx.soup;
  s.begin(p.haze ?? 0);
  const col = rgb(p.colour);
  // The deck's half-width and its slab's thickness: a far bridge's own sizes "as it reads from the road"
  // (32 m wide, 4 m thick or more), unless the piece says its own (a near bridge, B5: the old Bahia Honda).
  const W = (p.widthM !== undefined ? p.widthM / 2 : 16) * e;
  const deck = p.deckM * e;
  // A deck that climbs or falls end to end (playtest 4, G1: the Golden Gate, 71 m at Marin, 59 m at the
  // toll plaza); a suspension or girder bridge only, the other styles stand on `deck`.
  const deckEnd = (p.deckEndM ?? p.deckM) * e;
  const deckAt = (u: number) => deck + (deckEnd - deck) * u;
  const thick = (p.thickM ?? Math.max(4, deck * 0.12)) * e;
  const hump = (u: number) =>
    p.humpAt !== undefined ? (p.humpM ?? 0) * e * Math.exp(-(((u - p.humpAt) / 0.05) ** 2)) : 0;
  const inGap = (u: number) => (p.gaps ?? []).some(([g0, g1]) => u >= g0 && u <= g1);
  const at = (u: number): [number, number] => [ax + tx * L * u, az + tz * L * u];
  const nearAt = (u: number) => {
    const [x, z] = at(u);
    return ctx.nearRoad(x, z, keep);
  };
  const SEGS = Math.max(8, Math.min(90, Math.round(L / 120)));
  let built = 0;
  // The slabs' edges: every 1/SEGS and at both ends of every missing span (T11.1), so a hole is as
  // long as the data asks, not a whole number of slabs.
  const cuts = [
    ...Array.from({ length: SEGS + 1 }, (_, k) => k / SEGS),
    ...(p.gaps ?? []).flatMap(([g0, g1]) => [g0, g1]).filter((u) => u > 0 && u < 1),
  ]
    .sort((a, b) => a - b)
    .filter((u, i, all) => i === 0 || u - all[i - 1]! > 1e-9);
  const slabGap = (k: number) => k >= 0 && k + 1 < cuts.length && inGap((cuts[k]! + cuts[k + 1]!) / 2);
  // The deck, as a run of slabs (skipping a gap and anything too close to a road).
  for (let k = 0; k + 1 < cuts.length; k++) {
    const u0 = cuts[k]!;
    const u1 = cuts[k + 1]!;
    const um = (u0 + u1) / 2;
    if (inGap(um) || nearAt(um)) continue;
    const [x0, z0] = at(u0);
    const [x1, z1] = at(u1);
    const y0 = deckAt(u0) + hump(u0);
    const y1 = deckAt(u1) + hump(u1);
    const vx = -tz * W;
    const vz = tx * W;
    s.inside = [(x0 + x1) / 2, (y0 + y1) / 2 - thick / 2, (z0 + z1) / 2];
    for (const side of [1, -1]) {
      s.poly(
        [
          [x0 + vx * side, y0 - thick, z0 + vz * side],
          [x1 + vx * side, y1 - thick, z1 + vz * side],
          [x1 + vx * side, y1, z1 + vz * side],
          [x0 + vx * side, y0, z0 + vz * side],
        ],
        col,
      );
    }
    s.poly(
      [
        [x0 - vx, y0, z0 - vz],
        [x1 - vx, y1, z1 - vz],
        [x1 + vx, y1, z1 + vz],
        [x0 + vx, y0, z0 + vz],
      ],
      col,
    );
    // A broken end: where the next slab is missing, the deck's cross-section shows (a face).
    for (const [end, x, z, y, open] of [
      [-1, x0, z0, y0, slabGap(k - 1)],
      [1, x1, z1, y1, slabGap(k + 1)],
    ] as const) {
      if (!open) continue;
      s.poly(
        [
          [x - vx, y - thick, z - vz],
          [x + vx, y - thick, z + vz],
          [x + vx, y, z + vz],
          [x - vx, y, z - vz],
        ],
        scale(col, end < 0 ? 0.8 : 0.85),
      );
    }
    s.inside = null;
    built++;
  }
  if (!built) return 0;
  /** A pier from the sea floor up to height `top`, at u (none in a gap or too near a road). */
  const pier = (u: number, top: number) => {
    if (inGap(u) || nearAt(u)) return;
    const [x, z] = at(u);
    s.frustum(x, -SKIRT_M, z, tx, tz, 3 * e, W * 0.7, top + SKIRT_M, scale(col, 0.85), 3 * e, W * 0.7, false);
  };
  if (p.style === 'girder') {
    const every = p.pierEveryM ?? 160;
    const count = Math.floor(L / every);
    for (let k = 1; k < count; k++) {
      const u = k / count;
      pier(u, deckAt(u) + hump(u) - thick);
    }
  }
  const towerM = (p.towerM ?? p.deckM * 3) * e;
  const towers = (p.towersAt ?? []).filter((u) => !nearAt(u));
  for (const u of towers) {
    const [x, z] = at(u);
    const vx = -tz * W;
    const vz = tx * W;
    const leg = 5 * e;
    for (const side of [1, -1])
      s.frustum(
        x + vx * side,
        -SKIRT_M,
        z + vz * side,
        tx,
        tz,
        leg,
        leg,
        towerM + SKIRT_M,
        col,
        leg * 0.8,
        leg * 0.8,
      );
    for (const f of [0.45, 0.72, 0.98]) {
      const y = deckAt(u) + (towerM - deckAt(u)) * f;
      s.beam([x - vx, y, z - vz], [x + vx, y, z + vz], 4 * e, col);
    }
  }
  if (p.style === 'suspension' && towers.length) {
    // The main cables: from deck-level ends and anchorages up over the tower tops, sagging between.
    const ctrl: { u: number; y: number; top: boolean }[] = [
      { u: 0, y: deckAt(0), top: false },
      { u: 1, y: deckAt(1), top: false },
      ...(p.anchorsAt ?? []).map((u) => ({ u, y: deckAt(u) + 2, top: false })),
      ...towers.map((u) => ({ u, y: towerM - 2 * e, top: true })),
    ].sort((a, b) => a.u - b.u);
    const th = 3.2 * e;
    for (let k = 0; k + 1 < ctrl.length; k++) {
      const a = ctrl[k]!;
      const b = ctrl[k + 1]!;
      const sag =
        a.top && b.top
          ? Math.min(a.y, b.y) - (deckAt((a.u + b.u) / 2) + 6)
          : (Math.max(a.y, b.y) - Math.min(a.y, b.y)) * 0.12;
      const N = 14;
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= N; i++) {
        const v = i / N;
        const u = lerp(a.u, b.u, v);
        const y = lerp(a.y, b.y, v) - 4 * sag * v * (1 - v);
        pts.push([u, y, 0]);
      }
      for (const side of [1, -1]) {
        for (let i = 0; i < N; i++) {
          const q0 = pts[i]!;
          const q1 = pts[i + 1]!;
          if (inGap((q0[0] + q1[0]) / 2) || nearAt((q0[0] + q1[0]) / 2)) continue;
          const [x0, z0] = at(q0[0]);
          const [x1, z1] = at(q1[0]);
          const ox = -tz * W * side;
          const oz = tx * W * side;
          s.poly(
            [
              [x0 + ox, q0[1], z0 + oz],
              [x1 + ox, q1[1], z1 + oz],
              [x1 + ox, q1[1] + th, z1 + oz],
              [x0 + ox, q0[1] + th, z0 + oz],
            ],
            scale(col, 0.92),
          );
        }
      }
    }
  }
  // The styles for the real roads' bridges (playtest 3, T11.1): all flat-coloured plates in the one
  // soup, hanging in vertical planes beside the deck, so a bridge costs no draw call.
  const members = scale(col, 0.88);
  /** A point of the vertical plane `lat` m to the side of the deck's axis: m along it, y up. */
  const plane =
    (lat: number) =>
    (m: number, y: number): V3 => [ax + tx * m - tz * lat, y, az + tz * m + tx * lat];
  /** A plate in such a plane between two points, `t` thick (a post: its width along the deck). */
  const plate = (lat: number, m0: number, y0: number, m1: number, y1: number, t: number) => {
    const P = plane(lat);
    s.poly([P(m0, y0), P(m1, y1), P(m1, y1 - t), P(m0, y0 - t)], members);
  };
  const post = (lat: number, m: number, yLo: number, yHi: number, hw: number) => {
    const P = plane(lat);
    s.poly([P(m - hw, yLo), P(m + hw, yLo), P(m + hw, yHi), P(m - hw, yHi)], members);
  };
  const overGap = (u0: number, u1: number) => (p.gaps ?? []).some(([g0, g1]) => g0 < u1 && g1 > u0);
  if (p.style === 'truss') {
    // Camelback spans: a polygonal top chord humped over the middle of each span, posts and
    // diagonals between it and the deck (a through truss), or, with `deckOnTop`, the same under the
    // deck. A span stands only where it has deck under it all along, as a removed span leaves none.
    const H = (p.trussM ?? 9) * e;
    const spans = Math.max(1, Math.round(L / (p.spanM ?? 60)));
    const camel = [0.4, 0.7, 1, 1, 1, 0.7, 0.4] as const;
    const tc = Math.max(1.2, H * 0.1);
    const sign = p.deckOnTop === true ? -1 : 1;
    const base = p.deckOnTop === true ? deck - thick : deck;
    const lat = W * 0.92;
    for (let k = 0; k < spans; k++) {
      const u0 = k / spans;
      const u1 = (k + 1) / spans;
      if (overGap(u0, u1) || nearAt(u0) || nearAt((u0 + u1) / 2) || nearAt(u1)) continue;
      const m0 = u0 * L;
      const n = camel.length - 1;
      const mAt = (i: number) => m0 + ((u1 - u0) * L * i) / n;
      const yAt = (i: number) => base + sign * H * camel[i]!;
      for (const side of [1, -1]) {
        for (let i = 0; i < n; i++) {
          // The chord, a post at each panel point, and a diagonal leaning toward the middle.
          plate(side * lat, mAt(i), yAt(i), mAt(i + 1), yAt(i + 1), tc);
          if (sign > 0) {
            post(side * lat, mAt(i), base, yAt(i), tc * 0.4);
            if (i < n / 2) plate(side * lat, mAt(i), base + tc, mAt(i + 1), yAt(i + 1) - tc * 0.5, tc * 0.5);
            else plate(side * lat, mAt(i), yAt(i) - tc * 0.5, mAt(i + 1), base + tc, tc * 0.5);
          } else {
            post(side * lat, mAt(i), yAt(i), base, tc * 0.4);
            if (i < n / 2) plate(side * lat, mAt(i), base, mAt(i + 1), yAt(i + 1) + tc * 1.5, tc * 0.5);
            else plate(side * lat, mAt(i), yAt(i) + tc * 1.5, mAt(i + 1), base, tc * 0.5);
          }
        }
        post(side * lat, mAt(n), sign > 0 ? base : yAt(n), sign > 0 ? yAt(n) : base, tc * 0.4);
      }
      // Piers at each end of a span, up to where the truss or the deck ends there.
      if (k > 0) pier(u0, p.deckOnTop === true ? yAt(0) : deck + hump(u0) - thick);
    }
  } else if (p.style === 'lift') {
    // A vertical lift span: its towers joined at the top, a counterweight hung on each outer tower's
    // shore side, the hoist ropes down to the span and over to the counterweights, and piers under
    // the approach spans.
    const ordered = [...towers].sort((a, b) => a - b);
    const first = ordered[0] ?? 0;
    const last = ordered[ordered.length - 1] ?? 0;
    const sheave = deck + (towerM - deck) * 0.96;
    const cwTop = deck + (towerM - deck) * 0.7;
    const lo = cwTop - (towerM - deck) * 0.3;
    for (const side of ordered.length ? [1, -1] : []) {
      const lat = W * side;
      if (ordered.length > 1) plate(lat, first * L, sheave + 2 * e, last * L, sheave + 2 * e, 3 * e);
      for (const [u, out] of [
        [first, -1],
        [last, 1],
      ] as const) {
        if (out > 0 && ordered.length === 1) continue;
        const m = u * L;
        const cw = m + out * 16 * e;
        // The counterweight: a block as wide as a tower leg, hung out over the approach.
        const hw = 4 * e;
        const t = 2.4 * e;
        const corner = (dm: number, dl: number, y: number): V3 => plane(lat * 1.05 + dl)(cw + dm, y);
        s.inside = corner(0, 0, (lo + cwTop) / 2);
        const faces: V3[][] = [
          [corner(-hw, -t, lo), corner(hw, -t, lo), corner(hw, -t, cwTop), corner(-hw, -t, cwTop)],
          [corner(-hw, t, lo), corner(hw, t, lo), corner(hw, t, cwTop), corner(-hw, t, cwTop)],
          [corner(-hw, -t, lo), corner(-hw, t, lo), corner(-hw, t, cwTop), corner(-hw, -t, cwTop)],
          [corner(hw, -t, lo), corner(hw, t, lo), corner(hw, t, cwTop), corner(hw, -t, cwTop)],
          [corner(-hw, -t, cwTop), corner(hw, -t, cwTop), corner(hw, t, cwTop), corner(-hw, t, cwTop)],
          [corner(-hw, -t, lo), corner(hw, -t, lo), corner(hw, t, lo), corner(-hw, t, lo)],
        ];
        for (const f of faces) s.poly(f, scale(col, 0.7));
        s.inside = null;
        // Ropes: tower top to the counterweight, and down to the span's end.
        plate(lat, m, sheave, cw, cwTop, 0.5 * e);
        plate(lat, m, sheave, m - out * 12 * e, deck + thick * 0.2, 0.5 * e);
      }
    }
    const every = p.pierEveryM ?? 160;
    const count = Math.floor(L / every);
    for (let k = 1; k < count; k++) {
      const u = k / count;
      if (ordered.length > 1 && u > first && u < last) continue;
      pier(u, deck + hump(u) - thick);
    }
  } else if (p.style === 'arch') {
    // A tied arch: a parabolic rib over the span between the springings, the deck its tie, hung from
    // it on vertical hangers. It stands only where there is deck under it.
    const [a, b] = p.archAt ?? [0.25, 0.75];
    const rise = (p.archM ?? p.deckM * 2.5) * e;
    const N = 24;
    const tc = Math.max(1.5, rise * 0.08);
    const lat = W * 0.92;
    const mA = a * L;
    const mB = b * L;
    const ribAt = (i: number) => deck + rise * 4 * (i / N) * (1 - i / N);
    for (const side of [1, -1]) {
      for (let i = 0; i < N; i++) {
        const um = (mA + ((mB - mA) * (i + 0.5)) / N) / L;
        if (inGap(um) || nearAt(um)) continue;
        plate(
          side * lat,
          mA + ((mB - mA) * i) / N,
          ribAt(i),
          mA + ((mB - mA) * (i + 1)) / N,
          ribAt(i + 1),
          tc,
        );
      }
      for (let i = 1; i < N; i++) {
        const m = mA + ((mB - mA) * i) / N;
        if (inGap(m / L) || nearAt(m / L)) continue;
        post(side * lat, m, deck, ribAt(i) - tc, 0.4 * e);
      }
    }
    // The springings and the approach spans' piers.
    pier(a, deck + hump(a) - thick);
    pier(b, deck + hump(b) - thick);
    const every = p.pierEveryM ?? 160;
    const count = Math.floor(L / every);
    for (let k = 1; k < count; k++) {
      const u = k / count;
      if (u > a && u < b) continue;
      pier(u, deck + hump(u) - thick);
    }
  } else if (p.style === 'stayed') {
    // A cable-stayed bridge (playtest 4, P4-20: the Tilikum Crossing): straight stays fan from each
    // tower's upper part down to the deck on both sides, in a plane beside each edge of the deck, the
    // farthest stays from the highest anchors, each side out to half way to the next tower (or the end).
    const ordered = [...towers].sort((x, y) => x - y);
    const stay = Math.max(0.5, 0.9 * e);
    ordered.forEach((u, i) => {
      const m0 = u * L;
      for (const dir of [-1, 1] as const) {
        const nb = dir < 0 ? ordered[i - 1] : ordered[i + 1];
        const reach = nb !== undefined ? (Math.abs(nb - u) * L) / 2 : dir < 0 ? m0 : L - m0;
        const n = Math.max(2, Math.min(12, Math.floor(reach / (16 * e))));
        const top = towerM - 2 * e;
        for (let k = 1; k <= n; k++) {
          const m = m0 + (dir * reach * k) / n;
          if (inGap(m / L) || nearAt(m / L)) continue;
          const anchor = top - (top - deck) * 0.4 * ((n - k) / n);
          for (const side of [1, -1]) plate(side * W * 0.9, m0, anchor, m, deck + 1, stay);
        }
      }
    });
    const every = p.pierEveryM ?? 160;
    const count = Math.floor(L / every);
    const first = ordered[0] ?? 0;
    const last = ordered[ordered.length - 1] ?? 0;
    for (let k = 1; k < count; k++) {
      const u = k / count;
      if (ordered.length > 1 && u > first && u < last) continue;
      pier(u, deck + hump(u) - thick);
    }
  }
  return 1;
}

// ---- Skylines and city blocks -------------------------------------------------------------------

export function buildSkyline(p: SkylinePiece, ctx: ShapeCtx): number {
  const [cx, cz] = ctx.toWorld(p.centre);
  const e = exag(p);
  const keep = p.keepOutM ?? 350;
  const r = fixedRng(p.id);
  const s = ctx.soup;
  s.begin(p.haze ?? 0);
  s.gradient = { y0: 0, fadeM: 160 * e, amount: 0.35 };
  const seeded = r() * Math.PI;
  // A city's grid (the heading of its streets), when the data gives one; else seeded by the piece's id.
  const grid = p.gridDeg !== undefined ? (p.gridDeg * Math.PI) / 180 : seeded;
  const ground = p.baseM ?? 0;
  const colours = p.colours.map(rgb);
  const orb = rgb(p.orbColour ?? '#fff1c9');
  let built = 0;
  for (let k = 0; k < p.count; k++) {
    const rad = p.radiusM * Math.sqrt(r());
    const ang = r() * Math.PI * 2;
    const x = cx + Math.cos(ang) * rad;
    const z = cz + Math.sin(ang) * rad;
    const centreK = 1 - 0.55 * (rad / p.radiusM);
    const spire = k < (p.spires ?? 0);
    const hasOrb = !spire && k < (p.spires ?? 0) + (p.orbs ?? 0);
    const h = lerp(p.heightM[0], p.heightM[1], Math.pow(r(), 1.5)) * e * (spire ? 1 : centreK) + ground;
    const w = lerp(p.widthM[0], p.widthM[1], r()) * e;
    const d = w * lerp(0.6, 1.15, r());
    const style = r();
    const c = colours[Math.floor(r() * colours.length)]!;
    if (ctx.nearRoad(x, z, keep)) continue;
    const a = grid + (r() - 0.5) * 0.12;
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    built++;
    if (spire) {
      // A tall tapering tower with a needle (invented: it reads as a city, it copies no building).
      const hs = Math.max(h, p.heightM[1] * e + ground);
      s.frustum(x, -SKIRT_M, z, ux, uz, w * 0.62, w * 0.62, hs * 0.86 + SKIRT_M, c, w * 0.18, w * 0.18);
      s.frustum(x, hs * 0.86, z, ux, uz, w * 0.18, w * 0.18, hs * 0.14, c, 0.8, 0.8, false);
    } else if (hasOrb) {
      s.frustum(x, -SKIRT_M, z, ux, uz, w / 2, d / 2, h + SKIRT_M, c);
      // The startup campus's orb: a big plain glowing ball on the roof. Deadpan; it means nothing.
      const rr = w * 0.55;
      s.blob([x, h + rr * 0.9, z], rr, rr, rr, orb, scale(orb, 0.92), h, h + rr * 2);
    } else if (style < 0.4) {
      s.frustum(x, -SKIRT_M, z, ux, uz, w / 2, d / 2, h + SKIRT_M, c);
    } else if (style < 0.75) {
      // Setbacks: a wide base, a narrower top.
      s.frustum(x, -SKIRT_M, z, ux, uz, w / 2, d / 2, h * 0.62 + SKIRT_M, c);
      s.frustum(x, h * 0.62, z, ux, uz, w * 0.36, d * 0.36, h * 0.38, scale(c, 1.04));
    } else {
      // A crown: a small box on the roof.
      s.frustum(x, -SKIRT_M, z, ux, uz, w / 2, d / 2, h + SKIRT_M, c);
      s.frustum(x, h, z, ux, uz, w * 0.26, d * 0.26, h * 0.07, scale(c, 0.9));
    }
  }
  // Authored towers (playtest 4, P4-20): each where the data puts it, with the crown it names.
  const ux = Math.cos(grid);
  const uz = Math.sin(grid);
  for (const t of p.towers ?? []) {
    const [x, z] = ctx.toWorld(t.at);
    if (ctx.nearRoad(x, z, keep)) continue;
    built++;
    const h = t.heightM * e + ground;
    const hw = (t.widthM * e) / 2;
    const hd = ((t.depthM ?? t.widthM * 0.85) * e) / 2;
    const c = rgb(t.colour);
    const top = scale(c, 1.05);
    switch (t.crown ?? 'flat') {
      case 'stepped':
        // Two setbacks: a body to 0.86 of the height, a narrower step, then a narrower top.
        s.frustum(x, -SKIRT_M, z, ux, uz, hw, hd, h * 0.86 + SKIRT_M, c);
        s.frustum(x, h * 0.86, z, ux, uz, hw * 0.78, hd * 0.78, h * 0.08, top);
        s.frustum(x, h * 0.94, z, ux, uz, hw * 0.5, hd * 0.5, h * 0.06, scale(c, 0.95));
        break;
      case 'pyramid':
        s.frustum(x, -SKIRT_M, z, ux, uz, hw, hd, h * 0.9 + SKIRT_M, c);
        s.frustum(x, h * 0.9, z, ux, uz, hw, hd, h * 0.1, top, hw * 0.06, hd * 0.06);
        break;
      case 'slant':
        // A roof that slopes to a ridge along the long axis.
        s.frustum(x, -SKIRT_M, z, ux, uz, hw, hd, h * 0.92 + SKIRT_M, c);
        s.frustum(x, h * 0.92, z, ux, uz, hw, hd, h * 0.08, top, hw, hd * 0.12);
        break;
      case 'spire':
        s.frustum(x, -SKIRT_M, z, ux, uz, hw, hd, h * 0.88 + SKIRT_M, c, hw * 0.8, hd * 0.8);
        s.frustum(x, h * 0.88, z, ux, uz, hw * 0.2, hd * 0.2, h * 0.12, top, 0.8, 0.8, false);
        break;
      default:
        s.frustum(x, -SKIRT_M, z, ux, uz, hw, hd, h + SKIRT_M, c);
        s.frustum(x, h, z, ux, uz, hw * 0.3, hd * 0.3, Math.max(2, h * 0.03), scale(c, 0.9));
    }
  }
  return built > 0 ? 1 : 0;
}

/** Whether (x, z) lies inside a polygon (even-odd rule). */
export function insidePolygon(x: number, z: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function buildBlocks(p: BlocksPiece, ctx: ShapeCtx): number {
  const poly = p.area.map((q) => ctx.toWorld(q));
  const e = exag(p);
  const keep = p.keepOutM ?? 400;
  const xs = poly.map((q) => q[0]);
  const zs = poly.map((q) => q[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const r = fixedRng(p.id);
  const s = ctx.soup;
  s.begin(p.haze ?? 0);
  s.gradient = { y0: 0, fadeM: 60 * e, amount: 0.3 };
  const colours = p.colours.map(rgb);
  const grid = r() * Math.PI;
  let built = 0;
  for (let k = 0, tries = 0; k < p.count && tries < p.count * 8; tries++) {
    const x = lerp(x0, x1, r());
    const z = lerp(z0, z1, r());
    const h = lerp(p.heightM[0], p.heightM[1], r() * r()) * e;
    const w = lerp(p.sizeM[0], p.sizeM[1], r()) * e;
    const c = colours[Math.floor(r() * colours.length)]!;
    if (!insidePolygon(x, z, poly)) continue;
    k++;
    if (ctx.nearRoad(x, z, keep)) continue;
    const ux = Math.cos(grid);
    const uz = Math.sin(grid);
    s.frustum(x, -SKIRT_M * 0.3, z, ux, uz, w / 2, w * 0.35, h + (p.baseM ?? 0) + SKIRT_M * 0.3, c);
    built++;
  }
  return built > 0 ? 1 : 0;
}

// ---- Vessels ------------------------------------------------------------------------------------

function vessel(
  s: Soup,
  style: VesselsPiece['style'],
  x: number,
  z: number,
  hx: number,
  hz: number,
  e: number,
  p: VesselsPiece,
  r: () => number,
): void {
  const hull = rgb(
    p.colour ??
      (style === 'ferry'
        ? '#2f5d46'
        : style === 'sailboat'
          ? '#f2f0ea'
          : style === 'shrimper'
            ? '#ece8dc'
            : '#3b4650'),
  );
  const white = rgb('#f1efe8');
  if (style === 'container') {
    const L = 150 * e;
    const B = 20 * e;
    s.frustum(x, -4, z, hx, hz, L, B, 14 * e + 4, hull, L * 0.96, B);
    const boxes = (p.colours ?? ['#9b4a3c', '#3f6c8a', '#c9a24a', '#5e7d5a', '#b8b3a8']).map(rgb);
    const stacks = 6;
    for (let k = 0; k < stacks; k++) {
      const off = lerp(-0.62, 0.42, k / (stacks - 1)) * L;
      const h = lerp(8, 22, r()) * e;
      s.frustum(
        x + hx * off,
        14 * e,
        z + hz * off,
        hx,
        hz,
        L * 0.075,
        B * 0.92,
        h,
        boxes[Math.floor(r() * boxes.length)]!,
      );
    }
    s.frustum(x + hx * L * 0.8, 14 * e, z + hz * L * 0.8, hx, hz, 9 * e, B * 0.9, 26 * e, white);
  } else if (style === 'ferry') {
    const L = 70 * e;
    const B = 14 * e;
    s.frustum(x, -4, z, hx, hz, L, B, 8 * e + 4, hull, L * 1.02, B);
    s.frustum(x, 8 * e, z, hx, hz, L * 0.86, B * 0.95, 7 * e, white);
    s.frustum(x, 15 * e, z, hx, hz, L * 0.55, B * 0.8, 5 * e, white);
    s.frustum(x, 20 * e, z, hx, hz, L * 0.12, B * 0.7, 4 * e, white);
    s.frustum(x, 24 * e, z, hx, hz, 2.5 * e, 2.5 * e, 6 * e, rgb('#2a2f2c'));
  } else if (style === 'tug') {
    // A river tug pushing a barge of wood chips (the Columbia's barges).
    s.frustum(x, -3, z, hx, hz, 14 * e, 6 * e, 6 * e + 3, hull);
    s.frustum(x - hx * 4 * e, 6 * e, z - hz * 4 * e, hx, hz, 5 * e, 4 * e, 8 * e, white);
    const bx = x + hx * 62 * e;
    const bz = z + hz * 62 * e;
    s.frustum(bx, -3, bz, hx, hz, 46 * e, 10 * e, 5 * e + 3, rgb('#5d5148'));
    s.frustum(bx, 5 * e, bz, hx, hz, 40 * e, 8 * e, 5 * e, rgb('#b08d5a'), 30 * e, 4 * e);
  } else if (style === 'shrimper') {
    // A shrimp boat trawling (W-T, the horizon comes alive): a white hull, the pilothouse forward,
    // a mast with its two outrigger booms let down to each side, the nets streaming from their tips.
    const L = 11 * e;
    const B = 3.2 * e;
    const dark = rgb('#2e3a40');
    const net = rgb('#5d6b66');
    s.frustum(x, -2, z, hx, hz, L, B, 3 * e + 2, hull, L * 1.06, B * 1.05);
    s.frustum(x + hx * L * 0.45, 3 * e, z + hz * L * 0.45, hx, hz, L * 0.22, B * 0.8, 3.4 * e, white);
    const foot: V3 = [x - hx * L * 0.05, 3 * e, z - hz * L * 0.05];
    s.beam(foot, [foot[0], 16 * e, foot[2]], 0.8 * e, dark);
    for (const side of [1, -1]) {
      const vx = -hz * side;
      const vz = hx * side;
      const tip: V3 = [foot[0] + vx * 12 * e, 6.5 * e, foot[2] + vz * 12 * e];
      s.beam([foot[0], 10 * e, foot[2]], tip, 0.6 * e, dark);
      s.inside = null;
      s.tri(
        tip,
        [tip[0] - hx * 15 * e, 0.4, tip[2] - hz * 15 * e],
        [tip[0] - hx * 5 * e, 0.4, tip[2] - hz * 5 * e],
        net,
      );
    }
  } else {
    // A sailboat: a hull, a mast and two white sails on one tack.
    const L = 7 * e;
    s.frustum(x, -1.5, z, hx, hz, L, L * 0.32, 2.4 * e + 1.5, hull, L * 0.9, L * 0.3);
    const mast: V3 = [x + hx * L * 0.15, 2.4 * e, z + hz * L * 0.15];
    const top: V3 = [mast[0], 2.4 * e + 15 * e, mast[2]];
    const tack = r() < 0.5 ? 1 : -1;
    const boom: V3 = [
      mast[0] - hx * L * 0.95 - hz * tack * L * 0.25,
      3.4 * e,
      mast[2] - hz * L * 0.95 + hx * tack * L * 0.25,
    ];
    const bow: V3 = [x + hx * L * 0.98, 2.6 * e, z + hz * L * 0.98];
    s.inside = null;
    s.tri(mast, top, boom, rgb('#fbfaf5'));
    s.tri(bow, top, mast, rgb('#f3f1ea'), 0.94);
  }
}

export function buildVessels(p: VesselsPiece, ctx: ShapeCtx): number {
  const e = exag(p);
  const keep = p.keepOutM ?? 800;
  const s = ctx.soup;
  const r = raceRng(ctx, p.id);
  let built = 0;
  if (p.path) {
    const [ax, az] = ctx.toWorld(p.path[0]);
    const [bx, bz] = ctx.toWorld(p.path[1]);
    if (ctx.nearRoad(ax, az, keep) || ctx.nearRoad(bx, bz, keep)) return 0;
    const L = Math.hypot(bx - ax, bz - az) || 1;
    s.begin(p.haze ?? 0);
    // Shuttles between the two ends: a half-amplitude swing about the middle.
    s.drift = [(bx - ax) / 2, (bz - az) / 2, (Math.PI * 2) / (p.periodS ?? 900), r() * Math.PI * 2];
    vessel(s, p.style, (ax + bx) / 2, (az + bz) / 2, (bx - ax) / L, (bz - az) / L, e, p, r);
    return 1;
  }
  const [cx, cz] = p.centre ? ctx.toWorld(p.centre) : ctx.centre;
  for (let k = 0; k < (p.count ?? 0); k++) {
    let x: number;
    let z: number;
    if (p.centre) {
      const rad = (p.radiusM ?? 0) * Math.sqrt(r());
      const ang = r() * Math.PI * 2;
      x = cx + Math.cos(ang) * rad;
      z = cz + Math.sin(ang) * rad;
    } else {
      const [b0, b1] = p.bearingDeg ?? [0, 360];
      const [d0, d1] = p.distanceM ?? [1000, 5000];
      [x, z] = bearingFrom(cx, cz, lerp(b0, b1, r()), lerp(d0, d1, r()));
    }
    const head = r() * Math.PI * 2;
    const hx = Math.cos(head);
    const hz = Math.sin(head);
    // Sailboats tack about, shrimp boats trawl slowly up and down their ground, ships cross.
    const trawl = p.style === 'shrimper';
    const amp =
      p.style === 'sailboat' ? lerp(60, 200, r()) : trawl ? lerp(150, 350, r()) : lerp(300, 900, r());
    const period =
      p.style === 'sailboat' ? lerp(150, 300, r()) : trawl ? lerp(500, 900, r()) : lerp(900, 1800, r());
    const phase = r() * Math.PI * 2;
    if (ctx.nearRoad(x - hx * amp, z - hz * amp, keep) || ctx.nearRoad(x + hx * amp, z + hz * amp, keep))
      continue;
    s.begin(p.haze ?? 0);
    s.drift = [hx * amp, hz * amp, (Math.PI * 2) / period, phase];
    vessel(s, p.style, x, z, hx, hz, e, p, r);
    built++;
  }
  return built > 0 ? 1 : 0;
}

// ---- Clouds, fog banks ------------------------------------------------------------

/** A compass bearing (0 = north, clockwise) and a distance from a point, as world [x, z]. */
function bearingFrom(cx: number, cz: number, deg: number, dist: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + Math.sin(a) * dist, cz - Math.cos(a) * dist];
}

export function buildClouds(p: CloudsPiece, ctx: ShapeCtx): number {
  const e = exag(p);
  const s = ctx.soup;
  const r = raceRng(ctx, p.id);
  const over = rgb(p.colour);
  const under = rgb(p.shadeColour ?? p.colour);
  const spots: [number, number][] = [];
  if (p.path) {
    const pts = p.path.map((q) => ctx.toWorld(q));
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 420));
      for (let k = 0; k < n; k++)
        spots.push([lerp(a[0], b[0], (k + r()) / n), lerp(a[1], b[1], (k + r()) / n)]);
    }
  } else {
    const [b0, b1] = p.bearingDeg ?? [0, 360];
    const [d0, d1] = p.distanceM!;
    for (let k = 0; k < (p.count ?? 0); k++)
      spots.push(bearingFrom(ctx.centre[0], ctx.centre[1], lerp(b0, b1, r()), lerp(d0, d1, r())));
  }
  const keep = p.keepOutM ?? 600;
  const drift = p.driftM ?? 0;
  const db = ((p.driftBearingDeg ?? 90) * Math.PI) / 180;
  let built = 0;
  for (const [x, z] of spots) {
    if (ctx.nearRoad(x, z, keep)) continue;
    s.begin(p.haze ?? 0);
    if (drift)
      s.drift = [
        Math.sin(db) * drift,
        -Math.cos(db) * drift,
        (Math.PI * 2) / (p.driftPeriodS ?? 900),
        r() * 6.283,
      ];
    const base = p.baseM;
    const top = lerp(p.topM[0], p.topM[1], r()) * e;
    const H = top - base;
    if (p.style === 'cumulus') {
      // A heap of fair-weather cloud: a wide row of puffs along its base, a smaller row on top of it
      // and one small crown, each row narrower than the one below. Nothing is narrower than what sits
      // on it, so it never has a stalk and a cap (the Keys' thunderheads, an anvil on a tower, read
      // as a mushroom cloud: the maintainer, playtest 3).
      const span = H * lerp(1.5, 2.1, r());
      const ang = r() * Math.PI;
      const ax = Math.cos(ang);
      const az = Math.sin(ang);
      const row = (n: number, share: number, centre: number, tall: number) => {
        const w = span * share;
        for (let k = 0; k < n; k++) {
          const along = n === 1 ? 0 : (k / (n - 1) - 0.5) * w * (1 - 1 / (n + 1));
          const rx = (w / (n + 1)) * lerp(0.85, 1.1, r());
          const ry = H * tall * lerp(0.85, 1.1, r());
          s.blob(
            [x + ax * along, base + H * centre, z + az * along],
            rx,
            ry,
            rx * 0.8,
            over,
            under,
            base,
            top,
            r(),
          );
        }
      };
      row(4 + Math.floor(r() * 2), 1, 0.27, 0.3);
      row(2 + Math.floor(r() * 2), 0.56, 0.46, 0.27);
      row(1, 0.26, 0.74, 0.26);
    } else {
      // A long low bank (or rolling fog): flattened puffs side by side.
      const fog = p.style === 'fog';
      const puffs = fog ? 2 : 5 + Math.floor(r() * 3);
      const ang = r() * Math.PI;
      const span = fog ? 380 * e : H * 1.4;
      for (let k = 0; k < puffs; k++) {
        const off = (k - (puffs - 1) / 2) * span * 0.6;
        // A bank's middle puffs stand taller than its ends.
        const mid = 1 - Math.abs(k - (puffs - 1) / 2) / puffs;
        const rx = span * lerp(0.6, 0.95, r());
        const ry = fog ? H * 0.5 * lerp(0.75, 1, r()) : H * lerp(0.35, 0.6, r()) * (0.6 + 0.6 * mid);
        s.blob(
          [x + Math.cos(ang) * off, base + ry * 0.9, z + Math.sin(ang) * off],
          rx,
          ry,
          rx * 0.75,
          over,
          under,
          base,
          top,
          r(),
        );
      }
    }
    built++;
  }
  return built > 0 ? 1 : 0;
}

// ---- Islands, lighthouses, masts ----------------------------------------------------------------

export function buildIslands(p: IslandsPiece, ctx: ShapeCtx): number {
  const e = exag(p);
  const s = ctx.soup;
  const r = raceRng(ctx, p.id);
  const keep = p.keepOutM ?? 800;
  const col = rgb(p.colour);
  const [b0, b1] = p.bearingDeg ?? [0, 360];
  let built = 0;
  for (let k = 0; k < p.count; k++) {
    const [x, z] = bearingFrom(
      ctx.centre[0],
      ctx.centre[1],
      lerp(b0, b1, r()),
      lerp(p.distanceM[0], p.distanceM[1], r()),
    );
    const w = lerp(p.widthM[0], p.widthM[1], r()) * e;
    const h = lerp(p.heightM[0], p.heightM[1], r()) * e;
    const stretch = lerp(1, 2.6, r());
    const ang = r() * Math.PI;
    if (ctx.nearRoad(x, z, keep + w)) continue;
    s.begin(p.haze ?? 0);
    s.inside = [x, h * 0.2, z];
    // A low, lumpy dome: a ring at the waterline, a ring of canopy, a crown.
    const SEG = 9;
    const ring = (rad: number, y: number, j: number): V3[] =>
      Array.from({ length: SEG }, (_, i) => {
        const a = (i / SEG) * Math.PI * 2;
        const rr = rad * (0.85 + 0.3 * r());
        const lx = Math.cos(a) * rr * stretch;
        const lz = Math.sin(a) * rr;
        return [
          x + lx * Math.cos(ang) - lz * Math.sin(ang),
          y * (j ? 0.85 + 0.3 * r() : 1),
          z + lx * Math.sin(ang) + lz * Math.cos(ang),
        ];
      });
    const rings = [ring(w * 0.52, -SKIRT_M * 0.3, 0), ring(w * 0.5, h * 0.55, 1), ring(w * 0.3, h, 1)];
    for (let j = 0; j + 1 < rings.length; j++)
      for (let i = 0; i < SEG; i++) {
        const a = rings[j]!;
        const b = rings[j + 1]!;
        const n = (i + 1) % SEG;
        s.poly([a[i]!, a[n]!, b[n]!, b[i]!], j === 0 ? scale(col, 0.8) : col);
      }
    const crown: V3 = [x, h * 1.1, z];
    const last = rings[rings.length - 1]!;
    for (let i = 0; i < SEG; i++) s.tri(last[i]!, last[(i + 1) % SEG]!, crown, col);
    built++;
  }
  return built > 0 ? 1 : 0;
}

export function buildLighthouse(p: LighthousePiece, ctx: ShapeCtx): number {
  const [x, z] = ctx.toWorld(p.at);
  if (ctx.nearRoad(x, z, p.keepOutM ?? 600)) return 0;
  const H = p.heightM * exag(p);
  const s = ctx.soup;
  s.begin(p.haze ?? 0);
  const body = rgb(p.colour);
  const lamp = rgb(p.lanternColour);
  // A reef light: a tapering iron tower on the reef, a gallery, a lantern and a cap.
  s.prism(x, -SKIRT_M * 0.3, z, 8, H * 0.11, H * 0.05, H * 0.82 + SKIRT_M * 0.3, body, false);
  s.prism(x, H * 0.82, z, 8, H * 0.075, H * 0.075, H * 0.025, scale(body, 0.8));
  s.prism(x, H * 0.845, z, 8, H * 0.045, H * 0.045, H * 0.08, lamp);
  s.prism(x, H * 0.925, z, 8, H * 0.055, 0.5, H * 0.075, scale(body, 0.75), false);
  return 1;
}

export function buildMast(p: MastPiece, ctx: ShapeCtx): number {
  const [x, z] = ctx.toWorld(p.at);
  if (ctx.nearRoad(x, z, p.keepOutM ?? 300)) return 0;
  const H = p.heightM * exag(p);
  const y0 = p.baseM ?? 0;
  const s = ctx.soup;
  s.begin(p.haze ?? 0);
  const a = rgb(p.colour);
  const b = rgb(p.bandColour);
  const w = Math.max(3, H * 0.02);
  // A three-legged broadcast mast: legs splayed at the foot, meeting at a waist, three prongs above.
  const legAt = (k: number, rad: number, y: number): V3 => {
    const ang = (k / 3) * Math.PI * 2 + 0.3;
    return [x + Math.cos(ang) * rad, y, z + Math.sin(ang) * rad];
  };
  const band = (p0: V3, p1: V3, n: number) => {
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const q0: V3 = [lerp(p0[0], p1[0], t0), lerp(p0[1], p1[1], t0), lerp(p0[2], p1[2], t0)];
      const q1: V3 = [lerp(p0[0], p1[0], t1), lerp(p0[1], p1[1], t1), lerp(p0[2], p1[2], t1)];
      s.beam(q0, q1, w, i % 2 ? b : a);
    }
  };
  for (let k = 0; k < 3; k++) {
    band(legAt(k, H * 0.17, y0 - 10), legAt(k, H * 0.05, y0 + H * 0.56), 3);
    band(legAt(k, H * 0.05, y0 + H * 0.56), legAt(k, H * 0.1, y0 + H), 4);
  }
  for (const f of [0.3, 0.56, 0.8]) {
    const rad = f <= 0.56 ? lerp(H * 0.17, H * 0.05, f / 0.56) : lerp(H * 0.05, H * 0.1, (f - 0.56) / 0.44);
    for (let k = 0; k < 3; k++)
      s.beam(legAt(k, rad, y0 + f * H), legAt((k + 1) % 3, rad, y0 + f * H), w * 0.8, b);
  }
  return 1;
}

// ---- The far ground and water -------------------------------------------------------------------

/** Floor polygons are split until no edge is longer than this, so the haze varies smoothly over them. */
const FLOOR_EDGE_M = 1500;

export function buildFloor(
  p: FloorPiece,
  ctx: ShapeCtx,
  triangulate: (pts: [number, number][]) => number[][],
): number {
  const pts = p.area.map((q) => ctx.toWorld(q));
  const tris = triangulate(pts);
  if (!tris.length) return 0;
  const s = ctx.soup;
  s.begin(p.haze ?? 0);
  s.floor = 1;
  // Floors lie a hair under the sea (y = 0), so the near sea and ground always cover them; past the
  // fog's end, water wins over land and land over the far ring by a depth bias.
  s.bias = p.surface === 'water' ? 2 : 1;
  const col = rgb(p.colour);
  const y = (p.y ?? 0) - FLOOR_UNDER_M[p.surface];
  const split = (a: V3, b: V3, c: V3, depth: number) => {
    const ab = Math.hypot(a[0] - b[0], a[2] - b[2]);
    const bc = Math.hypot(b[0] - c[0], b[2] - c[2]);
    const ca = Math.hypot(c[0] - a[0], c[2] - a[2]);
    const m = Math.max(ab, bc, ca);
    if (m <= FLOOR_EDGE_M || depth > 6) {
      s.tri(a, b, c, col);
      return;
    }
    const mid = (u: V3, v: V3): V3 => [(u[0] + v[0]) / 2, y, (u[2] + v[2]) / 2];
    if (m === ab) {
      const d = mid(a, b);
      split(a, d, c, depth + 1);
      split(d, b, c, depth + 1);
    } else if (m === bc) {
      const d = mid(b, c);
      split(a, b, d, depth + 1);
      split(a, d, c, depth + 1);
    } else {
      const d = mid(c, a);
      split(a, b, d, depth + 1);
      split(d, b, c, depth + 1);
    }
  };
  for (const [i, j, k] of tris) {
    const v = (n: number): V3 => [pts[n]![0], y, pts[n]![1]];
    split(v(i!), v(j!), v(k!), 0);
  }
  return 1;
}

/** The far ring's height: under the sea and under every floor polygon. */
const RING_Y = -1.5;

/** The far ground (or sea) all round, out to the horizon: rings that follow the camera. */
export function buildFloorRing(s: Soup, colour: string): void {
  s.begin(0);
  s.floor = 1;
  s.follow = 1;
  const RADII = [700, 950, 1350, 2000, 3000, 4600, 7000, 11000, 17000, 26000, 40000, 60000];
  const SEG = 28;
  const col = rgb(colour);
  for (let k = 0; k + 1 < RADII.length; k++)
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2;
      const a1 = ((i + 1) / SEG) * Math.PI * 2;
      const r0 = RADII[k]!;
      const r1 = RADII[k + 1]!;
      s.poly(
        [
          [Math.cos(a0) * r0, RING_Y, Math.sin(a0) * r0],
          [Math.cos(a1) * r0, RING_Y, Math.sin(a1) * r0],
          [Math.cos(a1) * r1, RING_Y, Math.sin(a1) * r1],
          [Math.cos(a0) * r1, RING_Y, Math.sin(a0) * r1],
        ],
        col,
      );
    }
}
