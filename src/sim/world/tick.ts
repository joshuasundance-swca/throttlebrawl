// The tick order and the system registry API (a contract; docs/milestones/M1.md, app-1).
// One fixed order per tick: controllers, riders, combat, cops, traffic, peds, tumble, race,
// modifiers, then the event flush. Each sim sub-folder exports one SimSystem for its phase.
import type { SimConfig, SimEvent, SimInput } from '../types';
import type { World } from './store';

export const TICK_ORDER = [
  'controllers',
  'riders',
  'combat',
  'cops',
  'traffic',
  'peds',
  'tumble',
  'race',
  'modifiers',
] as const;
export type SystemName = (typeof TICK_ORDER)[number];

export interface SimSystem {
  readonly name: SystemName;
  /** Called once when the sim is created, after the riders are on the grid. */
  init(world: World, config: SimConfig): void;
  /** Called once per tick, in TICK_ORDER. */
  step(world: World, config: SimConfig): void;
}

/** Orders systems by TICK_ORDER; a missing or duplicated phase is a programming error. */
export function orderSystems(systems: readonly SimSystem[]): SimSystem[] {
  return TICK_ORDER.map((name) => {
    const found = systems.filter((s) => s.name === name);
    if (found.length !== 1 || !found[0]) throw new Error(`sim: expected exactly one ${name} system`);
    return found[0];
  });
}

/**
 * Steps the world one tick: apply pending tuning changes, hand player inputs to their riders, run
 * every system in order, then flush this tick's events. Returns the flushed events, which stay
 * readable as `world.lastEvents` during the next step.
 */
export function stepWorld(
  world: World,
  config: SimConfig,
  systems: readonly SimSystem[],
  playerInputs: readonly SimInput[],
): SimEvent[] {
  for (const change of world.pendingParams) world.params[change.id] = change.value;
  world.pendingParams.length = 0;
  world.events = [];
  for (const mover of world.movers) {
    const def = mover.riderIndex >= 0 ? config.riders[mover.riderIndex] : undefined;
    if (def?.controller.kind === 'player') {
      const input = playerInputs[def.controller.slot];
      world.inputs[mover.id] = input ? { ...input } : { steer: 0, throttle: 0, brake: 0, flags: 0 };
    }
  }
  for (const system of systems) system.step(world, config);
  const flushed = world.events;
  world.events = [];
  world.lastEvents = flushed;
  world.tick++;
  return flushed;
}
