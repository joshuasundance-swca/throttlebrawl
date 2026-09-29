// The BotController (docs/architecture.md, "Testing seams"): a test player outside the sim that
// reads snapshots like a human would and writes the input layer's action state, once per sim
// tick. This is app-1's throttle-only stub: hold the throttle and steer along the route to the
// centre of the travel lane. dev-1 builds the real bot: attacks, the ramp shortcut, the run-back.
import type { ActionState } from '../../app';
import type { EntitySnapshot, RouteQueries } from '../../sim/api';

export interface BotController {
  /** Writes this tick's actions for the rider, from its snapshot and the route. */
  drive(me: EntitySnapshot, route: RouteQueries, actions: ActionState): void;
}

export function createStubBot(): BotController {
  return {
    drive(me, route, a) {
      const { edge, s, d, dir, yaw } = me.road;
      const v = Math.max(me.speed, 5);
      const lanes = route.lanesAt(edge, s);
      const lane = lanes.find((l) => l.kind === 'drive' && l.direction === dir) ?? lanes[0];
      const target = lane?.dCenterM ?? 0;
      // Steer toward the lane centre, with the road's curvature fed forward.
      const lateral = (target - d) * dir;
      const kappa = route.kappaAt(edge, s) * dir;
      const steer = 0.35 * lateral - 2.5 * yaw + (kappa * v * v) / 22;
      a.throttle = 1;
      a.brake = 0;
      a.steer = Math.max(-1, Math.min(1, steer));
    },
  };
}
