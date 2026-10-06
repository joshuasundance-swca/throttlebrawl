// Test helper: the colour the player sees on the sea, by look and time of day (polish J3, the Smathers salt ponds).
// A water tint is a vertex colour that multiplies the look's own water colour (sea-bands.ts), and what is drawn is
// that albedo lit. In the ink looks (render/looks/ink.ts, FRAGMENT_WATER) the sea is not lit at all: it is the albedo
// times the time of day's exposure, then the film grade; in the classic look it is a Lambert surface under the scene's
// hemisphere and sun (render/look.ts setupScene), seen from above (the sea faces up). No GLSL runs here: this is the
// same arithmetic on the CPU, for a flat colour (no waves, no hatching, no fog, no grain, no vignette).
// Colours go in and out as display sRGB, 0 to 255.
import { Color, DirectionalLight, HemisphereLight, Scene, type MeshLambertMaterial } from 'three';
import { createFlatLook } from './look';
import { createLookSet, INK_RECIPES, type LookId } from './looks';
import { GRADES } from './looks/grade';
import { skyOf } from './looks/recipes';

export type Rgb = [number, number, number];

export const LOOK_IDS_LIT: readonly LookId[] = ['classic', 'kodak', 'wasteland', 'brush'];
/** Every time of day the sky tables name (render/look.ts SKY_BY_TIME). */
export const TIMES_OF_DAY = ['dawn', 'noon', 'golden-hour', 'dusk', 'night'] as const;

const regionFiles = import.meta.glob<{
  id: string;
  palette?: Record<string, string>;
  timeOfDayOptions?: { id: string; palette?: Record<string, string> }[];
}>('../../packs/*/regions/*/region.json', { eager: true, import: 'default' });

/** A region's palette for a time of day: its own, overridden key by key by the time's option (app/regions.ts racePalette). */
export function regionPalette(regionId: string, timeOfDay: string): Record<string, string> {
  const region = Object.values(regionFiles).find((r) => r.id === regionId);
  if (!region) throw new Error(`no region ${regionId}`);
  const option = region.timeOfDayOptions?.find((o) => o.id === timeOfDay);
  return { ...(region.palette ?? {}), ...(option?.palette ?? {}) };
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toDisplay = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};

/** CIE L*a*b* of a display sRGB colour (0 to 255), D65. */
export function lab(rgb: readonly number[]): [number, number, number] {
  const [r, g, b] = [0, 1, 2].map((k) => toLinear((rgb[k] ?? 0) / 255)) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export const deltaE = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

/** The hue (degrees, 0 to 360: 30 orange, 60 yellow, 120 green, 180 cyan, 240 blue) and chroma of a colour. */
export function hueChroma(rgb: readonly number[]): { hue: number; chroma: number } {
  const [, a, b] = lab(rgb);
  return { hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360, chroma: Math.hypot(a, b) };
}

export interface LitSea {
  /** The look's own water colour, linear (what a tint multiplies). */
  water: Rgb;
  /** The display colour of the sea where its tint is `tint`. */
  lit(tint: readonly number[]): Rgb;
}

/** The sea of one look at one time of day in a region (its palette as the game hands it to the look). */
export function litSea(lookId: LookId, timeOfDay: string, regionId = 'florida-keys'): LitSea {
  const set = createLookSet(createFlatLook());
  const material = set.material('water', { vertexColors: true, paletteBase: true }) as MeshLambertMaterial;
  set.select(lookId);
  const scene = new Scene();
  set.setupScene(scene, { timeOfDay, palette: regionPalette(regionId, timeOfDay) });
  const c: Color = material.color;
  const water: Rgb = [c.r, c.g, c.b];
  const recipe = lookId === 'classic' ? null : INK_RECIPES[lookId];
  // What multiplies the albedo, per channel (linear).
  let gain: Rgb = [1, 1, 1];
  if (recipe) {
    const e = skyOf(recipe, timeOfDay).exposure;
    gain = [e, e, e];
  } else {
    const sky = scene.children.find((o): o is HemisphereLight => o instanceof HemisphereLight);
    const sun = scene.children.find((o): o is DirectionalLight => o instanceof DirectionalLight);
    if (!sky || !sun) throw new Error('the classic look lights no sky or sun');
    // Facing up: the hemisphere gives its sky colour whole; the sun gives its colour by the cosine of its angle from
    // the vertical. three's Lambert is the albedo over pi, with no pi in the light.
    const up = sun.position.clone().normalize().y;
    gain = [0, 1, 2].map(
      (k) =>
        (([sky.color.r, sky.color.g, sky.color.b][k] ?? 0) * sky.intensity +
          ([sun.color.r, sun.color.g, sun.color.b][k] ?? 0) * sun.intensity * Math.max(0, up)) /
        Math.PI,
    ) as Rgb;
  }
  return {
    water,
    lit(tint) {
      const display = [0, 1, 2].map((k) =>
        toDisplay((water[k] ?? 0) * (tint[k] ?? 1) * (gain[k] ?? 1)),
      ) as Rgb;
      // The film pass grades the ink looks (looks/index.ts post: filmGrade 1, the recipe's amount).
      const graded = recipe ? GRADES[recipe.grade](display[0], display[1], display[2]) : display;
      const amount = recipe ? Math.min(1, recipe.gradeAmount) : 0;
      return [0, 1, 2].map(
        (k) => 255 * ((display[k] ?? 0) + ((graded[k] ?? 0) - (display[k] ?? 0)) * amount),
      ) as Rgb;
    },
  };
}
