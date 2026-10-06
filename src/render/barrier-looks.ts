// Barrier looks (playtest 3, "Golden Gate": the railing; playtest 4, P4-19, run C5: the concrete barrier
// and the guard rail). A road's barrier says only what it stops (`rail` or `wall`); its look says what it
// is drawn as, so a place gets its own barrier by data: the I-5 interstate's guard rail and concrete
// parapets (sheet I1), and the stone-arch walls of the Columbia River Highway and Chuckanut's parapet
// (sheets CR1 and H2) are each one more row here and one more word in the pack, not a new drawing path.
//
// A look is a panel: a handful of boxes (local x along the road, y up, z across; symmetric in z, so the
// same panel stands on either side), drawn in instanced copies along its barrier by the verge layer
// (verge.ts) within `drawM` of the camera. The road leaves the solid band of a barrier with a look out
// (road-mesh.ts), so the panel is the only thing drawn there.
//
// A look comes from three places, in this order:
// 1. the barrier's own `look` in its road file;
// 2. the road's scenery tag (`BARRIER_LOOK_BY_TAG`): a barrier with no look on an `interstate` road is a
//    guard rail (a `rail`) or a concrete barrier (a `wall`);
// 3. a hard verge edge (a band that ends in a wall the sim holds a rider in) with a tag that names an
//    `edge` look: the interstate's shoulder ends in a guard rail.
// Render only: the barrier's kind still decides what it stops.
import type { BakedBarrier } from '../road';
import type { BoxFace, BoxPart } from './geometry';

/** A barrier look: the road format's own word for it (`BARRIER_LOOKS` in src/core/surfaces.ts). */
export type BarrierLook = NonNullable<BakedBarrier['look']>;

/** One look's panel: how long it is, how tall, where it stands and how far it is drawn. */
export interface BarrierLookStyle {
  /** The panel's length along the road, m. */
  segM: number;
  /** The panel's own height, m: a barrier's `heightM` scales it. */
  heightM: number;
  /**
   * The panel's middle stands this far past the lanes' outer edge (or the verge band's), m: its inner
   * face is then flush with the edge, where the sim stops a rider and a tumbling body.
   */
  outM: number;
  /** Panels are drawn out to this far from the camera, m. */
  drawM: number;
  /** The panel's parts. `paint` is the region palette's `bridgePaint`, for the looks that wear it. */
  parts: (paint: string) => BoxPart[];
}

/** Faces nobody sees: a panel's two ends (butted against the next panel's) and its underside. */
const ENDS_AND_FOOT: readonly BoxFace[] = ['px', 'nx', 'ny'];

/** The Golden Gate's bridge railing: a kerb, a post and three rails, in the palette's bridge paint. */
export const RAILING_SEG_M = 2;
const RAILING_H_M = 1.3;
export const RAILING_OUT_M = 0.2;
export const RAILING_DRAW_M = 120;
/** The railing's paint when the region's palette has no `bridgePaint`: International Orange. [default] */
export const RAILING_PAINT = '#c0452f';

function railingParts(paint: string): BoxPart[] {
  const half = RAILING_SEG_M / 2;
  return [
    { size: [RAILING_SEG_M, 0.3, 0.34], at: [0, 0.15, 0], color: '#a8a39a', omit: ENDS_AND_FOOT },
    { size: [0.18, RAILING_H_M, 0.18], at: [-half + 0.09, RAILING_H_M / 2, 0], color: paint, omit: ['ny'] },
    { size: [RAILING_SEG_M, 0.16, 0.22], at: [0, RAILING_H_M - 0.08, 0], color: paint, omit: ENDS_AND_FOOT },
    { size: [RAILING_SEG_M, 0.08, 0.12], at: [0, 0.92, 0], color: paint, omit: ENDS_AND_FOOT },
    { size: [RAILING_SEG_M, 0.08, 0.12], at: [0, 0.62, 0], color: paint, omit: ENDS_AND_FOOT },
  ];
}

/**
 * A concrete barrier (the "New Jersey" profile: a wide foot, a sloped waist, a narrow top), in grey
 * concrete. 0.81 m tall, as the real one is; the foot is 0.6 m deep.
 */
