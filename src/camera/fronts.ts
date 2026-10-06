// The camera keeps clear of the building fronts (the solid-world batch's live check, punch item 2: "the
// camera ends up inside buildings after a Duval sidewalk crash": it sat inside the upper-floor balcony
// railing after a planter-palm crash and clipped a building face after a frangipani crash).
//
// A street's buildings stand on the sidewalk's outer edge (render/roadside.ts `Frontage`, downtown.ts,
// scenery.ts), so the sidewalk's outer edge is the line past which a camera is inside a building, and on
// Old Town's Duval Street the balconies and the open bars hang over the sidewalk, so there the line is
// further in. A crash throws the rider, and the chase camera with it, to the back of the sidewalk, and the
// walk back to the bike swings the camera round the rider (the framing follows the walk), so the eye
// ended up in the front.
//
// The rule is on the road's own data (the camera reads only data: boundaries.test.ts), so every street with
// a front on its sidewalk gets it, and nothing of the render layers is read: a side whose scenery tags name
// a street (`FRONT_TAGS`, the tags whose land theme in road/themes.ts is a street: the theme render's scatter
// reads, and fronts.test.ts holds the two lists together) and which has a verge band (a sidewalk) has the
// camera held at most `frontLimitM` from the centre line, `frontMarginM` inside the front. The camera swings
// to the open side, along the road's across direction, and its aim stays where it was. The push comes on in
// the frame it is needed (no frame is inside a front) and eases off at `FRONT_EASE_RATE` when it is not, so
// leaving a front does not snap the camera back. tests/sim/camera-fronts.test.ts holds the rule to the
// fronts the render layers draw.
import type { BakedTag, RoadNetwork } from '../road';
import type { CameraPose } from './chase';

/**
 * The scenery tags whose side of the road is a street front, each with its land theme (road/themes.ts
 * `LAND_TAGS`): Old Town's shopfronts (`oldtown`), downtown's towers (`downtown`, and `plaza`, whose towers
 * stand behind the paving), Portland's blocks (`blocks`), the mural alleys' shopfronts (`mission`),
 * Chinatown's and North Beach's (`lanterns`, `cafes`), a block's row houses (`urban`) and the cross streets
 * between them (`crossing`).
 */
export const FRONT_TAGS: Readonly<Record<string, string>> = {
  'key-oldtown': 'oldtown',
  towers: 'downtown',
  plaza: 'plaza',
  'pdx-blocks': 'blocks',
  shopfronts: 'mission',
  murals: 'mission',
  'mascot-mural': 'mission',
  lanterns: 'lanterns',
  cafes: 'cafes',
  'row-houses': 'urban',
  'painted-houses': 'urban',
  gardens: 'urban',
  'cross-street': 'crossing',
  'cable-crossing': 'crossing',
  'side-street': 'crossing',
};

/** The facade of Old Town's front stands this far past the sidewalk's outer edge, m (roadside.ts `across`). */
export const OLDTOWN_FACADE_M = 0.3;

/** How fast the push eases off once the camera needs none, 1/s (about a third of a second). [default] */
const FRONT_EASE_RATE = 4;

/** What the rule reads of the camera's tuning. */
export interface FrontParams {
  /** 1 holds the camera clear of the fronts, 0 leaves it where the rig put it. */
  keepClearOfFronts: number;
  /** How far inside a front's face the eye stays, m (a little over the near plane). */
  frontMarginM: number;
  /** How far Old Town's deepest front, the open bar, reaches over the sidewalk, m. */
  frontReachM: number;
}

/** Whether a tag covers that side of the road at s (a tag with no side covers both). */
const covers = (t: BakedTag, side: 'left' | 'right', s: number): boolean =>
  s >= t.s0 && s <= t.s1 && (t.side === 'both' || t.side === side);

/**
 * The front theme of one side at s (`FRONT_TAGS`'s value; Old Town's first, the only one whose fronts hang
 * over the sidewalk), or null: no street tag covers it, or water does (the theme order puts water first).
 */
