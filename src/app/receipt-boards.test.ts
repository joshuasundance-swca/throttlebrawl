import { describe, expect, it } from 'vitest';
import type { BoardCatalog, FeatureSpan, RoadDressing } from '../render';
import type { RoadNetwork } from '../sim/api';

/** What the renderer shows in a slot (render/boards.ts resolveSlot: its item first, else its pool). */
const resolveSlot = (slot: FeatureSpan | undefined, c: BoardCatalog) =>
  slot?.item ? (c.items[slot.item] ?? null) : slot?.pool ? 'pool' : null;
type BoardSlot = FeatureSpan;
import { boardSpots, spotOn, withReceiptBoards } from './receipt-boards';

// The world's receipts on the race's boards (run W-T): the slots the career can rewrite, and the
// rewrite itself, which the renderer resolves like any board item.

/** Two straight roads along x, the second 1 km east: world x = 1000 × edge + s, z = d. */
const road = {
  edges: [
    { index: 0, id: 'road-a', length: 800 },
    { index: 1, id: 'road-b', length: 500 },
  ],
  toWorld: (edge: number, s: number, d: number) => ({ x: 1000 * edge + s, y: 0, z: d }),
} as unknown as RoadNetwork;

const board = (s0: number, item: string | undefined, pool?: 'billboards') => ({
  kind: 'billboard',
  s0,
  s1: s0 + 10,
  d0: 8,
  d1: 12,
  item,
  pool,
});
const dressing: RoadDressing = {
  'road-a': { features: [{ kind: 'boostPad', s0: 5, s1: 10, d0: 0, d1: 2 }, board(100, 'gator-ad')] },
  'road-b': { features: [board(200, undefined, 'billboards')] },
};
const catalog: BoardCatalog = {
  items: { 'gator-ad': { ref: 'base:region/florida-keys#gator-ad', text: 'GATOR AD.', kind: 'billboard' } },
  pools: { billboards: [] },
};

describe('receipt boards on the race roads', () => {
  it('lists every billboard slot with where its panel stands', () => {
    expect(boardSpots(road, dressing)).toEqual([
      { road: 'road-a', index: 1, x: 105, z: 10 },
      { road: 'road-b', index: 0, x: 1205, z: 10 },
    ]);
    expect(spotOn(road)('road-b', 600)).toEqual({ x: 1500, z: 0 });
    expect(spotOn(road)('elsewhere', 10)).toBeNull();
  });

  it('points a rewritten slot at its receipt item, leaves the rest and the originals alone', () => {
    const receipt = {
      ref: 'base:career/keys-circuit#receipt-scoreboard',
      text: 'RV 1, KEVIN 0.',
      kind: 'billboard' as const,
    };
    const shown = withReceiptBoards(dressing, catalog, [{ road: 'road-b', index: 0, ...receipt }]);
    const slot = shown.dressing['road-b']?.features?.[0] as BoardSlot;
    expect(resolveSlot(slot, shown.catalog)).toEqual(receipt);
    // The other road's board still shows its region item; nothing given was changed.
    expect(resolveSlot(shown.dressing['road-a']?.features?.[1] as BoardSlot, shown.catalog)).toEqual(
      catalog.items['gator-ad'],
    );
    expect(dressing['road-b']?.features?.[0]).toMatchObject({ pool: 'billboards', item: undefined });
    expect(catalog.items['receipt-1']).toBeUndefined();
    // No receipts: the very same dressing and catalog.
    expect(withReceiptBoards(dressing, catalog, [])).toEqual({ dressing, catalog });
  });
});
