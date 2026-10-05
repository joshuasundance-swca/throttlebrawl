// The road set pieces' props (W-P events, the maintainer, 2026-10-01b: "events and set pieces:
// roadwork, crash scenes, parades, a farm truck shedding hay, speed traps"), drawn from
// SimSnapshot.props. Code-made, flat-coloured boxes (every look recolours them through the `prop`
// material, no textures, no grime), batched (run W-T's draw-call headroom, prop-batch.ts): the props
// standing still are one mesh, the moving ones another and the glowing ones one instanced mesh per
// shape, so a live set piece costs two or three draw calls and a race without one costs none. The
// warning signs carry printed panels, their words from the event's pack entry, all drawn as one
// mesh over a shared atlas.
// Presentation only: it may use wall-clock time (the waving arm, the flashing light bar, the
// bobbing inflatable) and Math freely. The vehicles themselves (the work truck, the tow truck, the
// floats, the farm truck) are traffic entities drawn by views.ts; this draws what rides on them.
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import type { PropSnapshot, SimSnapshot } from '../sim/api';
import { mergeBoxes, type BoxPart } from './geometry';
import { canvasMeasure, fitLine, paintCopy, type CopyFit, type MeasureText } from './boards';
import type { LookStyle } from './look';
import { cullByInstances, PropBatch } from './prop-batch';

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
  return [box([0.22, 0.32, 0.22], [0, 0.18, 0], '#ff3b1f'), box([0.1, 0.5, 0.1], [0, 0.3, 0], '#ffd27a')];
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

/**
 * A shed log (W-T): its long axis across the road (model x), sized to the sim's contact box
 * (sim/modifiers/moving.ts: 3.4 m long, about 0.66 m through), with pale cut ends. It rolls about x.
 */
function log(): Parts {
  return [
    box([3.4, 0.62, 0.62], [0, 0, 0], '#6b4a2e'),
    box([3.4, 0.66, 0.44], [0, 0, 0], '#5a3d25'),
    box([3.4, 0.44, 0.66], [0, 0, 0], '#5a3d25'),
    box([0.04, 0.5, 0.5], [-1.71, 0, 0], '#d9b07a'),
    box([0.04, 0.5, 0.5], [1.71, 0, 0], '#d9b07a'),
  ];
}

/** A sign post, shared by every event sign (one draw for all of them): tall, or short for a serial sign. */
function signPost(short: boolean): Parts {
  return short
    ? [box([0.12, 2.2, 0.12], [0, 1.1, -0.1], '#9aa0a6')]
    : [box([0.14, 3.6, 0.14], [0, 1.8, -0.12], '#9aa0a6')];
}

/** A lane-vote gantry's frame (W-T): a post at each side and a beam over the road, `span` wide. */
function gantryFrame(span: number): Parts {
  const half = span / 2 + 0.4;
  return [
    box([0.3, 6.4, 0.3], [-half, 3.2, 0], '#8a9096'),
    box([0.3, 6.4, 0.3], [half, 3.2, 0], '#8a9096'),
    box([2 * half + 0.3, 0.35, 0.35], [0, 6.25, 0], '#8a9096'),
    box([2 * half + 0.3, 0.2, 0.2], [0, 6.75, 0], '#8a9096'),
  ];
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
  // W-T: the gator crossing's guard, in a vest and a sun hat, holding up a round STOP paddle.
  'crossing-guard': {
    shirt: '#ff7a1a',
    pants: '#2f3a52',
    hat: '#f0d38a',
    arm: '#ff7a1a',
    extra: [
      box([0.7, 0.06, 0.7], [0, 1.78, 0], '#f0d38a'),
      box([0.05, 1.5, 0.05], [0.42, 1.0, -0.1], '#777'),
      box([0.56, 0.56, 0.05], [0.42, 1.95, -0.1], '#d4202a'),
      box([0.4, 0.12, 0.06], [0.42, 1.95, -0.13], WHITE),
    ],
  },
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

export function partsFor(key: string): Parts {
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
    case 'log':
      return log();
    case 'signPost':
      return signPost(variant === 'serial');
    default:
      return [box([0.5, 0.5, 0.5], [0, 0.25, 0], '#ff00ff')];
  }
}

