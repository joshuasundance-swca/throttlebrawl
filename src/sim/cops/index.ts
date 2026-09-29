// sim/cops: one cop who chases, can be hit, and busts a downed player (cops-1 builds it).
// Stub from the walking skeleton. Cop frequency reads config.difficulty.copFrequency.
import type { TuningParamDecl } from '../../core';
import type { SimSystem } from '../world';

export const COPS_TUNING: readonly TuningParamDecl[] = [];

export const copsSystem: SimSystem = {
  name: 'cops',
  init() {},
  step() {},
};
