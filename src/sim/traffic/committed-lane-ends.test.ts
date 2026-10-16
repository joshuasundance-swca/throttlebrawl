import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, highwayLanes, type BakedNetworkBundle } from '../../road';
import { buildLaneMap, laneEndOnMap, type Corridor } from './corridor';

/** Only the outer source lanes connect to this committed single-lane movement. */
function fixture() {
  const bundle = fixtureNetwork([
    { id: 'a', lengthM: 100, kappa: 0, lanes: highwayLanes(2) },
    {
      id: 'turn',
      lengthM: 20,
      kappa: 0,
      lanes: [
        { id: 'L1', dCenterM: -6, widthM: 4, direction: -1, kind: 'drive' },
        { id: 'R1', dCenterM: 6, widthM: 4, direction: 1, kind: 'drive' },
      ],
    },
    { id: 'b', lengthM: 100, kappa: 0, lanes: highwayLanes(2) },
  ]);
  bundle.roads[1]!.from = bundle.roads[1]!.to = 'turn-j';
  bundle.roads[0]!.to = bundle.roads[2]!.from = 'turn-j';
  bundle.network.junctions = [
    {
      id: 'turn-j',
      ends: [
        { road: 'a', end: 'to' },
        { road: 'b', end: 'from' },
      ],
      connectors: [
        {
          id: 'outer-plus',
          road: 'turn',
          from: { road: 'a', end: 'to', lane: 'R2' },
          to: { road: 'b', end: 'from', lane: 'R2' },
        },
        {
          id: 'outer-minus',
          road: 'turn',
          from: { road: 'a', end: 'to', lane: 'L2' },
          to: { road: 'b', end: 'from', lane: 'L2' },
        },
      ],
    },
  ];
  return bundle;
}

function corridor(bundle: BakedNetworkBundle, reversed = false, committed = true): Corridor {
  const order = reversed ? [2, 1, 0] : [0, 1, 2];
  let length = 0;
  const off = order.map((edge) => {
    const at = length;
    length += bundle.roads[edge]!.lengthM;
    return at;
  });
  return {
    edges: order,
    o: order.map(() => (reversed ? -1 : 1)),
    off,
    len: order.map((edge) => bundle.roads[edge]!.lengthM),
    length,
    routeDir: 1,
    lo: 0,
    hi: length,
    ...(committed ? { dOff: order.map(() => 0) } : {}),
  };
}

