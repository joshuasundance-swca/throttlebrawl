// Test fixtures for the gaps (playtest 3, T3.1; the maintainer, round 3: "the real 80 m missing span
// is the big jump (a miss = splash, respawn on the highway)"): a straight bridge GAP_DECK_Y above the
// water, with an optional kicker baked into its profile (the compiler's `ramp` shape, y = h·u²), any
// `gap` features and barriers, and a SimConfig with one player on it. Used by tests only; it follows
// the sim's determinism rules like any file under src/sim.
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  type BakedBarrier,
  type BakedFeature,
  type BakedNetworkBundle,
  type BakedRoute,
} from '../../road';
import { SIM_TUNING } from '../create';
import type { SimBikeDef, SimConfig, SimRiderDef } from '../types';

/** The deck's height above the water, m. */
export const GAP_DECK_Y = 8;

/** The fixture's bike: the riders tests' 38 m/s test bike. */
export const GAP_BIKE: SimBikeDef = {
  contentId: 'base:test-bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};

export interface GapBridgeOptions {
  lengthM?: number;
  /** A kicker whose lip is at `lipS` (on a 2 m sample), `heightM` high over `lengthM` before it. */
  kicker?: { lipS: number; heightM: number; lengthM: number };
  features?: readonly BakedFeature[];
  /** Barriers; absent means a 1 m rail on both sides for the whole length. */
  barriers?: readonly BakedBarrier[];
}

/** A straight bridge (road `a`) over the water, with a kicker, gaps and barriers as asked. */
export function gapBridge(opts: GapBridgeOptions = {}): BakedNetworkBundle {
  const lengthM = opts.lengthM ?? 1500;
  const bundle = JSON.parse(
    JSON.stringify(fixtureNetwork([{ id: 'a', lengthM, kappa: 0 }])),
  ) as BakedNetworkBundle;
  const road = bundle.roads[0] as unknown as {
    sampleSpacingM: number;
    features?: BakedFeature[];
    barriers?: BakedBarrier[];
    samples: { data: Record<string, number[]> };
  };
  const sp = road.sampleSpacingM;
  const y = road.samples.data['y'] ?? [];
  const grade = road.samples.data['grade'] ?? [];
  const k = opts.kicker;
  for (let i = 0; i < y.length; i++) {
    const s = i * sp;
    let lift = 0;
    let slope = 0;
    if (k && s >= k.lipS - k.lengthM && s <= k.lipS) {
      const u = (s - (k.lipS - k.lengthM)) / k.lengthM;
      lift = k.heightM * u * u;
      slope = (2 * k.heightM * u) / k.lengthM;
    }
    y[i] = (y[i] ?? 0) + GAP_DECK_Y + lift;
    grade[i] = slope;
  }
  // The kicker's range is marked as a `ramp` feature, as the compiler and the GIS bake mark theirs
  // (the riders' crest rule leaves a marked lip to the lip rule).
  const ramp: BakedFeature[] = k
    ? [{ kind: 'ramp', id: 'kicker', s0: k.lipS - k.lengthM, s1: k.lipS, d0: -8, d1: 8 }]
    : [];
  road.features = [...ramp, ...(opts.features ?? [])].sort((a, b) => a.s0 - b.s0);
  road.barriers = opts.barriers
    ? [...opts.barriers]
    : [{ s0: 0, s1: lengthM, side: 'both', kind: 'rail', heightM: 1 }];
  for (const j of bundle.network.junctions as unknown as { y: number }[]) j.y += GAP_DECK_Y;
  return bundle;
}

/** A gap feature over the whole road width (d −8 to 8) from s0 to s1. */
export function gapFeature(
  id: string,
  s0: number,
  s1: number,
  params?: Record<string, unknown>,
): BakedFeature {
  return { kind: 'gap', id, s0, s1, d0: -8, d1: 8, ...(params ? { params } : {}) };
}

export interface GapConfigOptions {
  /** The route over the bundle; absent: road `a` start to end, every road allowed. */
  route?: BakedRoute;
  tuning?: Readonly<Record<string, number>>;
  seed?: number;
}

/** One player on the bundle's roads, every sim tuning parameter at its default. */
export function gapSimConfig(bundle: BakedNetworkBundle, opts: GapConfigOptions = {}): SimConfig {
  const road = createRoadNetwork(bundle);
  const first = bundle.roads[0];
  const route = createRouteProgress(
    road,
    opts.route ?? {
      id: 'r',
      network: bundle.network.id,
      start: { road: first?.id ?? 'a', s: 20, dir: 1 },
      finish: { road: first?.id ?? 'a', s: (first?.lengthM ?? 100) - 20 },
      mainPath: [first?.id ?? 'a'],
      allowedRoads: bundle.roads.map((r) => r.id),
      closed: false,
    },
  );
  const player: SimRiderDef = {
    contentId: 'base:player',
    name: 'You',
    role: 'player',
    faction: 'rider',
    controller: { kind: 'player', slot: 0 },
    bike: GAP_BIKE,
    massKg: 80,
    healthMax: 100,
  };
  const tuning: Record<string, number> = {};
  for (const d of SIM_TUNING) tuning[d.id] = d.default;
  return {
    seed: opts.seed ?? 1234,
    event: {
      contentId: 'base:test-event',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100, 50, 25],
      raceEndTimeoutTicks: 60 * 600,
    },
    riders: [player],
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { ...tuning, ...(opts.tuning ?? {}) },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}
