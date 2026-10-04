// Air that pays (the pitch deck's #13, run W-T), what render draws of it:
// - the chalk mark: "a chalk mark shows where you'll touch down, red if you're crooked". While the
//   player is in the air, a chalk ring with a cross sits flat on the ground at the sim's forecast
//   touch-down point (`EntitySnapshot.touchdown`), turned along the bike's heading there: chalk white
//   for a clean landing, red when landing now would be crooked;
// - the one-liner: a clean landing after real air (`land` with `data.surge`) pops one of the region's
//   `landingLines` ('TEN OUT OF TEN, SAYS A PELICAN') in chalk for a moment, centred just under the
//   road ahead. It is listed among the content in view while it shows, so "cut this" can cut it. It
//   draws on a screen-space overlay AFTER the look's film pass, in CSS pixels on a dark plate, at
//   least LINE_MIN_FONT_PX tall (the live check, run W-T: drawn in the 3D scene, the film pass
//   painted the sky over it in the default Ink + 60s look, and in classic its letters were about 6 px
//   tall). Playtest 3 (2026-10-03): "The black and white text pop-ups block the actual game", and the
//   HUD rule is that nothing covers the road ahead (the middle half across, 25-65 % down) or another
//   HUD piece. Over the bike, it sat in the middle of the road; just under the road ahead it still
//   covered the bike from the seat down in the Keys (the live check after #430). So it sits under the
//   player's bike as the camera shows it (its screen box, projected from the rider's frame), between
//   the bottom corners' speed, health and touch buttons, a little smaller when the room is short.
//   While it shows, render marks its canvas `data-landing-line`, and ui's career prompt (which shares
//   that band) steps aside for its 2 s;
// - the newspaper: while the player's rider sits back reading it (`trick: 'newspaper'`), the paper is
//   held up in front of him; landing with it (a crash whose `data.attempt` is `newspaper`), it flies
//   off down the road.
// Code-made and flat: one draw call for the mark, one for the paper and one for the line, each only
// while it shows. Presentation only: it reads snapshots and events, never sim state.
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import type { BoardItem } from './boards';
import { mergeBoxes, type BoxPart } from './geometry';

/** The chalk's colours: clean, and crooked. */
export const CHALK_CLEAN = '#f3efe2';
export const CHALK_CROOKED = '#e8392c';
/** The mark's ring radius and line width, m; lifted this far over the road so it never z-fights. */
const RING_R = 0.75;
const LINE_W = 0.11;
const LIFT_M = 0.05;
/** The one-liner shows this long, s, fading over the last FADE_S. */
export const LINE_S = 2;
const FADE_S = 0.45;
/**
 * The road ahead on screen, as fractions of the view (the HUD rule, playtest 3): the plate's top sits
 * just under its bottom edge, and on a landscape screen the plate is no wider than it.
 */
export const ROAD_AHEAD_BOTTOM = 0.65;
export const ROAD_AHEAD_WIDTH = 0.5;
/**
 * The bottom corners' HUD on a landscape screen (the touch buttons, with the speed and health across
 * from them) reaches about this far in from each side, as a fraction of the short side (the classic
 * layout's BRAKE button: 0.4 in, 0.18 wide). On an upright screen the speed and health rise about
 * PORTRAIT_FOOT of the short side from the bottom. [default]
 */
export const CORNER_REACH = 0.6;
export const PORTRAIT_FOOT = 0.3;
/**
 * The player's bike and rider as boxes in the rider's frame (render/views.ts: x across, y up from
 * the ground, z along with the nose toward -z), metres: the bike, then the rider on it. Their screen
 * box is what the landing line keeps clear of. tests/e2e/ui-style-popups.spec.ts measures the same
 * shape independently.
 */
export const BIKE_SHAPE: readonly { min: [number, number, number]; max: [number, number, number] }[] = [
  { min: [-0.35, 0, -0.95], max: [0.35, 1.05, 0.95] },
  { min: [-0.45, 0.5, -0.45], max: [0.45, 1.75, 0.35] },
];

/** A box on screen, CSS px from the top left. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The screen box of BIKE_SHAPE in a frame (`frame`: its world matrix, column-major), seen through a
 * camera (its view and projection matrices) on a `viewW` x `viewH` CSS px screen; null when it is
 * behind the camera.
 */
