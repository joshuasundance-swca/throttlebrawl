// render-2's feel numbers (docs/milestones/M2.md, render-2). Every one is a tuning slider [default]
// and none affects the sim: they change how a hit, a crash, the slow motion and a splash look, never
// what happens. app/ gathers RENDER_TUNING with the other modules' declarations and hands a changed
// value to `GameRenderer.setParam`.
import type { TuningParamDecl } from '../sim/api';

export interface RenderParams {
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
