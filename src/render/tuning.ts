// render-2's feel numbers (docs/milestones/M2.md, render-2). Every one is a tuning slider [default]
// and none affects the sim: they change how a hit, a crash, the slow motion and a splash look, never
// what happens. app/ gathers RENDER_TUNING with the other modules' declarations and hands a changed
// value to `GameRenderer.setParam`.
import type { TuningParamDecl } from '../sim/api';

export interface RenderParams {
  /**
   * The player's Reduce motion setting (M5's a11y-1), set through `GameRenderer.setReduceMotion`, not a
   * tuning slider: no white hit flash, half the slow-motion tint and the speed lines, a slower cops'
   * light bar and steady road-event lights (calm.ts). Absent (off) until the renderer sets it, so it
   * is not one of the sliders `defaultRenderParams` lists.
   */
  reduceMotion?: boolean;
  /** How long a hit target flashes bright, seconds (a takedown's victim flashes twice as long). */
  hitFlashS: number;
  /** Sparks in one hit's burst (a kick throws 1.5 times as many, a crash 2 times). */
  sparkCount: number;
  /** Spark launch speed, m/s. */
  sparkSpeedMps: number;
  /** Strength of the cool slow-motion tint over the screen, 0 = off. */
  slowmoTint: number;
  /** Scale on how fast a crashed bike cartwheels and a thrown rider tumbles, 0 = no spin. */
  cartwheelRate: number;
  /** How high a splash throws its water, metres. */
  splashHeightM: number;
  /** How long the gator or the fisherman stays to react to a splash, seconds. */
  reactorS: number;
  /** How long a knocked-off rider takes to stand up, seconds. */
  getUpS: number;
  /** How long a rider shakes a fist, seconds. */
  fistShakeS: number;
  // Playtest 1 item 10 (speed cues).
  /** The speed lines' opacity at full speed, 0 = off. */
  streakOpacity: number;
  /** How many speed lines show at once. */
  streakCount: number;
  /** Speed where the speed lines start, and where they are full, m/s. */
  streakFromMps: number;
  streakFullMps: number;
  /** Roadside scenery per stretch of road (1 = the default spacing), 0 = none. Rebuilds the road. */
  roadsideDensity: number;
  /** Scenery farther than this from the camera is not drawn (playtest 1c), metres. */
  sceneryDrawM: number;
  /** Past this the still scenery draws its far stand-ins (run W-S), metres. */
  sceneryLodM: number;
  /**
   * Where the haze is full in a region whose palette names a `fog` colour (the Pacific Northwest,
   * San Francisco), metres. It always starts past the threat draw distance. Elsewhere it is 700 m.
   */
  regionFogFarM: number;
  /** Drizzle in a rainy region (its palette names a `rain` colour), 1 = the default, 0 = none. */
  rainAmount: number;
  // Playtest 1b item 6: the "Ink + 1960s film" look (render/looks). They change that look only.
  /** Ink outline strength, 0 = none. */
  inkLines: number;
  /** Ink outline width, device pixels. */
  inkWidthPx: number;
  /** Hatch lines per metre in the inked shadows. */
  hatchPerM: number;
  /** Inked waves on the sea, 0 = plain water. */
  seaInk: number;
  /** The Kodachrome grade's strength, 0 = ungraded. */
  filmGrade: number;
  /** The film vignette, 0 = none. */
  vignette: number;
  /** Film grain, 0 = none. */
  filmGrain: number;
}

const decl = (
  key: keyof RenderParams,
  label: string,
  def: number,
  min: number,
  max: number,
  step: number,
  unit: string,
): TuningParamDecl => ({
  id: `render.${key}`,
  group: 'visuals',
  label,
  default: def,
  min,
  max,
  step,
  unit,
  affectsSim: false,
});

