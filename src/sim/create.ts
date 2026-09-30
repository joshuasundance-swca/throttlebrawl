// createSim: builds the world, puts the riders on the grid, wires the systems in tick order,
// and answers snapshots and hashes. Internal to src/sim; everything outside imports sim/api.ts.
import { atan2, cos, FNV_OFFSET, sin, type TuningParamDecl } from '../core';
import { aiSystem, AI_TUNING } from './ai';
import { combatSystem, combatView, COMBAT_TUNING, pickupWeapon } from './combat';
import { copsSystem, COPS_TUNING } from './cops';
import { modifiersSystem, MODIFIERS_TUNING } from './modifiers';
import { pedsSystem, PEDS_TUNING } from './peds';
import { gridPosition, raceState, raceSystem, RACE_TUNING } from './race';
import { riderState, ridersSystem, RIDERS_TUNING } from './riders';
import { trafficSystem, TRAFFIC_TUNING, vehicleInfo } from './traffic';
import { parkedBike, tumbleSystem, TUMBLE_TUNING } from './tumble';
import type {
  EntitySnapshot,
  ParkedBikeSnapshot,
  Sim,
  SimConfig,
  SimEvent,
  SimInput,
  SimSnapshot,
} from './types';
import { addMover, createWorld, hashPlain, orderSystems, stepWorld, type World } from './world';

/** Every sim tuning declaration, aggregated so app/ never imports a sim sub-folder. */
export const SIM_TUNING: readonly TuningParamDecl[] = [
  ...RIDERS_TUNING,
  ...COMBAT_TUNING,
  ...COPS_TUNING,
  ...TRAFFIC_TUNING,
  ...PEDS_TUNING,
  ...TUMBLE_TUNING,
  ...RACE_TUNING,
  ...AI_TUNING,
  ...MODIFIERS_TUNING,
];

const SYSTEMS = orderSystems([
  aiSystem,
  ridersSystem,
  combatSystem,
  copsSystem,
  trafficSystem,
  pedsSystem,
  tumbleSystem,
  raceSystem,
  modifiersSystem,
]);

function snapshotOf(world: World, config: SimConfig): SimSnapshot {
  const riders = riderState(world);
  const race = raceState(world);
  const road = config.road;
  /** A rider's bike where tumble-1 parked it (on foot after a crash), facing along the road. */
  const parkedOf = (id: number): ParkedBikeSnapshot | null => {
    const at = parkedBike(world, id);
    if (!at) return null;
    const p = road.toWorld(at.edge, at.s, at.d, 0);
    const f = road.frameAt(at.edge, at.s);
    return { x: p.x, y: p.y, z: p.z, heading: atan2(-f.tx * at.dir, -f.tz * at.dir) };
  };
  const entities: EntitySnapshot[] = world.movers.map((m) => {
    const def = config.riders[m.riderIndex];
    const p = road.toWorld(m.pos.edge, m.pos.s, m.pos.d, m.h);
    const f = road.frameAt(m.pos.edge, m.pos.s);
    // Forward: the road tangent in the travel direction, turned by yaw toward the rider's right.
    const tx = f.tx * m.pos.dir;
    const tz = f.tz * m.pos.dir;
    const c = cos(m.yaw);
    const s = sin(m.yaw);
    const fx = c * tx - s * tz;
    const fz = c * tz + s * tx;
    return {
      id: m.id,
      kind: m.kind,
      mode: m.mode,
      road: { edge: m.pos.edge, s: m.pos.s, d: m.pos.d, h: m.h, dir: m.pos.dir, yaw: m.yaw },
      x: p.x,
      y: p.y,
      z: p.z,
      heading: atan2(-fx, -fz),
      speed: m.speed,
      lean: riders.lean[m.id] ?? 0,
      // A vehicle carries its traffic type, so render can size and shape it; a pickup, its weapon.
      contentId:
        def?.contentId ??
        (m.kind === 'vehicle'
          ? (vehicleInfo(world, config, m.id)?.contentId ?? '')
          : m.kind === 'pickup'
            ? pickupWeapon(world, m.id)
            : ''),
      name: def?.name ?? '',
      faction: def?.faction ?? 'rider',
      slot: def?.controller.kind === 'player' ? def.controller.slot : -1,
      throttle: riders.throttle[m.id] ?? 0,
      rpm: riders.rpm[m.id] ?? 0,
      gear: riders.gear[m.id] ?? 0,
      grounded: m.h <= 0,
      health: riders.health[m.id] ?? 0,
      healthMax: def?.healthMax ?? 0,
      ...combatView(world, m.id),
      progress: race.progress[m.id] ?? 0,
      distanceToFinish: race.distanceToFinish[m.id] ?? 0,
      place: race.place[m.id] ?? 0,
      finished: race.finishOrder.includes(m.id),
      parkedBike: m.kind === 'rider' ? parkedOf(m.id) : null,
    };
  });
  return {
    tick: world.tick,
    timeScale: world.timeScale,
    entities,
    race: { over: race.over, routeLength: config.route.length, finishOrder: [...race.finishOrder] },
  };
}

export function createSim(config: SimConfig): Sim {
  const known = new Set(SIM_TUNING.filter((d) => d.affectsSim).map((d) => d.id));
  const world = createWorld(config);
  config.riders.forEach((_def, i) => addMover(world, 'rider', gridPosition(config, i), i));
  for (const system of SYSTEMS) system.init(world, config);
  let last: SimEvent[] = [];

  return {
    config,
    get tick() {
      return world.tick;
    },
    step(inputs: readonly SimInput[]) {
      last = stepWorld(world, config, SYSTEMS, inputs);
    },
    snapshot: () => snapshotOf(world, config),
    events: () => last,
    hash() {
      const { tick, timeScale, params, movers, inputs, rng, systems } = world;
      return hashPlain(FNV_OFFSET, { tick, timeScale, params, movers, inputs, rng, systems });
    },
    applyParam(id: string, value: number) {
      if (!known.has(id)) throw new Error(`sim.applyParam: ${id} is not a sim tuning parameter`);
      if (!Number.isFinite(value)) throw new Error(`sim.applyParam: ${id} must be a finite number`);
      world.pendingParams.push({ id, value });
    },
    isOver: () => raceState(world).over,
  };
}
