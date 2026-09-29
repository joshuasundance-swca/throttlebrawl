// sim/modifiers: weird-event modifiers (M4 or the shelf; docs/architecture.md, "Event
// modifiers"). M1 ships only the empty `config.modifiers` list and the `modifiers` RNG stream.
import type { TuningParamDecl } from '../../core';
import type { SimSystem } from '../world';

export const MODIFIERS_TUNING: readonly TuningParamDecl[] = [];

export const modifiersSystem: SimSystem = {
  name: 'modifiers',
  init() {},
  step() {},
};
