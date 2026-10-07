// The car ferry's numbers (moved here from render/roofs.ts and render/pnw-places.ts, the physical world's port of
// the Pacific Northwest's places, 2026-10-06): the one place that says how long a hull section is, how wide the
// hull, where its passenger deck stands over the car deck and where it stops. The ferry is a solid structure now
// (road/plan-pnw-places.ts plans its walls, posts, passenger deck and funnel for the sim), render draws it from
// the same numbers (render/pnw-places.ts) and the rain stops under its roof by them (render/roofs.ts), so what is
// drawn, what is hit and where the rain stops are one fact. Small and pure: it sits in the main chunk.

/** The car ferry's roof, m [default]: how far its passenger deck stands over the car deck, and how wide. */
export const FERRY_ROOF = {
  /** The underside of the passenger deck above the car deck. */
  heightM: 6.6,
  /** Half the hull's width: the roof covers the road out to here each side. */
  halfWidthM: 12,
  /** The passenger deck stops this far short of each end of the hull. */
  insetM: 20,
  /** About how long one hull section is (the ferry is built in sections of about this length). */
  sectionM: 18,
} as const;

/** Hull half width, the car deck's walls and the passenger deck's heights above the car deck, m. */
export const FERRY_DIM = {
  hullHalfW: FERRY_ROOF.halfWidthM,
  wallD: 10,
  wallW: 0.6,
  bulwarkH: 2.6,
  /** The passenger deck's underside: roofs.ts keeps the rain out from under it. */
  ceilingY: FERRY_ROOF.heightM,
  cabinTopY: 10,
  /** The passenger deck stops this far short of each end of the hull. */
  cabinInsetM: FERRY_ROOF.insetM,
} as const;

/** The sections a ferry stretch s0..s1 is built in, and which of them carry the passenger deck. */
export function ferrySections(
  s0: number,
  s1: number,
): { n: number; len: number; cabin: (i: number) => boolean } {
  const n = Math.max(1, Math.round((s1 - s0) / FERRY_ROOF.sectionM));
  const len = (s1 - s0) / n;
  const cabin = (i: number) => {
    const s = s0 + (i + 0.5) * len;
    return s > s0 + FERRY_ROOF.insetM && s < s1 - FERRY_ROOF.insetM;
  };
  return { n, len, cabin };
}
