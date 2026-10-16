import { describe, expect, it } from 'vitest';
import { keptSamples, type Point3Like } from './samples';

const point = (x: number, y = 0): Point3Like => ({ x, y, z: 0 });

describe('keptSamples', () => {
  it('keeps each endpoint while simplifying a straight run within its span bound', () => {
    const rows = Array.from({ length: 6 }, (_, i) => [point(i * 10)]);

    expect(keptSamples(rows, 0.01, 25)).toEqual([0, 2, 4, 5]);
  });

  it('retains a sample that falls outside the permitted error', () => {
    const rows = [[point(0)], [point(10, 0.1)], [point(20)]];

    expect(keptSamples(rows, 0.01, 40)).toEqual([0, 1, 2]);
  });
});
