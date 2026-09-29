// sim/peds: roadside pedestrians who dive clear (traffic-2 builds it). Stub from the walking
// skeleton. Rolls come from world.rng.peds only.
import type { TuningParamDecl } from '../../core';
import type { SimSystem } from '../world';

export const PEDS_TUNING: readonly TuningParamDecl[] = [];

export const pedsSystem: SimSystem = {
  name: 'peds',
  init() {},
  step() {},
};
