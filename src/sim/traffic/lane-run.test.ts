// laneRunBoundary (playtest 3, T10.6): where a vehicle that is on a stretch with no lane its way is
// held. A one-lane one-way block (one lane toward +u, none toward -u) between two-way streets: a car
// heading -u that rolled in is put back at the block's far end, on the lane side of the boundary; a
// car with a lane under it, and a run that reaches the corridor's end, answer null.
import { describe, expect, it } from 'vitest';
import { laneRunBoundary, type LaneMap } from './corridor';

/** Two-way 0 to 100, one-way (+u only) 100 to 300, two-way from 300. */
const MAP: LaneMap = { u0: [0, 100, 300], plus: [1, 1, 1], minus: [1, 0, 1] };

describe('laneRunBoundary', () => {
  it('holds a car heading -u at the block end it came from, inside the lane side', () => {
    const at = laneRunBoundary(MAP, 250, -1);
    expect(at).not.toBeNull();
    expect(at ?? 0).toBeGreaterThan(300);
    expect(at ?? 0).toBeLessThan(300.5);
  });

  it('is null where the car has a lane its way', () => {
    expect(laneRunBoundary(MAP, 250, 1)).toBeNull();
    expect(laneRunBoundary(MAP, 50, -1)).toBeNull();
    expect(laneRunBoundary(MAP, 350, -1)).toBeNull();
  });

  it('holds a car heading +u in a run of no lanes at the start of that run', () => {
    const noPlus: LaneMap = { u0: [0, 100, 300], plus: [1, 0, 1], minus: [1, 1, 1] };
    const at = laneRunBoundary(noPlus, 200, 1);
    expect(at ?? 0).toBeLessThan(100);
    expect(at ?? 0).toBeGreaterThan(99.5);
  });

  it('is null when the run reaches the corridor end on the side the car came from, and for an empty map', () => {
    const open: LaneMap = { u0: [0, 100], plus: [1, 1], minus: [0, 0] };
    expect(laneRunBoundary(open, 50, -1)).toBeNull();
    expect(laneRunBoundary({ u0: [], plus: [], minus: [] }, 50, -1)).toBeNull();
  });
});
