import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type RoadNetwork } from '../road';
import { EdgeLocator } from './overlap';
import { track } from './scene-cost.test-util';

/** Original quarter-metre search, retained independently of clearReach's empty-space shortcut. */
function reference(
  road: RoadNetwork,
  loc: EdgeLocator,
  edge: number,
  s: number,
  near: number,
  far: number,
  margin: number,
  filter: (edge: number) => boolean = () => true,
) {
  const over = (d: number) => {
    const p = road.toWorld(edge, s, d, 0.1);
    return loc.overLowerLanes(p.x, p.y, p.z, edge, margin, 0.05, Infinity, filter);
  };
  if (over(near)) return null;
  const n = Math.max(1, Math.ceil(Math.abs(far - near) / 0.25));
  let clear = near;
  for (let k = 1; k <= n; k++) {
    const d = near + ((far - near) * k) / n;
    if (!over(d)) {
      clear = d;
      continue;
    }
    let out = d;
    for (let i = 0; i < 5; i++) {
      const mid = (clear + out) / 2;
      if (over(mid)) out = mid;
      else clear = mid;
    }
    return clear;
  }
  return far;
}

describe('ground clearance search in empty space', () => {
  it('does not repeat empty-neighborhood queries as a clear strip gets wider', () => {
    const road = createRoadNetwork(
      fixtureNetwork([
        { id: 'long', lengthM: 8192, kappa: 0 },
        { id: 'distant', lengthM: 128, kappa: 0 },
      ]),
    );
    let worldQueries = 0;
    const counted = {
      ...road,
      toWorld: (...args: Parameters<RoadNetwork['toWorld']>) => {
        worldQueries++;
        return road.toWorld(...args);
      },
    };
    const loc = new EdgeLocator(counted);
    expect(loc.clearReach(0, 4096, 4, 8, 0.1, 0.25, 0.05)).toBe(8);
    const narrowQueries = worldQueries;
    worldQueries = 0;
    expect(loc.clearReach(0, 4096, 4, 64, 0.1, 0.25, 0.05)).toBe(64);
    expect(narrowQueries).toBeGreaterThan(0);
    expect(worldQueries).toBeGreaterThan(0);
    expect(worldQueries).toBeLessThanOrEqual(narrowQueries * 2);
  });

  it('preserves the original clipping on actual lower-road joins, empty bands and both strip directions', () => {
    const { road } = track('osm-pnw-samish');
    const main = road.edgeIndex('osm-i5-lake-samish');
    const shore = road.edgeIndex('osm-samish-east-shore');
    const cases = [
      [main, 5358, 10, 30],
      [main, 1500, 10, 30],
      [shore, 4208, -6, -24],
      [shore, 4208, -24, -6],
      [main, 5358, 10, 10],
    ];
    let clipped = 0;
    let whole = 0;
    for (const [edge, s, near, far] of cases as [number, number, number, number][]) {
      for (const margin of [0, 0.25, 4, 20]) {
        for (const filter of [() => true, () => false]) {
          const expected = reference(road, new EdgeLocator(road), edge, s, near, far, margin, filter);
          const loc = new EdgeLocator(road);
          expect(loc.clearReach(edge, s, near, far, 0.1, margin, 0.05, filter)).toBe(expected);
          expect(loc.clearReach(edge, s, near, far, 0.1, margin, 0.05, filter)).toBe(expected);
          if (expected === far) whole++;
          else clipped++;
        }
      }
    }
    expect(clipped).toBeGreaterThan(0);
    expect(whole).toBeGreaterThan(0);
  });

  it('keeps curved self-road strips and the neighboring road at a join equivalent to the old search', () => {
    const road = createRoadNetwork(
      fixtureNetwork([
        { id: 'bend', lengthM: 256, kappa: 1 / 100 },
        { id: 'tail', lengthM: 128, kappa: 0 },
      ]),
    );
    let whole = 0;
    let clipped = 0;
    for (const s of [16, 128, 255.9]) {
      for (const margin of [0.25, 4, 20]) {
        for (const [near, far] of [
          [-40, 40],
          [40, -40],
        ]) {
          const expected = reference(road, new EdgeLocator(road), 0, s, near!, far!, margin);
          const loc = new EdgeLocator(road);
          expect(loc.clearReach(0, s, near!, far!, 0.1, margin, 0.05)).toBe(expected);
          if (expected === far) whole++;
          else clipped++;
        }
      }
    }
    expect(whole).toBeGreaterThan(0);
    expect(clipped).toBeGreaterThan(0);
  });
});
