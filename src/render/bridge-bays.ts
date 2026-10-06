// Bridge bays (playtest 3, T12.3; the maintainer's round 3: the Seven Mile has "real geometry", the
// old bridge beside it, and "the real 80 m missing span is the big jump"). The Seven Mile's two
// spans, its repair platforms and the Moser gap's two ends are dressed with Codex batch CX2's kit
// (`models/scenery/seven-mile-kit`): the new span's 41 m segmental bays, the old bridge's concrete
// arches and steel girders, the platforms the ramp trucks stand on, and the broken end of a deck.
// Each bay is a rigid module with its origin at the deck top where it starts, running along +Z, so
// this module only decides where each one stands: end to end along a bridge, turned to the road's
// heading and sheared up its grade so the deck of the bay is the deck of the road. Playtest 4 (P4-19)
// adds the same for any deck tagged `arch-bridge`: the Columbia River Highway's concrete deck arches,
// from Codex CX5's Gorge kit (`planArches`).
//
// Nothing here draws. The spots (`ScenerySpot`, kind `bay`) go into the road scene's merged
// scenery blocks (road-mesh.ts, scenery-merge.ts), so a bay costs no mesh where a block already
// stands, and only blocks near the camera are ever built. Presentation only: nothing reaches the sim.
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { Point3 } from './geometry';
import type { ScenerySpot } from './scenery';

/** What a bay is: the new span's, the old bridge's two, a gap's broken end and a repair platform. */
export type BayKind = 'newSpan' | 'newSpanTall' | 'oldArch' | 'oldGirder' | 'gapEnd' | 'staging';

/** The kit's root node for each bay kind (tools/blender/props/seven_mile_kit.py). */
export const BAY_ROOT: Readonly<Record<BayKind, string>> = {
  newSpan: 'nsm_bay',
  newSpanTall: 'nsm_bay_tall',
  oldArch: 'osm_arch_bay',
  oldGirder: 'osm_girder_bay',
  gapEnd: 'osm_gap_end',
  staging: 'staging_platform',
};
/** The bay kinds in the order of the kit's variants: a spot's `variant` indexes this. */
export const BAY_KINDS: readonly BayKind[] = [
  'newSpan',
  'newSpanTall',
  'oldArch',
  'oldGirder',
  'gapEnd',
  'staging',
];
/** The kit's root nodes in variant order (models.ts bakes one variant per root). */
export const BAY_ROOTS: readonly string[] = BAY_KINDS.map((k) => BAY_ROOT[k]);

/** Each bay's length along the road, m: the root's `bay_m` extra, which the kit's score checks to 1%. */
export const BAY_M: Readonly<Record<BayKind, number>> = {
  newSpan: 41,
  newSpanTall: 41,
  oldArch: 18,
  oldGirder: 24,
  gapEnd: 8,
  staging: 10,
};
/** How far each bay's pier reaches under the deck, m: the root's `pier_m` extra. */
export const PIER_M: Readonly<Record<BayKind, number>> = {
  newSpan: 6,
  newSpanTall: 19.8,
  oldArch: 6,
  oldGirder: 6,
  gapEnd: 6,
  staging: 6,
};

/** A gap end stands this far back from the gap along the deck: its whole length, m. */
export const GAP_END_ZONE_M = BAY_M.gapEnd;
/** The short pier stands in the water while the deck is at most this high above the sea, m. [default] */
export const SHORT_PIER_MAX_DECK_M = PIER_M.newSpan - 0.5;
/**
 * Bays merge into blocks of this size, m, apart from the scatter's 160 m blocks, and draw within
 * `BAY_DRAW_M` of the camera (so none is ever built a kilometre out, as the plan says). A bridge
 * crosses a 160 m square every 160 m, so bays in the scatter's blocks cost a mesh for each of them
 * (measured: up to 8 more draw calls in one view of the Seven Mile); 320 m squares and a 300 m
 * reach cost two to four. [default]
 */
