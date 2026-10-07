// The event modifiers: the system's step (sim/modifiers), the code only a running race needs. It loads after the first
// screen, in the sim's step chunk (src/sim/late.ts; scripts/sim-chunk.mjs SIM_STEPS_TEST), and a race waits for
// it. ./index.ts keeps the system's state, its init, its tuning and what a snapshot reads (the menu's grid).
import type { SimConfig } from '../types';
import type { World } from '../world';
import { stepLawProps } from './law-props';
import { stepSetPieces } from './setpieces';
import { raceState } from '../race';

export function modifiersStep(world: World, config: SimConfig): void {
  stepSetPieces(world, config, raceState(world).over);
  // The law's own props (sim/cops lawProps) are met by the same rule, with or without a set piece in the race.
  stepLawProps(world, config);
}