describe('committed lane ends follow public directed lane transitions', () => {
  it.each([false, true])(
    'follows the selected outer lane through rank changes in both directions (reversed corridor %s)',
    (reversed) => {
      const bundle = fixture();
      const road = createRoadNetwork(bundle);
      // Positive oracle: the actual public API has R2→R1 and L2→L1 movements, not inner-lane entries.
      expect(road.laneTransitions(0, 'to').map((row) => [row.fromLane, row.toLane])).toEqual([['R2', 'R1']]);
      expect(road.laneTransitions(2, 'from').map((row) => [row.fromLane, row.toLane])).toEqual([
        ['L2', 'L1'],
      ]);
      const map = buildLaneMap(road, corridor(bundle, reversed));
      for (const [u, dir] of [
        [80, 1],
        [140, -1],
      ]) {
        expect(laneEndOnMap(map, u!, dir!, 1, 200), `outer lane at u${u},dir${dir}`).toBe(Infinity);
        expect(laneEndOnMap(map, u!, dir!, 0, 200), 'inner lane has no row into this committed turn').toBe(
          20,
        );
        expect(laneEndOnMap(map, u!, dir!, 2, 200), 'nonexistent lane cannot gain a continuation').toBe(0);
      }
    },
  );

  it.each([
    { reversed: false, dir: 1 },
    { reversed: false, dir: -1 },
    { reversed: true, dir: 1 },
    { reversed: true, dir: -1 },
  ])('does not replace a genuine outer lane drop with a rank clamp ($reversed,$dir)', ({ reversed, dir }) => {
    const bundle = fixture();
    const edge = dir === 1 ? (reversed ? 2 : 0) : reversed ? 0 : 2;
    const first = bundle.roads[edge]!.laneSections[0]!.lanes;
    // Both physical directions lose their outer lane at the same section boundary.
    const inner = first.filter((lane) => lane.id !== 'L2' && lane.id !== 'R2');
    bundle.roads[edge]!.laneSections =
      (reversed ? -1 : 1) * dir === -1
        ? [
            { s0: 0, lanes: inner },
            { s0: 40, lanes: first },
          ]
        : [
            { s0: 0, lanes: first },
            { s0: 60, lanes: inner },
          ];
    const map = buildLaneMap(createRoadNetwork(bundle), corridor(bundle, reversed));
    expect(laneEndOnMap(map, dir === 1 ? 40 : 180, dir, 1, 100)).toBe(20);
    expect(
      laneEndOnMap(map, dir === 1 ? 80 : 140, dir, 1, 100),
      'outer lane absent where the car stands',
    ).toBe(0);
  });

  it.each([
    { reversed: false, dir: 1 },
    { reversed: false, dir: -1 },
    { reversed: true, dir: 1 },
    { reversed: true, dir: -1 },
  ])('retains an outer lane identity when the inner lane ends ($reversed,$dir)', ({ reversed, dir }) => {
    const bundle = fixture();
    const edge = dir === 1 ? (reversed ? 2 : 0) : reversed ? 0 : 2;
    const first = bundle.roads[edge]!.laneSections[0]!.lanes;
    const outer = first.filter((lane) => lane.id !== 'L1' && lane.id !== 'R1');
    bundle.roads[edge]!.laneSections =
      (reversed ? -1 : 1) * dir === -1
        ? [
            { s0: 0, lanes: outer },
            { s0: 40, lanes: first },
          ]
        : [
            { s0: 0, lanes: first },
            { s0: 60, lanes: outer },
          ];
    const map = buildLaneMap(createRoadNetwork(bundle), corridor(bundle, reversed));
    expect(
      laneEndOnMap(map, dir === 1 ? 40 : 180, dir, 1, 170),
      'same outer ID becomes rank0 then connects legally',
    ).toBe(Infinity);
    expect(
      laneEndOnMap(map, dir === 1 ? 40 : 180, dir, 0, 170),
      'ended inner ID cannot become the surviving outer ID',
    ).toBe(20);
  });

  it('rejects an absent/opposing receiving movement despite unchanged lane counts', () => {
    const bundle = fixture();
    bundle.network.junctions[0]!.connectors = bundle.network.junctions[0]!.connectors.slice(0, 1);
    const road = createRoadNetwork(bundle);
    expect(road.laneTransitions(2, 'from')).toEqual([]);
    const map = buildLaneMap(road, corridor(bundle));
    expect(laneEndOnMap(map, 140, -1, 1, 100)).toBe(20);
    expect(laneEndOnMap(map, 80, 1, 1, 100)).toBe(Infinity);
  });

  it('does not treat a renamed lane in the next section as the previous lane', () => {
    const bundle = fixture();
    const lanes = bundle.roads[0]!.laneSections[0]!.lanes;
    bundle.roads[0]!.laneSections = [
      { s0: 0, lanes },
      { s0: 60, lanes: lanes.map((l) => (l.id === 'R2' ? { ...l, id: 'R9' } : l)) },
    ];
    const map = buildLaneMap(createRoadNetwork(bundle), corridor(bundle));
    expect(laneEndOnMap(map, 40, 1, 1, 100)).toBe(20);
  });

  it('does not mistake an implicit nearest-lane pass-through for an explicit outer-lane continuation', () => {
    const bundle = fixtureNetwork([
      { id: 'wide', lengthM: 100, kappa: 0, lanes: highwayLanes(2).filter((l) => l.kind === 'drive') },
      { id: 'narrow', lengthM: 100, kappa: 0, lanes: highwayLanes(1).filter((l) => l.kind === 'drive') },
    ]);
    const road = createRoadNetwork(bundle);
    // The public API allows preparation to merge; this is not an authored R2 connector.
    expect(road.laneTransitions(0, 'to').find((row) => row.fromLane === 'R2')).toMatchObject({
      toLane: 'R1',
    });
    expect(road.laneTransitions(0, 'to').find((row) => row.fromLane === 'R2')!.connector).toBeUndefined();
    const c: Corridor = {
      edges: [0, 1],
      o: [1, 1],
      off: [0, 100],
      len: [100, 100],
      length: 200,
      lo: 0,
      hi: 200,
      routeDir: 1,
      dOff: [0, 0],
    };
    const map = buildLaneMap(road, c);
    expect(laneEndOnMap(map, 80, 1, 1, 100), 'outer lane must merge before the ordinary narrowing').toBe(20);
    expect(laneEndOnMap(map, 80, 1, 0, 100), 'inner lane retains its lane ID').toBe(Infinity);
  });

  it('maps opposite host and connector orientations using their actual road ends', () => {
    const bundle = fixture();
    bundle.roads[0]!.from = 'turn-j';
    bundle.network.junctions[0]!.ends[0]!.end = 'from';
    for (const raw of bundle.network.junctions[0]!.connectors) {
      const row = raw as { from: { end: 'from' | 'to'; lane: string } };
      row.from.end = 'from';
      row.from.lane = row.from.lane === 'R2' ? 'L2' : 'R2';
    }
    const road = createRoadNetwork(bundle);
    expect(road.laneTransitions(0, 'from').map((r) => [r.fromLane, r.toLane])).toEqual([['L2', 'R1']]);
    const c = corridor(bundle);
    c.o[0] = -1;
    const map = buildLaneMap(road, c);
    expect(laneEndOnMap(map, 80, 1, 1, 200)).toBe(Infinity);
    expect(laneEndOnMap(map, 140, -1, 1, 200)).toBe(Infinity);
    expect(laneEndOnMap(map, 80, 1, 0, 200)).toBe(20);
  });

  it('does not continue into an opposing receiving lane', () => {
    const bundle = fixture();
    const row = bundle.network.junctions[0]!.connectors[0] as { to: { lane: string } };
    row.to.lane = 'L2';
    const road = createRoadNetwork(bundle);
    expect(road.laneTransitions(1, 'to')).toEqual([]);
    const map = buildLaneMap(road, corridor(bundle));
    expect(laneEndOnMap(map, 105, 1, 0, 100)).toBe(15);
  });

  it('uses the actual repeated occurrence and stops at a missing road-to-road transition', () => {
    const bundle = fixture();
    const road = createRoadNetwork(bundle);
    const one = corridor(bundle);
    const twice: Corridor = {
      ...one,
      edges: [...one.edges, ...one.edges],
      o: [...one.o, ...one.o],
      off: [...one.off, ...one.off.map((u) => u + one.length)],
      len: [...one.len, ...one.len],
      dOff: [...one.dOff!, ...one.dOff!],
      length: 440,
      hi: 440,
    };
    const map = buildLaneMap(road, twice);
    expect(laneEndOnMap(map, 300, 1, 1, 200), 'second a→turn→b occurrence is legal').toBe(Infinity);
    expect(laneEndOnMap(map, 200, 1, 1, 100), 'first b has no public movement into second a').toBe(20);
  });

  it('answers cold/warm queries identically without mutating derived map data', () => {
    const bundle = fixture();
    const road = createRoadNetwork(bundle);
    const c = corridor(bundle);
    const cold = buildLaneMap(road, c);
    const saved = structuredClone(cold);
    const queries = [
      [80, 1, 1],
      [80, 1, 0],
      [140, -1, 1],
      [140, -1, 0],
    ] as const;
    const answer = () => queries.map(([u, dir, rank]) => laneEndOnMap(cold, u, dir, rank, 200));
    const first = answer();
    expect(first).toEqual([Infinity, 20, Infinity, 20]);
    expect(answer()).toEqual(first);
    expect(cold).toEqual(saved);
    expect(buildLaneMap(road, c)).toEqual(saved);
  });

  it('preserves the count-only legacy reference corridor behavior and fast representation', () => {
    const bundle = fixture();
    const map = buildLaneMap(createRoadNetwork(bundle), corridor(bundle, false, false));
    expect(map).toEqual({ u0: [0, 100, 120], plus: [2, 1, 2], minus: [2, 1, 2] });
    expect(laneEndOnMap(map, 80, 1, 1, 200)).toBe(20);
    expect(laneEndOnMap(map, 140, -1, 1, 200)).toBe(20);
    expect(laneEndOnMap(map, 80, 1, 0, 200)).toBe(Infinity);
  });
});