export const RENDER_TUNING: readonly TuningParamDecl[] = [
  decl('hitFlashS', 'Hit flash', 0.1, 0, 0.3, 0.01, 's'),
  decl('sparkCount', 'Sparks per hit', 12, 0, 40, 1, ''),
  decl('sparkSpeedMps', 'Spark speed', 7, 1, 20, 0.5, 'm/s'),
  decl('slowmoTint', 'Slow-motion tint', 0.28, 0, 0.7, 0.02, ''),
  decl('cartwheelRate', 'Crash spin', 1, 0, 3, 0.1, ''),
  decl('splashHeightM', 'Splash height', 5, 1, 12, 0.5, 'm'),
  decl('reactorS', 'Gator or fisherman stays', 3, 1, 8, 0.25, 's'),
  decl('getUpS', 'Get-up time', 0.5, 0.2, 1.5, 0.05, 's'),
  decl('fistShakeS', 'Fist shake', 1.2, 0.3, 3, 0.1, 's'),
  // Playtest 1 item 10 [decided]: speed cues. [default] numbers.
  decl('streakOpacity', 'Speed lines', 0.45, 0, 1, 0.05, ''),
  decl('streakCount', 'Speed line count', 40, 0, 64, 1, ''),
  decl('streakFromMps', 'Speed lines from', 20, 0, 60, 1, 'm/s'),
  decl('streakFullMps', 'Speed lines full at', 45, 10, 80, 1, 'm/s'),
  decl('roadsideDensity', 'Roadside scenery', 1, 0, 3, 0.25, ''),
  // Playtest 1c: the Blender scenery. [default] well into the fog (it starts at 220 m), so far
  // scenery fades in rather than pops, and the phone keeps its triangle budget.
  decl('sceneryDrawM', 'Scenery draw distance', 360, 150, 760, 10, 'm'),
  // Run W-S (the draw-call and triangle headroom): past this the still scenery draws as blocks in
  // its own colours, about a tenth of the triangles. [default] 200 m: inside the 220 m fog start, a
  // palm there is about 11 px wide on the phone's 412 px landscape height.
  decl('sceneryLodM', 'Scenery far detail from', 200, 60, 760, 10, 'm'),
  // Playtest 1c integration: a foggy region's haze closes in. [default] 480 m: past the 200 m threat
  // draw distance and the 220 m fog start, so traffic still shows; the Keys keep 700 m.
  decl('regionFogFarM', 'Foggy region: haze full at', 480, 300, 700, 10, 'm'),
  // W-O region build-out (the maintainer, 2026-10-01): the Pacific Northwest's drizzle. [default]
  decl('rainAmount', 'Rainy region: drizzle', 1, 0, 2, 0.1, ''),
  // Playtest 1b item 6 [decided]: the ink + film look. [default] numbers; the classic look ignores them.
  decl('inkLines', 'Ink look: outlines', 1, 0, 1, 0.05, ''),
  decl('inkWidthPx', 'Ink look: outline width', 1.5, 0.5, 3, 0.25, 'px'),
  decl('hatchPerM', 'Ink look: hatch lines per metre', 5, 1, 12, 0.5, '/m'),
  decl('seaInk', 'Ink look: inked waves', 1, 0, 1, 0.05, ''),
  decl('filmGrade', 'Ink look: film grade', 1, 0, 1, 0.05, ''),
  decl('vignette', 'Ink look: vignette', 0.4, 0, 1, 0.05, ''),
  decl('filmGrain', 'Ink look: film grain', 0.05, 0, 0.2, 0.01, ''),
];

export function defaultRenderParams(): RenderParams {
  const p: Record<string, number> = {};
  for (const d of RENDER_TUNING) p[d.id.slice('render.'.length)] = d.default;
  return p as unknown as RenderParams;
}

/** Applies a `render.*` value to the params in place; other ids and non-finite values are ignored. */
export function applyRenderParam(params: RenderParams, id: string, value: number): boolean {
  if (!id.startsWith('render.') || !Number.isFinite(value)) return false;
  const key = id.slice('render.'.length);
  const decl = RENDER_TUNING.find((d) => d.id === id);
  if (!decl || !(key in params)) return false;
  (params as unknown as Record<string, number>)[key] = Math.min(decl.max, Math.max(decl.min, value));
  return true;
}
