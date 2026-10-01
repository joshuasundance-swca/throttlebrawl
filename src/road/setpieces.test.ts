import { describe, expect, it } from 'vitest';
import { chooseSetPieces, setPieceActive, setPieceSlot, setPieceSlots, type BakedFeature } from './index';

// Playtest 1c item 2 ([decided] 2026-09-30: "ramp truck in the same place"): set pieces placed from
// candidate slots by the race seed.

const f = (kind: string, id: string, slot?: string): BakedFeature => ({
  kind,
  id,
  s0: 0,
  s1: 10,
  d0: 0,
  d1: 2,
  ...(slot === undefined ? {} : { params: { slot } }),
});

const EDGES = [
  {
    features: [
      f('rampTruck', 'truck-b', 'truck'),
      f('boostPad', 'pad-fixed'),
      f('boostPad', 'pad-a1', 'pad-a'),
    ],
  },
  {
    features: [
      f('rampTruck', 'truck-a', 'truck'),
      f('rampTruck', 'truck-c', 'truck'),
      f('boostPad', 'pad-a2', 'pad-a'),
      f('ramp', 'kicker', 'truck'), // not a set-piece kind: its slot is ignored
    ],
  },
];

describe('set pieces from the race seed', () => {
  it('reads slots only on boost pads and ramp trucks', () => {
    expect(setPieceSlot(f('boostPad', 'p', 'x'))).toBe('x');
    expect(setPieceSlot(f('rampTruck', 't', 'y'))).toBe('y');
    expect(setPieceSlot(f('boostPad', 'p'))).toBeNull();
    expect(setPieceSlot(f('ramp', 'r', 'x'))).toBeNull();
    expect([...setPieceSlots(EDGES).entries()]).toEqual([
      ['truck', ['truck-a', 'truck-b', 'truck-c']],
      ['pad-a', ['pad-a1', 'pad-a2']],
    ]);
  });

  it('picks exactly one candidate per slot, the same for the same seed', () => {
    for (const seed of [1, 7, 123456, 0xffffffff]) {
      const chosen = chooseSetPieces(EDGES, seed);
      expect(chosen.size).toBe(2);
      expect(['truck-a', 'truck-b', 'truck-c'].filter((id) => chosen.has(id))).toHaveLength(1);
      expect(['pad-a1', 'pad-a2'].filter((id) => chosen.has(id))).toHaveLength(1);
      expect([...chooseSetPieces(EDGES, seed)]).toEqual([...chosen]);
    }
  });

  it('different seeds give different placements, and every candidate gets its turn', () => {
    const seen = new Map<string, number>();
    const placements = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const chosen = chooseSetPieces(EDGES, seed);
      placements.add([...chosen].sort().join(','));
      for (const id of chosen) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    console.log(
      `set pieces over 60 seeds: ${placements.size} placements; ${JSON.stringify([...seen].sort())}`,
    );
    expect(placements.size).toBe(6); // 3 trucks × 2 pads
    for (const id of ['truck-a', 'truck-b', 'truck-c', 'pad-a1', 'pad-a2'])
      expect(seen.get(id)).toBeGreaterThan(5);
  });

  it('a set piece without a slot is always there; a candidate only when picked', () => {
    const chosen = chooseSetPieces(EDGES, 3);
    expect(setPieceActive(f('boostPad', 'pad-fixed'), chosen)).toBe(true);
    for (const id of ['truck-a', 'truck-b', 'truck-c']) {
      expect(setPieceActive(f('rampTruck', id, 'truck'), chosen)).toBe(chosen.has(id));
    }
  });
});