export const BAY_BLOCK_M = 320;
export const BAY_DRAW_M = 300;
/** Room allowed across a bay's own width when a block counts how far it reaches, m. */
const BAY_ASIDE_M = 6;
/** The old bridge's bays in turn: two girders, then an arch. [default] */
const OLD_CYCLE: readonly BayKind[] = ['oldGirder', 'oldGirder', 'oldArch'];

export interface BayTag {
  s0: number;
  s1: number;
  side?: string | undefined;
  tag: string;
}
export interface BayRange {
  s0: number;
  s1: number;
}

/** One road's bridge spans, gaps and kickers, as the road scene reads them. */
export interface BayEdge {
  edge: number;
  length: number;
  /** The road's scenery tags (`bridge` marks a deck; `old-bridge` the old span). */
  tags: readonly BayTag[] | undefined;
  /** A deck with no drive lane, only the ramp trucks' shortcut: a repair platform. */
  shortcutOnly: boolean;
  /** Whether this network has an old span at all (the Seven Mile): its other bridge decks are the new span. */
  sevenMile: boolean;
  /** The gaps the road draws as broken ends (road-mesh `gapSpans`). */
  gaps: readonly BayRange[];
  /** The ramps; a bay never stands under a kicker's lifted road. */
  ramps: readonly BayRange[];
  /** The road's centre line at s, in world metres (deck top height). */
  at(s: number): Point3;
}

/** Whether any of a network's roads carries the `old-bridge` tag: the Seven Mile. */
export function isSevenMile(tagLists: readonly (readonly { tag: string }[] | undefined)[]): boolean {
  return tagLists.some((tags) => (tags ?? []).some((t) => t.tag === 'old-bridge'));
}

type Span = readonly [number, number];

/** Merges overlapping spans, in order. */
function union(spans: readonly Span[]): Span[] {
  const out: [number, number][] = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b);
    else if (b > a) out.push([a, b]);
  }
  return out;
}
/** The parts of `a` that are inside `b` (both sorted, merged). */
function intersect(a: readonly Span[], b: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (hi - lo > 1e-9) out.push([lo, hi]);
    }
  }
  return out;
}
/** The parts of `a` that are not inside `b` (both sorted, merged). */
function subtract(a: readonly Span[], b: readonly Span[]): Span[] {
  let out: Span[] = [...a];
  for (const [b0, b1] of b) {
    const next: Span[] = [];
    for (const [a0, a1] of out) {
      if (b1 <= a0 || b0 >= a1) next.push([a0, a1]);
      else {
        if (b0 > a0) next.push([a0, b0]);
        if (b1 < a1) next.push([b1, a1]);
      }
    }
    out = next;
  }
  return out;
}

type Style = 'new' | 'old' | 'staging';

/**
 * Plans the bays of one road, as spots for the merged scenery blocks.
 *
 * What a deck gets follows its tags and lanes: a `bridge` stretch also tagged `old-bridge` is the
 * old bridge (girders and arches in turn); one of a road with no drive lane is a repair platform
 * (the ramp trucks' decks); any other bridge of the Seven Mile's network is the new span. Bays stand
 * end to end from the start of each stretch, as many as fit (the last metres, short of a whole bay,
 * stay bare). None stands over a gap, the kicker that feeds it (the lifted road is no flat deck) or
 * a gap end; each gap has two gap ends, one against each broken end of the deck, facing the gap.
 *
 * Each bay is turned to its chord (its start to its end along the road) and sheared up the chord's
 * grade, so its deck is the road's at both ends and the joints abut.
 */
