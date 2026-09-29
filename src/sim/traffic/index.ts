// sim/traffic: cars and trucks both ways, car-following, population around the sim anchors
// (traffic-1 builds it). Stub from the walking skeleton. Rolls come from world.rng.traffic only.
import type { TuningParamDecl } from '../../core';
import type { SimSystem } from '../world';

export const TRAFFIC_TUNING: readonly TuningParamDecl[] = [];

export const trafficSystem: SimSystem = {
  name: 'traffic',
  init() {},
  step() {},
};
