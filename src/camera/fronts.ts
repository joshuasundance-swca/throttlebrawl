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
//
// The physical world (the maintainer, 2026-10-06, [decided]: a road race in a physical world with honest
// edges): a rider can be on a building's roof, and the tag rule knows no height. With the race's structures
// plan (`CameraContext.structures`, the road's data) the fronts the plan holds are kept clear as what they are,
// solids, and the tag no longer decides for them:
// - a camera beside a planned front is held out of the plan's solids, not at the sidewalk's line: on a roof past
//   the line the eye stays beside the rider instead of hanging 5 m off over the street, and a front's gap is
//   open. The eye's arm (the rider's body to the eye) is cut short at the first solid it meets, padded by the
//   renderer's near plane (`EYE_CLEARANCE_M`), and eased back out at `FRONT_EASE_RATE` when it is clear, so a
//   tower beside a low roof is never inside the view, nor a wall between the rider and the camera;
// - the helmet eye, which sits in the rider's head and was never moved, is kept the near plane's distance off a
//   face by leaning out less, never more than its own reach;
// - the fronts the plan does not hold (the row and painted houses, the gardens: render's scatter, walls at any
//   height in the sim) keep the tag rule, and a camera with no plan is the camera as it was.
import type { BakedTag, RoadNetwork, StructurePlan } from '../road';
import type { CameraPose } from './chase';
import { armClear, escapeSolids, eyeHeightShare, keepInView, pushedClear } from './solids';

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

/**
 * The front tags whose buildings the structures plan holds (some layer of `STRUCTURE_LAYERS` in road/structures.ts
 * asks for them): the fronts a camera with the plan keeps clear as solids. The rest of `FRONT_TAGS` (the row and
 * painted houses, the gardens) are render's scatter and stay the tag rule. fronts.test.ts holds this list to the
 * layer table.
 */
