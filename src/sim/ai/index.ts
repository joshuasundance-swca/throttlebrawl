// sim/ai: the AIController, run in the controllers phase (ai-1 owns this folder after app-1).
// Rivals drive through SimInput exactly like the player. The skeleton rival holds its lane and
// the event's pace; ai-1 adds traffic avoidance, fights, styles and the rubber band.
import { clamp, type TuningParamDecl } from '../../core';
import { maxYawAt } from '../riders';
import type { SimConfig } from '../types';
import type { SimSystem, World } from '../world';

export const AI_TUNING: readonly TuningParamDecl[] = [];

const COAST_DECEL = 0.6;

export const aiSystem: SimSystem = {
  name: 'controllers',
  init() {},
  step(world: World, config: SimConfig) {
    const road = config.road;
    const steerScale = world.params['riders.steerScale'] ?? 1;
    for (const m of world.movers) {
      const def = config.riders[m.riderIndex];
      if (m.kind !== 'rider' || def?.controller.kind !== 'ai' || m.mode !== 'Road') continue;
      const bike = def.bike;
      const pos = m.pos;
      const v = m.speed;
      // Pace: feed-forward throttle that holds the target speed, plus a proportional term.
      const target = Math.min(config.event.paceMps, bike.topSpeedMps * 0.98);
      const hold = (bike.accelMps2 * (target * target)) / (bike.topSpeedMps * bike.topSpeedMps) + COAST_DECEL;
      const throttle = clamp(hold / (bike.accelMps2 + COAST_DECEL) + 0.5 * (target - v), 0, 1);
      const brake = v > target + 4 ? clamp((v - target - 4) * 0.3, 0, 1) : 0;
      // Lane keeping: aim for the centre of the nearest drive lane in the travel direction.
      const lanes = road.lanesAt(pos.edge, pos.s);
      const lane = lanes.find((l) => l.kind === 'drive' && l.direction === pos.dir) ?? lanes[0];
      const dTarget = lane?.dCenterM ?? 0;
      // Lateral speed wanted, in the rider's frame (its right is -d when riding toward -s).
      const vLat = clamp((dTarget - pos.d) * 0.8, -3, 3) * pos.dir;
      const wantYaw = vLat / Math.max(v, 5);
      const turn = pos.dir * road.kappaAt(pos.edge, pos.s) * v + 3 * (wantYaw - m.yaw);
      const yawTarget = m.yaw + turn / 4;
      const steer = clamp(yawTarget / maxYawAt(bike.steerRateMps, v, steerScale), -1, 1);
      world.inputs[m.id] = {
        steer: Math.round(steer * 127),
        throttle: Math.round(throttle * 255),
        brake: Math.round(brake * 255),
        flags: 0,
      };
    }
  },
};
