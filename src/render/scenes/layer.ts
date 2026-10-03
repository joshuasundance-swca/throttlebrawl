// The staged roadside scenes, drawn (run W-T, pitch 6 "the horizon comes alive": "small staged
// scenes beside the road, each with ONE dry sign"; "merge each scene into one mesh, use far
// stand-ins"). A lazy chunk: a race loads it with its region's scenes file, and the first load never
// pays for it.
//
// Drawing: each placed scene is ONE mesh with one material, so a scene in view costs one draw call
// and a scene out of range costs none. Its boxes are vertex-coloured; its sign's printed face takes
// its letters from one texture per race (an atlas of the race's signs, with a white corner every
// box samples), so the words need no second material. The parts marked `far` and the sign come
// first in the buffer, the small parts after: past the far level of detail a scene draws only the
// first stretch (its outline and its sign), a draw range, not a second mesh.
import {
  BufferGeometry,
  CanvasTexture,
  Euler,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import type { RoadNetwork } from '../../road';
import { paintCopy } from '../boards';
import type { LookStyle } from '../look';
import type { ScenerySpot } from '../scenery';
import type { SceneDef, ScenesFile } from './data';
import { placeScenes, type PlacedScene } from './place';

/** Every pack's scenes files, fetched on demand: `/packs/<pack>/assets/scenes/<region>.json`. */
const SCENE_FILES = import.meta.glob<ScenesFile>('/packs/*/assets/scenes/*.json', { import: 'default' });

/** The scenes file of a region (its pack id too), or null when no pack gives that region scenes. */
export async function loadScenes(region: string): Promise<{ pack: string; file: ScenesFile } | null> {
  const key = Object.keys(SCENE_FILES).find((k) => k.endsWith(`/assets/scenes/${region}.json`));
  if (!key) return null;
  const pack = /\/packs\/([^/]+)\//.exec(key)?.[1] ?? '';
  return { pack, file: await SCENE_FILES[key]!() };
}

/** A sign's veto reference (docs/content-packs.md, "In-game veto", the scenes' form). */
export const sceneRef = (pack: string, region: string, id: string) => `${pack}:scenes/${region}#${id}`;

/** The atlas: a white corner every box samples, then the race's signs, two to a row. */
const ATLAS_W = 1024;
const WHITE_PX = 128;
const SIGN_W = 512;
const POST_COLOUR = '#6b5a3a';

interface Rect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** A scene sign's cell in the atlas, px: SIGN_W wide, in the sign's own aspect (the sign audit reads it). */
export function signCell(size: readonly [number, number]): { width: number; height: number } {
  return { width: SIGN_W, height: Math.max(48, Math.round((SIGN_W * size[1]) / size[0])) };
}

/** Lays out the signs (by scene id) and paints them, or only lays them out with no DOM canvas. */
function buildAtlas(scenes: readonly SceneDef[]): {
  texture: Texture | null;
  rects: Map<string, Rect>;
  white: [number, number];
} {
  const boxes: { id: string; x: number; y: number; w: number; h: number }[] = [];
  let y = WHITE_PX;
  for (let i = 0; i < scenes.length; i += 2) {
    const row = scenes.slice(i, i + 2);
    const hs = row.map((sc) => signCell(sc.sign.size).height);
    row.forEach((sc, j) => boxes.push({ id: sc.id, x: j * SIGN_W, y, w: SIGN_W, h: hs[j]! }));
    y += Math.max(...hs);
  }
  let H = 256;
  while (H < y) H *= 2;
  const rects = new Map<string, Rect>();
  for (const b of boxes)
    rects.set(b.id, {
      u0: b.x / ATLAS_W,
      u1: (b.x + b.w) / ATLAS_W,
      v0: 1 - (b.y + b.h) / H,
      v1: 1 - b.y / H,
    });
  // The middle of the white corner (canvas textures are flipped: v = 1 is the canvas's top).
  const white: [number, number] = [WHITE_PX / 2 / ATLAS_W, 1 - WHITE_PX / 2 / H];
  if (typeof document === 'undefined') return { texture: null, rects, white };
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { texture: null, rects, white };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ATLAS_W, H);
  for (const b of boxes) {
    const sc = scenes.find((q) => q.id === b.id)!;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = sc.sign.bg;
    ctx.fillRect(0, 0, b.w, b.h);
    paintCopy(ctx, b.w, b.h, sc.sign.text, sc.sign.fg);
    ctx.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, rects, white };
}

