// Placeholder signs and billboards (docs/milestones/M2.md, render-2; docs/architecture.md, "In-game
// veto"). A road's `billboard` feature is a slot; it names one region item, or a pool the game
// fills from. Each board view carries its item's content reference, so the veto can name exactly
// what the player long-pressed (`pick`), and the pause screen can list what was on screen
// (`visibleRefs`). ui/ never imports render/: app/ hands the result across.
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

export type BoardKind = 'sign' | 'billboard';

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
  items: Readonly<Record<string, BoardItem>>;
  pools?: { signs?: readonly BoardItem[]; billboards?: readonly BoardItem[] };
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
}

export interface BoardView {
  ref: string;
  slotId: string;
  kind: BoardKind;
  text: string;
  group: Group;
  /** The printed face, the part a long-press lands on. */
  panel: Mesh;
  /** Centre of the panel, world space. */
  centre: Vector3;
}

/** Only boards this close count as seen (they are unreadable further out). */
export const VISIBLE_M = 250;

// Sized to be read at up to about 100 mph (44.7 m/s): a billboard's headline letters stand about
// 1.4 m tall, so they read from roughly 100 m out and the rider has the best part of two seconds.
const SIZES: Record<BoardKind, { panelH: number; bottom: number; minW: number; maxW: number }> = {
  sign: { panelH: 1.8, bottom: 1.8, minW: 3.2, maxW: 4.6 },
  billboard: { panelH: 4.6, bottom: 4, minW: 8.5, maxW: 13 },
};
/** How far ahead of a board (along its road) the rider it turns toward is, metres. */
const AIM_AHEAD_M = 70;
/** How far behind the printed face the posts stand, metres. */
const POST_BEHIND_M = 0.22;
const FACE: Record<BoardKind, { bg: string; fg: string; frame: string }> = {
  sign: { bg: '#1f6b3a', fg: '#ffffff', frame: '#cfd3d6' },
  billboard: { bg: '#f4ecd8', fg: '#2b2b2b', frame: '#6b5a3a' },
};

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

/** Wraps `text` into the widest lines that fit `maxW` at the context's current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The largest bold size (stepping down from `max`) whose wrapped lines fit the box. */
function fit(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  boxH: number,
  max: number,
  min: number,
): { size: number; lines: string[] } {
  let size = max;
  let lines: string[] = [];
  for (; size >= min; size -= 4) {
    ctx.font = `bold ${size}px sans-serif`;
    lines = wrap(ctx, text, maxW);
    if (lines.length * size * 1.08 <= boxH) break;
  }
  return { size: Math.max(size, min), lines };
}

/**
 * The printed face: a big headline over a small kicker, in the panel's own proportions (the canvas
 * aspect matches the panel, so the letters are not stretched). Null where there is no DOM canvas.
 */
function faceTexture(item: BoardItem, aspect: number): Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = item.kind === 'sign' ? 512 : 1024;
  canvas.height = Math.max(64, Math.round(canvas.width / aspect));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const face = FACE[item.kind];
  ctx.fillStyle = face.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const { headline, kicker } = splitCopy(item.text);
  const pad = Math.round(canvas.height * 0.07);
  const innerW = canvas.width - pad * 2;
  const innerH = canvas.height - pad * 2;
  const kickerH = kicker ? innerH * 0.3 : 0;
  const head = fit(ctx, headline, innerW, innerH - kickerH, Math.round(canvas.height * 0.62), 24);
  const sub = kicker ? fit(ctx, kicker, innerW, kickerH - pad * 0.4, Math.round(head.size * 0.42), 14) : null;
  const headBlock = head.lines.length * head.size * 1.08;
  const subBlock = sub ? sub.lines.length * sub.size * 1.08 : 0;
  const gap = sub ? pad * 0.5 : 0;
  let y = (canvas.height - (headBlock + gap + subBlock)) / 2;
  ctx.fillStyle = face.fg;
  ctx.font = `bold ${head.size}px sans-serif`;
  head.lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, y + (i + 0.5) * head.size * 1.08));
  y += headBlock + gap;
  if (sub) {
    ctx.globalAlpha = 0.82;
    ctx.font = `bold ${sub.size}px sans-serif`;
    sub.lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, y + (i + 0.5) * sub.size * 1.08));
    ctx.globalAlpha = 1;
  }
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
        this.views.push(this.buildView(road, edge.index, edge.length, slot, item));
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

  /** Content references of the shown boards inside the view and within VISIBLE_M. */
  visibleRefs(camera: Camera): string[] {
    camera.updateMatrixWorld();
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    camera.getWorldPosition(this.camPos);
    const out = new Set<string>();
    for (const v of this.views) {
      if (!v.group.visible) continue;
      if (v.centre.distanceTo(this.camPos) > VISIBLE_M) continue;
      if (this.frustum.containsPoint(v.centre)) out.add(v.ref);
    }
    return [...out];
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
  ): BoardView {
    const size = SIZES[item.kind];
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
    const face = FACE[item.kind];
    const postH = size.bottom + size.panelH;
    // Posts and the cross rails stand BEHIND the printed face (local -z), so nothing crosses the
    // words; the face itself is a thin panel in front of them.
    const back = -POST_BEHIND_M;
    const frame: BoxPart[] = [
      { size: [0.18, postH, 0.18], at: [-w * 0.34, postH / 2, back], color: face.frame },
      { size: [0.18, postH, 0.18], at: [w * 0.34, postH / 2, back], color: face.frame },
      { size: [w + 0.3, 0.16, 0.14], at: [0, size.bottom - 0.08, back * 0.5], color: face.frame },
      { size: [w + 0.3, 0.16, 0.14], at: [0, postH + 0.08, back * 0.5], color: face.frame },
    ];
    const frameMesh = new Mesh(mergeBoxes(frame), this.look.material('post', { vertexColors: true }));
    const map = faceTexture(item, w / size.panelH);
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
    return { ref: item.ref, slotId: slot.id ?? '', kind: item.kind, text: item.text, group, panel, centre };
  }
}
