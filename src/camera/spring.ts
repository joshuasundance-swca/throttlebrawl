// Critically damped springs for the camera rigs (docs/architecture.md, "Camera").
//
// Each step uses the exact closed-form solution of x'' = ω²(goal − x) − 2ω·x' with the goal held
// for the step, so the result does not depend on the frame rate's stability limits: a 0.25 s frame
// (the loop's clamp) is as stable as a 1/120 s one. Started at rest, a critically damped spring
// approaches a new goal monotonically and never overshoots it.

/** One scalar spring: its value and its velocity. */
export interface Spring {
  x: number;
  v: number;
}

export function spring(x: number): Spring {
  return { x, v: 0 };
}

/**
 * Advances a spring toward `goal` by `dt` seconds with natural frequency `omega` (1/s).
 * `dt <= 0` leaves it unchanged. Mutates and returns the spring.
 */
export function stepSpring(sp: Spring, goal: number, omega: number, dt: number): Spring {
  if (!(dt > 0) || !(omega > 0)) return sp;
  const e = sp.x - goal;
  const k = sp.v + omega * e;
  const decay = Math.exp(-omega * dt);
  sp.x = goal + (e + k * dt) * decay;
  sp.v = (sp.v - omega * k * dt) * decay;
  return sp;
}

/** Wraps an angle into (−π, π]. */
export function wrapAngle(a: number): number {
  const TAU = Math.PI * 2;
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

/** Like stepSpring, for an angle: it takes the short way round to the goal. */
export function stepAngleSpring(sp: Spring, goal: number, omega: number, dt: number): Spring {
  const near = sp.x + wrapAngle(goal - sp.x);
  stepSpring(sp, near, omega, dt);
  sp.x = wrapAngle(sp.x);
  return sp;
}
