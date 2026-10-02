import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { twoBoneIk } from './pose';

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
