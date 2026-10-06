// The haze per stretch of road (the maintainer, 2026-10-06, playtest 4 answers: "Thin it on Chuckanut: a longer,
// lighter haze on that drive only, so the sea below the cliff shows. The rest of the region keeps its misty mood.").
// A region whose palette names a `fog` colour closes its haze in (render.regionFogFarM, 480 m). A road tagged
// `thin-haze` over a run of s takes a longer one there (render.thinHazeFarM, 700 m): where is data, in the road
// files and their bake configs; how far is a tuning number. Chuckanut Drive's three roads carry it all along, and
// Lake Samish's East Shore Drive (run C's fix check, punch item 5: the lake a pale band from the chase camera).
// The renderer reads it where the player is, each frame, and eases the fog's end toward it, so a turn-off onto a
// tagged road opens the view over a second or two instead of at a cut. Small and pure: it sits in the main chunk.
import type { RoadNetwork } from '../road';

/** The road tag that thins a foggy region's haze over its run of s (either side; the fog is not sided). */
export const THIN_HAZE_TAG = 'thin-haze';

/** How quickly the fog's end follows a new stretch's reach: the time constant of its ease, seconds. [default] */
export const HAZE_EASE_S = 1;

/** Closer than this to its goal, the fog's end is there, m. */
const SNAP_M = 0.05;

/** Per edge index, the runs of s where the haze thins. */
export type ThinHazeSpans = ReadonlyMap<number, readonly (readonly [number, number])[]>;

/** The `thin-haze` runs of every edge of a network, from its baked tags. */
export function thinHazeSpans(road: RoadNetwork): ThinHazeSpans {
  const out = new Map<number, [number, number][]>();
  for (const e of road.edges)
    for (const t of e.tags) {
      if (t.tag !== THIN_HAZE_TAG) continue;
      let list = out.get(e.index);
      if (!list) out.set(e.index, (list = []));
      list.push([t.s0, t.s1]);
    }
  return out;
}

/** Where a foggy region's haze is full for a rider at (edge, s): the thin reach on a tagged run, else the region's. */
export function hazeFarAt(
  spans: ThinHazeSpans,
  edge: number,
  s: number,
  params: { readonly regionFogFarM: number; readonly thinHazeFarM: number },
): number {
  const runs = spans.get(edge);
  return runs?.some(([s0, s1]) => s >= s0 && s <= s1) ? params.thinHazeFarM : params.regionFogFarM;
}

/** The fog's end after `dtS` seconds easing from `current` toward `target`: never past it, there when close. */
export function easeHaze(current: number, target: number, dtS: number): number {
  const next = target + (current - target) * Math.exp(-Math.max(0, dtS) / HAZE_EASE_S);
  return Math.abs(next - target) < SNAP_M ? target : next;
}
