// The ink looks as data (playtest 1c item 5): one ink pipeline (ink.ts + post.ts) with dials, and
// each look is a recipe of palette, sky, grade, line weight and shadow style. The style curator
// found the looks share kodak's palette family (scratch/styles4/curation4.md, "One pipeline for
// wasteland and film"), so a new look is a new recipe here, not a new shader. Every number is
// [default]. There are no crack, rust or grime ageing textures in any recipe (the maintainer:
// "Not big on the cracked, rust, grime").
import type { MaterialKind } from '../look';
import type { GradeId } from './grade';

/** How the shaded sides of things are drawn. */
export type ShadowStyle = 'hatch' | 'solid';

export interface SkyColours {
  top: string;
  horizon: string;
  exposure: number;
}

export interface InkRecipe {
  /** World colours (display sRGB) by material kind; kinds not listed keep the classic colour. */
  palette: Partial<Record<MaterialKind, string>>;
  /** The sky gradient and haze, by time of day (`golden-hour` is the fallback). */
  sky: Record<string, SkyColours>;
  /** The ink colour (display sRGB). */
  ink: string;
  /** Times the "outline width" slider. */
  lineWeight: number;
  /** 0 = an even pen line, 1 = a brush line that swells and thins along its length. */
  brush: number;
  /** Hatched shadow bands, or flat bands with the deep side filled solid ink. */
  shadow: ShadowStyle;
  /** Times the "hatch lines per metre" slider. */
  hatchScale: number;
  /** Sparse pen strokes on lit faces as well as shaded ones, 0 = none. */
  litHatch: number;
  /** Times the "inked waves" slider. */
  seaInk: number;
  /** Which colour table the final pass reads. */
  grade: GradeId;
  /** Times the "film grade" slider. */
  gradeAmount: number;
  /** Times the "film grain" slider. */
  grain: number;
  /** Times the "vignette" slider. */
  vignette: number;
}

const NIGHT: SkyColours = { top: '#141a33', horizon: '#2a2f4a', exposure: 0.45 };

/**
 * "Ink + 1960s film" (playtest 1b item 6): peach-cream sky, deep teal sea, warm brown-grey asphalt,
 * sand shoulders, wooden rails; hatched shadows; the full Kodachrome grade. Unchanged from 1b.
 */
export const KODAK: InkRecipe = {
  palette: {
    road: '#4d443d',
    shoulder: '#cfa86a',
    shortcut: '#c08e55',
    brick: '#a8583f',
    marking: '#f3e6c8',
    markingCenter: '#e8ae36',
    post: '#efe0bf',
    rail: '#b8864f',
    deck: '#b9a283',
    land: '#d7b273',
    water: '#1e8e98',
  },
  sky: {
    dawn: { top: '#e9b49a', horizon: '#f4dcc0', exposure: 0.95 },
    noon: { top: '#9fc9cf', horizon: '#efe3c6', exposure: 1.05 },
    'golden-hour': { top: '#eda57f', horizon: '#f7e6c9', exposure: 1 },
    dusk: { top: '#b9687a', horizon: '#e8b48f', exposure: 0.8 },
    night: NIGHT,
  },
  ink: '#1b140f',
  lineWeight: 1,
  brush: 0,
  shadow: 'hatch',
  hatchScale: 1,
  litHatch: 0,
  seaInk: 1,
  grade: 'kodachrome',
  gradeAmount: 1,
  grain: 1,
  vignette: 1,
};

/**
 * "Sun-bleached wasteland" (the curator's top pick, scratch/styles4 `wasteland-sunbleached`): a flat
 * burnt-orange sky, a deep teal sea, a charcoal road, tan shoulders and one hot-orange accent (the
 * centre line), heavy black ink and denser hatching. The grade is a light sun-bleach, not film;
 * the film is a dial (`grade: 'kodachrome'` gives the `blend_kodak` variant). Dust is a little grain.
 * The sea hue and the accent stay fixed at every time of day, as the curator advised.
 */
export const WASTELAND: InkRecipe = {
  palette: {
    road: '#3b3a3c',
    shoulder: '#d4aa72',
    shortcut: '#c48a50',
    brick: '#a85a38',
    marking: '#efe4cc',
    markingCenter: '#f08a24',
    post: '#e8d9b8',
    rail: '#a8794a',
    deck: '#a99678',
    land: '#d6ad6c',
    water: '#16707a',
  },
  sky: {
    dawn: { top: '#d98a68', horizon: '#e6a27c', exposure: 0.95 },
    noon: { top: '#e39a5c', horizon: '#e8a86c', exposure: 1.05 },
    'golden-hour': { top: '#df7f48', horizon: '#e69058', exposure: 1 },
    dusk: { top: '#a8566a', horizon: '#c97a6a', exposure: 0.8 },
    night: { top: '#1a1830', horizon: '#2b2838', exposure: 0.45 },
  },
  ink: '#120e0b',
  lineWeight: 1.5,
  brush: 0,
  shadow: 'hatch',
  hatchScale: 1.3,
  litHatch: 0.25,
  seaInk: 1,
  grade: 'bleach',
  gradeAmount: 1,
  grain: 0.6,
  vignette: 0.25,
};

/**
 * "Kodachrome brush" (scratch/styles4 `kodak-brush`, scratch/styles2 `v_brush_frame1.png`): thick
 * brush outlines that swell and thin, flat colour with the shaded sides filled solid black, a cream
 * sky over a teal sea and a near-black road, all under the Kodachrome grade, grain and vignette.
 */
export const BRUSH: InkRecipe = {
  palette: {
    road: '#2f2c2b',
    shoulder: '#cdb592',
    shortcut: '#b88f5c',
    brick: '#9c4a38',
    marking: '#f7f1e3',
    markingCenter: '#f2c230',
    post: '#f1e7d0',
    rail: '#c9b79a',
    deck: '#bfae93',
    land: '#d9bf8e',
    water: '#2a9d97',
  },
  sky: {
    dawn: { top: '#f0c4b0', horizon: '#f6dccb', exposure: 0.95 },
    noon: { top: '#bfe0e0', horizon: '#f3e8d4', exposure: 1.05 },
    'golden-hour': { top: '#f2c9ae', horizon: '#f6dcc6', exposure: 1 },
    dusk: { top: '#c27c86', horizon: '#eabca0', exposure: 0.8 },
    night: NIGHT,
  },
  ink: '#0d0b0a',
  lineWeight: 2.2,
  brush: 1,
  shadow: 'solid',
  hatchScale: 1,
  litHatch: 0,
  seaInk: 0.45,
  grade: 'kodachrome',
  gradeAmount: 1,
  grain: 1,
  vignette: 1,
};

export function skyOf(recipe: InkRecipe, timeOfDay: string | undefined): SkyColours {
  return recipe.sky[timeOfDay ?? ''] ?? recipe.sky['golden-hour']!;
}
