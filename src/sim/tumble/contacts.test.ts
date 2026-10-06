// The crash tumble's boxes follow the drawn sizes (the hitbox audit's contract, docs/content-packs.md,
// "Heights and hitboxes"): a vehicle's box is as tall as its type (`heightM`, else its category's
// default), not 1.5 m or 3.2 m by hazard class, and a rider on the bike is its own box (riderHitbox).
import { describe, expect, it } from 'vitest';
import { testConfig } from '../riders/testing';
import { placeVehicle, trafficSystem } from '../traffic';
import type { SimConfig, SimTrafficTypeDef } from '../types';
import { addMover, createWorld } from '../world';
import { nearbyBoxes } from './contacts';

/** A pickup towing a boat: drawn 2.3 m tall, `normal` (the old box was 1.5 m). */
const TOWING: SimTrafficTypeDef = {
  contentId: 'base:pickup-boat',
  category: 'car',
  lengthM: 9,
  widthM: 2,
  heightM: 2.3,
  cruiseMps: 0,
  hazard: 'normal',
};
/** A sedan with no height of its own: its category's default (car, 1.8 m). */
const SEDAN: SimTrafficTypeDef = { ...TOWING, contentId: 'base:sedan', lengthM: 4.6, widthM: 1.8 };
delete (SEDAN as { heightM?: number }).heightM;

function boxes(config: SimConfig) {
  const world = createWorld(config);
  addMover(world, 'rider', { edge: 0, s: 300, d: -1.7, dir: 1 }, 0);
  trafficSystem.init(world, config);
  placeVehicle(world, config, { type: 0, u: 305, dir: 1, v0: 0, speed: 0 });
  placeVehicle(world, config, { type: 1, u: 290, dir: 1, v0: 0, speed: 0 });
  const at = config.road.toWorld(0, 300, 0, 0);
  // A crash's centre near them, excluding nobody (-1).
  return nearbyBoxes(world, config, { edge: 0, s: 300 }, at.x, at.z, -1);
}

describe('the tumble’s boxes', () => {
  const base = testConfig({ tuning: { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 } });

  it('a vehicle is as tall as its type: 2.3 m for the pickup towing a boat, 1.8 m for a car with none', () => {
    const all = boxes({ ...base, trafficTypes: [TOWING, SEDAN] });
    const towing = all.find((b) => b.contentId === 'base:pickup-boat');
    const sedan = all.find((b) => b.contentId === 'base:sedan');
    console.log(`[examined] half heights: towing ${towing?.hh}, sedan ${sedan?.hh}`);
    expect(towing?.hh).toBeCloseTo(1.15, 9);
    expect(sedan?.hh).toBeCloseTo(0.9, 9);
  });

  it('a rider on the bike is its own box: the default 2.0 x 0.8, the lawnmower’s 1.65 x 1.15', () => {
    const plain = boxes({ ...base, trafficTypes: [TOWING, SEDAN] }).find((b) => b.kind === 'rider');
    expect([plain?.hl, plain?.hw]).toEqual([1.0, 0.4]);
    const riders = base.riders.map((r) => ({ ...r, hitbox: { lengthM: 1.65, widthM: 1.15 } }));
    const mower = boxes({ ...base, riders, trafficTypes: [TOWING, SEDAN] }).find((b) => b.kind === 'rider');
    expect(mower?.hl).toBeCloseTo(0.825, 9);
    expect(mower?.hw).toBeCloseTo(0.575, 9);
  });
});