export const PLANNED_FRONT_TAGS: ReadonlySet<string> = new Set([
  'cable-crossing',
  'cafes',
  'cross-street',
  'key-oldtown',
  'lanterns',
  'mascot-mural',
  'murals',
  'pdx-blocks',
  'plaza',
  'shopfronts',
  'side-street',
  'towers',
]);

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
function frontThemeAt(
  tags: readonly BakedTag[],
  side: 'left' | 'right',
  s: number,
): { theme: string; planned: boolean } | null {
  let theme: string | null = null;
  // Planned unless some front tag on the side is one the plan does not hold.
  let planned = true;
  for (const t of tags) {
    if (!covers(t, side, s)) continue;
    if (t.tag.startsWith('water')) return null;
    const found = Object.hasOwn(FRONT_TAGS, t.tag) ? FRONT_TAGS[t.tag] : undefined;
    if (found !== undefined) {
      if (!PLANNED_FRONT_TAGS.has(t.tag)) planned = false;
      if (theme !== 'oldtown') theme = found;
    }
  }
  return theme === null ? null : { theme, planned };
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
  /** The camera has the race's structures plan: the fronts it holds are kept clear as solids, not by the tag. */
  planned = false,
): number | null {
  const e = road.edges[edge];
  if (!e) return null;
  const verge = road.vergeAt(edge, s, side);
  if (!(verge.widthM > 0)) return null;
  const found = frontThemeAt(e.tags, side, s);
  if (found === null) return null;
  if (planned && found.planned) return null;
  const theme = found.theme;
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

/**
 * What the rule knows of the race's world beyond the road's tags: the structures plan (null or empty: the camera
 * as it was), the point the eye hangs from (the rider's body), so the eye's arm can be tested against the
 * solids, and whether the eye is the helmet's, which sits in the rider's head and is leaned clear of a face,
 * never moved otherwise.
 */
export interface FrontScene {
  plan: StructurePlan | null;
  pivot: { x: number; y: number; z: number };
  helmet: boolean;
}

/**
 * How far off the middle of the frame the rider may be once the solids have moved the eye, as a share of the
 * frame's half height [default]: half of it.
 */
const VIEW_SHARE = 0.5;

/** The arm is never cut shorter than this (the eye stays out of the rider's own body), m [default]. */
const MIN_ARM_M = 0.6;

/** The clearance rule's own state: the push the last frame needed, m (it eases off), and the arm's cut. */
export interface FrontKeeper {
  /**
   * Moves the pose clear of the fronts: `dt` 0 or less is a cut (the push is exactly what is needed). With a
   * `scene` that has a plan, the fronts the plan holds are kept clear as solids (see the top of this file).
   */
  apply(pose: CameraPose, dt: number, hintEdge: number | undefined, scene?: FrontScene): CameraPose;
  /** Forgets the eased push (a new road, a respawn). */
  reset(): void;
}

export function createFrontKeeper(getRoad: () => RoadNetwork | null, params: FrontParams): FrontKeeper {
  let eased = 0;
  /** How much of the eye's arm the solids cut off last frame, m (it eases back out). */
  let armCut = 0;
  /** The share of the eye's height over the rider the solids took off last frame (a ceiling), 0 to 1 (it eases back). */
  let heightLoss = 0;

  /** The tag rule: held at the sidewalk's line beside a street's fronts (the plan's own fronts excepted). */
  const byTags = (
    road: RoadNetwork,
    pose: CameraPose,
    dt: number,
    hintEdge: number | undefined,
    planned: boolean,
  ): CameraPose => {
    // Nothing to hold off on an edge with no street tag: the rider's own edge, where the camera is.
    if (hintEdge !== undefined && eased <= 1e-4 && !hasFronts(road, hintEdge)) {
      eased = 0;
      return pose;
    }
    const at = road.project(pose.x, pose.z, hintEdge);
    const side = at.d < 0 ? 'left' : 'right';
    const limit = frontLimitM(road, at.edge, at.s, side, params, planned);
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
  };

  /** The solids: the eye's arm cut short at the first one it meets, eased back out. */
  const bySolids = (
    plan: StructurePlan,
    pose: CameraPose,
    dt: number,
    pivot: FrontScene['pivot'],
  ): CameraPose => {
    const dx = pose.x - pivot.x;
    const dy0 = pose.y - pivot.y;
    const dz = pose.z - pivot.z;
    // Under a ceiling (a balcony's slab over a rider thrown beneath it) the eye comes down first: the share of
    // its height it loses comes on at once and eases back, like the arm's cut.
    const wantLoss = dy0 > 0.05 ? 1 - eyeHeightShare(plan, pivot, pose) : 0;
    heightLoss = dt > 0 ? Math.max(wantLoss, heightLoss * Math.exp(-FRONT_EASE_RATE * dt)) : wantLoss;
    if (!(heightLoss > 1e-4)) heightLoss = 0;
    const dy = dy0 * (1 - heightLoss);
    const low = heightLoss > 0 ? { ...pose, y: pivot.y + dy } : pose;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > MIN_ARM_M)) {
      armCut = 0;
      return outOfSolids(plan, low);
    }
    const clear = armClear(plan, pivot, low);
    const need = Math.min(len - MIN_ARM_M, (1 - clear) * len);
    // The cut comes on in the frame it is needed and eases off when it is not, as the tag rule's push does.
    armCut = dt > 0 ? Math.max(need, armCut * Math.exp(-FRONT_EASE_RATE * dt)) : need;
    if (!(armCut > 1e-4)) return outOfSolids(plan, low);
    const k = Math.max(MIN_ARM_M, len - armCut) / len;
    return outOfSolids(plan, { ...pose, x: pivot.x + dx * k, y: pivot.y + dy * k, z: pivot.z + dz * k });
  };

  /**
   * An eye still inside a solid after all that (the rider himself was left inside it, where the arm has no clear
   * side to be cut from) is moved out by the shortest way.
   */
  const outOfSolids = (plan: StructurePlan, pose: CameraPose): CameraPose => {
    const out = escapeSolids(plan, pose);
    return out.x === pose.x && out.y === pose.y && out.z === pose.z ? pose : { ...pose, ...out };
  };

  return {
    reset() {
      eased = 0;
      armCut = 0;
      heightLoss = 0;
    },
    apply(pose, dt, hintEdge, scene) {
      const road = getRoad();
      if (!road || !(params.keepClearOfFronts > 0)) {
        eased = 0;
        armCut = 0;
        heightLoss = 0;
        return pose;
      }
      const plan = scene?.plan && scene.plan.items.length > 0 ? scene.plan : null;
      if (scene && plan && scene.helmet) {
        // The eye in the head: leaned out less, never moved otherwise (the rider's box holds it out of a building).
        const pushed = pushedClear(plan, pose.x, pose.y, pose.z);
        return pushed ? { ...pose, x: pushed.x, z: pushed.z } : pose;
      }
      const tagged = byTags(road, pose, dt, hintEdge, plan !== null);
      if (!scene || !plan) {
        armCut = 0;
        heightLoss = 0;
        return tagged;
      }
      const solved = bySolids(plan, tagged, dt, scene.pivot);
      // An eye the solids moved is not where the aim was made for: the rider stays within `VIEW_SHARE` of the
      // frame's half height of its middle.
      return solved === tagged
        ? solved
        : keepInView(solved, scene.pivot, (VIEW_SHARE * pose.fov * Math.PI) / 360);
    },
  };
}
