// The world store (docs/milestones/M1.md, app-1): entities in ascending id order, the shared mover
// state every system reads, the per-tick controller inputs, the random streams, and one plain-data
// state object per system. No closures and no class instances in here, so the whole world can be
// hashed now and serialized for M2's race snapshots.
import { createStreams, type EntityId, type RngState, type RngStreamName } from '../../core';
import type { RoadPos } from '../../road';
import type { EntityKind, MoverMode, SimConfig, SimEvent, SimEventType, SimInput } from '../types';

/** Shared state of anything that moves on the network. */
export interface Mover {
  id: EntityId;
  kind: EntityKind;
  mode: MoverMode;
  /** Road position; for a rider, `pos.dir` is its travel direction. */
  pos: RoadPos;
  /** Metres above the surface. */
  h: number;
  /** Heading offset from the road tangent, radians, toward the mover's right. */
  yaw: number;
  /** Forward speed, m/s, never negative. */
  speed: number;
  /** Index into config.riders for riders, else -1. */
  riderIndex: number;
}

export interface World {
  tick: number;
  /** 1 in M1; 0 during a hit-stop, below 1 in slow motion (M2). Motion uses dt = timeScale / 60. */
  timeScale: number;
  /** Sim-affecting tuning values in force this tick. */
  params: Record<string, number>;
  /** Changes from applyParam, applied at the start of the next step. */
  pendingParams: { id: string; value: number }[];
  /** Movers by entity id (index = id). */
  movers: Mover[];
  /** The command each entity is acting on this tick, by entity id (controllers phase fills it). */
  inputs: SimInput[];
  rng: Record<RngStreamName, RngState>;
  /** Events being emitted during the current step. */
  events: SimEvent[];
  /** Per-system plain data, by system name. */
  systems: Record<string, unknown>;
  /** Next id for causeId links. */
  nextCauseId: number;
  /** Race facts the snapshot shows, published by their owning systems (see `WorldFacts`). */
  facts: WorldFacts;
}

/**
 * Facts one system owns and presentation reads from the snapshot (M2, app-3 item 5). Each has one
 * writer, through the helpers below, so createSim's snapshot shows them with no wiring PR:
 * - `slowmo`: a takedown's slow motion (combat-4, `setSlowmo`), in raw ticks left;
 * - `styleTally`: style cash per rider entity id (sim/race, `addStyle`);
 * - `grudgeNotedBy`: per rider entity id, the riders who noted a grudge against them this race,
 *   in the order noted (tumble-2, `noteGrudge`; ai-2 reads it for target choice).
 * Plain data, hashed with the rest of the world.
 */
export interface WorldFacts {
  slowmo: { remainingTicks: number };
  styleTally: Record<number, number>;
  grudgeNotedBy: Record<number, EntityId[]>;
}

export function createWorld(config: SimConfig): World {
  return {
    tick: 0,
    timeScale: 1,
    params: { ...config.tuning },
    pendingParams: [],
    movers: [],
    inputs: [],
    rng: createStreams(config.seed),
    events: [],
    systems: {},
    nextCauseId: 1,
    facts: { slowmo: { remainingTicks: 0 }, styleTally: {}, grudgeNotedBy: {} },
  };
}

/** Sets the takedown slow motion's raw ticks left; 0 ends it (combat-4 is the one writer). */
export function setSlowmo(world: World, remainingTicks: number): void {
  world.facts.slowmo.remainingTicks = Math.max(0, remainingTicks);
}

/** Adds style cash to a rider's tally (sim/race is the one writer, beside its `style` event). */
export function addStyle(world: World, riderId: EntityId, points: number): void {
  world.facts.styleTally[riderId] = (world.facts.styleTally[riderId] ?? 0) + points;
}

/** Notes that `holderId` holds a grudge against `againstId` for the rest of the race (once). */
export function noteGrudge(world: World, holderId: EntityId, againstId: EntityId): void {
  const list = (world.facts.grudgeNotedBy[againstId] ??= []);
  if (!list.includes(holderId)) list.push(holderId);
}

/** Adds an entity and returns it. Ids are dense and ascending. */
export function addMover(world: World, kind: EntityKind, pos: RoadPos, riderIndex = -1): Mover {
  const mover: Mover = {
    id: world.movers.length,
    kind,
    mode: 'Road',
    pos,
    h: 0,
    yaw: 0,
    speed: 0,
    riderIndex,
  };
  world.movers.push(mover);
  world.inputs.push({ steer: 0, throttle: 0, brake: 0, flags: 0 });
  return mover;
}

/** Emits an event on the current tick. Returns its cause id for chaining. */
export function emit(
  world: World,
  type: SimEventType,
  actor: EntityId,
  data: Record<string, number | string | boolean> = {},
  extra: { target?: EntityId; causeId?: number } = {},
): number {
  const causeId = extra.causeId ?? world.nextCauseId++;
  const event: SimEvent = { tick: world.tick, type, actor, data, causeId };
  if (extra.target !== undefined) event.target = extra.target;
  world.events.push(event);
  return causeId;
}

/** A system's plain-data state, created on first use. */
export function systemState<S>(world: World, name: string, init: () => S): S {
  if (!(name in world.systems)) world.systems[name] = init();
  return world.systems[name] as S;
}
