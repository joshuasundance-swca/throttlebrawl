// Placeholder signs and billboards (docs/milestones/M2.md, render-2; docs/architecture.md, "In-game
// veto"). A road's `billboard` feature is a slot; it names one region item, or a pool the game
// fills from. Each board view carries its item's content reference, so the veto can name exactly
// what the player long-pressed (`pick`), and the pause screen can list what was on screen
// (`visibleRefs`, and `visibleContent`, which adds each item's kind and words for the ticker's
// "recently seen" poll). ui/ never imports render/: app/ hands the result across.
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Camera,
  type Texture,
} from 'three';
import type { RoadNetwork } from '../sim/api';
import { mergeBoxes, type BoxPart } from './geometry';
import type { LookStyle } from './look';

/**
 * `cone` (run W-U, the pitch deck's #14: "an 'INCIDENT SITE #3' cone where you were busted"): a
 * small orange placard on short legs among traffic cones, standing where the thing happened rather
 * than in a road's billboard slot (app/ adds a slot for it at the spot).
 */
export type BoardKind = 'sign' | 'billboard' | 'cone';

/** One vetoable board item, as app/ resolves it from the region file. */
export interface BoardItem {
  /** `<packId>:region/<regionId>#<itemId>` (docs/content-packs.md, "In-game veto"). */
  ref: string;
  text: string;
  kind: BoardKind;
}

/**
 * The region's live board items: by item id (a slot's `item`), and the two pools (a slot's
 * `pool`). app/ builds it from the content registry, leaving out vetoed items.
 */
export interface BoardCatalog {
  /**
   * The region's sign style (its region file's `signStyle`): the face every `sign` in the region
   * wears unless its slot names another. A name `signStyleOf` does not know counts as absent.
   */
  style?: string;
  items: Readonly<Record<string, BoardItem>>;
  pools?: {
    signs?: readonly BoardItem[];
    billboards?: readonly BoardItem[];
    /** The region's `landingLines` (app/ puts one on the top ticker on a surge landing; render and no road slot use them). */
    landing?: readonly BoardItem[];
  };
}

/**
 * One item in view, as the poll (app/, every 30 frames in a race) reads it: its content reference,
 * what it is, and its words on one line. Only boards are in view in the scene; the landing
 * one-liner is on the top ticker (app/).
 */
export interface VisibleContent {
  ref: string;
  kind: BoardKind;
  label: string;
}

/** An item's words on one line (whitespace runs, newlines included, become one space). */
export function labelOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A `billboard` feature on a road, structurally (docs/content-packs.md, "Road file"). */
export interface BoardSlot {
  kind: string;
  id?: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  item?: string;
  pool?: string;
  /** Kind-specific values; a slot's `style` names its sign face (see `SIGN_STYLES`). */
  params?: Readonly<Record<string, unknown>> | undefined;
}

export interface BoardView {
  ref: string;
  slotId: string;
  kind: BoardKind;
  /** The face style a `sign` wears (always `default` for a billboard or a cone). */
  style: SignStyle;
  text: string;
  group: Group;
  /** The printed face, the part a long-press lands on. */
  panel: Mesh;
  /** Centre of the panel, world space. */
  centre: Vector3;
  /** Half the board's width, m: it counts as within a draw distance once its near edge is. */
  radius: number;
}

/** Only boards this close count as seen (they are unreadable further out). */
export const VISIBLE_M = 250;

// Sized to be read at up to about 100 mph (44.7 m/s): a billboard's headline letters stand about
// 1.4 m tall, so they read from roughly 100 m out and the rider has the best part of two seconds.
export const BOARD_SIZES: Record<BoardKind, { panelH: number; bottom: number; minW: number; maxW: number }> =
  {
    sign: { panelH: 1.8, bottom: 1.8, minW: 3.2, maxW: 4.6 },
    billboard: { panelH: 4.6, bottom: 4, minW: 8.5, maxW: 13 },
    cone: { panelH: 1.4, bottom: 0.5, minW: 2.8, maxW: 2.8 },
  };