function frontThemeAt(tags: readonly BakedTag[], side: 'left' | 'right', s: number): string | null {
  let theme: string | null = null;
  for (const t of tags) {
    if (!covers(t, side, s)) continue;
    if (t.tag.startsWith('water')) return null;
    const found = Object.hasOwn(FRONT_TAGS, t.tag) ? FRONT_TAGS[t.tag] : undefined;
    if (found !== undefined && theme !== 'oldtown') theme = found;
  }
  return theme;
}

/**
 * The farthest the eye may be from the centre line on one side of the road at s, m, or null where that side
 * has no front to keep clear of (no sidewalk, or a theme that is not a street).
 */
export function frontLimitM(
  road: RoadNetwork,
  edge: number,
  s: number,
  side: 'left' | 'right',
  p: FrontParams,
): number | null {
  const e = road.edges[edge];
  if (!e) return null;
  const verge = road.vergeAt(edge, s, side);
  if (!(verge.widthM > 0)) return null;
  const theme = frontThemeAt(e.tags, side, s);
  if (theme === null) return null;
  const outer = Math.abs(verge.dOuter);
  const inner = Math.abs(verge.dInner);
  // The facade is on the sidewalk's edge; Old Town's balconies and open bars hang over the sidewalk.
  const reach = theme === 'oldtown' ? p.frontReachM - OLDTOWN_FACADE_M : 0;
  return Math.max(inner, outer - reach - p.frontMarginM);
}

/** Whether any street tag lies on an edge (the rule has nothing to do on the rest, most roads). */
const edgeHasFronts = new WeakMap<RoadNetwork, Map<number, boolean>>();
function hasFronts(road: RoadNetwork, edge: number): boolean {
  let byEdge = edgeHasFronts.get(road);
  if (!byEdge) {
    byEdge = new Map<number, boolean>();
    edgeHasFronts.set(road, byEdge);
  }
  let has = byEdge.get(edge);
  if (has === undefined) {
    has = (road.edges[edge]?.tags ?? []).some((t) => Object.hasOwn(FRONT_TAGS, t.tag));
    byEdge.set(edge, has);
  }
  return has;
}

/** The clearance rule's own state: the push the last frame needed, m (it eases off). */
export interface FrontKeeper {
  /** Moves the pose clear of the fronts: `dt` 0 or less is a cut (the push is exactly what is needed). */
  apply(pose: CameraPose, dt: number, hintEdge: number | undefined): CameraPose;
  /** Forgets the eased push (a new road, a respawn). */
  reset(): void;
}

export function createFrontKeeper(getRoad: () => RoadNetwork | null, params: FrontParams): FrontKeeper {
  let eased = 0;
  return {
    reset() {
      eased = 0;
    },
    apply(pose, dt, hintEdge) {
      const road = getRoad();
      if (!road || !(params.keepClearOfFronts > 0)) {
        eased = 0;
        return pose;
      }
      // Nothing to hold off on an edge with no street tag: the rider's own edge, where the camera is.
      if (hintEdge !== undefined && eased <= 1e-4 && !hasFronts(road, hintEdge)) {
        eased = 0;
        return pose;
      }
      const at = road.project(pose.x, pose.z, hintEdge);
      const side = at.d < 0 ? 'left' : 'right';
      const limit = frontLimitM(road, at.edge, at.s, side, params);
      const need = limit === null ? 0 : Math.max(0, Math.abs(at.d) - limit);
      eased = dt > 0 ? Math.max(need, eased * Math.exp(-FRONT_EASE_RATE * dt)) : need;
      if (!(eased > 1e-4) || !(Math.abs(at.d) > 0)) return pose;
      // Toward the centre line, along the road's across direction at the camera (it follows a bend).
      const sign = at.d < 0 ? -1 : 1;
      const here = road.toWorld(at.edge, at.s, at.d, 0);
      const there = road.toWorld(at.edge, at.s, at.d - sign * Math.min(eased, Math.abs(at.d)), 0);
      const dx = there.x - here.x;
      const dz = there.z - here.z;
      if (!Number.isFinite(dx) || !Number.isFinite(dz)) return pose;
      return { ...pose, x: pose.x + dx, z: pose.z + dz };
    },
  };
}
