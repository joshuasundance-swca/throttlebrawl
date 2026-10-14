import type { RoadPos } from '../../road';
import type { World } from '../world';
import type { SimConfig } from '../types';
import { supportKeyOf } from '../riders/supports';
import { fromCorridor, toCorridor } from './corridor';
import type { TrafficState } from './index';

function trafficState(world: World): TrafficState {
  const st = world.systems['traffic'] as TrafficState | undefined;
  if (!st) throw new Error('traffic: vehicle control requires an initialized population');
  return st;
}

export function networkTrafficEnabled(config: Pick<SimConfig, 'route'>): boolean {
  return config.route.trafficRoads.length > 0 || config.route.trafficExcludedRoads.length > 0;
}

export function protectedVehicle(world: World, st: TrafficState, k: number): boolean {
  if (st.owner[k]) return true;
  const key = `v:${st.id[k] ?? -1}`;
  return world.movers.some((m) => m.kind === 'rider' && supportKeyOf(world, m.id) === key);
}

export interface VehicleHandle {
  id: number;
  generation: number;
}

export function claimVehicle(world: World, slot: number, owner: string): VehicleHandle {
  const st = trafficState(world);
  const id = st.id[slot];
  if (id === undefined || !owner) throw new Error('traffic: invalid ownership claim');
  if (st.owner[slot] && st.owner[slot] !== owner) throw new Error('traffic: vehicle already owned');
  st.owner[slot] = owner;
  return { id, generation: st.generation[slot] ?? 0 };
}

export function ownedVehicleSlot(world: World, handle: VehicleHandle, owner: string): number {
  const st = trafficState(world);
  const slot = st.id.indexOf(handle.id);
  return slot >= 0 && st.generation[slot] === handle.generation && st.owner[slot] === owner ? slot : -1;
}

export function releaseVehicle(world: World, handle: VehicleHandle, owner: string): void {
  const slot = ownedVehicleSlot(world, handle, owner);
  if (slot >= 0) trafficState(world).owner[slot] = '';
}

/** Explicit geometry adapter for existing main-path authored props and moving decks. */
export function referenceVehicleAt(world: World, slot: number) {
  const st = trafficState(world);
  const m = world.movers[st.id[slot] ?? -1];
  return m ? toCorridor(st.corridor, m.pos) : null;
}

export function driveReferenceVehicle(
  world: World,
  slot: number,
  spec: { u?: number; cd?: number; speed?: number; yaw?: number },
): void {
  const st = trafficState(world);
  if (st.paths[slot]) throw new Error('traffic: reference control requires an authored reference vehicle');
  const m = world.movers[st.id[slot] ?? -1];
  if (!m) return;
  if (spec.u !== undefined) st.u[slot] = spec.u;
  if (spec.cd !== undefined) st.cd[slot] = spec.cd;
  if (spec.speed !== undefined) {
    st.v0[slot] = spec.speed;
    m.speed = spec.speed;
  }
  if (spec.yaw !== undefined) m.yaw = spec.yaw;
  fromCorridor(st.corridor, st.u[slot] ?? 0, st.cd[slot] ?? 0, st.dir[slot] ?? 1, m.pos);
}

export function referenceVehiclePose(world: World, slot: number, alongM = 0): RoadPos | null {
  const st = trafficState(world);
  const p = referenceVehicleAt(world, slot);
  if (!p) return null;
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  fromCorridor(st.corridor, p.u + p.dir * alongM, p.cd, p.dir, pos);
  return pos;
}
