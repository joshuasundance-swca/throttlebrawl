// A smoking bike is a little slower (playtest 4, P4-14; the maintainer's answer "A little": about
// 5 to 10 % less top speed while it smokes, repairs between races fix it, tunable).
// - A bike smokes while its rider's health is at or under SMOKE_HEALTH of the most (the render draws
//   the exhaust smoke from the same number, through the sim's public contract).
// - While it smokes the bike's own top speed is scaled by 1 - `riders.smokeSlowdown` ([default]
//   0.075, the middle of the decided 5 to 10 %). The scale is on the bike's top speed only: the
//   drag still pulls a faster bike down smoothly, a boost pad's boost and the ground's speed
//   scale come on top as before, and acceleration is unchanged.
// - It is one rule for every rider whose health is tracked (the player, the rivals): what you see
//   smoking is slower. A cop's health is never touched, so he never smokes.
// - Repairs: every race starts with every bike at full health (the riders' init, and each rider's
//   hand-back after a tumble), so in a career the next race is a repaired bike. Mid-race the
//   player's regeneration (combat) lifts the slowdown when it takes him back over the line.
// Deterministic: plain numbers only.
import type { TuningParamDecl } from '../../core';

/** A bike smokes at or under this share of its rider's health. [default] (render and sim share it) */
export const SMOKE_HEALTH = 0.34;

export const SMOKE_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'riders.smokeSlowdown',
    group: 'speed',
    label: 'Smoking bike: top speed lost (0 off)',
    default: 0.075,
    min: 0,
    max: 0.3,
    step: 0.005,
    unit: '',
    affectsSim: true,
  },
];

/**
 * The scale on a bike's top speed for the health its rider has left: `1 - loss` at or under the
 * smoking line, 1 above it, and 1 when the loss is not positive or the rider has no health to
 * speak of (`healthMax` 0: a rider that is not hurt by anything).
 */
export function smokeTopScale(loss: number, health: number, healthMax: number): number {
  if (!(loss > 0) || !(healthMax > 0) || health / healthMax > SMOKE_HEALTH) return 1;
  return 1 - Math.min(loss, 1);
}
