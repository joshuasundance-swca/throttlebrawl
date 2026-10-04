import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { bikeFrame, leanForward, riderFrame, seating, STRETCH_REACH, twoBoneIk } from './pose';
import { fakeBike, fakeRider } from './rig-fixtures.test-util';

describe('twoBoneIk', () => {
  const root = new Vector3(0, 1.4, 0);
  const pole = new Vector3(1, 0, 0);

  it('reaches a target in range: both segments keep their lengths and the end is on the target', () => {
    const target = new Vector3(0.1, 1.0, -0.4);
    const mid = new Vector3();
    const end = new Vector3();
    twoBoneIk(root, target, 0.3, 0.34, pole, mid, end);
    expect(end.distanceTo(target)).toBeLessThan(1e-6);
    expect(root.distanceTo(mid)).toBeCloseTo(0.3, 6);
    expect(mid.distanceTo(end)).toBeCloseTo(0.34, 6);
    // It bends toward the pole.
    const along = target.clone().sub(root).normalize();
    const bend = mid.clone().sub(root);
    bend.addScaledVector(along, -bend.dot(along));
    expect(bend.dot(pole)).toBeGreaterThan(0);
  });

  it('a target out of reach: the limb points straight at it, fully stretched', () => {
    const target = new Vector3(0, 1.4, -2);
    const mid = new Vector3();
    const end = new Vector3();
    twoBoneIk(root, target, 0.3, 0.34, pole, mid, end);
    expect(root.distanceTo(end)).toBeCloseTo(0.64, 3);
    expect(end.x).toBeCloseTo(0, 3);
    expect(end.z).toBeLessThan(-0.63);
  });

  it('a target at the root or along the pole does not produce NaN', () => {
    const mid = new Vector3();
    const end = new Vector3();
    twoBoneIk(root, root.clone(), 0.3, 0.34, new Vector3(0, -1, 0), mid, end);
    expect([mid.x, mid.y, mid.z, end.x, end.y, end.z].every(Number.isFinite)).toBe(true);
    twoBoneIk(root, new Vector3(0.5, 1.4, 0), 0.3, 0.34, pole, mid, end);
    expect([mid.x, mid.y, mid.z, end.x, end.y, end.z].every(Number.isFinite)).toBe(true);
  });
});

describe('seating: the seated lean and the stretched one (a wheelie or a backflip sits back)', () => {
  const rider = riderFrame(fakeRider());
  const bike = bikeFrame(fakeBike());
  const seat = seating(rider, bike);
  const armLength = rider.arms.l.upper + rider.arms.l.lower;
  const barMid = bike.bars.l.clone().add(bike.bars.r).multiplyScalar(0.5);

  /** Shoulder-to-bar distance when the chest leans forward by `lean`, as seating() judges it. */
  const reachAt = (lean: number): number => {
    const qh = leanForward(lean * 0.35, new Quaternion());
    const chest = rider.rest.chest.clone().sub(rider.rest.hips).applyQuaternion(qh).add(seat.hips);
    const q = leanForward(lean, new Quaternion());
    const shoulderMid = rider.rest.upper_arm_l.clone().add(rider.rest.upper_arm_r).multiplyScalar(0.5);
    const sh = shoulderMid.sub(rider.rest.chest).applyQuaternion(q).add(chest);
    return sh.distanceTo(barMid);
  };

  it('the seated lean has the arms at 88 % of their length', () => {
    expect(reachAt(seat.chestLean) / armLength).toBeCloseTo(0.88, 1);
  });

  it('the stretched lean sits back of the seated one, with the arms nearly straight but not over', () => {
    expect(seat.stretchLean).toBeLessThan(seat.chestLean);
    const used = reachAt(seat.stretchLean) / armLength;
    expect(used).toBeGreaterThan(0.9);
    expect(used).toBeLessThanOrEqual(STRETCH_REACH + 1e-9);
    // One step further back and the hands would come off the bars.
    expect(reachAt(seat.stretchLean - 0.025) / armLength).toBeGreaterThan(STRETCH_REACH - 0.002);
  });
});