export function planBays(e: BayEdge): ScenerySpot[] {
  if (!e.sevenMile) return [];
  const tags = e.tags ?? [];
  const span = (t: BayTag): Span => [
    Math.max(0, Math.min(t.s0, t.s1)),
    Math.min(e.length, Math.max(t.s0, t.s1)),
  ];
  const bridge = union(tags.filter((t) => t.tag === 'bridge').map(span));
  if (!bridge.length) return [];
  const old = intersect(bridge, union(tags.filter((t) => t.tag === 'old-bridge').map(span)));
  const rest = subtract(bridge, old);
  const styled: { span: Span; style: Style }[] = [
    ...old.map((s) => ({ span: s, style: 'old' as const })),
    ...rest.map((s) => ({ span: s, style: e.shortcutOnly ? ('staging' as const) : ('new' as const) })),
  ];

  const out: ScenerySpot[] = [];
  const place = (kind: BayKind, origin: number, far: number) => {
    const p0 = e.at(origin);
    const p1 = e.at(far);
    const run = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    out.push({
      kind: 'bay',
      variant: BAY_KINDS.indexOf(kind),
      p: p0,
      turn: Math.atan2(p1.x - p0.x, p1.z - p0.z),
      size: 1,
      phase: 0,
      edge: e.edge,
      s: origin,
      d: 0,
      slope: run > 1e-6 ? (p1.y - p0.y) / run : 0,
      reachM: BAY_M[kind] + BAY_ASIDE_M,
    });
  };

  // A gap's two ends, each against the broken end of the deck the road draws at s0 and s1.
  const ends: Span[] = [];
  for (const g of e.gaps) {
    const before: Span = [g.s0 - GAP_END_ZONE_M, g.s0];
    const after: Span = [g.s1, g.s1 + GAP_END_ZONE_M];
    ends.push(before, after);
    const held = (z: Span) => styled.some(({ span: [a, b] }) => z[0] >= a - 1e-6 && z[1] <= b + 1e-6);
    if (held(before)) place('gapEnd', before[0], before[1]);
    if (held(after)) place('gapEnd', after[1], after[0]);
  }

  const blocked = union([
    ...e.gaps.map((g): Span => [g.s0, g.s1]),
    ...e.ramps.map((r): Span => [Math.min(r.s0, r.s1), Math.max(r.s0, r.s1)]),
    ...ends,
  ]);
  for (const { span: whole, style } of styled) {
    for (const [from, to] of subtract([whole], blocked)) {
      let a = from;
      for (let k = 0; ; k++) {
        const kind = bayKind(e, style, k, a);
        const b = a + BAY_M[kind];
        if (b > to + 1e-9) break;
        place(kind, a, b);
        a = b;
      }
    }
  }
  return out;
}

// ---- Supports picked by the deck's own tag (playtest 4, P4-19; the identity sheets' cause C5) ------
// Until playtest 4 a network with `forest` anywhere stood every bridge on timber trestle bents, so the
// Columbia River Highway's concrete deck arches, I-5's concrete bridges and Upper Market's bridge
// stood on timber. Now a deck says what holds it up: `trestle` stands it on timber bents (road-mesh.ts),
// `arch-bridge` gives it Codex CX5's concrete deck arches (below), and any other deck keeps the plain
// concrete pylons.

/** A deck tagged this stands on timber trestle bents (road-mesh.ts). */
export const TRESTLE_TAG = 'trestle';
/** A deck tagged this gets the concrete deck arches (`planArches`). */
export const ARCH_TAG = 'arch-bridge';

/** The arches: a 24 m bay, and the one 46 m span a short deck takes whole. */
export type ArchKind = 'bay' | 'span';
/** Each arch's root node in the Gorge kit (`models/landmarks/gorge-landmarks`, tools/blender/props/gorge_landmarks.py). */
export const ARCH_ROOT: Readonly<Record<ArchKind, string>> = {
  bay: 'gorge_arch_bay',
  span: 'gorge_arch_span_46',
};
/** The arch kinds in the order of the model's variants: an arch spot's `variant` indexes this. */
export const ARCH_KINDS: readonly ArchKind[] = ['bay', 'span'];
/** The arches' root nodes in variant order (models.ts bakes one variant per root). */
export const ARCH_ROOTS: readonly string[] = ARCH_KINDS.map((k) => ARCH_ROOT[k]);
/** Each arch's length along the road, m: its root's `bay_m` extra. */
export const ARCH_M: Readonly<Record<ArchKind, number>> = { bay: 24, span: 46 };
/** How far each arch's piers reach under the deck top, m: its root's `pier_m` extra. */
export const ARCH_PIER_M: Readonly<Record<ArchKind, number>> = { bay: 16, span: 28 };
/**
 * Where an arch's stone footings stand, at the foot of its piers: this far either side of the deck's
 * centre line, and this far in from each end of the arch, m (measured on the kit: 3 m across by 2.4 m
 * along, from x 2.1 to 5.1 and z 0 to 2.4 at each end).
 */
