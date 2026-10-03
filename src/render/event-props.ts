// The road set pieces' props (W-P events, the maintainer, 2026-10-01b: "events and set pieces:
// roadwork, crash scenes, parades, a farm truck shedding hay, speed traps"), drawn from
// SimSnapshot.props. Code-made, flat-coloured boxes (every look recolours them through the `prop`
// material, no textures, no grime), one instanced mesh per shape, so a live set piece costs a few
// draw calls and a race without one costs none. The warning signs are the one exception: a small
// printed panel per sign, its words from the event's pack entry.
// Presentation only: it may use wall-clock time (the waving arm, the flashing light bar, the
// bobbing inflatable) and Math freely. The vehicles themselves (the work truck, the tow truck, the
// floats, the farm truck) are traffic entities drawn by views.ts; this draws what rides on them.
import {
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import type { PropSnapshot, SimSnapshot } from '../sim/api';
import { mergeBoxes, type BoxPart } from './geometry';
import { paintCopy } from './boards';
import type { LookStyle } from './look';

type Parts = BoxPart[];
const box = (
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  color: string,
  rot: { rotX?: number; rotY?: number } = {},
): BoxPart => ({ size, at, color, ...rot });

// ---- shapes (models face -z, origin on the ground at the middle) ----------------------------

const ORANGE = '#ff6a13';
const WHITE = '#f4f4f0';
const STRAW = '#dcb64e';
const TWINE = '#9c7a2a';

function cone(): Parts {
  return [
    box([0.42, 0.04, 0.42], [0, 0.02, 0], ORANGE),
    box([0.3, 0.22, 0.3], [0, 0.15, 0], ORANGE),
    box([0.24, 0.1, 0.24], [0, 0.31, 0], WHITE),
    box([0.18, 0.2, 0.18], [0, 0.46, 0], ORANGE),
    box([0.12, 0.1, 0.12], [0, 0.61, 0], WHITE),
    box([0.08, 0.12, 0.08], [0, 0.72, 0], ORANGE),
  ];
}

function flareStick(): Parts {
  return [
    box([0.06, 0.06, 0.34], [0, 0.03, 0], '#c81d25'),
    box([0.07, 0.07, 0.05], [0, 0.03, -0.17], '#3a3a3a'),
  ];
}

/** The flare's glow, unlit, so it reads at speed in every look. */
function flareGlow(): Parts {
  return [
    box([0.22, 0.32, 0.22], [0, 0.18, 0.17], '#ff3b1f'),
    box([0.1, 0.5, 0.1], [0, 0.3, 0.17], '#ffd27a'),
  ];
}

function barricade(): Parts {
  const parts: Parts = [];
  for (const x of [-0.75, 0.75]) {
    parts.push(box([0.07, 1.0, 0.07], [x, 0.5, -0.22], '#d9d9d4', { rotX: 0.35 }));
    parts.push(box([0.07, 1.0, 0.07], [x, 0.5, 0.22], '#d9d9d4', { rotX: -0.35 }));
  }
  parts.push(box([1.9, 0.26, 0.08], [0, 0.88, 0], ORANGE));
  for (const x of [-0.6, 0, 0.6]) parts.push(box([0.24, 0.27, 0.09], [x, 0.88, 0], WHITE));
  parts.push(box([1.9, 0.18, 0.08], [0, 0.5, 0], WHITE));
  return parts;
}

function hayBale(): Parts {
  return [
    box([0.6, 0.55, 1.05], [0, 0.275, 0], STRAW),
    box([0.62, 0.57, 0.04], [0, 0.275, -0.25], TWINE),
    box([0.62, 0.57, 0.04], [0, 0.275, 0.25], TWINE),
  ];
}

function hayLoad(): Parts {
  const parts: Parts = [];
  for (let row = 0; row < 3; row++)
    for (let col = -1; col <= 1; col++)
      for (let k = -1; k <= 1; k++)
        if (row < 2 || (col !== 1 && k !== -1))
          parts.push(
            box([0.68, 0.56, 1.1], [col * 0.7, 0.3 + row * 0.57, k * 1.15], row % 2 ? STRAW : '#d2ab42'),
          );
  return parts;
}

function radar(): Parts {
  return [
    box([0.05, 1.25, 0.05], [0, 0.6, -0.2], '#2b2b2b', { rotX: 0.3 }),
    box([0.05, 1.25, 0.05], [-0.18, 0.6, 0.12], '#2b2b2b', { rotX: -0.25 }),
    box([0.05, 1.25, 0.05], [0.18, 0.6, 0.12], '#2b2b2b', { rotX: -0.25 }),
    box([0.34, 0.24, 0.42], [0, 1.3, 0], '#1d1f24'),
    box([0.2, 0.2, 0.04], [0, 1.3, -0.23], '#e83030'),
    box([0.8, 0.5, 0.05], [0.7, 1.0, 0], WHITE),
  ];
}

function arrowBoard(): Parts {
  const parts: Parts = [
    box([2.1, 1.1, 0.12], [0, 0, 0], '#111111'),
    box([0.1, 1.2, 0.1], [0, -1.1, 0.1], '#555'),
  ];
  // An amber arrow pointing toward the open lane (the board's +x side is where the cones lean).
  const cells: [number, number][] = [
    [-0.8, 0],
    [-0.55, 0],
    [-0.3, 0],
    [-0.05, 0],
    [0.2, 0],
    [0.45, 0],
    [0.45, 0.25],
    [0.45, -0.25],
    [0.7, 0],
    [0.3, 0.35],
    [0.3, -0.35],
  ];
  for (const [x, y] of cells) parts.push(box([0.18, 0.16, 0.04], [x, y, -0.08], '#ffb21a'));
  return parts;
}

function lightbar(): Parts {
  return [
    box([1.5, 0.16, 0.32], [0, 0, 0], '#ffae1a'),
    box([0.3, 0.17, 0.33], [-0.5, 0, 0], '#ff2a2a'),
    box([0.3, 0.17, 0.33], [0.5, 0, 0], '#ff2a2a'),
  ];
}

/** The people: legs, torso, head, plus what each one wears or holds (no faces, no injuries). */
const PEOPLE: Readonly<
  Record<string, { shirt: string; pants: string; hat: string; extra: Parts; arm: string }>
> = {
  flagger: {
    shirt: '#c8ff2e',
    pants: '#2f3a52',
    hat: '#ffd21f',
    arm: '#c8ff2e',
    // The SLOW paddle, held up on its pole.
    extra: [
      box([0.05, 1.6, 0.05], [0.42, 0.95, -0.1], '#777'),
      box([0.5, 0.5, 0.05], [0.42, 1.9, -0.1], '#f2c400'),
    ],
  },
  'cop-waving': {
    shirt: '#20324f',
    pants: '#1a2438',
    hat: '#141c2b',
    arm: '#20324f',
    extra: [box([0.36, 0.12, 0.05], [0, 1.3, -0.17], '#c8ff2e')],
  },
  'cop-radar': {
    shirt: '#20324f',
    pants: '#1a2438',
    hat: '#141c2b',
    arm: '#20324f',
    extra: [box([0.14, 0.14, 0.34], [0.3, 1.25, -0.3], '#1d1f24')],
  },
  'marcher-keys': {
    shirt: '#ff5fa2',
    pants: '#24b5b0',
    hat: '#f0d38a',
    arm: '#ff5fa2',
    // A costume: a flamingo-pink feather boa and a straw sun hat with a wide brim.
    extra: [box([0.7, 0.06, 0.7], [0, 1.78, 0], '#f0d38a'), box([0.5, 0.14, 0.32], [0, 1.45, 0], '#ff9fc8')],
  },
  'marcher-sf': {
    shirt: '#8a8f99',
    pants: '#2c2f36',
    hat: '#2c2f36',
    arm: '#8a8f99',
    // A hoodie, a lanyard and a blank placard on a stick (the slogans are on the sign ahead).
    extra: [
      box([0.04, 0.3, 0.02], [0, 1.2, -0.17], '#3d7bff'),
      box([0.04, 1.1, 0.04], [0.4, 1.3, 0], '#8b6a3e'),
      box([0.7, 0.45, 0.04], [0.4, 2.0, 0], WHITE),
    ],
  },
  'marcher-pnw': {
    shirt: '#b3262c',
    pants: '#3c4a33',
    hat: '#2f5f4a',
    arm: '#b3262c',
    // Flannel, a beanie and a rain shell tied round the waist.
    extra: [
      box([0.46, 0.14, 0.3], [0, 0.95, 0], '#e8b400'),
      box([0.12, 0.2, 0.3], [-0.2, 1.3, 0], '#1b1b1b'),
    ],
  },
  marcher: { shirt: '#ffb000', pants: '#3a3a3a', hat: '#ff4d4d', arm: '#ffb000', extra: [] },
};

function person(variant: string): Parts {
  const p = PEOPLE[variant] ?? PEOPLE['marcher'];
  if (!p) return [];
  return [
    box([0.16, 0.85, 0.18], [-0.12, 0.425, 0], p.pants),
    box([0.16, 0.85, 0.18], [0.12, 0.425, 0], p.pants),
    box([0.46, 0.62, 0.28], [0, 1.16, 0], p.shirt),
    box([0.24, 0.26, 0.24], [0, 1.6, 0], '#c99a6e'),
    box([0.28, 0.1, 0.28], [0, 1.76, 0], p.hat),
    box([0.12, 0.55, 0.14], [-0.3, 1.15, 0], p.arm),
    ...p.extra,
  ];
}

/** The waving arm, pivoting at the shoulder (origin), raised. */
function arm(color: string): Parts {
  return [box([0.12, 0.6, 0.14], [0, 0.3, 0], color)];
}

/** A float's dressing: a fringed skirt hiding the wheels, and the region's centrepiece on top. */
function floatDecor(variant: string): Parts {
  const [theme, index] = variant.split('-');
  const n = Number(index) || 0;
  const skirt = theme === 'sf' ? '#e8edf5' : theme === 'pnw' ? '#2f6b3a' : '#2ec4b6';
  const fringe = theme === 'sf' ? '#5b8cff' : theme === 'pnw' ? '#d9a441' : '#ff6fae';
  const parts: Parts = [
    box([3.3, 0.9, 9.4], [0, -0.75, 0], skirt),
    box([3.34, 0.18, 9.44], [0, -0.25, 0], fringe),
  ];
  const top = 2.1;
  if (theme === 'keys') {
    if (n % 2 === 0) {
      // A giant pink flamingo on one leg.
      parts.push(box([0.12, 2.0, 0.12], [0, top + 1, 0], '#ff7eb6'));
      parts.push(box([1.4, 1.0, 2.4], [0, top + 2.4, 0], '#ff7eb6'));
      parts.push(box([0.25, 1.6, 0.25], [0, top + 3.6, -1.0], '#ff7eb6', { rotX: 0.3 }));
      parts.push(box([0.4, 0.4, 0.7], [0, top + 4.4, -1.4], '#ff7eb6'));
      parts.push(box([0.2, 0.2, 0.4], [0, top + 4.3, -1.85], '#222'));
    } else {
      // A giant conch shell, the conch republic's flag colours on the float.
      parts.push(box([2.2, 1.6, 3.2], [0, top + 0.8, 0], '#ffc9a8'));
      parts.push(box([1.6, 1.2, 2.2], [0, top + 2.0, 0.3], '#ffb38a'));
      parts.push(box([0.9, 0.9, 1.2], [0, top + 2.9, 0.6], '#ffd6bd'));
      parts.push(box([0.8, 1.0, 0.1], [0, top + 0.6, -1.65], '#ff8a8a'));
    }
  } else if (theme === 'sf') {
    // A product launch: a stage-lit pedestal, a giant laptop and a glowing loading ring.
    parts.push(box([2.6, 0.5, 3.0], [0, top + 0.25, 0], '#20232a'));
    parts.push(box([2.2, 0.12, 1.6], [0, top + 0.6, 0.4], '#c9ccd3'));
    parts.push(box([2.2, 1.5, 0.12], [0, top + 1.35, -0.4], '#c9ccd3', { rotX: -0.2 }));
    parts.push(box([1.9, 1.2, 0.05], [0, top + 1.35, -0.48], '#2de2ff', { rotX: -0.2 }));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      parts.push(
        box(
          [0.35, 0.35, 0.2],
          [Math.cos(a) * 1.2, top + 3.4 + Math.sin(a) * 1.2, 1.2],
          k < 5 ? '#2de2ff' : '#3a3f4a',
        ),
      );
    }
  } else {
    // Logging days: a giant log on chocks, and a chainsaw-carved bear standing on it.
    parts.push(box([1.4, 1.4, 7.6], [0, top + 0.7, 0], '#7a4e2b'));
    parts.push(box([1.1, 1.1, 0.05], [0, top + 0.7, -3.82], '#d9b07a'));
    parts.push(box([1.0, 1.6, 0.8], [0, top + 2.2, 1.6], '#5a3a22'));
    parts.push(box([0.7, 0.6, 0.7], [0, top + 3.3, 1.5], '#5a3a22'));
    parts.push(box([0.25, 0.2, 0.2], [0, top + 3.25, 1.05], '#3a2414'));
  }
  return parts;
}

