import type { Edge, RoadNetwork } from './network';

/** Shared solid-road drawing settings; the heavy physical sampler loads with race-world physics. */
export const ROAD_SURFACE_SIMPLIFY = { tolM: 0.01, maxSpanM: 40 } as const;
export const SHOULDER_LAP_M = 2 * ROAD_SURFACE_SIMPLIFY.tolM;

type ShoulderSupport = (road: RoadNetwork, edge: Edge, s: number, d: number) => boolean;
type Prewarm = (road: RoadNetwork) => void;
let support: { query: ShoulderSupport; prewarm: Prewarm } | null = null;
let loading: Promise<void> | null = null;

/** Install one immutable implementation. Repeated loading cannot change future query behavior. */
export function installPlainShoulderSupport(query: ShoulderSupport, prewarm: Prewarm): void {
  if (support) {
    if (support.query !== query || support.prewarm !== prewarm)
      throw new Error('road: shoulder support is already installed');
    return;
  }
  support = { query, prewarm };
}

/** Uses the existing awaited structures loading path; a failed import can be retried. */
export function preparePlainShoulderSupport(): Promise<void> {
  loading ??= import('./structures/shoulder-support').then(
    () => undefined,
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}

/** Early menu reads never invent support; every simulation step awaits the installing chunk. */
export function onPlainShoulder(road: RoadNetwork, edge: Edge, s: number, d: number): boolean {
  return support?.query(road, edge, s, d) ?? false;
}

/** Prepared races pay network planning before their first snapshot/countdown, never on a swerve. */
export function prewarmPlainShoulderSupport(road: RoadNetwork): void {
  if (road.terrain) support?.prewarm(road);
}