export const ARCH_FOOTING = { x: 3.6, inM: 1.2 } as const;

/** One road's decks, as the arch planner reads them. */
export interface ArchEdge {
  edge: number;
  length: number;
  /** The road's scenery tags (`bridge` marks a deck; `arch-bridge` an arched one). */
  tags: readonly BayTag[] | undefined;
  /** The gaps the road draws as broken ends; no arch stands over one. */
  gaps: readonly BayRange[];
  /** The ramps; no arch stands under a kicker's lifted road. */
  ramps: readonly BayRange[];
  /** The road's centre line at s, in world metres (deck top height). */
  at(s: number): Point3;
}

/**
 * Plans the arches of one road, as spots (kind `arch`) for the merged bridge blocks.
 *
 * Each `bridge` stretch also tagged `arch-bridge` gets them. A deck no longer than the big span and
 * one bay (under 70 m) takes the one 46 m span, as Shepperd's Dell's single arch; a longer deck takes
 * 24 m bays end to end, as many as fit. Either way the arches are centred on the deck, so what is
 * left bare (less than a bay) is split between its two ends. A deck shorter than one bay takes none,
 * and none stands over a gap or a kicker. Each arch is turned to its chord and sheared up its grade,
 * as the Seven Mile's bays are (`planBays`).
 */
export function planArches(e: ArchEdge): ScenerySpot[] {
  const tags = e.tags ?? [];
  const span = (t: BayTag): Span => [
    Math.max(0, Math.min(t.s0, t.s1)),
    Math.min(e.length, Math.max(t.s0, t.s1)),
  ];
  const decks = intersect(
    union(tags.filter((t) => t.tag === 'bridge').map(span)),
    union(tags.filter((t) => t.tag === ARCH_TAG).map(span)),
  );
  if (!decks.length) return [];
  const blocked = union([
    ...e.gaps.map((g): Span => [g.s0, g.s1]),
    ...e.ramps.map((r): Span => [Math.min(r.s0, r.s1), Math.max(r.s0, r.s1)]),
  ]);
  const out: ScenerySpot[] = [];
  for (const [from, to] of subtract(decks, blocked)) {
    const len = to - from;
    const one = len >= ARCH_M.span && len < ARCH_M.span + ARCH_M.bay;
    const kind: ArchKind = one ? 'span' : 'bay';
    const n = one ? 1 : Math.floor(len / ARCH_M.bay + 1e-9);
    let a = from + (len - n * ARCH_M[kind]) / 2;
    for (let k = 0; k < n; k++, a += ARCH_M[kind]) {
      const p0 = e.at(a);
      const p1 = e.at(a + ARCH_M[kind]);
      const run = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      out.push({
        kind: 'arch',
        variant: ARCH_KINDS.indexOf(kind),
        p: p0,
        turn: Math.atan2(p1.x - p0.x, p1.z - p0.z),
        size: 1,
        phase: 0,
        edge: e.edge,
        s: a,
        d: 0,
        slope: run > 1e-6 ? (p1.y - p0.y) / run : 0,
        reachM: ARCH_M[kind] + BAY_ASIDE_M,
      });
    }
  }
  return out;
}

/** The next bay of a stretch: the old bridge's cycle, the platform, or the new span's by deck height. */
function bayKind(e: BayEdge, style: Style, k: number, a: number): BayKind {
  if (style === 'staging') return 'staging';
  if (style === 'old') return OLD_CYCLE[k % OLD_CYCLE.length] ?? 'oldGirder';
  // The short pier reaches the water only under a low deck; the channel hump's high one needs the tall.
  const high = Math.max(e.at(a).y, e.at(a + BAY_M.newSpan).y);
  return high > SHORT_PIER_MAX_DECK_M ? 'newSpanTall' : 'newSpan';
}