export function bikeScreenBox(
  frame: ArrayLike<number>,
  view: ArrayLike<number>,
  projection: ArrayLike<number>,
  viewW: number,
  viewH: number,
): ScreenBox | null {
  const mul = (e: ArrayLike<number>, x: number, y: number, z: number): [number, number, number, number] => [
    (e[0] ?? 0) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z + (e[12] ?? 0),
    (e[1] ?? 0) * x + (e[5] ?? 0) * y + (e[9] ?? 0) * z + (e[13] ?? 0),
    (e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 0) * z + (e[14] ?? 0),
    (e[3] ?? 0) * x + (e[7] ?? 0) * y + (e[11] ?? 0) * z + (e[15] ?? 0),
  ];
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const b of BIKE_SHAPE)
    for (const x of [b.min[0], b.max[0]])
      for (const y of [b.min[1], b.max[1]])
        for (const z of [b.min[2], b.max[2]]) {
          const wp = mul(frame, x, y, z);
          const vp = mul(view, wp[0], wp[1], wp[2]);
          const [cx, cy, , cw] = mul(projection, vp[0], vp[1], vp[2]);
          if (!(cw > 0.05)) continue; // behind the camera
          const sx = ((cx / cw + 1) / 2) * viewW;
          const sy = ((1 - cy / cw) / 2) * viewH;
          box.left = Math.min(box.left, sx);
          box.right = Math.max(box.right, sx);
          box.top = Math.min(box.top, sy);
          box.bottom = Math.max(box.bottom, sy);
        }
  return box.right > box.left ? box : null;
}
/**
 * The one-liner's letters on screen, CSS px: about 6.5% of the screen's short side, never under
 * LINE_MIN_FONT_PX (a phone at arm's length) nor over LINE_MAX_FONT_PX.
 */
export const LINE_MIN_FONT_PX = 18;
export const LINE_MAX_FONT_PX = 30;
const LINE_FONT_OF_SHORT_SIDE = 0.065;
/** It stays this far inside the screen's edges, CSS px. */
const LINE_MARGIN_PX = 8;
/**
 * The bike keeps settling after the line is placed (the landing's suspension and the chase camera
 * catching up: in a CI race on #446 it sank 12 to 14 px, 0.16 of its screen height, under a plate
 * placed on the landing frame). So where there is room the plate leaves it this share of the bike's
 * height more, at most LINE_SETTLE_MAX_PX; where there is not, it keeps the old place. [default]
 */
const LINE_SETTLE_OF_BIKE = 0.2;
const LINE_SETTLE_MAX_PX = 24;
/** The dark plate behind the chalk (its contrast holds over any sky or sea: see the tests). */
export const LINE_PLATE = '#141414';
export const LINE_PLATE_ALPHA = 0.85;
const LINE_FONT = (px: number) => `bold ${px}px sans-serif`;
/** The paper is held this high and this far ahead of the rider's road position, m. */
const PAPER_UP_M = 1.4;
const PAPER_AHEAD_M = 0.55;

/** The chalk mark's geometry: a ring and a cross, flat in the x-z plane (y up). */
export function chalkMarkGeometry(): BufferGeometry {
  const pos: number[] = [];
  const quad = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    dx: number,
    dz: number,
  ) => {
    pos.push(ax, 0, az, bx, 0, bz, cx, 0, cz, ax, 0, az, cx, 0, cz, dx, 0, dz);
  };
  const N = 28;
  const r0 = RING_R - LINE_W / 2;
  const r1 = RING_R + LINE_W / 2;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const b = ((i + 1) / N) * Math.PI * 2;
    const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
    quad(ca * r0, sa * r0, cb * r0, sb * r0, cb * r1, sb * r1, ca * r1, sa * r1);
  }
  // The cross: two strokes through the centre, at 45 degrees to the heading.
  const h = RING_R * 0.85;
  const w = LINE_W / 2;
  for (const s of [1, -1]) {
    const ux = Math.SQRT1_2 * s;
    const uz = Math.SQRT1_2;
    const nx = -uz;
    const nz = ux;
    quad(
      -ux * h - nx * w,
      -uz * h - nz * w,
      ux * h - nx * w,
      uz * h - nz * w,
      ux * h + nx * w,
      uz * h + nz * w,
      -ux * h + nx * w,
      -uz * h + nz * w,
    );
  }
  // A short tick ahead of the ring: which way the bike will be heading (models face -z).
  quad(-w, -r1, w, -r1, w, -r1 - 0.45, -w, -r1 - 0.45);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

