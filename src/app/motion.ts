// Reduce motion and Reduce screen shake (M5's a11y-1; docs/product-spec.md, "Accessibility"): which
// amount each setting sets. Reduce screen shake is the narrow switch the maintainer decided on (no
// shake, no hit jolt). Reduce motion is the wider one: it takes the shake with it, softens the chase
// cameras' lean roll and speed FOV kick, and calms the picture's flashes (render/calm.ts). The phone's
// own reduce-motion preference counts as Reduce motion being on, so a player who set it once is not
// asked again. Presentation only; none of it reaches the sim.
import type { Settings } from '../save';

export interface MotionAmounts {
  /** camera.setShakeAmount: 1 full shake and hit jolt, 0 none. */
  shake: 0 | 1;
  /** camera.setMotionAmount: 1 full lean roll and FOV kick, 0 softened. */
  motion: 0 | 1;
  /** renderer.setReduceMotion: the flashes calm. */
  calm: boolean;
}

/** The amounts for the saved settings, given the phone's own `prefers-reduced-motion` answer. */
export function motionAmounts(
  s: Readonly<Pick<Settings, 'reduceShake' | 'reduceMotion'>>,
  osPrefersReduced: boolean,
): MotionAmounts {
  const calm = s.reduceMotion || osPrefersReduced;
  return { shake: s.reduceShake || calm ? 0 : 1, motion: calm ? 0 : 1, calm };
}

/** Whether the phone or the browser asks for reduced motion. False where `matchMedia` is missing. */
export function osPrefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
