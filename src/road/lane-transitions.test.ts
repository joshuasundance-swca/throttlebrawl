import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureBranchNetwork, readConnector } from './index';

describe('traffic lane transitions', () => {
  it('adds a traffic-only movement without changing any existing rider defaults or split links', () => {
    const f = fixtureBranchNetwork();
    const original = createRoadNetwork(f);
    const source = f.roads.find((r) => r.id === 'c-in')!;
    const roads = [
      ...f.roads,
      {
        ...source,
        id: 'c-traffic',
        laneSections: source.laneSections.map((s) => ({
          ...s,
          lanes: s.lanes.map((l) => ({ ...l, kind: 'drive' as const })),
        })),
      },
    ];
    const network = {
      ...f.network,
      roads: [...f.network.roads, 'c-traffic'],
      junctions: f.network.junctions.map((j) => {
        const row = j.connectors.map(readConnector).find((r) => r?.road === 'c-in');
        return row
          ? {
              ...j,
              connectors: [
                ...j.connectors,
                { ...row, id: 'cx-c-traffic', road: 'c-traffic', trafficOnly: true, splitZone: undefined },
              ],
            }
          : j;
      }),
    };
    const road = createRoadNetwork({ ...f, roads, network });
    for (const edge of original.edges) {
      for (const end of ['from', 'to'] as const)
        expect(road.nextEdges(edge.index, end), `${edge.id}.${end}`).toEqual(
          original.nextEdges(edge.index, end),
        );
    }
    expect(
      road.laneTransitions(road.edgeIndex('a'), 'to').some((r) => r.edge === road.edgeIndex('c-traffic')),
    ).toBe(true);
    const pos = { edge: road.edgeIndex('c-traffic'), s: source.lengthM + 1, d: 0, dir: 1 as const };
    expect(road.advance(pos)).toBe('ok');
    expect(pos.edge).toBe(road.edgeIndex('cut'));
  });
  it('retains individual connector rows in both legal directions', () => {
    const f = fixtureBranchNetwork();
    const road = createRoadNetwork(f);
    const a = road.edgeIndex('a');
    const rows = road.laneTransitions(a, 'to');
    expect(rows.filter((r) => r.edge === road.edgeIndex('c-split')).map((r) => r.fromLane)).toEqual(['R1']);
    expect(rows.find((r) => r.edge === road.edgeIndex('c-in'))).toMatchObject({
      fromLane: 'R1',
      toLane: 'S1',
      entersAt: 'from',
      connector: 'cx-c-in',
    });
    const reverse = road.laneTransitions(road.edgeIndex('b'), 'from');
    expect(reverse.find((r) => r.edge === road.edgeIndex('c-split'))).toMatchObject({
      fromLane: 'L1',
      toLane: 'L1',
      entersAt: 'to',
      connector: 'cx-c-split-l1',
    });
    expect(reverse.some((r) => r.fromLane === 'R1')).toBe(false);
  });

  it('rejects a rider shortcut row from an opposing source lane for forward cars', () => {
    const f = fixtureBranchNetwork();
    const network = {
      ...f.network,
      junctions: f.network.junctions.map((j) => ({
        ...j,
        connectors: j.connectors.map((raw) => {
          const row = readConnector(raw);
          return row?.road === 'c-in' ? { ...row, from: { ...row.from, lane: 'L1' } } : raw;
        }),
      })),
    };
    const road = createRoadNetwork({ ...f, network });
    expect(
      road.laneTransitions(road.edgeIndex('a'), 'to').some((r) => r.edge === road.edgeIndex('c-in')),
    ).toBe(false);
    expect(road.nextEdges(road.edgeIndex('a'), 'to').some((r) => r.edge === road.edgeIndex('c-in'))).toBe(
      true,
    );
    expect(
      road.laneTransitions(road.edgeIndex('a'), 'to').some((r) => r.edge === road.edgeIndex('c-split')),
    ).toBe(true);
  });
});
