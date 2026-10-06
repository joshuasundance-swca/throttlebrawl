// Text surfaces (playtest 3, T12.6). A model never carries an invented word: its blank board is a
// "text surface" (a node with the extras `text_surface`, `width_m` and `height_m`, tools/blender/README.md),
// and the game paints the words of the pack sign whose id is the node's name in kebab case: the roof sign's
// `pdx_roof_sign_words` shows the region's sign `pdx-roof-sign-words` ("STILL RAINING"), a food cart's
// `pdx_food_cart_a_name` shows `pdx-food-cart-a-name`. So the words are pack text: the maintainer cuts one
// in the game the way he cuts any sign (long-press it, or pick it from "recently seen"), the sign's status
// takes it out of the catalog, and the board stays blank.
//
// Drawing, for the phone's budget: every surface of a road scene (the landmark layer's and the downtown's)
// is one quad of ONE mesh with ONE canvas as its map, whatever the number: one draw call. Each distinct
// text has its own row of the canvas. The quads stand 6 cm in front of the baked blank panel, and only the
// ones near the camera are in the index (a refill every REFILL_M, as landmarks.ts does), because words
// are unreadable far out. Presentation only: nothing here reaches the sim. This is a lazy chunk: it loads
// with a road that has a surface, never in the first load.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  Ray,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Raycaster,
  type Camera,
  type Texture,
} from 'three';
import {
  fitLine,
  labelOf,
  VISIBLE_M,
  type BoardCatalog,
  type MeasureText,
  type VisibleContent,
} from './boards';
import type { LookStyle } from './look';
import { textSurfaceItemId, type TextSurface } from './models';

/** How far in front of the blank panel the painted quad stands, m (clear of the depth buffer's noise). */
export const SURFACE_LIFT_M = 0.06;
/** A surface's words are in the index within this far of the camera, m. [default] */
export const SURFACE_DRAW_M = 420;
/** The index refills when the camera has moved this far, m. */
export const SURFACE_REFILL_M = 12;

/** How a surface's words are set: the board's colours and its weight. */
export interface SurfaceStyle {
  bg: string;
  fg: string;
  /** A glow round the letters (neon), px at the canvas's own scale (a share of the letter height). */
  glow: string | null;
}

/**
 * Neon on a dark board for the roof sign; white on highway green for the toll gantry's (playtest 4, P1:
 * it was a blank panel); chalk on a dark board for everything else. [default]
 */
const NEON: SurfaceStyle = { bg: '#121827', fg: '#ff7ab8', glow: '#ff2d8f' };
const HIGHWAY: SurfaceStyle = { bg: '#0f5a3a', fg: '#f6f6ee', glow: null };
const CHALK: SurfaceStyle = { bg: '#2a2f2d', fg: '#f2e9d2', glow: null };
const STYLES: Readonly<Record<string, SurfaceStyle>> = {
  pdx_roof_sign_words: NEON,
  toll_gantry_sign: HIGHWAY,
};

/**
 * Duval Street's shop names (playtest 4, P4-16): neon at dusk, each board its own colour (a street of
 * one pink is a cheap street), and plain signwriting by day. [default]
 */
const neon = (fg: string, glow: string, bg = '#13111d'): SurfaceStyle => ({ bg, fg, glow });
const SHOP_NEON: Readonly<Record<string, SurfaceStyle>> = {
  duval_balcony_a_shop_name_0: neon('#ff7ab8', '#ff2d8f'),
  duval_balcony_a_shop_name_1: neon('#7ff0ff', '#00c8ff', '#0f1a22'),
  duval_balcony_b_shop_name_0: neon('#c8ff6a', '#7dff00', '#121a14'),
  duval_balcony_b_shop_name_1: neon('#ffd27a', '#ff9f1c', '#1a150f'),
  duval_balcony_b_shop_name_2: neon('#d6a8ff', '#9b5cff', '#17121f'),
  duval_balcony_c_shop_name_0: neon('#ff9a8a', '#ff4d3d', '#1c1214'),
  duval_balcony_c_shop_name_1: neon('#8ff5d8', '#00d9a5', '#0f1b1b'),
  duval_balcony_c_shop_name_2: neon('#ffe07a', '#ffb000', '#1a170d'),
  duval_corner_bar_name: neon('#ff8fd0', '#ff3fa8', '#190f1a'),
  // The identity kit's two open-fronted bars (playtest 4, P4-19).
  duval_open_bar_a_name: neon('#ffb36b', '#ff7a00', '#1b130d'),
  duval_open_bar_b_name: neon('#9be8ff', '#2d9cff', '#0e1822'),
};
const SHOP_BY_DAY: SurfaceStyle = { bg: '#f1e6c8', fg: '#2b3a42', glow: null };