/**
 * Read-at-speed scale per shape (W-P: "readable at speed"; on a phone at 100 mph a life-size cone is
 * a few pixels). Stylized, not literal: the small props are drawn larger than life. The sim's contact
 * boxes are sized to match (sim/modifiers, `extent`).
 */
export const READ_SCALE: Readonly<Record<string, number>> = {
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
/** A serial sign's smaller panel (W-T: four small signs, one joke), metres, and how high it stands. */
const SERIAL_M = 2.2;
const SERIAL_UP = 1.4;
/** A gantry's panel height, and its bottom above the road, metres. */
const GANTRY_PANEL_M = 1.7;
const GANTRY_PANEL_UP = 4.25;

/** Shapes drawn unlit (they glow): flares and light bars. */
const GLOWS = new Set(['flareGlow', 'lightbar']);

/**
 * Sign panel colours by piece: work-zone orange, a regulatory white for the speed trap and for the
 * cops' END OF JURISDICTION sign (run W-T, variant `jurisdiction`, from sim/cops).
 */
function signFace(variant: string): { bg: string; fg: string } {
  if (variant === 'speed-trap' || variant === 'jurisdiction') return { bg: '#f4f4f0', fg: '#111111' };
  if (variant === 'parade') return { bg: '#6a2bd9', fg: '#ffffff' };
  // W-T: serial signs are small red boards with white words, the old roadside serial-ad style.
  if (variant === 'serial') return { bg: '#c8202a', fg: '#ffffff' };
  // A lane vote's warning is a highway-green guide sign, like the gantry it announces.
  if (variant === 'lane-vote') return { bg: '#1f6f3a', fg: '#ffffff' };
  return { bg: '#ff8a1f', fg: '#111111' };
}

/** A warning or serial sign's square canvas, px (the sign audit, sign-fit.test.ts, reads it). */
export const SIGN_TEXTURE_PX = 384;
const SIGN_PX = SIGN_TEXTURE_PX;

/** Paints a warning sign's face into a `SIGN_PX` square at the context's origin. */
function paintSign(ctx: CanvasRenderingContext2D, label: string, variant: string): void {
  const face = signFace(variant);
  ctx.fillStyle = face.bg;
  ctx.fillRect(0, 0, SIGN_PX, SIGN_PX);
  ctx.strokeStyle = face.fg;
  ctx.lineWidth = 14;
  ctx.strokeRect(14, 14, SIGN_PX - 28, SIGN_PX - 28);
  ctx.fillStyle = face.fg;
  // A short headline that comes true a moment later, and a small kicker (boards.ts, `paintCopy`).
  paintCopy(ctx, SIGN_PX, SIGN_PX, label, face.fg);
}

/** One sign's own texture: only for a sign past the atlas's slots (SignAtlas). */
function signTexture(label: string, variant: string): Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIGN_PX;
  canvas.height = SIGN_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintSign(ctx, label, variant);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** The sign atlas's grid: this many signs at once share one texture (one draw call). */
const ATLAS_COLS = 4;
const ATLAS_ROWS = 2;
/** Texels kept off each cell's edge, so a far (mipmapped) panel never takes its neighbour's colour. */
const ATLAS_INSET_PX = 2;

/**
 * The live warning signs' faces, painted into one texture (run W-T's draw-call headroom): every sign
 * panel then draws as ONE mesh, where each had its own texture and draw call. A slot is kept while
 * its sign is in the snapshot and freed when it leaves; a sign past the last slot draws on its own.
 */
class SignAtlas {
  readonly texture: CanvasTexture | null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly keys: (string | null)[] = new Array<string | null>(ATLAS_COLS * ATLAS_ROWS).fill(null);

  constructor() {
    const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
    if (canvas) {
      canvas.width = SIGN_PX * ATLAS_COLS;
      canvas.height = SIGN_PX * ATLAS_ROWS;
    }
    this.ctx = canvas?.getContext('2d') ?? null;
    if (canvas && this.ctx) {
      this.texture = new CanvasTexture(canvas);
      this.texture.colorSpace = SRGBColorSpace;
    } else this.texture = null;
  }

  /** The slot holding this sign's face, painted on first use; null with no slot free (or no DOM). */
  slot(key: string, label: string, variant: string): number | null {
    const have = this.keys.indexOf(key);
    if (have >= 0) return have;
    const free = this.keys.indexOf(null);
    if (free < 0 || !this.ctx || !this.texture) return null;
    this.keys[free] = key;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate((free % ATLAS_COLS) * SIGN_PX, Math.floor(free / ATLAS_COLS) * SIGN_PX);
    ctx.beginPath();
    ctx.rect(0, 0, SIGN_PX, SIGN_PX);
    ctx.clip();
    paintSign(ctx, label, variant);
    ctx.restore();
    this.texture.needsUpdate = true;
    return free;
  }

  /** Frees the slots of signs no longer in the snapshot. */
  keep(used: ReadonlySet<string>): void {
    this.keys.forEach((k, i) => {
      if (k !== null && !used.has(k)) this.keys[i] = null;
    });
  }

  /** A slot's texture coordinates (canvas textures are flipped: v = 1 is the canvas's top). */
  rect(slot: number): { u0: number; v0: number; u1: number; v1: number } {
    const w = SIGN_PX * ATLAS_COLS;
    const h = SIGN_PX * ATLAS_ROWS;
    const x = (slot % ATLAS_COLS) * SIGN_PX;
    const y = Math.floor(slot / ATLAS_COLS) * SIGN_PX;
    return {
      u0: (x + ATLAS_INSET_PX) / w,
      u1: (x + SIGN_PX - ATLAS_INSET_PX) / w,
      v0: 1 - (y + SIGN_PX - ATLAS_INSET_PX) / h,
      v1: 1 - (y + ATLAS_INSET_PX) / h,
    };
  }
}

/** A lane-vote gantry's canvas, px, and the width one side's words may take. */
const GANTRY_PX = { w: 1024, h: 192 };
const GANTRY_TEXT_W = GANTRY_PX.w / 2 - 60;

/** One side of a lane-vote gantry (`leftText` or `rightText`), fitted to its half of the panel. */
export function gantryFit(measure: MeasureText, text: string): CopyFit & { maxW: number } {
  return { ...fitLine(measure, text, GANTRY_TEXT_W, 64, 24), maxW: GANTRY_TEXT_W };
}

/**
 * A lane-vote gantry's panel (W-T): the rider's left choice and right choice side by side in
 * highway green, an arrow down to each side's lanes. Once the vote is cast (`variant` `left` or
 * `right`) the winning side lights up and the other goes dark.
 */
function gantryTexture(label: string, voted: string): Texture | null {
  if (typeof document === 'undefined') return null;
  const { w, h } = GANTRY_PX;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const [left = '', right = ''] = label.split(' | ');
  const halves: [string, 'left' | 'right'][] = [
    [left, 'left'],
    [right, 'right'],
  ];
  halves.forEach(([text, side], i) => {
    const x0 = i * (w / 2);
    const lost = voted !== '' && voted !== side;
    const won = voted === side;
    ctx.fillStyle = lost ? '#1d2422' : won ? '#2fae5a' : '#1f6f3a';
    ctx.fillRect(x0, 0, w / 2, h);
    ctx.strokeStyle = lost ? '#55605c' : '#ffffff';
    ctx.lineWidth = 8;
    ctx.strokeRect(x0 + 8, 8, w / 2 - 16, h - 16);
    ctx.fillStyle = lost ? '#55605c' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const { size } = gantryFit(canvasMeasure(ctx), text);
    ctx.font = `bold ${size}px sans-serif`;
    ctx.fillText(text, x0 + w / 4, h * 0.42);
    // The down arrow to that side's lanes.
    ctx.beginPath();
    ctx.moveTo(x0 + w / 4 - 22, h * 0.72);
    ctx.lineTo(x0 + w / 4 + 22, h * 0.72);
    ctx.lineTo(x0 + w / 4, h * 0.9);
    ctx.closePath();
    ctx.fill();
  });
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
  /** What the panel was drawn for (a gantry redraws once its vote is cast). */
  variant: string;
}

/** Shapes that move every frame although their prop stands still: the waving arm, the bobbing balloon. */
const ANIMATED = new Set(['arm', 'inflatable']);

/** The sign panels' quads in one geometry: four corners each, in world space, with atlas UVs. */
function panelGeometry(
  quads: readonly {
    x: number;
    y: number;
    z: number;
    heading: number;
    size: number;
    up: number;
    uv: { u0: number; v0: number; u1: number; v1: number };
  }[],
): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const nrm: number[] = [];
  for (const q of quads) {
    const c = Math.cos(q.heading);
    const s = Math.sin(q.heading);
    const h = q.size / 2;
    const base = pos.length / 3;
    // A plane facing +z in the sign's own frame (as PlaneGeometry), turned by the heading about +y.
    const corners: [number, number, number, number][] = [
      [-h, q.up, q.uv.u0, q.uv.v0],
      [h, q.up, q.uv.u1, q.uv.v0],
      [h, q.up + q.size, q.uv.u1, q.uv.v1],
      [-h, q.up + q.size, q.uv.u0, q.uv.v1],
    ];
    for (const [lx, ly, u, v] of corners) {
      pos.push(q.x + lx * c, q.y + ly, q.z - lx * s);
      nrm.push(s, 0, c);
      uv.push(u, v);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * The road events' props. Draw calls (run W-T's draw-call headroom): every lit prop standing still
 * is in ONE batch (`event-props-still`, rewritten only when the set changes), every lit prop on the
 * move (a person stepping aside, a rolling log, a float's dressing, a waving arm, the balloon) in a
 * second (`event-props-moving`, rewritten each frame), the glowing flares and light bars stay one
 * instanced mesh per shape on the unlit material, and every warning sign's panel is one mesh over a
 * shared atlas (`event-panels`). A roadwork beside a speed trap drew 11 calls; it now draws 3.
 */
export class EventProps {
  readonly root = new Group();
  private readonly meshes = new Map<string, InstancedMesh>();
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly still: PropBatch;
  private readonly moving: PropBatch;
  private readonly atlas = new SignAtlas();
  private readonly panels: Mesh;
  private panelKey = '';
  /** Signs past the atlas's slots, and every gantry's panel: their own meshes. */
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
    this.still = new PropBatch(this.material(false), 'event-props-still');
    this.moving = new PropBatch(this.material(false), 'event-props-moving');
    this.panels = new Mesh(
      new BufferGeometry(),
      this.atlas.texture
        ? this.look.material('board', { map: this.atlas.texture })
        : this.look.material('board'),
    );
    this.panels.name = 'event-panels';
    this.panels.visible = false;
    this.root.add(this.still.mesh, this.moving.mesh, this.panels);
  }

  private material(glow: boolean): Material {
    return this.look.material(glow ? 'lightbar' : 'prop', { vertexColors: true });
  }

  /** A shape's merged boxes, made once and shared by every batch and instance. */
  private geometry(key: string, parts: () => Parts = () => partsFor(key)): BufferGeometry {
    let g = this.geometries.get(key);
    if (!g) {
      g = mergeBoxes(parts());
      g.name = key;
      this.geometries.set(key, g);
    }
    return g;
  }

  /** An instanced mesh per glowing shape (flares' glow, light bars): they flicker every frame. */
  private mesh(key: string, needed: number): InstancedMesh {
    let mesh = this.meshes.get(key);
    if (mesh && mesh.instanceMatrix.count >= needed) return mesh;
    const capacity = Math.max(8, needed * 2, (mesh?.instanceMatrix.count ?? 0) * 2);
    const geometry = this.geometry(key);
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

  /** A prop's pose for one shape: into `this.m`. `t` is wall-clock seconds (waving, bobbing). */
  private pose(key: string, p: PropSnapshot, t: number): Matrix4 {
    const kind = key.split(':')[0];
    this.v.set(p.x, p.y, p.z);
    this.q.setFromAxisAngle(this.yAxis, p.heading);
    let sx = 1;
    if (kind === 'arm') {
      // The arm at the right shoulder, swinging overhead: waving traffic by, or the crowd.
      const swing = p.moving ? 0.2 : 2.4 + 0.5 * Math.sin(t * (p.variant === 'cop-waving' ? 5 : 3) + p.id);
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
    if (p.tilt !== 0 && kind !== 'signPost' && kind !== 'gantryFrame') {
      this.q2.setFromAxisAngle(this.xAxis, p.tilt);
      this.q.multiply(this.q2);
    }
    const k = READ_SCALE[kind ?? ''] ?? 1;
    this.s.set(sx * k, (kind === 'flareGlow' ? sx : 1) * k, sx * k);
    return this.m.compose(this.v, this.q, this.s);
  }

  /** Draws the snapshot's props. `t` is wall-clock seconds (the waving, flashing and bobbing). */
  sync(snap: SimSnapshot | null, t: number): void {
    const props = snap?.props ?? [];
    const glows = new Map<string, PropSnapshot[]>();
    const glow = (key: string, p: PropSnapshot) => {
      const list = glows.get(key);
      if (list) list.push(p);
      else glows.set(key, [p]);
    };
    const byKind: Record<string, number> = {};
    const signsSeen = new Set<number>();
    const signWords: string[] = [];
    // The atlas frees the cells of signs that have left before this frame's signs take theirs.
    this.atlas.keep(new Set(props.filter((p) => p.kind === 'sign').map((p) => `${p.variant}|${p.label}`)));
    const quads: Parameters<typeof panelGeometry>[0][number][] = [];
    const panelKey: string[] = [];
    this.still.begin();
    this.moving.begin();
    for (const p of props) {
      byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
      if (p.kind === 'sign') {
        signWords.push(p.label);
        // Every sign's post goes in the still batch; its panel in the atlas's mesh (or its own).
        const key = `signPost:${p.variant === 'serial' ? 'serial' : 'tall'}`;
        this.still.add(this.geometry(key), this.pose(key, p, t));
        const serial = p.variant === 'serial';
        const face = `${p.variant}|${p.label}`;
        const slot = this.atlas.slot(face, p.label, p.variant);
        if (slot === null) {
          signsSeen.add(p.id);
          this.placeSign(p);
          continue;
        }
        const size = serial ? SERIAL_M : SIGN_M;
        quads.push({
          x: p.x,
          y: p.y,
          z: p.z,
          heading: p.heading,
          size,
          up: serial ? SERIAL_UP : 2.2,
          uv: this.atlas.rect(slot),
        });
        panelKey.push(`${slot}:${p.x}:${p.y}:${p.z}:${p.heading}:${size}`);
        continue;
      }
      if (p.kind === 'gantry') {
        signsSeen.add(p.id);
        signWords.push(p.label);
        const span = Math.max(4, p.spanM ?? 8);
        const key = `gantryFrame:${span}`;
        this.still.add(
          this.geometry(key, () => gantryFrame(span)),
          this.pose(key, p, t),
        );
        this.placeGantry(p, span);
        continue;
      }
      const key = shapeKey(p);
      if (GLOWS.has(p.kind)) glow(key, p);
      else {
        const batch = p.moving || ANIMATED.has(p.kind) ? this.moving : this.still;
        batch.add(this.geometry(key), this.pose(key, p, t));
      }
      if (p.kind === 'flare') glow('flareGlow', p);
      if (
        p.kind === 'person' &&
        (p.variant === 'cop-waving' || p.variant.startsWith('marcher') || p.variant === 'flagger')
      ) {
        const arm = `arm:${PEOPLE[p.variant]?.arm ?? '#ffb000'}`;
        this.moving.add(this.geometry(arm), this.pose(arm, p, t));
      }
    }
    this.still.end();
    this.moving.end();
    const nextPanels = panelKey.join('|');
    if (nextPanels !== this.panelKey) {
      this.panelKey = nextPanels;
      this.panels.geometry.dispose();
      this.panels.geometry = quads.length ? panelGeometry(quads) : new BufferGeometry();
    }
    this.panels.visible = quads.length > 0;
    for (const [id, sign] of this.signs) {
      if (signsSeen.has(id)) continue;
      this.root.remove(sign.mesh);
      this.signs.delete(id);
    }
    for (const [key, mesh] of this.meshes)
      if (!glows.has(key)) {
        mesh.count = 0;
        mesh.visible = false;
      }
    for (const [key, list] of glows) {
      const mesh = this.mesh(key, list.length);
      list.forEach((p, i) => {
        mesh.setMatrixAt(i, this.pose(key, p, t));
        mesh.setColorAt(i, this.white);
      });
      mesh.count = list.length;
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      cullByInstances(mesh);
    }
    this.last = { byKind, total: props.length, signs: signWords };
  }

  /** A sign past the atlas's slots: its panel on its own (its post is in the still batch). */
  private placeSign(p: PropSnapshot): void {
    let sign = this.signs.get(p.id);
    if (!sign || sign.label !== p.label) {
      if (sign) this.root.remove(sign.mesh);
      const g = new Group();
      const key = `${p.variant}|${p.label}`;
      let tex = this.textures.get(key);
      if (!tex) {
        tex = signTexture(p.label, p.variant) ?? undefined;
        if (tex) this.textures.set(key, tex);
      }
      if (tex) {
        // The face looks back along the road at the riders coming (the plane's +z, the model's back).
        const serial = p.variant === 'serial';
        const m = serial ? SERIAL_M : SIGN_M;
        const panel = new Mesh(new PlaneGeometry(m, m), this.look.material('board', { map: tex }));
        panel.position.set(0, (serial ? SERIAL_UP : 2.2) + m / 2, 0);
        g.add(panel);
      }
      g.name = `event-sign-${p.id}`;
      sign = { mesh: g, label: p.label, variant: p.variant };
      this.signs.set(p.id, sign);
      this.root.add(g);
    }
    sign.mesh.position.set(p.x, p.y, p.z);
    sign.mesh.rotation.set(0, p.heading, 0);
  }

  /**
   * A lane-vote gantry's panel (W-T), with both choices; redrawn once when the vote is cast, so the
   * winning side lights. Its frame is in the still batch: the panel is the gantry's one own draw.
   */
  private placeGantry(p: PropSnapshot, span: number): void {
    let sign = this.signs.get(p.id);
    if (!sign || sign.label !== p.label || sign.variant !== p.variant) {
      if (sign) this.root.remove(sign.mesh);
      const g = new Group();
      const key = `gantry|${p.variant}|${p.label}`;
      let tex = this.textures.get(key);
      if (!tex) {
        tex = gantryTexture(p.label, p.variant) ?? undefined;
        if (tex) this.textures.set(key, tex);
      }
      if (tex) {
        const panel = new Mesh(
          new PlaneGeometry(span * 0.94, GANTRY_PANEL_M),
          this.look.material('board', { map: tex }),
        );
        panel.position.set(0, GANTRY_PANEL_UP + GANTRY_PANEL_M / 2, 0.2);
        g.add(panel);
      }
      g.name = `event-gantry-${p.id}`;
      sign = { mesh: g, label: p.label, variant: p.variant };
      this.signs.set(p.id, sign);
      this.root.add(g);
    }
    sign.mesh.position.set(p.x, p.y, p.z);
    sign.mesh.rotation.set(0, p.heading, 0);
  }

  counts(): EventPropCounts {
    return this.last;
  }

  /** The batches (tests and the debug overlay): the props standing still, and the moving ones. */
  batches(): { still: PropBatch; moving: PropBatch } {
    return { still: this.still, moving: this.moving };
  }
}