/** Flat triangles for one scene: position, normal, colour and uv per corner. */
class Tris {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  constructor(private readonly white: [number, number]) {}

  get vertices(): number {
    return this.pos.length / 3;
  }

  private corner(p: Vector3, n: Vector3, c: readonly number[], uv: readonly [number, number]) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.col.push(c[0]!, c[1]!, c[2]!);
    this.uv.push(uv[0], uv[1]);
  }

  /** A box of size [w, h, d] centred at `at`, turned by `rot` (x, y, z radians), in one colour. */
  box(
    size: readonly number[],
    at: readonly number[],
    rot: readonly number[],
    colour: string,
    skipBottom = true,
  ) {
    const m = new Matrix4().makeRotationFromEuler(new Euler(rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0));
    m.setPosition(at[0]!, at[1]!, at[2]!);
    const nm = new Matrix4().extractRotation(m);
    const [hx, hy, hz] = [size[0]! / 2, size[1]! / 2, size[2]! / 2];
    const c = rgb(colour);
    // Each face: its normal axis and sign, and two in-plane axes.
    const faces: [number, number][] = [
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [2, 1],
      [2, -1],
    ];
    for (const [axis, sign] of faces) {
      if (skipBottom && axis === 1 && sign < 0) continue;
      const a = (axis + 1) % 3;
      const b = (axis + 2) % 3;
      const half = [hx, hy, hz];
      const pt = (ua: number, ub: number) => {
        const v = [0, 0, 0];
        v[axis] = sign * half[axis]!;
        v[a] = ua * half[a]!;
        v[b] = ub * half[b]!;
        return new Vector3(v[0], v[1], v[2]).applyMatrix4(m);
      };
      const n = new Vector3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0).applyMatrix4(
        nm,
      );
      // Wound counter-clockwise seen from outside.
      const q =
        sign > 0
          ? [pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)]
          : [pt(-1, -1), pt(-1, 1), pt(1, 1), pt(1, -1)];
      for (const i of [0, 1, 2, 0, 2, 3]) this.corner(q[i]!, n, c, this.white);
    }
  }

  /** The sign's printed face: a quad facing +z at `at`, its letters from `rect` of the atlas. */
  face(at: readonly number[], w: number, h: number, rect: Rect) {
    const n = new Vector3(0, 0, 1);
    const z = at[2]!;
    const p = [
      new Vector3(at[0]! - w / 2, at[1]! - h / 2, z),
      new Vector3(at[0]! + w / 2, at[1]! - h / 2, z),
      new Vector3(at[0]! + w / 2, at[1]! + h / 2, z),
      new Vector3(at[0]! - w / 2, at[1]! + h / 2, z),
    ];
    const uv: [number, number][] = [
      [rect.u0, rect.v0],
      [rect.u1, rect.v0],
      [rect.u1, rect.v1],
      [rect.u0, rect.v1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(p[i]!.x, p[i]!.y, p[i]!.z);
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(1, 1, 1);
      this.uv.push(uv[i]![0], uv[i]![1]);
    }
  }
}

/** A #rrggbb colour as linear RGB (three's working space for vertex colours). */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

