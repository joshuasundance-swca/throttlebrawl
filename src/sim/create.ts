// createSim: builds the world, puts the riders on the grid, wires the systems in tick order,
// and answers snapshots and hashes. Internal to src/sim; everything outside imports sim/api.ts.
import { atan2, cos, DIFFICULTY_TUNING, sin, type TuningParamDecl } from '../core';
import { aiSystem, AI_TUNING, signatureView } from './ai';
import { combatSystem, combatView, COMBAT_TUNING, pickupWeapon } from './combat';
import { copsSystem, COPS_TUNING, lawSnapshot } from './cops';
import { GROUND_TUNING, groundUnder } from './ground';
import { modifiersSystem, MODIFIERS_TUNING, propSnapshots } from './modifiers';
import { pedInfo, pedsSystem, PEDS_TUNING } from './peds';
import { gridPosition, raceState, raceSystem, RACE_TUNING, styleRunOf } from './race';
import { riderState, ridersSystem, RIDERS_TUNING, touchdownOf, trickOf } from './riders';
import { smashSnapshots, SMASH_TUNING, withSmashables } from './smash';
import { trafficSystem, TRAFFIC_TUNING, vehicleInfo } from './traffic';
import { parkedBike, tumbleRecord, tumbleSystem, TUMBLE_TUNING, type TumbleBody } from './tumble';
import type {
  EntitySnapshot,
  ParkedBikeSnapshot,
  Sim,
  SimConfig,
  SimEvent,
  SimInput,
  SimSnapshot,
  TumbleBodySnapshot,
  TumbleSnapshot,
} from './types';
import { addMover, createWorld, orderSystems, stepWorld, worldHash, type World } from './world';

/**
 * Every sim tuning declaration, aggregated so app/ never imports a sim sub-folder. The difficulty
 * scales (core/difficulty) are among them with `affectsSim` false: buildSimConfig resolves them
 * into SimConfig.difficulty at race start, so they never reach `sim.applyParam`.
 */
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
  ...GROUND_TUNING,
  ...SMASH_TUNING,
  ...DIFFICULTY_TUNING,
];

const SYSTEMS = orderSystems([
  aiSystem,
  ridersSystem,
  combatSystem,
  copsSystem,
  trafficSystem,
  // The roadside smashables step at the end of the peds phase (sim/smash, run W-T).
  withSmashables(pedsSystem),
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
  /** A tumbling rider's two crash bodies, as the tumble system steps them; else null. */
  const body = (b: TumbleBody): TumbleBodySnapshot => ({
    x: b.x,
    y: b.y,
    z: b.z,
    vx: b.vx,
    vy: b.vy,
    vz: b.vz,
  });
  const tumbleOf = (id: number): TumbleSnapshot | null => {
    const r = tumbleRecord(world, id);
    return r && r.phase === 'tumble' ? { rider: body(r.rider), bike: body(r.bike) } : null;
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
      // A vehicle, a pedestrian or an animal carries its traffic type, so render can size and shape
      // it (an iguana is not a tourist); a pickup, its weapon.
      contentId:
        def?.contentId ??
        (m.kind === 'vehicle'
          ? (vehicleInfo(world, config, m.id)?.contentId ?? '')
          : m.kind === 'ped'
            ? (pedInfo(world, config, m.id)?.contentId ?? '')
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
      tumble: m.kind === 'rider' ? tumbleOf(m.id) : null,
      styleTally: world.facts.styleTally[m.id] ?? 0,
      grudgeNotedBy: [...(world.facts.grudgeNotedBy[m.id] ?? [])],
      boostS: m.kind === 'rider' ? (riders.boost[m.id] ?? 0) / 60 : 0,
      styleRun: m.kind === 'rider' ? styleRunOf(world, config, m.id) : null,
      // Air control and flips (playtest 2): the bike's pitch while riding, and the trick in the air.
      pitch:
        m.kind === 'rider' && (m.mode === 'Road' || m.mode === 'Airborne') ? (riders.pitch[m.id] ?? 0) : 0,
      trick: m.kind === 'rider' && m.mode === 'Airborne' ? trickOf(riders.trick[m.id]) : null,
      // Air that pays (the pitch deck's #13): where a player in the air will touch down.
      touchdown: touchdownOf(world, config, m),
      signature: m.kind === 'rider' ? signatureView(world, m.id) : null,
      // W-Q contracts: the ground under a rider, its heading sign on the route, and its branch.
      ground: m.kind === 'rider' ? groundUnder(road, m.pos.edge, m.pos.s, m.pos.d, m.h) : null,
      routeDir: m.pos.dir * config.route.orientation(m.pos.edge) === -1 ? -1 : 1,
      branch: m.kind === 'rider' ? (config.route.branchAt(m.pos.edge)?.id ?? null) : null,
    };
  });
  return {
    tick: world.tick,
    timeScale: world.timeScale,
    entities,
    race: { over: race.over, routeLength: config.route.length, finishOrder: [...race.finishOrder] },
    slowmo: {
      active: world.facts.slowmo.remainingTicks > 0,
      remainingTicks: world.facts.slowmo.remainingTicks,
    },
    props: propSnapshots(world, config),
    law: lawSnapshot(world, config),
    smashables: smashSnapshots(world, config),
  };
}

export function createSim(config: SimConfig): Sim {
  return createSimWithWorld(config).sim;
}

/** createSim plus its world, for the sim's own tests (not exported through sim/api). */
export function createSimWithWorld(config: SimConfig): { sim: Sim; world: World } {
  const known = new Set(SIM_TUNING.filter((d) => d.affectsSim).map((d) => d.id));
  const world = createWorld(config);
  config.riders.forEach((_def, i) => addMover(world, 'rider', gridPosition(config, i), i));
  for (const system of SYSTEMS) system.init(world, config);
  let last: SimEvent[] = [];

  const sim: Sim = {
    config,
    get tick() {
      return world.tick;
    },
    step(inputs: readonly SimInput[]) {
      last = stepWorld(world, config, SYSTEMS, inputs);
    },
    snapshot: () => snapshotOf(world, config),
    events: () => last,
    hash: () => worldHash(world),
    applyParam(id: string, value: number) {
      if (!known.has(id)) throw new Error(`sim.applyParam: ${id} is not a sim tuning parameter`);
      if (!Number.isFinite(value)) throw new Error(`sim.applyParam: ${id} must be a finite number`);
      world.pendingParams.push({ id, value });
    },
    isOver: () => raceState(world).over,
  };
  return { sim, world };
}