/** San Francisco's giant inflatable: a beaming, slightly over-confident assistant balloon. */
function inflatable(): Parts {
  return [
    box([3.0, 3.2, 2.6], [0, 0, 0], '#f6f8ff'),
    box([2.6, 1.0, 2.2], [0, 2.0, 0], '#f6f8ff'),
    box([2.2, 1.0, 0.1], [0, 0.6, -1.32], '#1e2a44'),
    box([0.4, 0.4, 0.05], [-0.55, 0.65, -1.38], '#2de2ff'),
    box([0.4, 0.4, 0.05], [0.55, 0.65, -1.38], '#2de2ff'),
    box([1.0, 0.12, 0.05], [0, 0.2, -1.38], '#2de2ff'),
    box([0.9, 2.2, 0.9], [-1.9, 0.4, 0], '#f6f8ff', { rotX: 0.2 }),
    box([0.9, 2.2, 0.9], [1.9, 0.4, 0], '#f6f8ff', { rotX: -0.2 }),
    box([0.05, 5.5, 0.05], [0, -4.4, 0], '#bbbbbb'),
  ];
}

// ---- drawing ----------------------------------------------------------------------------------

/** A shape key per prop: kind, plus the variant where the variant changes the shape. */
function shapeKey(p: PropSnapshot): string {
  switch (p.kind) {
    case 'person':
      return `person:${PEOPLE[p.variant] ? p.variant : 'marcher'}`;
    case 'floatDecor': {
      const [theme, index] = p.variant.split('-');
      const t = theme === 'sf' || theme === 'pnw' ? theme : 'keys';
      return `floatDecor:${t}-${(Number(index) || 0) % 2}`;
    }
    default:
      return p.kind;
  }
}