/**
 * The repair platform's outrigger piles (playtest 4, P1; the wave C check: "a floating orange slab"). The
 * kit's own pipe piles stand inside the deck's width, so a camera over the deck sees only the slab. A
 * bent of two raked piles under each side of the deck, every `stationM` along the bay, leaves the deck's
 * edge near the top and meets the water outside it, where a rider coming along the deck sees them
 * against the sea. In bay metres: x across the road, y up from the deck top, z along the bay. [default]
 */
export const STAGING_LEGS = {
  /** Where each pile leaves the deck's underside (x, y), and where it ends (x, y: well under the water). */
  topX: 3.7,
  topY: -0.5,
  footX: 5.6,
  footY: -6,
  radiusM: 0.26,
  sides: 6,
  /** Along the bay, m: two bents in each 10 m bay. */
  stationsM: [2.5, 7.5],
  /** A cross-brace between the two piles of each side's bent, at this height (y), m. */
  braceY: -2.2,
  braceRadiusM: 0.1,
  /** Weathered, rust-brown steel pipe (the old bridge's rail colour family). */
  colour: [0.36, 0.27, 0.21],
  /**
   * The outrigger posts (playtest 4, run A's check, item 10: "the piles never show from the chase camera").
   * A camera 2.6 m over the deck cannot see under its edge, so the raked piles above are hidden by the deck
   * itself. A post stands in the sea clear of the rails, one at each station on each side, and rises past the
   * deck's top, so it shows against the water: pale weathered timber with a dark cap, and a stub of cap
   * beam back to the deck's edge at `armY`. They are bigger and lighter than the raked piles on purpose: a
   * pile 0.7 m across at 20 m is 10 px. In bay metres, as above. [default]
   */
  posts: {
    x: 6,
    footY: -6,
    topY: 1.3,
    radiusM: 0.42,
    sides: 6,
    colour: [0.55, 0.47, 0.36],
    capColour: [0.2, 0.19, 0.18],
    armY: -0.15,
    armRadiusM: 0.2,
  },
} as const;

/** Appends a 6-sided tube from `a` to `b` to the vertex lists, outward normals, open ends. */
function pushTube(
  out: { pos: number[]; nrm: number[]; col: number[] },
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  radius: number,
  sides: number,
  colour: readonly number[],
): void {
  const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(axis[0] ?? 0, axis[1] ?? 0, axis[2] ?? 0);
  const t = axis.map((v) => v / len) as [number, number, number];
  // Any vector not along the axis seeds the ring's frame.
  const seed: [number, number, number] = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (p: readonly number[], q: readonly number[]): [number, number, number] => [
    (p[1] ?? 0) * (q[2] ?? 0) - (p[2] ?? 0) * (q[1] ?? 0),
    (p[2] ?? 0) * (q[0] ?? 0) - (p[0] ?? 0) * (q[2] ?? 0),
    (p[0] ?? 0) * (q[1] ?? 0) - (p[1] ?? 0) * (q[0] ?? 0),
  ];
  const norm = (v: [number, number, number]): [number, number, number] => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const u = norm(cross(t, seed));
  const w = norm(cross(t, u));
  const ring = (k: number): [number, number, number] => {
    const phi = (k / sides) * Math.PI * 2;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    return [u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s];
  };
  const at = (end: readonly number[], o: [number, number, number]) => {
    out.pos.push((end[0] ?? 0) + o[0] * radius, (end[1] ?? 0) + o[1] * radius, (end[2] ?? 0) + o[2] * radius);
    out.nrm.push(o[0], o[1], o[2]);
    out.col.push(colour[0] ?? 0, colour[1] ?? 0, colour[2] ?? 0);
  };
  for (let k = 0; k < sides; k++) {
    const o0 = ring(k);
    const o1 = ring(k + 1);
    // Counter-clockwise seen from outside: a0, b0, a1 and a1, b0, b1 (a at the start, b at the end).
    at(a, o0);
    at(b, o0);
    at(a, o1);
    at(a, o1);
    at(b, o0);
    at(b, o1);
  }
}