const CONCRETE = '#b4b0a6';
const CONCRETE_DARK = '#9a968d';
function concreteParts(): BoxPart[] {
  const seg = 2;
  return [
    { size: [seg, 0.22, 0.6], at: [0, 0.11, 0], color: CONCRETE_DARK, omit: ENDS_AND_FOOT },
    { size: [seg, 0.3, 0.44], at: [0, 0.37, 0], color: CONCRETE, omit: ENDS_AND_FOOT },
    { size: [seg, 0.29, 0.26], at: [0, 0.665, 0], color: CONCRETE, omit: ENDS_AND_FOOT },
  ];
}

/**
 * A guard rail (a W-beam on posts): a galvanised steel beam 0.31 m deep with its centre 0.6 m up, on a
 * post every panel. 0.76 m tall to the beam's top edge.
 */
const STEEL = '#b9c0c4';
const POST = '#8a8d8f';
function guardrailParts(): BoxPart[] {
  const seg = 2;
  return [
    { size: [seg, 0.31, 0.1], at: [0, 0.6, 0], color: STEEL, omit: ENDS_AND_FOOT },
    { size: [0.14, 0.76, 0.14], at: [-seg / 2 + 0.07, 0.38, 0], color: POST, omit: ['ny'] },
  ];
}

/** Every look's panel. A look the schema lists has a row here (barrier-looks.test.ts holds the two equal). */
export const BARRIER_LOOK_STYLES: Readonly<Record<BarrierLook, BarrierLookStyle>> = {
  railing: {
    segM: RAILING_SEG_M,
    heightM: RAILING_H_M,
    outM: RAILING_OUT_M,
    drawM: RAILING_DRAW_M,
    parts: railingParts,
  },
  concrete: { segM: 2, heightM: 0.81, outM: 0.3, drawM: 110, parts: concreteParts },
  guardrail: { segM: 2, heightM: 0.76, outM: 0.07, drawM: 110, parts: guardrailParts },
};

/** What a road tag turns a barrier, and a hard verge edge, into when the barrier says no look of its own. */
export interface TagLooks {
  /** A `rail` barrier on a road with the tag. */
  rail?: BarrierLook;
  /** A `wall` barrier on a road with the tag. */
  wall?: BarrierLook;
  /** A hard verge edge (the band's wall) on a side with the tag, where no barrier stands. */
  edge?: BarrierLook;
}

/**
 * The looks a road tag brings [default]. The first tag of a road that has an entry for what is asked
 * decides, in the order of its tags. `interstate` (playtest 4, sheet I1): bridges stand behind concrete
 * parapets, a barrier is a guard rail, and the shoulder's wall is a guard rail too.
 */
export const BARRIER_LOOK_BY_TAG: Readonly<Record<string, TagLooks>> = {
  interstate: { rail: 'guardrail', wall: 'concrete', edge: 'guardrail' },
};

/** A tag, as a road file carries it. */
export interface LookTag {
  s0: number;
  s1: number;
  side?: string;
  tag: string;
}

const onSide = (t: LookTag, side: 'left' | 'right'): boolean =>
  t.side === undefined || t.side === 'both' || t.side === side;

/** What the road's tags at s on a side say for `want` (rail, wall or edge), or undefined. */
export function tagLook(
  tags: readonly LookTag[] | undefined,
  side: 'left' | 'right',
  s: number,
  want: keyof TagLooks,
): BarrierLook | undefined {
  for (const t of tags ?? []) {
    if (s < t.s0 || s > t.s1 || !onSide(t, side)) continue;
    const look = Object.hasOwn(BARRIER_LOOK_BY_TAG, t.tag) ? BARRIER_LOOK_BY_TAG[t.tag]?.[want] : undefined;
    if (look) return look;
  }
  return undefined;
}

/** The look of a barrier at s on a side: its own, else its road tag's, else none (drawn as its kind). */
export function barrierLookAt(
  b: { kind: string; look?: string | undefined },
  tags: readonly LookTag[] | undefined,
  side: 'left' | 'right',
  s: number,
): BarrierLook | undefined {
  if (b.look !== undefined) return b.look in BARRIER_LOOK_STYLES ? (b.look as BarrierLook) : undefined;
  return tagLook(tags, side, s, b.kind === 'wall' ? 'wall' : 'rail');
}
