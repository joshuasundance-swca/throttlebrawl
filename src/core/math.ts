// Deterministic math (docs/architecture.md, "Determinism rules"). ECMAScript does not pin
// Math.sin, Math.cos, Math.atan2 and friends bit-exactly across engines and CPUs, so the sim and
// the road use these versions instead. They are built only from + - * /, Math.sqrt,
// Math.round, Math.floor and comparisons, whose results IEEE 754 fixes exactly.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

/** x clamped into [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Linear interpolation from a to b by t. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The angle x wrapped into [-π, π]. */
export function wrapAngle(x: number): number {
  if (x >= -PI && x <= PI) return x;
  return x - TAU * Math.round(x / TAU);
}

// Taylor coefficients, precomputed as literals so no engine computes them differently.
const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;
const S13 = 1 / 6227020800;
const S15 = -1 / 1307674368000;

/** Deterministic sine. Absolute error below 1e-11 over any finite input. */
export function sin(x: number): number {
  let r = wrapAngle(x);
  // Fold into [-π/2, π/2], where the series converges fast.
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  return r * (1 + r2 * (S3 + r2 * (S5 + r2 * (S7 + r2 * (S9 + r2 * (S11 + r2 * (S13 + r2 * S15)))))));
}

/** Deterministic cosine. */
export function cos(x: number): number {
  return sin(x + HALF_PI);
}

/** atan on |z| <= 1, by two argument halvings and a short series. */
function atanUnit(z: number): number {
  // atan(z) = 2·atan(z / (1 + sqrt(1 + z²))): two halvings bring |z| below 0.2.
  const h1 = z / (1 + Math.sqrt(1 + z * z));
  const h2 = h1 / (1 + Math.sqrt(1 + h1 * h1));
  const t = h2 * h2;
  let sum = 0;
  // Series atan(u) = u - u³/3 + u⁵/5 - ... to u^23 (error below 1e-18 at |u| = 0.2).
  for (let k = 11; k >= 0; k--) sum = (k % 2 === 0 ? 1 : -1) / (2 * k + 1) + t * sum;
  return 4 * h2 * sum;
}

/** Deterministic atan. */
export function atan(z: number): number {
  if (z > 1) return HALF_PI - atanUnit(1 / z);
  if (z < -1) return -HALF_PI - atanUnit(1 / z);
  return atanUnit(z);
}

/** Deterministic atan2, with the same quadrant rules as Math.atan2 for finite input. */
export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

/** Seconds to whole 60 Hz ticks, by the content rule ticks = max(1, round(seconds × 60)). */
export function secondsToTicks(seconds: number, hz = 60): number {
  return Math.max(1, Math.round(seconds * hz));
}