/** Appends a flat cap (a fan of `sides` triangles facing up) over a post's top. */
function pushCap(
  out: { pos: number[]; nrm: number[]; col: number[] },
  at: readonly [number, number, number],
  radius: number,
  sides: number,
  colour: readonly number[],
): void {
  const ring = (k: number): [number, number, number] => {
    const phi = (k / sides) * Math.PI * 2;
    return [at[0] + Math.cos(phi) * radius, at[1], at[2] + Math.sin(phi) * radius];
  };
  for (let k = 0; k < sides; k++) {
    // Counter-clockwise seen from above (+y): the centre, then the next ring point, then this one.
    for (const v of [at, ring(k + 1), ring(k)]) {
      out.pos.push(v[0], v[1], v[2]);
      out.nrm.push(0, 1, 0);
      out.col.push(colour[0] ?? 0, colour[1] ?? 0, colour[2] ?? 0);
    }
  }
}

/**
 * The repair platform's variant with its outrigger piles (`STAGING_LEGS`) added: a new geometry (the
 * source is left alone), the kit's own triangles first and unchanged, so a role run still names them.
 * The kit variants are triangle lists with position, normal and colour only.
 */
export function withStagingLegs(g: BufferGeometry): BufferGeometry {
  const L = STAGING_LEGS;
  const add = { pos: [] as number[], nrm: [] as number[], col: [] as number[] };
  for (const z of L.stationsM) {
    for (const side of [-1, 1]) {
      pushTube(add, [side * L.topX, L.topY, z], [side * L.footX, L.footY, z], L.radiusM, L.sides, L.colour);
    }
    // The brace joins the two piles where each stands at its height.
    const x = (y: number) => L.topX + ((L.footX - L.topX) * (L.topY - y)) / (L.topY - L.footY);
    pushTube(add, [-x(L.braceY), L.braceY, z], [x(L.braceY), L.braceY, z], L.braceRadiusM, 4, L.colour);
    // The posts: tall, pale and clear of the rails, so a camera over the deck sees them against the sea.
    const P = L.posts;
    for (const side of [-1, 1]) {
      pushTube(add, [side * P.x, P.footY, z], [side * P.x, P.topY, z], P.radiusM, P.sides, P.colour);
      pushCap(add, [side * P.x, P.topY, z], P.radiusM, P.sides, P.capColour);
      pushTube(add, [side * L.topX, P.armY, z], [side * P.x, P.armY, z], P.armRadiusM, 4, P.colour);
    }
  }
  const out = new BufferGeometry();
  for (const [name, extra] of [
    ['position', add.pos],
    ['normal', add.nrm],
    ['color', add.col],
  ] as const) {
    const src = g.getAttribute(name);
    const merged = new Float32Array(src.count * 3 + extra.length);
    for (let i = 0; i < src.count; i++) {
      merged[i * 3] = src.getX(i);
      merged[i * 3 + 1] = src.getY(i);
      merged[i * 3 + 2] = src.getZ(i);
    }
    merged.set(extra, src.count * 3);
    out.setAttribute(name, new Float32BufferAttribute(merged, 3));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * The model of a gap end without what stands above its deck: the batch drew a barricade, two posts
 * and a "bridge out" board across the lanes at the lip, where a rider passes (the sim has nothing
 * there), so only the stub under the deck is kept (the triangles with a corner below the deck's top
 * face). A new geometry; the source is left alone.
 */
export function belowDeck(g: BufferGeometry, topY = -0.05): BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position');
  const names = ['position', 'normal', 'color'].filter((n) => src.getAttribute(n));
  const kept = new Map<string, number[]>(names.map((n) => [n, []]));
  for (let t = 0; t + 2 < pos.count; t += 3) {
    const low = Math.min(pos.getY(t), pos.getY(t + 1), pos.getY(t + 2));
    if (low >= topY) continue;
    for (const n of names) {
      const a = src.getAttribute(n);
      const list = kept.get(n);
      if (!list) continue;
      for (let k = 0; k < 3; k++) for (let c = 0; c < a.itemSize; c++) list.push(a.getComponent(t + k, c));
    }
  }
  const out = new BufferGeometry();
  for (const n of names) {
    out.setAttribute(n, new Float32BufferAttribute(kept.get(n) ?? [], src.getAttribute(n).itemSize));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