function partsFor(key: string): Parts {
  const [kind, variant = ''] = key.split(':');
  switch (kind) {
    case 'cone':
      return cone();
    case 'flare':
      return flareStick();
    case 'flareGlow':
      return flareGlow();
    case 'barricade':
      return barricade();
    case 'hayBale':
      return hayBale();
    case 'hayLoad':
      return hayLoad();
    case 'radar':
      return radar();
    case 'arrowBoard':
      return arrowBoard();
    case 'lightbar':
      return lightbar();
    case 'person':
      return person(variant);
    case 'arm':
      return arm(variant);
    case 'floatDecor':
      return floatDecor(variant);
    case 'inflatable':
      return inflatable();
    default:
      return [box([0.5, 0.5, 0.5], [0, 0.25, 0], '#ff00ff')];
  }
}

/**
 * Read-at-speed scale per shape (W-P: "readable at speed"; on a phone at 100 mph a life-size cone is
 * a few pixels). Stylized, not literal: the small props are drawn larger than life. The sim's contact
 * boxes are sized to match (sim/modifiers, `extent`).
 */
const READ_SCALE: Readonly<Record<string, number>> = {
  cone: 1.7,
  flare: 1.8,
  flareGlow: 2.2,
  barricade: 1.3,
  hayBale: 1.25,
  radar: 1.4,
  person: 1.12,
  arm: 1.12,
  arrowBoard: 1.5,
  lightbar: 1.4,
};
/** The warning sign's panel, metres square (stands 2.2 m up). */
const SIGN_M = 3.0;