/** The newspaper: a cream broadsheet with a headline bar and columns, facing +z (toward the rider). */
export function newspaperParts(): BoxPart[] {
  const ink = '#2a2a2a';
  const parts: BoxPart[] = [{ size: [0.62, 0.42, 0.012], at: [0, 0, 0], color: '#ece6d2' }];
  parts.push({ size: [0.52, 0.07, 0.004], at: [0, 0.14, 0.008], color: ink });
  for (const x of [-0.18, 0, 0.18])
    parts.push({ size: [0.14, 0.2, 0.004], at: [x, -0.05, 0.008], color: '#8d877a' });
  // The back page faces the road too: the same headline bar.
  parts.push({ size: [0.52, 0.07, 0.004], at: [0, 0.14, -0.008], color: ink });
  return parts;
}

/** How wide a text is at a font size, CSS px. */
export type MeasureText = (text: string, fontPx: number) => number;

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** The browser's own measure of the bold sans; without a canvas (tests), 0.7 em a capital. */
const measureLine: MeasureText = (text, fontPx) => {
  if (measureCtx === undefined)
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * fontPx * 0.7;
  measureCtx.font = LINE_FONT(fontPx);
  return measureCtx.measureText(text).width;
};

/** The one-liner as laid out on screen, CSS px: its rows, letter size and plate. */
export interface LineLayout {
  rows: string[];
  fontPx: number;
  plateW: number;
  plateH: number;
}

/** Splits a line at the space nearest its middle (a lone word stays whole). */
function twoRows(text: string): string[] {
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++)
    if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? [text] : [text.slice(0, best), text.slice(best + 1)];
}

/**
 * Lays the one-liner out for a screen `viewW` x `viewH` CSS px: one row at the screen's letter size
 * when it fits, else two rows, shrinking only as far as LINE_MIN_FONT_PX if even those are too wide
 * or taller than `maxH`. Its room is the screen's width on an upright screen, and on a landscape one
 * the road ahead's width, kept inside the bottom corners' HUD (CORNER_REACH).
 */
export function landingLineLayout(
  text: string,
  viewW: number,
  viewH: number,
  measure: MeasureText = measureLine,
  maxH = Infinity,
): LineLayout {
  const short = Math.min(viewW, viewH);
  const across =
    viewH > viewW
      ? viewW
      : Math.min(viewW * ROAD_AHEAD_WIDTH, viewW - 2 * (CORNER_REACH * short + LINE_MARGIN_PX));
  const room = Math.max(1, across - 2 * LINE_MARGIN_PX);
  const want = Math.round(short * LINE_FONT_OF_SHORT_SIDE);
  let fontPx = Math.min(LINE_MAX_FONT_PX, Math.max(LINE_MIN_FONT_PX, want));
  const plateFor = (rows: string[], px: number) => {
    const pad = Math.round(px * 0.6);
    const wide = Math.max(...rows.map((r) => measure(r, px)));
    return { w: Math.ceil(wide + 2 * pad), h: Math.ceil(rows.length * px * 1.2 + px * 0.6) };
  };
  const tooBig = (rows: string[], px: number) => {
    const p = plateFor(rows, px);
    return p.w > room || p.h > maxH;
  };
  let rows = [text];
  if (plateFor(rows, fontPx).w > room) rows = twoRows(text);
  while (fontPx > LINE_MIN_FONT_PX && tooBig(rows, fontPx)) fontPx -= 1;
  const plate = plateFor(rows, fontPx);
  return { rows, fontPx, plateW: Math.min(plate.w, room), plateH: plate.h };
}

/** Paints the laid-out one-liner at `pixelRatio`: chalk letters with a dark edge on a dark plate. */
function lineTexture(layout: LineLayout, pixelRatio: number): Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const pr = Math.max(1, pixelRatio);
  canvas.width = Math.ceil(layout.plateW * pr);
  canvas.height = Math.ceil(layout.plateH * pr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(canvas.width / layout.plateW, canvas.height / layout.plateH);
  const w = layout.plateW;
  const h = layout.plateH;
  const r = Math.min(h / 2, layout.fontPx * 0.45);
  ctx.globalAlpha = LINE_PLATE_ALPHA;
  ctx.fillStyle = LINE_PLATE;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.font = LINE_FONT(layout.fontPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, Math.round(layout.fontPx * 0.16));
  ctx.strokeStyle = LINE_PLATE;
  ctx.fillStyle = CHALK_CLEAN;
  const rowH = layout.fontPx * 1.2;
  const top = (h - layout.rows.length * rowH) / 2 + rowH / 2;
  const fit = w - layout.fontPx; // a font wider than measured still stays on the plate
  layout.rows.forEach((row, i) => {
    ctx.strokeText(row, w / 2, top + i * rowH, fit);
    ctx.fillText(row, w / 2, top + i * rowH, fit);
  });
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  return tex;
}

