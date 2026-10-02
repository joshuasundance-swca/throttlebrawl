// Fixture roads for tests in any lane (riders, traffic, tumble...): a chain of edges, each a
// constant-curvature arc, joined end to end by pass-through junctions, in the baked format.
// Built with core/math so it may live in src/road under the determinism rules.
import { cos, sin, type LaneInfo } from '../core';
import { compileTrack, type RampSource, type RoadSource, type TrackSource } from './compile';
import type { BakedNetwork, BakedNetworkBundle, BakedRoad, BakedRoute } from './types';

export const FIXTURE_LANES: readonly LaneInfo[] = [
  { id: 'L0', dCenterM: -4.15, widthM: 1.5, direction: -1, kind: 'shoulder' },
  { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
  { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
  { id: 'R0', dCenterM: 4.15, widthM: 1.5, direction: 1, kind: 'shoulder' },
];

export interface FixtureEdgeSpec {
  id: string;
  lengthM: number;
  /** Constant curvature, 1/m, positive = right turn. */
  kappa: number;
  /** Constant grade (rise over run). */
  grade?: number;
  /** The edge's own lanes in place of FIXTURE_LANES (a multi-lane highway, W-R). */
  lanes?: readonly LaneInfo[];
}

/**
 * A highway's lanes (W-R; interview, 2026-10-02: "multi-lane highways (4-6 lanes, lane
 * splitting)"): `perDirection` drive lanes each way of `widthM`, the innermost each way where
 * FIXTURE_LANES-style two-lane roads put theirs when `widthM` matches, and a shoulder each side.
 * Ids run outward: L1, L2, L3 and R1, R2, R3, shoulders L0 and R0.
 */
export function highwayLanes(perDirection: number, widthM = 4, shoulderM = 1.5): LaneInfo[] {
  const right: LaneInfo[] = [];
  for (let i = 1; i <= perDirection; i++) {
    right.push({ id: `R${i}`, dCenterM: (i - 0.5) * widthM, widthM, direction: 1, kind: 'drive' });
  }
  right.push({
    id: 'R0',
    dCenterM: perDirection * widthM + shoulderM / 2,
    widthM: shoulderM,
    direction: 1,
    kind: 'shoulder',
  });
  const left = right.map((l): LaneInfo => ({
    ...l,
    id: `L${l.id.slice(1)}`,
    dCenterM: -l.dCenterM,
    direction: -1,
  }));
  return [...left.reverse(), ...right];
}

/** A network of arcs joined end to end, starting at the origin heading north. */
export function fixtureNetwork(specs: readonly FixtureEdgeSpec[], id = 'fixture'): BakedNetworkBundle {
  let x = 0;
  let y = 0;
  let z = 0;
  let heading = 0;
  const roads: BakedRoad[] = specs.map((spec, n) => {
    const intervals = Math.max(1, Math.round(spec.lengthM / 2));
    const spacing = spec.lengthM / intervals;
    const grade = spec.grade ?? 0;
    const data = { x: [x], y: [y], z: [z], kappa: [spec.kappa], grade: [grade], bankRad: [0] };
    const sub = 8;
    const h = spacing / sub;
    for (let i = 1; i <= intervals; i++) {
      for (let j = 0; j < sub; j++) {
        const mid = heading + (spec.kappa * h) / 2;
        x += sin(mid) * h;
        z -= cos(mid) * h;
        heading += spec.kappa * h;
      }
      y += grade * spacing;
      data.x.push(x);
      data.y.push(y);
      data.z.push(z);
      data.kappa.push(spec.kappa);
      data.grade.push(grade);
      data.bankRad.push(0);
    }
    return {
      id: spec.id,
      from: `j${n}`,
      to: `j${n + 1}`,
      lengthM: spec.lengthM,
      sampleSpacingM: spacing,
      // Copies, so a test that edits one fixture's lanes never leaks into the next fixture.
      laneSections: [{ s0: 0, lanes: (spec.lanes ?? FIXTURE_LANES).map((l) => ({ ...l })) }],
      samples: { encoding: 'json-columns', columns: Object.keys(data), data },
    };
  });
  const junctions = specs.map((_s, n) => ({ n })).concat([{ n: specs.length }]);
  // Each junction sits where its roads end, so the fixture passes the road lint.
  const endPoint = (n: number): [number, number, number] => {
    const road = roads[n] ?? roads[n - 1];
    const d = road?.samples.data;
    const i = roads[n] ? 0 : (d?.['x']?.length ?? 1) - 1;
    return [d?.['x']?.[i] ?? 0, d?.['y']?.[i] ?? 0, d?.['z']?.[i] ?? 0];
  };
  return {
    network: {
      id,
      roads: specs.map((s) => s.id),
      junctions: junctions.map(({ n }) => {
        const prev = specs[n - 1];
        const next = specs[n];
        const [jx, jy, jz] = endPoint(n);
        return {
          id: `j${n}`,
          x: jx,
          y: jy,
          z: jz,
          ends: [
            ...(prev ? [{ road: prev.id, end: 'to' as const }] : []),
            ...(next ? [{ road: next.id, end: 'from' as const }] : []),
          ],
          connectors: [],
        };
      }),
    },
    roads,
  };
}

const plainRoad = (id: string, extra: Partial<RoadSource> = {}): RoadSource => ({
  id,
  name: id,
  speedLimitMps: 24.6,
  surface: 'asphalt',
  humps: [],
  tags: [],
  features: [],
  barriers: [],
  ...extra,
});

export interface BranchFixtureOptions {
  /** Where the fixture's one ramp goes: on the straight of the shortcut (default) or on the main bend. */
  rampOn?: 'shortcut' | 'bend';
}

/**
 * A small track with one split and one merge (road-2), compiled by the real road compiler: main
 * roads `a`, `b` and `d` (b swings through an S-bend), main-through connectors `c-split` and
 * `c-merge`, and a straight shortcut `cut` with its connectors `c-in` and `c-out` and a ramp. The
 * split zone is the last 40 m of `a`, d 2.4 to 4.9 (the right edge). Route `r` runs a to d.
 */
export function fixtureBranchTrack(opts: BranchFixtureOptions = {}): TrackSource {
  const ramp: RampSource = { id: 'kicker', s0: 100, lengthM: 15, heightM: 1.5, backM: 5 };
  const onBend = opts.rampOn === 'bend';
  return {
    network: {
      id: 'fixture-y',
      name: 'Fixture with a shortcut',
      region: 'fixture',
      crs: { kind: 'tmerc', originLatDeg: 0, originLonDeg: 0, originElevM: 0 },
      notes: 'test fixture',
    },
    createdAt: '2026-09-30',
    points: [
      [0, 0],
      [0, -200],
      [-60, -330],
      [-60, -470],
      [0, -600],
      [0, -800],
    ],
    baseElevationM: 1,
    spacingM: 2,
    smoothingM: 40,
    lanes: FIXTURE_LANES,
    roads: [
      plainRoad('a', { lengthM: 200 }),
      plainRoad('c-split', { lengthM: 30, connector: true }),
      plainRoad('b', onBend ? { ramps: [{ ...ramp, s0: 60 }] } : {}),
      plainRoad('c-merge', { lengthM: 30, connector: true }),
      plainRoad('d', { lengthM: 200 }),
    ],
    branches: [
      {
        leave: { road: 'a', offsetM: 3.4, lane: 'R1', zone: { lengthM: 40, d0: 2.4, d1: 4.9 } },
        join: { road: 'd', offsetM: 2.4, lane: 'R1' },
        turnsM: [40, 40],
        lanes: [{ id: 'S1', dCenterM: 0, widthM: 5, direction: 1, kind: 'shortcut' }],
        roads: [
          plainRoad('c-in', { lengthM: 30, connector: true }),
          plainRoad('cut', onBend ? {} : { ramps: [ramp] }),
          plainRoad('c-out', { lengthM: 30, connector: true }),
        ],
      },
    ],
    routes: [
      {
        id: 'r',
        start: { road: 'a', s: 20, dir: 1 },
        finish: { road: 'd', s: -20 },
        checkpoints: [{ road: 'd', s: 50 }],
        startGrid: { rows: 1, perRow: 2, rowGapM: 8 },
      },
    ],
  };
}

/** fixtureBranchTrack compiled: the network bundle and the route, in the baked format. */
export function fixtureBranchNetwork(
  opts: BranchFixtureOptions = {},
): BakedNetworkBundle & { route: BakedRoute } {
  const out = compileTrack(fixtureBranchTrack(opts));
  return {
    network: out.network as unknown as BakedNetwork,
    roads: out.roads as unknown as BakedRoad[],
    route: out.routes[0] as unknown as BakedRoute,
  };
}
