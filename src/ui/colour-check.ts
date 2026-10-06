// The shape and colour check (M5's a11y-1; docs/product-spec.md, "Accessibility"): pure colour maths
// for deciding whether two HUD colours could be mistaken for each other by a colour-blind player. A
// HUD state that colour alone tells apart needs a second cue (a word, a shape, a place);
// shape-colour.test.ts holds every colour-coded piece of the HUD to that. Used by tests only, so the
// game never loads it. [default]

export type Cvd = 'protan' | 'deutan' | 'tritan';
export const CVDS: readonly Cvd[] = ['protan', 'deutan', 'tritan'];

type Rgb = [number, number, number];

/** A `#rrggbb` colour as 0..1 sRGB. */
export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`a11y: not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toLinearRgb = (rgb: Rgb): Rgb => [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])];

/**
 * Machado, Oliveira and Fernandes (2009) matrices for severity 1.0, applied to linear sRGB: what a
 * protan (no L cones), deutan (no M) or tritan (no S) viewer sees.
 */
const MATRIX: Record<Cvd, readonly [Rgb, Rgb, Rgb]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The colour as the given kind of colour-blind viewer sees it, in linear sRGB. */
export function simulate(hex: string, kind: Cvd | null): Rgb {
  const lin = toLinearRgb(parseHex(hex));
  if (kind === null) return lin;
  const m = MATRIX[kind];
  const row = (r: Rgb) => clamp01(r[0] * lin[0] + r[1] * lin[1] + r[2] * lin[2]);
  return [row(m[0]), row(m[1]), row(m[2])];
}

/** WCAG relative luminance of a linear sRGB colour. */
const luminance = (lin: Rgb) => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];

/** WCAG contrast ratio of two colours as the given viewer sees them (1 is identical, 21 is black on white). */
export function contrastRatio(a: string, b: string, kind: Cvd | null = null): number {
  const la = luminance(simulate(a, kind));
  const lb = luminance(simulate(b, kind));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Two colours a colour-blind player could mistake: their lightness differs by less than this contrast
 * ratio for some kind of colour blindness (or none). 1.5 is the line the hue-only pairs fall under
 * (a green and an amber of the same lightness are about 1.1).
 */
export const CONFUSABLE_BELOW = 1.5;

/** Whether the two colours could be mistaken for each other by someone, going by lightness alone. */
export function confusable(a: string, b: string): boolean {
  return [null, ...CVDS].some((kind) => contrastRatio(a, b, kind) < CONFUSABLE_BELOW);
}