/** Which line comes next: never the one just shown when there is another. */
export function nextLineIndex(count: number, last: number, tick: number): number {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  const step = 1 + (Math.abs(Math.floor(tick)) % (count - 1));
  return last < 0 ? Math.abs(Math.floor(tick)) % count : (last + step) % count;
}

/** What the last frame drew, for tests and the debug overlay. */
export interface AirPaysCounts {
  mark: boolean;
  crooked: boolean;
  paper: boolean;
  line: string | null;
}

interface Flying {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  ground: number;
  restS: number;
}

export class AirPays {
  readonly root = new Group();
  /** The screen-space overlay the one-liner draws on, after the film pass (CSS px, y up). */
  readonly overlay = new Scene();
  readonly overlayCamera = new OrthographicCamera(0, 1, 1, 0, -10, 10);
  readonly mark: Mesh;
  readonly paper: Mesh;
  readonly line: Sprite;
  private readonly markMat: MeshBasicMaterial;
  private readonly lineMat: SpriteMaterial;
  private readonly clean = new Color(CHALK_CLEAN);
  private readonly crookedColor = new Color(CHALK_CROOKED);
  private lines: BoardItem[] = [];
  private lastLine = -1;
  private shown: { item: BoardItem; until: number } | null = null;
  /** Whether the line shows this frame (a line is up and the player is there). */
  private posed = false;
  /** What the line's texture was painted for: the line, the screen and the pixel ratio. */
  private paintedKey = '';
  private layout: LineLayout | null = null;
  /** The plate's top, CSS px from the screen's top, as set when the line first showed. */
  private plateTop = 0;
  private pendingSurge: SimEvent[] = [];
  private pendingCrash: SimEvent[] = [];
  private flying: Flying | null = null;
  private lastT = -1;
  private counts: AirPaysCounts = { mark: false, crooked: false, paper: false, line: null };

