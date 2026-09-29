// sim/tumble: the crude crash tumble, the hand-back and the on-foot run-back (tumble-1 builds it).
// Stub from the walking skeleton. Rest detection and the run-back use scaled time.
import type { TuningParamDecl } from '../../core';
import type { SimSystem } from '../world';

export const TUMBLE_TUNING: readonly TuningParamDecl[] = [];

export const tumbleSystem: SimSystem = {
  name: 'tumble',
  init() {},
  step() {},
};