/** A surface's style: Duval's shop names are neon when `lit` (dusk, night), signwriting by day. */
export const styleOfSurface = (name: string, lit = true): SurfaceStyle => {
  const shop = SHOP_NEON[name];
  if (shop) return lit ? shop : SHOP_BY_DAY;
  return STYLES[name] ?? CHALK;
};

/** One surface as a model put it in the world: its triangles, already lifted in front of the panel. */
export interface PlacedSurface {
  /** The pack sign that fills it (`pdx-roof-sign-words`). */
  id: string;
  /** The node's name (`pdx_roof_sign_words`). */
  name: string;
  widthM: number;
  heightM: number;
  /** World positions of its triangles, three numbers per vertex, and the UVs (two per vertex). */
  positions: Float32Array;
  uvs: Float32Array;
  /** The panel's middle, in the world, and the way its face looks. */
  centre: Vector3;
  normal: Vector3;
  /**
   * Which of the board's names this building shows (playtest 4, Duval's shop names): the layer takes
   * it modulo the names the catalog has for the sign (`id`, `id-2`, `id-3`...). None: the first.
   */
  pick?: number;
}

/**
 * A model's text surface under `matrix` (its model frame to the world): its triangles, lifted off the
 * blank panel along the face's normal. A surface's front is its winding (counter-clockwise from the front).
 */
export function placeSurface(surface: TextSurface, matrix: Matrix4): PlacedSurface {
  const n = surface.positions.length / 3;
  const world = new Float32Array(n * 3);
  const p = new Vector3();
  const centre = new Vector3();
  for (let i = 0; i < n; i++) {
    p.fromArray(surface.positions, i * 3).applyMatrix4(matrix);
    p.toArray(world, i * 3);
    centre.add(p);
  }
  centre.divideScalar(Math.max(1, n));
  const a = new Vector3().fromArray(world, 0);
  const b = new Vector3().fromArray(world, 3);
  const c = new Vector3().fromArray(world, 6);
  const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  for (let i = 0; i < n; i++) {
    world[i * 3] = (world[i * 3] ?? 0) + normal.x * SURFACE_LIFT_M;
    world[i * 3 + 1] = (world[i * 3 + 1] ?? 0) + normal.y * SURFACE_LIFT_M;
    world[i * 3 + 2] = (world[i * 3 + 2] ?? 0) + normal.z * SURFACE_LIFT_M;
  }
  centre.addScaledVector(normal, SURFACE_LIFT_M);
  return {
    id: textSurfaceItemId(surface.name),
    name: surface.name,
    widthM: surface.widthM,
    heightM: surface.heightM,
    positions: world,
    uvs: surface.uvs,
    centre,
    normal,
  };
}