/** Shapes drawn unlit (they glow): flares and light bars. */
const GLOWS = new Set(['flareGlow', 'lightbar']);

/**
 * Sign panel colours by piece: work-zone orange, a regulatory white for the speed trap and for the
 * cops' END OF JURISDICTION sign (run W-T, variant `jurisdiction`, from sim/cops).
 */
function signFace(variant: string): { bg: string; fg: string } {
  if (variant === 'speed-trap' || variant === 'jurisdiction') return { bg: '#f4f4f0', fg: '#111111' };
  if (variant === 'parade') return { bg: '#6a2bd9', fg: '#ffffff' };
  return { bg: '#ff8a1f', fg: '#111111' };
}

function signTexture(label: string, variant: string): Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const face = signFace(variant);
  ctx.fillStyle = face.bg;
  ctx.fillRect(0, 0, 384, 384);
  ctx.strokeStyle = face.fg;
  ctx.lineWidth = 14;
  ctx.strokeRect(14, 14, 356, 356);
  ctx.fillStyle = face.fg;
  // A short headline that comes true a moment later, and a small kicker (boards.ts, `paintCopy`).
  paintCopy(ctx, 384, 384, label, face.fg);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** What the last frame drew, for tests and the debug overlay. */
export interface EventPropCounts {
  /** Props drawn, by kind. */
  byKind: Record<string, number>;
  total: number;
  /** The signs' words as drawn. */
  signs: string[];
}