/** How far ahead of a board (along its road) the rider it turns toward is, metres. */
const AIM_AHEAD_M = 70;
/** How far behind the printed face the posts stand, metres. */
const POST_BEHIND_M = 0.22;

/**
 * The sign faces (playtest 4, P4-19, C6: every sign in every region was the same green). A region
 * file's `signStyle` sets its signs' face, and a road's `billboard` slot can override it with
 * `params.style`. Colours only: every style prints on the same panel, so the copy fits as it did.
 * `[default]` taste, from memory of the places, not checked against a source:
 * - `default`: the green every sign always wore, unchanged;
 * - `mile-marker`: the Keys' bright green highway posts, on white;
 * - `historic`: the Gorge's brown heritage-route signs (the Columbia River Highway);
 * - `guide`: the interstate's deep green guide signs, white-bordered, on steel;
 * - `blade`: San Francisco's street blades, blue-green on black lamp-post iron;
 * - `town`: the Northwest's mossy routed-cedar town signs.
 */
export const SIGN_STYLES = ['default', 'mile-marker', 'historic', 'guide', 'blade', 'town'] as const;
export type SignStyle = (typeof SIGN_STYLES)[number];

export interface BoardFace {
  bg: string;
  fg: string;
  frame: string;
  /** An inset rule round the printed face (the real signs' border); absent for none. */
  border?: string;
}

export const SIGN_FACES: Record<SignStyle, BoardFace> = {
  default: { bg: '#1f6b3a', fg: '#ffffff', frame: '#cfd3d6' },
  'mile-marker': { bg: '#0b8a43', fg: '#ffffff', frame: '#f2f2ee', border: '#ffffff' },
  historic: { bg: '#5c3b22', fg: '#f4ecd8', frame: '#3a2616', border: '#f4ecd8' },
  guide: { bg: '#00623f', fg: '#ffffff', frame: '#8a9094', border: '#ffffff' },
  blade: { bg: '#1f4e6b', fg: '#ffffff', frame: '#232323', border: '#ffffff' },
  town: { bg: '#34483a', fg: '#f1e8c9', frame: '#6b5a3a', border: '#c9b98a' },
};

/** The sign style a pack named, or null when it names none this build knows. */
export function signStyleOf(name: unknown): SignStyle | null {
  return (SIGN_STYLES as readonly unknown[]).includes(name) ? (name as SignStyle) : null;
}

/**
 * The style a board wears: only a `sign` takes one (billboards and the incident cones keep their
 * looks); the slot's own `params.style`, else the region's, else the default.
 */
export function styleOfSlot(kind: BoardKind, slot: BoardSlot, catalog: BoardCatalog): SignStyle {
  if (kind !== 'sign') return 'default';
  return signStyleOf(slot.params?.['style']) ?? signStyleOf(catalog.style) ?? 'default';
}

const FACE: Record<Exclude<BoardKind, 'sign'>, BoardFace> = {
  billboard: { bg: '#f4ecd8', fg: '#2b2b2b', frame: '#6b5a3a' },
  cone: { bg: '#ff6a13', fg: '#151515', frame: '#3a3a3a' },
};
/** The face a board prints on: a sign's by its style, the others' by their kind. */
function faceOf(kind: BoardKind, style: SignStyle): BoardFace {
  return kind === 'sign' ? SIGN_FACES[style] : FACE[kind];
}
/** A traffic cone (event-props.ts's shape), `k` times life size, standing at (x, z). */
const CONE_ORANGE = '#ff6a13';
const CONE_WHITE = '#f4f4f0';
export function conePartsAt(k: number, x: number, z: number): BoxPart[] {
  const parts: [number, number, number, string][] = [
    [0.42, 0.04, 0.02, CONE_ORANGE],
    [0.3, 0.22, 0.15, CONE_ORANGE],
    [0.24, 0.1, 0.31, CONE_WHITE],
    [0.18, 0.2, 0.46, CONE_ORANGE],
    [0.12, 0.1, 0.61, CONE_WHITE],
    [0.08, 0.12, 0.72, CONE_ORANGE],
  ];
  return parts.map(([w, h, y, color]) => ({ size: [w * k, h * k, w * k], at: [x, y * k, z], color }));
}
/** The incident site's cones: a big one by the placard's left edge, two smaller ones by its right. */
function incidentCones(w: number): BoxPart[] {
  return [
    ...conePartsAt(2.4, -w / 2 - 0.55, 0.1),
    ...conePartsAt(1.5, w / 2 + 0.45, 0.25),
    ...conePartsAt(1.5, w / 2 + 1.05, -0.2),
  ];
}