/** The canvas's drawing calls this module uses (a 2D context, or a test's recorder). */
export interface SurfaceContext {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  shadowColor: string;
  shadowBlur: number;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

/** Where one text's cell sits in the shared canvas, px. */
export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The cell's padding (a share of its height): the letters stay inside it. */
const PAD = 0.12;

/**
 * Paints `text` on one line, as large as fits the cell, in the style's colours. Returns the letters'
 * size and width in px (tests read it: the words must stay inside the cell).
 */
export function paintSurface(
  ctx: SurfaceContext,
  cell: Cell,
  style: SurfaceStyle,
  text: string,
  measure: MeasureText = (t, size) => {
    ctx.font = `bold ${size}px sans-serif`;
    return ctx.measureText(t).width;
  },
): { size: number; width: number } {
  ctx.fillStyle = style.bg;
  ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
  const pad = Math.round(cell.h * PAD);
  const fit = fitLine(measure, text, cell.w - pad * 2, Math.round(cell.h - pad * 2), 8);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fit.size}px sans-serif`;
  ctx.fillStyle = style.fg;
  if (style.glow) {
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = fit.size * 0.35;
  }
  ctx.fillText(fit.lines[0] ?? text, cell.x + cell.w / 2, cell.y + cell.h / 2);
  ctx.shadowBlur = 0;
  return { size: fit.size, width: measure(fit.lines[0] ?? text, fit.size) };
}

/** The suffixes of a board's other names: `duval-balcony-a-shop-name-0-2` to `-5`. */
const ALTERNATES: readonly number[] = [2, 3, 4, 5];

/** The shared canvas's width, px. */
const CANVAS_W = 1024;
/** The gap between two cells, px (so a mipmap does not bleed one text into the next). */
const GAP = 8;

/** One distinct text's place: its id (the sign), its words, its style and its cell. */
export interface Row {
  id: string;
  text: string;
  style: SurfaceStyle;
  cell: Cell;
}

/**
 * Lays the distinct texts out in rows of one canvas: each cell is as wide as the canvas and as tall as its
 * surface's own proportions give (its widest ratio, so no letter is stretched), at least 48 px.
 */
export function layoutRows(
  items: readonly { id: string; text: string; style: SurfaceStyle; aspect: number }[],
): { rows: Row[]; width: number; height: number } {
  const rows: Row[] = [];
  let y = GAP;
  for (const it of items) {
    const h = Math.max(48, Math.round(CANVAS_W / Math.max(1, it.aspect)));
    rows.push({ id: it.id, text: it.text, style: it.style, cell: { x: 0, y, w: CANVAS_W, h } });
    y += h + GAP;
  }
  return { rows, width: CANVAS_W, height: y };
}

export interface TextSurfaceCounts {
  /** Surfaces with words (their sign is in the catalog), and the ones cut on this device. */
  surfaces: number;
  cut: number;
  /** Surfaces in the index now, and the draw call the layer costs (1 while any is). */
  shown: number;
  drawCalls: number;
}

export interface TextSurfaceOptions {
  /** The region's live signs by id (`catalog.items`); a surface whose sign is not there stays blank. */
  catalog: BoardCatalog | undefined;
  /** Refs cut on this device: their surfaces stay blank. */
  hidden?: Iterable<string>;
  /** Dusk or night: Duval's shop names glow as neon; by day they are plain signwriting. Default lit. */
  lit?: boolean;
  /** Makes the shared canvas (the game's: a DOM canvas; none where there is no DOM). */
  createCanvas?: (width: number, height: number) => { ctx: SurfaceContext; texture: Texture } | null;
}

function domCanvas(width: number, height: number): { ctx: SurfaceContext; texture: Texture } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // UVs run down from the canvas's top, as glTF's do.
  texture.flipY = false;
  return { ctx, texture };
}

interface Shown {
  surface: PlacedSurface;
  ref: string;
  text: string;
  /** Its first vertex in the mesh, and how many it has. */
  v0: number;
  n: number;
}

export class TextSurfaceLayer {
  readonly group = new Group();
  private readonly shown: Shown[] = [];
  private readonly geometry: BufferGeometry | null = null;
  private readonly mesh: Mesh | null = null;
  private readonly texture: Texture | null = null;
  private readonly live: Uint32Array;
  private readonly hiddenRefs: Set<string>;
  private readonly frustum = new Frustum();
  private readonly pv = new Matrix4();
  private readonly camPos = new Vector3();
  private readonly raycaster = new Raycaster();
  private filledX = Number.NaN;
  private filledZ = Number.NaN;
  private inIndex = 0;
  private cutCount = 0;
  private total = 0;
  /** What the painter drew, per sign id (tests read it). */
  readonly painted = new Map<string, { size: number; width: number; cell: Cell }>();

  constructor(look: LookStyle, surfaces: readonly PlacedSurface[], opts: TextSurfaceOptions) {
    this.group.name = 'text-surfaces';
    this.hiddenRefs = new Set(opts.hidden ?? []);
    const items = opts.catalog?.items ?? {};
    const lit = opts.lit ?? true;
    // A board may have several names (`id`, `id-2`...): the building's pick chooses among those the
    // catalog has, so a cut name leaves the other buildings theirs.
    const want: { s: PlacedSurface; id: string }[] = [];
    for (const s of surfaces) {
      const names = [s.id, ...ALTERNATES.map((k) => `${s.id}-${k}`)].filter((n) => items[n]);
      const id = names[Math.abs(Math.floor(s.pick ?? 0)) % Math.max(1, names.length)];
      if (id) want.push({ s, id });
    }
    this.total = want.length;
    // One canvas row per distinct sign.
    const distinct = new Map<string, { id: string; text: string; style: SurfaceStyle; aspect: number }>();
    for (const { s, id } of want) {
      const item = items[id];
      if (item && !distinct.has(id))
        distinct.set(id, {
          id,
          text: item.text,
          style: styleOfSurface(s.name, lit),
          aspect: s.widthM / s.heightM,
        });
    }
    const { rows, width, height } = layoutRows([...distinct.values()]);
    const rowOf = new Map(rows.map((r) => [r.id, r]));
    const make = opts.createCanvas ?? domCanvas;
    const canvas = rows.length ? make(width, height) : null;
    if (canvas) {
      for (const r of rows) {
        const fit = paintSurface(canvas.ctx, r.cell, r.style, r.text);
        this.painted.set(r.id, { ...fit, cell: r.cell });
      }
      this.texture = canvas.texture;
      this.texture.needsUpdate = true;
    }
    // One mesh for all of them.
    const pos: number[] = [];
    const uv: number[] = [];
    for (const { s, id } of want) {
      const item = items[id];
      const row = rowOf.get(id);
      if (!item || !row) continue;
      const v0 = pos.length / 3;
      pos.push(...s.positions);
      for (let i = 0; i < s.uvs.length; i += 2) {
        uv.push(s.uvs[i] ?? 0, (row.cell.y + (s.uvs[i + 1] ?? 0) * row.cell.h) / height);
      }
      this.shown.push({ surface: s, ref: item.ref, text: item.text, v0, n: s.positions.length / 3 });
    }
    this.live = new Uint32Array(pos.length / 3);
    if (this.shown.length === 0) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setIndex(new BufferAttribute(this.live, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    const bg = this.shown[0] ? styleOfSurface(this.shown[0].surface.name, lit).bg : CHALK.bg;
    this.mesh = new Mesh(g, look.material('board', this.texture ? { map: this.texture } : { color: bg }));
    this.mesh.name = 'text-surfaces';
    // The quads are far apart (a road's length): never culled whole; the index holds only the near ones.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  /** Hides the surfaces showing these refs (a veto takes effect at once; presentation only). */
  hide(refs: Iterable<string>): void {
    for (const r of refs) this.hiddenRefs.add(r);
    this.filledX = Number.NaN;
  }

  /** Per frame: refills the index with the surfaces near the camera that are not cut. */
  update(cameraX: number, cameraZ: number): void {
    if (!this.mesh || !this.geometry) return;
    if (Math.hypot(cameraX - this.filledX, cameraZ - this.filledZ) < SURFACE_REFILL_M) return;
    this.filledX = cameraX;
    this.filledZ = cameraZ;
    let w = 0;
    let shown = 0;
    this.cutCount = 0;
    for (const s of this.shown) {
      if (this.hiddenRefs.has(s.ref)) {
        this.cutCount++;
        continue;
      }
      if (Math.hypot(s.surface.centre.x - cameraX, s.surface.centre.z - cameraZ) > SURFACE_DRAW_M) continue;
      for (let k = 0; k < s.n; k++) this.live[w++] = s.v0 + k;
      shown++;
    }
    this.inIndex = shown;
    const index = this.geometry.getIndex();
    if (index) index.needsUpdate = true;
    this.geometry.setDrawRange(0, w);
    this.mesh.visible = w > 0;
  }

  /** The surfaces in the index that the camera sees, once per sign: ref, kind and words (the veto's list). */
  visibleContent(camera: Camera): VisibleContent[] {
    camera.updateMatrixWorld();
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    camera.getWorldPosition(this.camPos);
    const out = new Map<string, VisibleContent>();
    for (const s of this.shown) {
      if (this.hiddenRefs.has(s.ref) || out.has(s.ref)) continue;
      if (s.surface.centre.distanceTo(this.camPos) > VISIBLE_M) continue;
      if (this.frustum.containsPoint(s.surface.centre))
        out.set(s.ref, { ref: s.ref, kind: 'sign', label: labelOf(s.text) });
    }
    return [...out.values()];
  }

  /** The ref of the nearest painted surface under a point in normalized device coordinates, or null. */
  pick(ndcX: number, ndcY: number, camera: Camera): string | null {
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
    const ray: Ray = this.raycaster.ray;
    camera.getWorldPosition(this.camPos);
    let best: { ref: string; t: number } | null = null;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const hit = new Vector3();
    for (const s of this.shown) {
      if (this.hiddenRefs.has(s.ref)) continue;
      if (s.surface.centre.distanceTo(this.camPos) > SURFACE_DRAW_M) continue;
      for (let k = 0; k + 2 < s.n; k += 3) {
        a.fromArray(s.surface.positions, k * 3);
        b.fromArray(s.surface.positions, k * 3 + 3);
        c.fromArray(s.surface.positions, k * 3 + 6);
        if (!ray.intersectTriangle(a, b, c, true, hit)) continue;
        const t = hit.distanceTo(ray.origin);
        if (!best || t < best.t) best = { ref: s.ref, t };
      }
    }
    return best?.ref ?? null;
  }

  counts(): TextSurfaceCounts {
    return {
      surfaces: this.total,
      cut: this.cutCount,
      shown: this.inIndex,
      drawCalls: this.mesh?.visible ? 1 : 0,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometry?.dispose();
    this.texture?.dispose();
  }
}
