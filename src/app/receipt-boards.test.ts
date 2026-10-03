import { describe, expect, it } from 'vitest';
import type { BoardCatalog, FeatureSpan, RoadDressing } from '../render';
import type { RoadNetwork } from '../sim/api';

/** What the renderer shows in a slot (render/boards.ts resolveSlot: its item first, else its pool). */
const resolveSlot = (slot: FeatureSpan | undefined, c: BoardCatalog) =>
  slot?.item ? (c.items[slot.item] ?? null) : slot?.pool ? 'pool' : null;
type BoardSlot = FeatureSpan;
import {
  boardSpots,
  INCIDENT_EDGE_M,
  incidentSpot,
  spotOn,
  withIncidentSites,
  withReceiptBoards,
} from './receipt-boards';

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

describe('incident sites where you were busted (run W-U)', () => {
  /** The same two roads with two 4 m lanes (d -4..4) and a 1 m shoulder each side (d -5..5). */
  const laned = {
    ...road,
    lanesAt: () => [
      { id: 'L0', dCenterM: -4.5, widthM: 1, direction: -1, kind: 'shoulder' },
      { id: 'L1', dCenterM: -2, widthM: 4, direction: -1, kind: 'drive' },
      { id: 'R1', dCenterM: 2, widthM: 4, direction: 1, kind: 'drive' },
      { id: 'R0', dCenterM: 4.5, widthM: 1, direction: 1, kind: 'shoulder' },
    ],
  } as unknown as RoadNetwork;
  const site = {
    road: 'road-a',
    s: 300,
    ref: 'base:career/keys-circuit#receipt-incident-site',
    text: 'INCIDENT SITE #3.',
  };

  it('stands just off the road at the bust, on its right where that is dry', () => {
    expect(incidentSpot(laned, dressing, 'road-a', 300)).toEqual({ s: 300, d: 5 + INCIDENT_EDGE_M });
    expect(incidentSpot(laned, dressing, 'elsewhere', 300)).toBeNull();
  });

  it('never on a bridge or over water: the left when the right is wet, else slid to dry road', () => {
    const wetRight: RoadDressing = {
      'road-a': { tags: [{ s0: 250, s1: 350, side: 'right', tag: 'water-open' }] },
    };
    expect(incidentSpot(laned, wetRight, 'road-a', 300)).toEqual({ s: 300, d: -5 - INCIDENT_EDGE_M });
    const bridge: RoadDressing = {
      'road-a': {
        tags: [
          { s0: 200, s1: 330, tag: 'bridge' },
          { s0: 0, s1: 800, side: 'both', tag: 'forest' },
        ],
      },
    };
    // The bridge covers 300; the nearest dry step is 40 m on (340).
    expect(incidentSpot(laned, bridge, 'road-a', 300)).toEqual({ s: 340, d: 5 + INCIDENT_EDGE_M });
    const allWet: RoadDressing = {
      'road-a': { tags: [{ s0: 0, s1: 800, tag: 'bridge' }] },
    };
    expect(incidentSpot(laned, allWet, 'road-a', 300)).toBeNull();
  });

  it('adds a cone slot after the road’s own features, so receipt boards keep their indices', () => {
    const shown = withIncidentSites(laned, dressing, catalog, [site]);
    const feats = shown.dressing['road-a']?.features ?? [];
    expect(feats.slice(0, 2)).toEqual(dressing['road-a']?.features);
    const slot = feats[2] as BoardSlot;
    expect(slot).toMatchObject({ kind: 'billboard', s0: 300, s1: 300, d0: 5 + INCIDENT_EDGE_M });
    expect(resolveSlot(slot, shown.catalog)).toEqual({ ref: site.ref, text: site.text, kind: 'cone' });
    // The given dressing and catalog are untouched; no sites gives them back as they were.
    expect(dressing['road-a']?.features).toHaveLength(2);
    expect(Object.keys(catalog.items)).toEqual(['gator-ad']);
    expect(withIncidentSites(laned, dressing, catalog, [])).toEqual({ dressing, catalog });
    // A site off this network is left out.
    expect(withIncidentSites(laned, dressing, catalog, [{ ...site, road: 'elsewhere' }]).dressing).toEqual(
      dressing,
    );
  });
});
