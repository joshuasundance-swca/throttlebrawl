// The per-tick mover invariants, shared by the browser race (the test handle) and the headless
// seeded-race batch (tests/sim/batch.ts): every mover has finite numbers, a known mode and a valid
// road position (an existing edge, 0 ≤ s ≤ its length).
import type { EntitySnapshot, MoverMode, RouteQueries } from '../../sim/api';

export const MOVER_MODES: readonly MoverMode[] = ['Road', 'Airborne', 'Tumble', 'OnFoot', 'Free'];

/** What is wrong with a mover this tick, or null when it is valid. */
export function moverProblem(m: EntitySnapshot, route: RouteQueries): string | null {
  const r = m.road;
  const numbers = {
    x: m.x,
    y: m.y,
    z: m.z,
    heading: m.heading,
    speed: m.speed,
    s: r.s,
    d: r.d,
    h: r.h,
    yaw: r.yaw,
  };
  for (const [k, v] of Object.entries(numbers)) if (!Number.isFinite(v)) return `${k} is ${v}`;
  if (!MOVER_MODES.includes(m.mode)) return `unknown mode ${String(m.mode)}`;
  if (!Number.isInteger(r.edge)) return `edge ${r.edge} is not an integer`;
  const length = route.edgeLength(r.edge);
  if (!Number.isFinite(length)) return `edge ${r.edge} does not exist`;
  if (r.s < 0 || r.s > length) return `s ${r.s} outside edge ${r.edge} (0..${length})`;
  if (r.dir !== 1 && r.dir !== -1) return `dir ${String(r.dir)}`;
  return null;
}