  constructor() {
    this.root.name = 'air-pays';
    this.markMat = new MeshBasicMaterial({
      color: CHALK_CLEAN,
      transparent: true,
      opacity: 0.88,
      side: DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mark = new Mesh(chalkMarkGeometry(), this.markMat);
    this.mark.name = 'chalk-mark';
    this.mark.renderOrder = 2;
    this.mark.frustumCulled = false;
    this.mark.visible = false;
    this.paper = new Mesh(mergeBoxes(newspaperParts()), new MeshBasicMaterial({ vertexColors: true }));
    this.paper.name = 'newspaper';
    this.paper.visible = false;
    this.lineMat = new SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.line = new Sprite(this.lineMat);
    this.line.name = 'landing-line';
    this.line.visible = false;
    this.line.frustumCulled = false;
    this.root.add(this.mark, this.paper);
    this.overlay.name = 'air-pays-overlay';
    this.overlay.add(this.line);
  }

  /** The region's live one-liners (vetoed ones already left out by app/). */
  setLines(lines: readonly BoardItem[]): void {
    this.lines = [...lines];
    this.lastLine = -1;
    this.clearLine();
  }

  /** Sim events: a surge landing (the one-liner) and a newspaper crash (the paper flies off). */
  pushEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'land' && e.data['surge'] === true) this.pendingSurge.push(e);
      if (e.type === 'crash' && e.data['attempt'] === 'newspaper') this.pendingCrash.push(e);
    }
  }

  /**
   * Updates from the snapshots: `alpha` interpolates the player between them, `timeS` is wall-clock
   * seconds (the line's life and the paper's flight; both crawl with the world's time scale).
   */
  update(prev: SimSnapshot | null, curr: SimSnapshot | null, alpha: number, timeS: number): void {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, timeS - this.lastT)) * (curr?.timeScale ?? 1);
    this.lastT = timeS;
    const me = curr?.entities.find((e) => e.kind === 'rider' && e.slot === 0);
    const was = me ? prev?.entities.find((e) => e.id === me.id) : undefined;
    const pose = me ? lerped(was ?? me, me, alpha) : null;
    this.updateMark(me, was, alpha);
    this.updatePaper(me, pose, dt);
    this.updateLine(me, pose, timeS);
  }

  private updateMark(me: EntitySnapshot | undefined, was: EntitySnapshot | undefined, alpha: number): void {
    const td = me?.mode === 'Airborne' ? me.touchdown : null;
    if (!td || !(td.inS > 0)) {
      this.mark.visible = false;
      this.counts.mark = false;
      return;
    }
    const from = was?.touchdown ?? td;
    const t = Math.min(1, Math.max(0, alpha));
    const x = from.x + (td.x - from.x) * t;
    const y = from.y + (td.y - from.y) * t;
    const z = from.z + (td.z - from.z) * t;
    this.mark.position.set(x, y + LIFT_M, z);
    this.mark.rotation.set(0, td.heading, 0);
    this.markMat.color.copy(td.crooked ? this.crookedColor : this.clean);
    // It firms up as the ground comes near (faint at the top of a long jump).
    this.markMat.opacity = 0.55 + 0.35 * Math.min(1, Math.max(0, 1 - td.inS / 1.5));
    this.mark.visible = true;
    this.counts.mark = true;
    this.counts.crooked = td.crooked;
  }

  private updatePaper(me: EntitySnapshot | undefined, pose: Pose | null, dt: number): void {
    for (const e of this.pendingCrash) {
      if (!me || e.actor !== me.id || !pose) continue;
      // Landed holding the newspaper: off it goes, forward and up, spinning.
      const fx = -Math.sin(pose.heading);
      const fz = -Math.cos(pose.heading);
      const at = this.paperAt(pose);
      this.flying = {
        ...at,
        vx: fx * me.speed * 0.6,
        vy: 4,
        vz: fz * me.speed * 0.6,
        spin: 9,
        ground: pose.y - Math.max(0, me.road.h),
        restS: 0,
      };
    }
    this.pendingCrash = [];
    const f = this.flying;
    if (f) {
      f.vy -= 9.8 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      if (f.y < f.ground + 0.05) {
        f.y = f.ground + 0.05;
        f.vx *= 0.5;
        f.vz *= 0.5;
        f.vy = 0;
        f.spin *= 0.5;
        f.restS += dt;
      }
      this.paper.position.set(f.x, f.y, f.z);
      this.paper.rotation.x += f.spin * dt;
      this.paper.rotation.y += f.spin * 0.6 * dt;
      this.paper.visible = true;
      this.counts.paper = true;
      if (f.restS > 2.5) this.flying = null;
      return;
    }
    const reading = me?.mode === 'Airborne' && me.trick === 'newspaper' && pose;
    this.paper.visible = !!reading;
    this.counts.paper = !!reading;
    if (!reading || !pose) return;
    const at = this.paperAt(pose);
    this.paper.position.set(at.x, at.y, at.z);
    // Facing the rider, tipped back a little toward his eyes.
    this.paper.rotation.set(0, 0, 0);
    this.paper.rotation.order = 'YXZ';
    this.paper.rotation.y = pose.heading;
    this.paper.rotation.x = -0.35;
  }

  private paperAt(pose: Pose): { x: number; y: number; z: number } {
    return {
      x: pose.x - Math.sin(pose.heading) * PAPER_AHEAD_M,
      y: pose.y + PAPER_UP_M,
      z: pose.z - Math.cos(pose.heading) * PAPER_AHEAD_M,
    };
  }

  private updateLine(me: EntitySnapshot | undefined, pose: Pose | null, timeS: number): void {
    for (const e of this.pendingSurge) {
      if (!me || e.actor !== me.id || this.lines.length === 0) continue;
      const i = nextLineIndex(this.lines.length, this.lastLine, e.tick);
      const item = this.lines[i];
      if (!item) continue;
      this.lastLine = i;
      this.shown = { item, until: timeS + LINE_S };
      this.paintedKey = '';
    }
    this.pendingSurge = [];
    const s = this.shown;
    if (!s || timeS >= s.until || !pose) {
      if (s && timeS >= s.until) this.clearLine();
      this.line.visible = false;
      this.posed = false;
      return;
    }
    const left = s.until - timeS;
    this.lineMat.opacity = Math.min(1, left / FADE_S);
    this.posed = true;
    this.counts.line = s.item.text;
  }

  /**
   * Lays the one-liner out on a `viewW` x `viewH` CSS px screen for this frame: its plate is centred
   * across, its top under the road ahead and under the player's bike (`bike`, its screen box, as the
   * line first shows), above the bottom HUD on an upright screen, wholly on screen. Its size and place
   * are set as it first shows (and again if the screen or the pixel ratio changes), so it holds still
   * while the bike bobs; the texture is repainted only then. Returns whether a line is showing.
   */
  fitOverlay(viewW: number, viewH: number, pixelRatio: number, bike: ScreenBox | null = null): boolean {
    const s = this.shown;
    if (!s || !this.posed) {
      this.line.visible = false;
      return false;
    }
    const w = Math.max(1, viewW);
    const h = Math.max(1, viewH);
    const m = LINE_MARGIN_PX;
    const key = `${s.item.ref}|${w}|${h}|${pixelRatio}`;
    if (key !== this.paintedKey || !this.layout) {
      this.paintedKey = key;
      // The band it may use: from under the road ahead and the bike to the screen's foot (on an
      // upright screen, above the speed and health).
      const under = Math.max(h * ROAD_AHEAD_BOTTOM, bike?.bottom ?? 0) + m;
      const foot = (h > w ? h - PORTRAIT_FOOT * Math.min(w, h) : h) - m;
      this.layout = landingLineLayout(s.item.text, w, h, measureLine, foot - under);
      // Too tall even at its smallest: it rises over the bike rather than into the HUD below.
      const top = Math.max(h * ROAD_AHEAD_BOTTOM + m, Math.min(under, foot - this.layout.plateH));
      // It fits under the bike: room to spare goes to the bike's settling, up to LINE_SETTLE_*.
      const settle = bike ? Math.min(LINE_SETTLE_MAX_PX, LINE_SETTLE_OF_BIKE * (bike.bottom - bike.top)) : 0;
      this.plateTop = top >= under ? Math.max(top, Math.min(under + settle, foot - this.layout.plateH)) : top;
      this.lineMat.map?.dispose();
      this.lineMat.map = lineTexture(this.layout, pixelRatio);
      this.lineMat.needsUpdate = true;
    }
    const l = this.layout;
    const cam = this.overlayCamera;
    if (cam.right !== w || cam.top !== h) {
      cam.right = w;
      cam.top = h;
      cam.updateProjectionMatrix();
    }
    // The plate's centre, CSS px from the top, wholly on screen.
    const cyTop = clamp(this.plateTop + l.plateH / 2, l.plateH / 2 + m, h - l.plateH / 2 - m, h / 2);
    this.line.position.set(w / 2, h - cyTop, 0);
    this.line.scale.set(l.plateW, l.plateH, 1);
    // Painted only where there is a canvas (not in node tests): the layout above still holds.
    this.line.visible = this.lineMat.map !== null;
    return true;
  }

  /**
   * Draws the one-liner over the finished frame, after the film pass, so the look neither inks,
   * grades nor paints the sky over it. One draw call while it shows, none otherwise.
   */
  drawOverlay(gl: WebGLRenderer, viewW: number, viewH: number, bike: ScreenBox | null = null): void {
    if (!this.fitOverlay(viewW, viewH, gl.getPixelRatio(), bike) || !this.line.visible) return;
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    gl.render(this.overlay, this.overlayCamera);
    gl.autoClear = autoClear;
  }

  private clearLine(): void {
    this.shown = null;
    this.posed = false;
    this.line.visible = false;
    this.counts.line = null;
  }

  /** The one-liner's content reference while it shows (for "recently seen" and "cut this"). */
  visibleRefs(): string[] {
    return this.shown ? [this.shown.item.ref] : [];
  }

  /** Leaves out lines cut on this device from now on, and takes a cut one off the screen. */
  hide(refs: Iterable<string>): void {
    const cut = new Set(refs);
    this.lines = this.lines.filter((l) => !cut.has(l.ref));
    if (this.shown && cut.has(this.shown.item.ref)) this.clearLine();
    this.lastLine = -1;
  }

  /** What the last frame drew. */
  stats(): AirPaysCounts {
    return { ...this.counts };
  }

  dispose(): void {
    this.mark.geometry.dispose();
    this.markMat.dispose();
    this.paper.geometry.dispose();
    (this.paper.material as MeshBasicMaterial).dispose();
    this.lineMat.map?.dispose();
    this.lineMat.dispose();
  }
}

/** `v` kept within [lo, hi]; when the range is empty (the plate wider than the screen), `mid`. */
function clamp(v: number, lo: number, hi: number, mid: number): number {
  return lo > hi ? mid : Math.min(hi, Math.max(lo, v));
}

interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
}

function lerped(a: EntitySnapshot, b: EntitySnapshot, alpha: number): Pose {
  const t = Math.min(1, Math.max(0, alpha));
  let dh = b.heading - a.heading;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    heading: a.heading + dh * t,
  };
}
