// The ground under a rider (W-Q contracts; interview, 2026-10-02: "Anywhere with ground": a ridable
// band beside most roads, each surface with its own grip and speed; water, ferns, kerbs and some
// fences are the real edges). The sim's side of road/'s cross-section (`crossSectionAt`, `vergeAt`,
// `groundAt`):
// - tuning: each ground surface's grip and speed, and `ground.offRoad`, the switch that lets a
//   rider's across-position run past the lanes into the verge;
// - `rideLimits`: where a rider's centre may go across the road at s, and what stops it there;
// - `groundUnder` and `surfaceFeel`: the surface under the wheels and its grip and speed.
// The off-road lane (run W-R) wired the limits, the edges and the feel into sim/riders and turned the
// switch on by default; a race whose tuning leaves it out (every recording made before) runs with it
// off, exactly as before.
import {
  GROUND_SURFACES,
  type GroundSurface,
  type TuningParamDecl,
  type TuningValues,
  type VergeEdge,
} from '../core';
import type { RoadNetwork } from '../road';

/**
 * Each surface's grip (a scale on steering authority) and speed (a scale on top speed and
 * acceleration) [default]. Paved road is 1. The paved shoulder keeps 1 because the riders' own
 * shoulder drag already slows it (playtest 1, 2026-09-30); loose ground is slower and slides more.
 */
export const SURFACE_FEEL: Readonly<Record<GroundSurface, { grip: number; speed: number }>> = {
  asphalt: { grip: 1, speed: 1 },
  concrete: { grip: 1, speed: 1 },
  brick: { grip: 0.95, speed: 0.95 },
  cobbles: { grip: 0.9, speed: 0.9 },
  gravel: { grip: 0.75, speed: 0.8 },
  dirt: { grip: 0.8, speed: 0.8 },
  sand: { grip: 0.6, speed: 0.6 },
  grass: { grip: 0.7, speed: 0.7 },
  shoulder: { grip: 1, speed: 1 },
  kerb: { grip: 0.9, speed: 0.85 },
};

export const OFF_ROAD_PARAM = 'ground.offRoad';
export const gripParam = (g: GroundSurface): string => `ground.${g}.grip`;
export const speedParam = (g: GroundSurface): string => `ground.${g}.speed`;

const scale = (id: string, label: string, value: number): TuningParamDecl => ({
  id,
  group: 'ground',
  label,
  default: value,
  min: 0.2,
  max: 1.2,
  step: 0.05,
  unit: '×',
  affectsSim: true,
});

export const GROUND_TUNING: readonly TuningParamDecl[] = [
  {
    id: OFF_ROAD_PARAM,
    group: 'ground',
    label: 'Ride off the road onto the verge (0 off, 1 on)',
    // On (run W-R, interview 2026-10-02: "remove the invisible wall where ground is drawn"). A race
    // whose tuning leaves it out (a recording made before, a hand-built test config) rides with it
    // off, exactly as before.
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    affectsSim: true,
  },
  ...GROUND_SURFACES.flatMap((g) => [
    scale(gripParam(g), `Grip on ${g}`, SURFACE_FEEL[g].grip),
    scale(speedParam(g), `Speed on ${g}`, SURFACE_FEEL[g].speed),
  ]),
];

/** Whether riders may leave the lanes for the verge in this race. */
export const offRoadOn = (params: TuningValues): boolean => (params[OFF_ROAD_PARAM] ?? 0) >= 0.5;

/** Where a rider's centre may go across the road at s, and what stops it at each side. */
export interface RideLimits {
  /** Lowest and highest d for the rider's centre (half a bike inside the edges). */
  lo: number;
  hi: number;
  /** What stops the rider at each edge: with the switch off, the M1 wall at the lanes (`hard`). */
  loEdge: VergeEdge;
  hiEdge: VergeEdge;
  /** The ground band each side runs out to, m (0 with the switch off). */
  loBandM: number;
  hiBandM: number;
}

/**
 * The limits at (edge, s). Switch off: the lanes' outer edges, exactly the riders' barrier limits
 * since M1. Switch on: each verge band's outer edge, and the band's edge kind (a band of width 0,
 * on a bridge or a causeway, stops the rider at the lanes with its own kind: `rail`, `water`).
 */
export function rideLimits(
  road: RoadNetwork,
  params: TuningValues,
  edge: number,
  s: number,
  halfWidthM: number,
): RideLimits {
  if (!offRoadOn(params)) {
    let lo = 0;
    let hi = 0;
    for (const lane of road.lanesAt(edge, s)) {
      lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
      hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    }
    return {
      lo: lo + halfWidthM,
      hi: hi - halfWidthM,
      loEdge: 'hard',
      hiEdge: 'hard',
      loBandM: 0,
      hiBandM: 0,
    };
  }
  const left = road.vergeAt(edge, s, 'left');
  const right = road.vergeAt(edge, s, 'right');
  return {
    lo: left.dOuter + halfWidthM,
    hi: right.dOuter - halfWidthM,
    loEdge: left.edge,
    hiEdge: right.edge,
    loBandM: left.widthM,
    hiBandM: right.widthM,
  };
}

/** The ground under a mover at (edge, s, d), or null in the air (h > 0) or past every band. */
export function groundUnder(
  road: RoadNetwork,
  edge: number,
  s: number,
  d: number,
  h: number,
): GroundSurface | null {
  return h > 0 ? null : road.groundAt(edge, s, d);
}

/** The grip and speed scales for a ground, from the race's tuning; 1 and 1 in the air. */
export function surfaceFeel(
  params: TuningValues,
  ground: GroundSurface | null,
): { grip: number; speed: number } {
  if (ground === null) return { grip: 1, speed: 1 };
  const base = SURFACE_FEEL[ground];
  return {
    grip: params[gripParam(ground)] ?? base.grip,
    speed: params[speedParam(ground)] ?? base.speed,
  };
}