/** One scene's geometry: the far stretch (outline parts and the sign) first, then the rest. */
export function sceneGeometry(
  def: SceneDef,
  rect: Rect,
  white: [number, number],
  water: boolean,
): { geometry: BufferGeometry; farVertices: number; triangles: number } {
  const t = new Tris(white);
  const rot = (p: { rotX?: number; rotY?: number; rotZ?: number }) => [p.rotX ?? 0, p.rotY ?? 0, p.rotZ ?? 0];
  const sign = def.sign;
  const [w, h] = sign.size;
  // The sign's board, then its printed face just in front of it.
  t.box([w, h, 0.08], sign.at, [0, 0, 0], sign.bg, false);
  t.face([sign.at[0], sign.at[1], sign.at[2] + 0.045], w * 0.96, h * 0.92, rect);
  for (const p of def.parts) if (p.far) t.box(p.box, p.at, rot(p), p.colour);
  const farVertices = t.vertices;
  // Its posts, down into the ground (or the bed under the water).
  const posts = sign.posts ?? (w > 1.6 ? 2 : 1);
  const foot = water ? -1.5 : 0;
  const bottom = sign.at[1] - h / 2;
  if (bottom > foot + 0.05)
    for (let i = 0; i < posts; i++) {
      const x = posts === 1 ? sign.at[0] : sign.at[0] + (i ? 1 : -1) * w * 0.34;
      t.box(
        [0.1, bottom - foot, 0.1],
        [x, (bottom + foot) / 2, sign.at[2] - 0.08],
        [0, 0, 0],
        sign.post ?? POST_COLOUR,
      );
    }
  for (const p of def.parts) if (!p.far) t.box(p.box, p.at, rot(p), p.colour);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(t.pos, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(t.nrm, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(t.col, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(t.uv, 2));
  geometry.computeBoundingSphere();
  return { geometry, farVertices, triangles: t.vertices / 3 };
}

export interface ScenesInput {
  road: RoadNetwork;
  seed: number;
  pack: string;
  file: ScenesFile;
  landReach(edge: number, side: -1 | 1, s: number): number;
  spots: readonly ScenerySpot[];
}

export interface SceneView {
  placed: PlacedScene;
  ref: string;
  mesh: Mesh;
  farVertices: number;
  allVertices: number;
  triangles: number;
}

export interface ScenesCounts {
  /** Scenes placed this race, by id, in road order. */
  placed: string[];
  /** Scenes drawn in the last update, and how many of them at their far level of detail. */
  visible: number;
  far: number;
  /** Triangles of the scenes drawn in the last update. */
  triangles: number;
}

export class ScenesLayer {
  readonly group = new Group();
  readonly views: SceneView[] = [];
  private readonly texture: Texture | null;
  private readonly material: Material;
  private readonly hidden = new Set<string>();
  private last: ScenesCounts = { placed: [], visible: 0, far: 0, triangles: 0 };

  constructor(look: LookStyle, input: ScenesInput) {
    this.group.name = 'roadside-scenes';
    const placed = placeScenes(input);
    const atlas = buildAtlas(placed.map((p) => p.def));
    this.texture = atlas.texture;
    this.material = look.material(
      'prop',
      atlas.texture ? { vertexColors: true, map: atlas.texture } : { vertexColors: true },
    );
    for (const p of placed) {
      const water = p.def.on.includes('water');
      const built = sceneGeometry(p.def, atlas.rects.get(p.def.id)!, atlas.white, water);
      const mesh = new Mesh(built.geometry, this.material);
      mesh.name = `scene-${p.def.id}`;
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = p.turn;
      mesh.visible = false;
      mesh.userData['contentRef'] = sceneRef(input.pack, input.file.region, p.def.id);
      this.group.add(mesh);
      this.views.push({
        placed: p,
        ref: mesh.userData['contentRef'] as string,
        mesh,
        farVertices: built.farVertices,
        allVertices: built.triangles * 3,
        triangles: built.triangles,
      });
    }
    this.last.placed = placed.map((p) => p.def.id);
  }

  /** The ground each scene stands on, for the roadside props to keep clear of. */
  reserved(): { x: number; z: number; r: number }[] {
    return this.views.map((v) => ({ x: v.placed.x, z: v.placed.z, r: v.placed.def.radiusM }));
  }

  /** Hides the scenes these refs name (a veto, presentation only). */
  hide(refs: Iterable<string>): void {
    for (const r of refs) this.hidden.add(r);
  }

  /**
   * Per frame: draws the scenes within `drawM` of the camera (one draw call each), at their far
   * level of detail past `lodM`. Returns the scenes drawn.
   */
  update(cameraX: number, cameraZ: number, drawM: number, lodM: number): number {
    let visible = 0;
    let far = 0;
    let triangles = 0;
    for (const v of this.views) {
      const dist = Math.hypot(v.placed.x - cameraX, v.placed.z - cameraZ) - v.placed.def.radiusM;
      v.mesh.visible = dist < drawM && !this.hidden.has(v.ref);
      if (!v.mesh.visible) continue;
      const isFar = dist > lodM;
      const count = isFar ? v.farVertices : v.allVertices;
      v.mesh.geometry.setDrawRange(0, count);
      visible++;
      if (isFar) far++;
      triangles += count / 3;
    }
    this.last = { placed: this.last.placed, visible, far, triangles };
    return visible;
  }

  counts(): ScenesCounts {
    return { ...this.last, placed: [...this.last.placed] };
  }

  dispose(): void {
    for (const v of this.views) v.mesh.geometry.dispose();
    this.texture?.dispose();
    this.group.removeFromParent();
  }
}