interface Sign {
  mesh: Group;
  label: string;
}

export class EventProps {
  readonly root = new Group();
  private readonly meshes = new Map<string, InstancedMesh>();
  private readonly signs = new Map<number, Sign>();
  private readonly textures = new Map<string, Texture>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3(1, 1, 1);
  private readonly yAxis = new Vector3(0, 1, 0);
  private readonly xAxis = new Vector3(1, 0, 0);
  private readonly zAxis = new Vector3(0, 0, 1);
  private readonly white = new Color('#ffffff');
  private readonly shoulder = new Vector3();
  private last: EventPropCounts = { byKind: {}, total: 0, signs: [] };

  constructor(private readonly look: LookStyle) {
    this.root.name = 'event-props';
  }

  private material(glow: boolean): Material {
    return this.look.material(glow ? 'lightbar' : 'prop', { vertexColors: true });
  }

  private mesh(key: string, needed: number): InstancedMesh {
    let mesh = this.meshes.get(key);
    if (mesh && mesh.instanceMatrix.count >= needed) return mesh;
    const capacity = Math.max(8, needed * 2, (mesh?.instanceMatrix.count ?? 0) * 2);
    const geometry: BufferGeometry = mesh?.geometry ?? mergeBoxes(partsFor(key));
    if (mesh) this.root.remove(mesh);
    const kind = key.split(':')[0] ?? key;
    mesh = new InstancedMesh(geometry, this.material(GLOWS.has(kind)), capacity);
    mesh.name = `event-${key}`;
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.meshes.set(key, mesh);
    this.root.add(mesh);
    return mesh;
  }

