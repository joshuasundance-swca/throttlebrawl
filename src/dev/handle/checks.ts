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

/**
 * Watches the player's edge tick by tick for "the bot never rides back along its route". The old
 * browser check asked that no edge ever repeat, but a crash can throw the rider (or the bike he
 * runs back to) across a join, so after the remount he rides the joined edge again, forward, and
 * the check failed on the game working (bundle 1: edges 0>11>12>13>4>5>4>5 after 9 crashes). Only
 * a step from riding on one edge to riding on an edge first entered BEFORE it counts as riding
 * back; a tumble, the run on foot and the forward ride after a remount do not.
 */
export interface EdgeWatch {
  /** Notes the player's edge and mode after a step: what went wrong when it rode back, else null. */
  note(tick: number, edge: number, mode: MoverMode): string | null;
}

export function createEdgeWatch(): EdgeWatch {
  const firstEntered = new Map<number, number>();
  let lastEdge: number | null = null;
  let lastRiding = false;
  return {
    note(tick, edge, mode) {
      const riding = mode === 'Road' || mode === 'Airborne';
      let back: string | null = null;
      if (lastEdge !== null && edge !== lastEdge && riding && lastRiding) {
        const from = firstEntered.get(lastEdge) ?? 0;
        const to = firstEntered.get(edge);
        if (to !== undefined && to < from)
          back = `tick ${tick}: rode from edge ${lastEdge} back onto edge ${edge}`;
      }
      if (!firstEntered.has(edge)) firstEntered.set(edge, firstEntered.size);
      lastEdge = edge;
      lastRiding = riding;
      return back;
    },
  };
}
