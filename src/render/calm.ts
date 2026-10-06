// Reduce motion in the picture (M5's a11y-1; playtest 4 run B, B13): the flashing parts, in one place.
// A flash here is a light that changes colour or size on its own clock. The cops' red and blue light
// bar alternated at 4 Hz, more than the 3 flashes a second that accessibility guidance asks pages to
// stay under; under Reduce motion it alternates at 1 Hz, and the event light bar and the flares'
// glow hold steady. Presentation only: wall-clock time in, a number out. [default]

/** Colour steps per second of the cops' light bar: 8 (each colour shows 1/8 s), or 2 under reduce motion. */
const LIGHT_BAR_STEPS_PER_S = 8;
const LIGHT_BAR_CALM_STEPS_PER_S = 2;

/** Which colour the cops' light bar shows at wall-clock time `t`: 0 red, 1 blue. */
export function lightBarPhase(t: number, reduceMotion: boolean): 0 | 1 {
  const rate = reduceMotion ? LIGHT_BAR_CALM_STEPS_PER_S : LIGHT_BAR_STEPS_PER_S;
  return Math.floor(t * rate) % 2 === 0 ? 0 : 1;
}

/**
 * The size factor of a road-event light that flickers: the light bar swells and dims twice a
 * second, a flare's glow wobbles. Under reduce motion each holds at its steady size.
 */
export function propFlicker(
  kind: 'lightbar' | 'flareGlow',
  t: number,
  id: number,
  reduceMotion: boolean,
): number {
  if (kind === 'lightbar') return reduceMotion ? 1 : Math.sin(t * 12 + id) > 0 ? 1 : 0.55;
  return reduceMotion ? 0.8 : 0.8 + 0.25 * Math.sin(t * 17 + id * 3);
}

/** How much of the slow-motion tint and the speed lines Reduce motion leaves. */
export const CALM_SHARE = 0.5;