  /** Draws the snapshot's props. `t` is wall-clock seconds (the waving, flashing and bobbing). */
  sync(snap: SimSnapshot | null, t: number): void {
    const props = snap?.props ?? [];
    const groups = new Map<string, PropSnapshot[]>();
    const add = (key: string, p: PropSnapshot) => {
      const list = groups.get(key);
      if (list) list.push(p);
      else groups.set(key, [p]);
    };
    const byKind: Record<string, number> = {};
    const signsSeen = new Set<number>();
    const signWords: string[] = [];
    for (const p of props) {
      byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
      if (p.kind === 'sign') {
        signsSeen.add(p.id);
        signWords.push(p.label);
        this.placeSign(p);
        continue;
      }
      add(shapeKey(p), p);
      if (p.kind === 'flare') add('flareGlow', p);
      if (
        p.kind === 'person' &&
        (p.variant === 'cop-waving' || p.variant.startsWith('marcher') || p.variant === 'flagger')
      )
        add(`arm:${PEOPLE[p.variant]?.arm ?? '#ffb000'}`, p);
    }
    for (const [id, sign] of this.signs) {
      if (signsSeen.has(id)) continue;
      this.root.remove(sign.mesh);
      this.signs.delete(id);
    }
    for (const [key, mesh] of this.meshes)
      if (!groups.has(key)) {
        mesh.count = 0;
        mesh.visible = false;
      }
    for (const [key, list] of groups) {
      const mesh = this.mesh(key, list.length);
      const kind = key.split(':')[0];
      list.forEach((p, i) => {
        this.v.set(p.x, p.y, p.z);
        this.q.setFromAxisAngle(this.yAxis, p.heading);
        let sx = 1;
        if (kind === 'arm') {
          // The arm at the right shoulder, swinging overhead: waving traffic by, or the crowd.
          const swing = p.moving
            ? 0.2
            : 2.4 + 0.5 * Math.sin(t * (p.variant === 'cop-waving' ? 5 : 3) + p.id);
          this.v.add(this.shoulder.set(0.3, 1.4, 0).applyQuaternion(this.q));
          this.q2.setFromAxisAngle(this.zAxis, -swing);
          this.q.multiply(this.q2);
        } else if (kind === 'inflatable') {
          this.v.y += 0.35 * Math.sin(t * 0.9 + p.id);
          this.q2.setFromAxisAngle(this.zAxis, 0.06 * Math.sin(t * 0.7 + p.id));
          this.q.multiply(this.q2);
        } else if (kind === 'lightbar') {
          // Flashing: the bar swells and dims twice a second.
          sx = Math.sin(t * 12 + p.id) > 0 ? 1 : 0.55;
        } else if (kind === 'flareGlow') {
          sx = 0.8 + 0.25 * Math.sin(t * 17 + p.id * 3);
        } else if (kind === 'person' && p.moving) {
          // Stepping smartly out of the way.
          this.v.y += 0.12 * Math.abs(Math.sin(t * 10 + p.id));
        }
        if (p.tilt !== 0) {
          this.q2.setFromAxisAngle(this.xAxis, p.tilt);
          this.q.multiply(this.q2);
        }
        const k = READ_SCALE[kind ?? ''] ?? 1;
        this.s.set(sx * k, (kind === 'flareGlow' ? sx : 1) * k, sx * k);
        this.m.compose(this.v, this.q, this.s);
        mesh.setMatrixAt(i, this.m);
        mesh.setColorAt(i, this.white);
      });
      mesh.count = list.length;
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.last = { byKind, total: props.length, signs: signWords };
  }

  private placeSign(p: PropSnapshot): void {
    let sign = this.signs.get(p.id);
    if (!sign || sign.label !== p.label) {
      if (sign) this.root.remove(sign.mesh);
      const g = new Group();
      const post = new InstancedMesh(
        mergeBoxes([box([0.14, 3.6, 0.14], [0, 1.8, -0.12], '#9aa0a6')]),
        this.material(false),
        1,
      );
      post.setMatrixAt(0, new Matrix4());
      g.add(post);
      const key = `${p.variant}|${p.label}`;
      let tex = this.textures.get(key);
      if (!tex) {
        tex = signTexture(p.label, p.variant) ?? undefined;
        if (tex) this.textures.set(key, tex);
      }
      if (tex) {
        // The face looks back along the road at the riders coming (the plane's +z, the model's back).
        const panel = new Mesh(new PlaneGeometry(SIGN_M, SIGN_M), this.look.material('board', { map: tex }));
        panel.position.set(0, 2.2 + SIGN_M / 2, 0);
        g.add(panel);
      }
      g.name = `event-sign-${p.id}`;
      sign = { mesh: g, label: p.label };
      this.signs.set(p.id, sign);
      this.root.add(g);
    }
    sign.mesh.position.set(p.x, p.y, p.z);
    sign.mesh.rotation.set(0, p.heading, 0);
  }

  counts(): EventPropCounts {
    return this.last;
  }
}