/** A stable index from a string (the slot id), for picking an item out of a pool. */
function stableIndex(key: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % n;
}

/** The item a slot shows: its named item, else one from its pool (stable per slot), else null. */
export function resolveSlot(slot: BoardSlot, catalog: BoardCatalog): BoardItem | null {
  if (slot.item) return catalog.items[slot.item] ?? null;
  const pool =
    slot.pool === 'signs'
      ? catalog.pools?.signs
      : slot.pool === 'billboards'
        ? catalog.pools?.billboards
        : null;
  if (!pool || pool.length === 0) return null;
  return pool[stableIndex(slot.id ?? `${slot.s0}`, pool.length)] ?? null;
}

/**
 * A board's copy as a headline and a kicker: the headline is the first sentence (3-4 words, big and
 * readable at speed), the kicker is the rest (small, for the second look). Text with one sentence
 * has no kicker.
 */
export function splitCopy(text: string): { headline: string; kicker: string } {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = /^(.+?)[.!?](?:\s+(.*))?$/.exec(t);
  if (!m) return { headline: t, kicker: '' };
  return { headline: (m[1] ?? t).trim(), kicker: (m[2] ?? '').trim() };
}

/**
 * How wide `text` is in bold sans-serif at `size` px. paintCopy measures with the canvas; the sign
 * audit (sign-fit.test.ts) measures with a font table, so both run the same layout.
 */
export type MeasureText = (text: string, size: number) => number;

/** Line height as a share of the font size. */
const LEADING = 1.08;
/** How far the size steps down while fitting, px. */
const FIT_STEP = 4;

