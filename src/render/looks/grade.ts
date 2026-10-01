// The ink looks' colour grades as plain functions, each baked once into a small 3D lookup table the
// final pass reads with one texture tap (scratch/styles2's recipe: "one 3D-LUT tap, grain and
// vignette folded into one final pass"). Playtest 1b item 6 made the warm Kodachrome slide grade;
// playtest 1c item 5 adds the sun-bleach and neutral tables. Working space is display sRGB, 0..1
// per channel. Every number here is [default].

export type Rgb = [number, number, number];

/** Edge length of the baked table: 16³ texels, 16 KB as RGBA8. */
export const LUT_SIZE = 16;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * The Kodachrome-style grade of one display-sRGB colour:
 * - saturation up (slide film's rich reds and deep blues);
 * - a gentle S-curve for contrast;
 * - warm highlights (cream, not white) and warm, lifted blacks (faded film base, never pure black).
 */
export function kodachromeGrade(r: number, g: number, b: number): Rgb {
  // Saturation, around the colour's own luma.
  const sat = 1.18;
  const l0 = luma(r, g, b);
  let c: Rgb = [l0 + (r - l0) * sat, l0 + (g - l0) * sat, l0 + (b - l0) * sat];
  c = [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
  // Contrast: blend a third of the way toward a smoothstep S-curve.
  c = c.map((v) => v + (v * v * (3 - 2 * v) - v) * 0.35) as Rgb;
  // Warm highlights: toward cream as the colour brightens.
  const l1 = luma(c[0], c[1], c[2]);
  const hi = smooth(0.45, 1, l1);
  c = [c[0] * (1 + 0.04 * hi), c[1] * (1 - 0.02 * hi), c[2] * (1 - 0.14 * hi)];
  // A touch of warmth in the mids too (the film's orange cast), strongest at mid grey.
  const mid = 1 - Math.abs(2 * l1 - 1);
  c = [c[0] + 0.025 * mid, c[1] + 0.008 * mid, c[2] - 0.03 * mid];
  // Lifted, warm blacks: the darkest value is a brown, not black.
  const lift: Rgb = [0.075, 0.055, 0.045];
  c = [lift[0] + c[0] * (1 - lift[0]), lift[1] + c[1] * (1 - lift[1]), lift[2] + c[2] * (1 - lift[2])];
  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
}

/**
 * The sun-bleached grade (playtest 1c item 5, "Sun-bleached wasteland"): not film. Colours a touch
 * flatter and paler, as if left in the sun; highlights roll off toward a warm off-white; blacks lift
 * to a charcoal (not film's brown), so the heavy ink still reads darkest. A little warmth in the mids.
 */
export function bleachGrade(r: number, g: number, b: number): Rgb {
  const sat = 0.9;
  const l0 = luma(r, g, b);
  let c: Rgb = [l0 + (r - l0) * sat, l0 + (g - l0) * sat, l0 + (b - l0) * sat];
  c = [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
  // Highlights roll off: compress the top fifth toward a warm off-white.
  const l1 = luma(c[0], c[1], c[2]);
  const hi = smooth(0.6, 1, l1);
  const paper: Rgb = [0.97, 0.93, 0.85];
  c = [
    c[0] + (paper[0] - c[0]) * 0.18 * hi,
    c[1] + (paper[1] - c[1]) * 0.18 * hi,
    c[2] + (paper[2] - c[2]) * 0.18 * hi,
  ];
  const mid = 1 - Math.abs(2 * l1 - 1);
  c = [c[0] + 0.015 * mid, c[1] + 0.004 * mid, c[2] - 0.02 * mid];
  const lift: Rgb = [0.055, 0.052, 0.05];
  c = [lift[0] + c[0] * (1 - lift[0]), lift[1] + c[1] * (1 - lift[1]), lift[2] + c[2] * (1 - lift[2])];
  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
}

/** No grade: the table is the identity. */
export function neutralGrade(r: number, g: number, b: number): Rgb {
  return [r, g, b];
}

/** The colour tables a look can pick (recipes.ts). */
export const GRADES = {
  kodachrome: kodachromeGrade,
  bleach: bleachGrade,
  neutral: neutralGrade,
} as const;
export type GradeId = keyof typeof GRADES;

/**
 * The grade baked into an RGBA8 3D table, red fastest, then green, then blue (the layout a WebGL2
 * `Data3DTexture` reads). Sample it at `c * (n - 1) / n + 0.5 / n` for texel-centre lookups.
 */
export function buildGradeLut(size = LUT_SIZE, grade = kodachromeGrade): Uint8Array {
  const out = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let bz = 0; bz < size; bz++) {
    for (let gy = 0; gy < size; gy++) {
      for (let rx = 0; rx < size; rx++) {
        const [r, g, b] = grade(rx / (size - 1), gy / (size - 1), bz / (size - 1));
        out[i++] = Math.round(r * 255);
        out[i++] = Math.round(g * 255);
        out[i++] = Math.round(b * 255);
        out[i++] = 255;
      }
    }
  }
  return out;
}
