// sim/riders: the riding model (riders-1 and riders-2 own this folder after app-1). The skeleton
// model follows docs/architecture.md, "Coordinates": ds/dt = v·cos(yaw)/(1 − kappa·d),
// dd/dt = v·sin(yaw), d(yaw)/dt = own turn rate − kappa·ds/dt, signs flipped for dir −1.
import { clamp, cos, sin, type TuningParamDecl } from '../../core';
import { sRateFactor } from '../../road';
import type { SimConfig } from '../types';
import { systemState, type SimSystem, type World } from '../world';

export const RIDERS_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'riders.steerScale',
    group: 'steering',
    label: 'Steering',
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
];

/** Per-rider plain state, by entity id. */
export interface RiderState {
  throttle: number[];
  brake: number[];
  rpm: number[];
  gear: number[];
  lean: number[];
  health: number[];
}

const COAST_DECEL = 0.6; // m/s² when off the throttle, before air drag
const GRAVITY = 9.81;
const YAW_RESPONSE = 4; // 1/s: how fast the bike reaches the steered heading
const MAX_YAW = 0.5; // rad
const GEAR_TOP_MPS = [9, 16, 23, 30, 1000];

export function riderState(world: World): RiderState {
  return systemState<RiderState>(world, 'riders', () => ({
    throttle: [],
    brake: [],
    rpm: [],
    gear: [],
    lean: [],
    health: [],
  }));
}

/** The largest heading offset steering can ask for at a speed (reaches the bike's steer rate). */
export function maxYawAt(steerRateMps: number, speed: number, steerScale: number): number {
  return clamp((steerRateMps * steerScale) / (speed < 6 ? 6 : speed), 0.05, MAX_YAW);
}

export const ridersSystem: SimSystem = {
  name: 'riders',
  init(world: World, config: SimConfig) {
    const st = riderState(world);
    for (const m of world.movers) {
      const def = config.riders[m.riderIndex];
      if (m.kind !== 'rider' || !def) continue;
      st.throttle[m.id] = 0;
      st.brake[m.id] = 0;
      st.rpm[m.id] = 1200;
      st.gear[m.id] = 1;
      st.lean[m.id] = 0;
      st.health[m.id] = def.healthMax;
    }
  },
  step(world: World, config: SimConfig) {
    const st = riderState(world);
    const dt = world.timeScale / 60;
    const steerScale = world.params['riders.steerScale'] ?? 1;
    const road = config.road;
    for (const m of world.movers) {
      const def = config.riders[m.riderIndex];
      if (m.kind !== 'rider' || m.mode !== 'Road' || !def) continue;
      const input = world.inputs[m.id];
      if (!input) continue;
      const bike = def.bike;
      const throttle = clamp(input.throttle / 255, 0, 1);
      const brake = clamp(input.brake / 255, 0, 1);
      const steer = clamp(input.steer / 127, -1, 1);
      const pos = m.pos;
      const frameKappa = road.kappaAt(pos.edge, pos.s);
      const grade = road.frameAt(pos.edge, pos.s).grade * pos.dir;

      // Longitudinal: full throttle on the flat converges to top speed.
      const v = m.speed;
      const top = bike.topSpeedMps;
      let accel = throttle * bike.accelMps2 - (bike.accelMps2 * v * v) / (top * top);
      accel -= (1 - throttle) * COAST_DECEL + brake * bike.brakeMps2 + GRAVITY * grade;
      m.speed = Math.max(0, v + accel * dt);

      // Lateral: steering asks for a heading offset; the road turning under the bike pulls it.
      const yawTarget = steer * maxYawAt(bike.steerRateMps, m.speed, steerScale);
      const ownTurn = (yawTarget - m.yaw) * YAW_RESPONSE;
      const along = m.speed * cos(m.yaw) * sRateFactor(frameKappa, pos.d);
      m.yaw = clamp(m.yaw + (ownTurn - pos.dir * frameKappa * along) * dt, -1.2, 1.2);
      pos.s += pos.dir * along * dt;
      pos.d += pos.dir * m.speed * sin(m.yaw) * dt;

      // Barrier rule (crude): scrub speed and heading at the drivable edge. riders-1 adds the
      // wobble and crash events.
      const edge = road.edges[pos.edge];
      if (edge) {
        const lo = edge.dMin + 0.5;
        const hi = edge.dMax - 0.5;
        if (pos.d < lo || pos.d > hi) {
          pos.d = clamp(pos.d, lo, hi);
          m.yaw *= 0.5;
          m.speed *= 1 - 0.8 * dt;
        }
      }
      if (road.advance(pos) === 'deadEnd') m.speed = 0;

      st.throttle[m.id] = throttle;
      st.brake[m.id] = brake;
      st.lean[m.id] = clamp((m.speed * ownTurn) / GRAVITY, -0.8, 0.8);
      let gear = 1;
      let low = 0;
      for (const topOfGear of GEAR_TOP_MPS) {
        if (m.speed <= topOfGear) break;
        low = topOfGear;
        gear++;
      }
      const high = GEAR_TOP_MPS[gear - 1] ?? 40;
      st.gear[m.id] = gear;
      st.rpm[m.id] = 1200 + 8800 * clamp((m.speed - low) / Math.min(high - low, 12), 0, 1);
    }
  },
};
