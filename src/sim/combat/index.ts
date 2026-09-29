// sim/combat: attacks with real timing windows, auto-target, hits and the crude hit-stop.
// Stub from the walking skeleton; combat-1 and combat-2 build it (docs/milestones/M1.md).
// Keep per-entity state as plain data in systemState(world, 'combat', ...), and count phase
// timers in scaled time (world.timeScale); only the hit-stop countdown runs on raw ticks.
import type { TuningParamDecl } from '../../core';
import type { SimSystem } from '../world';

export const COMBAT_TUNING: readonly TuningParamDecl[] = [];

export const combatSystem: SimSystem = {
  name: 'combat',
  init() {},
  step() {},
};