/** Wraps `text` into the widest lines that fit `maxW` at `size`. A word wider than `maxW` keeps its own line. */
function wrap(measure: MeasureText, text: string, size: number, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    const next = line ? `${line} ${w}` : w;
    if (measure(next, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** One block of copy as laid out: its size, its lines, and whether it fitted at `min` or more. */
export interface CopyFit {
  size: number;
  lines: string[];
  /** False when even `min` was too big, so the block went below its floor to stay whole. */
  fits: boolean;
}

/**
 * The largest bold size (stepping down from `max`) whose wrapped lines fit the box: in HEIGHT, and
 * in WIDTH too, so a word wider than the box shrinks instead of being cut at both edges (the live
 * check, 2026-10-03: "END OF JURISDICTION" printed as "RISDICTI", #395; the PNW scenes' "FIREWOOD",
 * #396). If nothing from `max` down to `min` fits, the block shrinks below `min` rather than clip.
 */
export function fitCopy(
  measure: MeasureText,
  text: string,
  maxW: number,
  boxH: number,
  max: number,
  min: number,
): CopyFit {
  const widest = (lines: readonly string[], size: number) =>
    lines.reduce((w, l) => Math.max(w, measure(l, size)), 0);
  for (let size = Math.max(max, min); size >= min; size -= FIT_STEP) {
    const lines = wrap(measure, text, size, maxW);
    if (lines.length * size * LEADING <= boxH && widest(lines, size) <= maxW)
      return { size, lines, fits: true };
  }
  // Too long even at the floor: scale down until the widest line and the block fit.
  const atMin = wrap(measure, text, min, maxW);
  const w = widest(atMin, min);
  const scale = Math.min(1, w > 0 ? maxW / w : 1, boxH / Math.max(1, atMin.length * min * LEADING));
  const size = Math.max(1, Math.floor(min * scale));
  return { size, lines: wrap(measure, text, size, maxW), fits: false };
}

/** One line (no wrapping) at the largest size from `max` down whose width fits `maxW`. */
export function fitLine(measure: MeasureText, text: string, maxW: number, max: number, min: number): CopyFit {
  for (let size = Math.max(max, min); size >= min; size -= FIT_STEP)
    if (measure(text, size) <= maxW) return { size, lines: [text], fits: true };
  const w = measure(text, min);
  const size = Math.max(1, Math.floor(min * Math.min(1, w > 0 ? maxW / w : 1)));
  return { size, lines: [text], fits: false };
}

/** Copy laid out on a `width` x `height` canvas: the padding, the headline and the kicker (or null). */
export interface CopyLayout {
  pad: number;
  /** The box the lines must stay inside, px (the canvas less its padding). */
  innerW: number;
  headBoxH: number;
  subBoxH: number;
  head: CopyFit;
  sub: CopyFit | null;
}

/** The headline floor and the kicker floor, px. */
export const COPY_MIN = { head: 24, sub: 14 };

/**
 * Lays copy out as a big headline over a small kicker (see `paintCopy`); pure, so the sign audit
 * runs exactly what the painter runs.
 */
export function layoutCopy(measure: MeasureText, width: number, height: number, text: string): CopyLayout {
  const { headline, kicker } = splitCopy(text);
  const pad = Math.round(height * 0.07);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const kickerH = kicker ? innerH * 0.3 : 0;
  const headBoxH = innerH - kickerH;
  const subBoxH = kicker ? kickerH - pad * 0.4 : 0;
  const head = fitCopy(measure, headline, innerW, headBoxH, Math.round(height * 0.62), COPY_MIN.head);
  const sub = kicker
    ? fitCopy(measure, kicker, innerW, subBoxH, Math.round(head.size * 0.42), COPY_MIN.sub)
    : null;
  return { pad, innerW, headBoxH, subBoxH, head, sub };
}

/** The canvas's own measure: bold sans-serif at the asked size. */
export function canvasMeasure(ctx: CanvasRenderingContext2D): MeasureText {
  return (text, size) => {
    ctx.font = `bold ${size}px sans-serif`;
    return ctx.measureText(text).width;
  };
}

/**
 * Paints copy as a big headline over a small kicker, centred on a `width` x `height` canvas
 * (boards, the road events' warning signs and the scenes' signs share it). The caller has filled
 * the background.
 */
export function paintCopy(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  fg: string,
): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const { pad, head, sub } = layoutCopy(canvasMeasure(ctx), width, height, text);
  const headBlock = head.lines.length * head.size * LEADING;
  const subBlock = sub ? sub.lines.length * sub.size * LEADING : 0;
  const gap = sub ? pad * 0.5 : 0;
  let y = (height - (headBlock + gap + subBlock)) / 2;
  ctx.fillStyle = fg;
  ctx.font = `bold ${head.size}px sans-serif`;
  head.lines.forEach((l, i) => ctx.fillText(l, width / 2, y + (i + 0.5) * head.size * LEADING));
  y += headBlock + gap;
  if (sub) {
    ctx.globalAlpha = 0.82;
    ctx.font = `bold ${sub.size}px sans-serif`;
    sub.lines.forEach((l, i) => ctx.fillText(l, width / 2, y + (i + 0.5) * sub.size * LEADING));
    ctx.globalAlpha = 1;
  }
}

/** A board face's canvas, px: a fixed width per kind, and the panel's own aspect (width / height). */
export function boardCanvas(kind: BoardKind, aspect: number): { width: number; height: number } {
  const width = kind === 'billboard' ? 1024 : 512;
  return { width, height: Math.max(64, Math.round(width / aspect)) };
}

/**
 * The printed face: a big headline over a small kicker, in the panel's own proportions (the canvas
 * aspect matches the panel, so the letters are not stretched). Null where there is no DOM canvas.
 */
function faceTexture(item: BoardItem, face: BoardFace, aspect: number): Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const px = boardCanvas(item.kind, aspect);
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = face.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (face.border) {
    // A rule inside the copy's padding (layoutCopy's `pad`, 7 % of the height), so it never meets a letter.
    const inset = Math.round(canvas.height * 0.035);
    ctx.strokeStyle = face.border;
    ctx.lineWidth = Math.max(2, Math.round(canvas.height * 0.02));
    ctx.strokeRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2);
  }
  paintCopy(ctx, canvas.width, canvas.height, item.text, face.fg);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** A two-faced quad (front faces -z... +z both), with UVs so each face reads left to right. */
function panelGeometry(w: number, h: number): BufferGeometry {
  const x = w / 2;
  const g = new BufferGeometry();
  // Front (normal +z) and back (normal -z), 4 vertices each, slightly apart.
  const e = 0.03;
  g.setAttribute(
    'position',
    new Float32BufferAttribute(
      [-x, 0, e, x, 0, e, x, h, e, -x, h, e, x, 0, -e, -x, 0, -e, -x, h, -e, x, h, -e],
      3,
    ),
  );
  g.setAttribute(
    'normal',
    new Float32BufferAttribute(
      [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1],
      3,
    ),
  );
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.computeBoundingSphere();
  return g;
}

export class Boards {
  readonly root = new Group();
  private views: BoardView[] = [];
  private readonly hidden = new Set<string>();
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly frustum = new Frustum();
  private readonly pv = new Matrix4();
  private readonly camPos = new Vector3();
  private readonly look: LookStyle;

  constructor(look: LookStyle) {
    this.look = look;
    this.root.name = 'boards';
  }

  /**
   * Builds a board view for every `billboard` slot on the road whose item resolves. `slotsOf` gives
   * an edge's slots by road id (the road file's `features`).
   */
  build(
    road: RoadNetwork,
    slotsOf: (roadId: string) => readonly BoardSlot[] | undefined,
    catalog: BoardCatalog | undefined,
  ): void {
    this.clear();
    if (!catalog) return;
    for (const edge of road.edges) {
      for (const slot of slotsOf(edge.id) ?? []) {
        if (slot.kind !== 'billboard') continue;
        const item = resolveSlot(slot, catalog);
        if (!item) continue;
        this.views.push(this.buildView(road, edge.index, edge.length, slot, item, catalog));
      }
    }
    for (const v of this.views) {
      v.group.visible = !this.hidden.has(v.ref);
      this.root.add(v.group);
    }
  }

  /** Board views built, including hidden ones. */
  all(): readonly BoardView[] {
    return this.views;
  }

  /** Hides boards showing these items (a veto takes effect at once; presentation only). */
  hide(refs: Iterable<string>): void {
    for (const r of refs) this.hidden.add(r);
    for (const v of this.views) v.group.visible = !this.hidden.has(v.ref);
  }

  /**
   * Per frame: draws only the boards within `drawM` of the camera (render.sceneryDrawM, the
   * scenery's own draw distance; past it the houses and trees round a board are hidden too, and
   * each board costs two draw calls; main fix, 2026-10-02). A vetoed board stays hidden. Returns
   * the boards drawn.
   */
  update(cameraX: number, cameraZ: number, drawM: number): number {
    let drawn = 0;
    for (const v of this.views) {
      const near = Math.hypot(v.centre.x - cameraX, v.centre.z - cameraZ) - v.radius < drawM;
      v.group.visible = near && !this.hidden.has(v.ref);
      if (v.group.visible) drawn++;
    }
    return drawn;
  }

  /** The content reference of the nearest shown board under a point in normalized device coords. */
  pick(ndcX: number, ndcY: number, camera: Camera): string | null {
    this.ndc.set(ndcX, ndcY);
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, camera);
    const panels = this.views.filter((v) => v.group.visible).map((v) => v.panel);
    if (panels.length === 0) return null;
    this.root.updateMatrixWorld(true);
    const hit = this.raycaster.intersectObjects(panels, false)[0];
    if (!hit) return null;
    return this.views.find((v) => v.panel === hit.object)?.ref ?? null;
  }

  /** The shown boards inside the view and within VISIBLE_M, once per item: ref, kind and words. */
  visibleContent(camera: Camera): VisibleContent[] {
    camera.updateMatrixWorld();
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    camera.getWorldPosition(this.camPos);
    const out = new Map<string, VisibleContent>();
    for (const v of this.views) {
      if (!v.group.visible || out.has(v.ref)) continue;
      if (v.centre.distanceTo(this.camPos) > VISIBLE_M) continue;
      if (this.frustum.containsPoint(v.centre))
        out.set(v.ref, { ref: v.ref, kind: v.kind, label: labelOf(v.text) });
    }
    return [...out.values()];
  }

  /** Content references of the shown boards inside the view and within VISIBLE_M. */
  visibleRefs(camera: Camera): string[] {
    return this.visibleContent(camera).map((c) => c.ref);
  }

  clear(): void {
    for (const v of this.views) {
      this.root.remove(v.group);
      v.panel.geometry.dispose();
      const mat = v.panel.material as { map?: Texture | null };
      mat.map?.dispose();
    }
    this.views = [];
  }

  private buildView(
    road: RoadNetwork,
    edge: number,
    length: number,
    slot: BoardSlot,
    item: BoardItem,
    catalog: BoardCatalog,
  ): BoardView {
    const size = BOARD_SIZES[item.kind];
    const s = Math.min(length, Math.max(0, (slot.s0 + slot.s1) / 2));
    const d = (slot.d0 + slot.d1) / 2;
    const w = Math.min(size.maxW, Math.max(size.minW, Math.abs(slot.d1 - slot.d0)));
    const base = road.toWorld(edge, s, d, 0);
    const group = new Group();
    group.name = `board-${slot.id ?? item.ref}`;
    group.position.set(base.x, base.y, base.z);
    // Angle the face toward the rider coming up the road: its normal (local +z) points at the
    // road's middle AIM_AHEAD_M before the board, so it is seen nearly face-on through the approach
    // instead of edge-on from a hundred metres out.
    const aim = road.toWorld(edge, Math.max(0, s - AIM_AHEAD_M), 0, 0);
    group.rotation.y = Math.atan2(aim.x - base.x, aim.z - base.z);
    const style = styleOfSlot(item.kind, slot, catalog);
    const face = faceOf(item.kind, style);
    const postH = size.bottom + size.panelH;
    // Posts and the cross rails stand BEHIND the printed face (local -z), so nothing crosses the
    // words; the face itself is a thin panel in front of them.
    const back = -POST_BEHIND_M;
    const frame: BoxPart[] =
      item.kind === 'cone'
        ? [
            // Two short legs and a foot rail behind the placard, the cones round it.
            { size: [0.1, postH, 0.1], at: [-w * 0.4, postH / 2, back], color: face.frame },
            { size: [0.1, postH, 0.1], at: [w * 0.4, postH / 2, back], color: face.frame },
            { size: [w, 0.1, 0.1], at: [0, size.bottom - 0.05, back * 0.5], color: face.frame },
            ...incidentCones(w),
          ]
        : [
            { size: [0.18, postH, 0.18], at: [-w * 0.34, postH / 2, back], color: face.frame },
            { size: [0.18, postH, 0.18], at: [w * 0.34, postH / 2, back], color: face.frame },
            { size: [w + 0.3, 0.16, 0.14], at: [0, size.bottom - 0.08, back * 0.5], color: face.frame },
            { size: [w + 0.3, 0.16, 0.14], at: [0, postH + 0.08, back * 0.5], color: face.frame },
          ];
    const frameMesh = new Mesh(mergeBoxes(frame), this.look.material('post', { vertexColors: true }));
    const map = faceTexture(item, face, w / size.panelH);
    const panel = new Mesh(
      panelGeometry(w, size.panelH),
      this.look.material('board', map ? { map } : { color: face.bg }),
    );
    panel.name = 'board-panel';
    panel.position.y = size.bottom;
    panel.userData['contentRef'] = item.ref;
    group.add(frameMesh, panel);
    group.updateMatrixWorld(true);
    const centre = new Vector3(0, size.bottom + size.panelH / 2, 0).applyMatrix4(group.matrixWorld);
    return {
      ref: item.ref,
      slotId: slot.id ?? '',
      kind: item.kind,
      style,
      text: item.text,
      group,
      panel,
      centre,
      radius: item.kind === 'cone' ? w / 2 + 1.3 : w / 2,
    };
  }
}
