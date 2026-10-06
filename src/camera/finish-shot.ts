// The finish shot (playtest 4, run C's live check: "Coit Tower is never seen whole"). A landmark that stands
// right by a finish line is too tall for a camera that follows the road: Coit Tower is 64 m high and 25 m from the
// Lombard line, so its top is 57 degrees up, and the chase camera's frame ends near 36. So a landmark can ask to
// be framed (`params.frameHeightM`, the landmark's height in metres): when the player crosses the finish within
// reach of it, the camera holds where it is and turns up to the whole landmark over `SHOT_EASE_TICKS`, widening
// its field only as far as the landmark needs, and stays there for the two seconds before the results.
//
// It is the camera's, never the sim's: the shot reads a landmark feature and the live pose and nothing else, runs
// on the player's own screen only, and no replay, hash or sim state reads it. [default] A taste call for the
// maintainer (a veto removes the one `frameHeightM`).
import type { RoadNetwork } from '../road';
import type { CameraPose } from './chase';

/** A landmark that asks to be framed: its base's middle, its height and the half width of its footprint, m. */
export interface ShotFocus {
  x: number;
  y: number;
  z: number;
  heightM: number;
  radiusM: number;
}

/** The ease from the chase view to the shot, in sim ticks: 0.4 s. [default] */
export const SHOT_EASE_TICKS = 24;
/** A finish within this far of a landmark (its middle, on the ground) gets the shot, m. [default] */
export const SHOT_REACH_M = 90;
/** Room left past the landmark's top and base, and past its sides, degrees. [default] */
export const SHOT_MARGIN_DEG = 6;
/** The widest field the shot may use, degrees (a wider one bends the road at the frame's edge). [default] */
export const SHOT_MAX_FOV_DEG = 100;
/** How far ahead the shot's aim point lies, m. */
const AIM_M = 60;

const RAD = Math.PI / 180;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Every landmark of a road that asks to be framed (`params.frameHeightM`), on the ground at its footprint's middle. */
export function shotFociOf(road: RoadNetwork): ShotFocus[] {
  const out: ShotFocus[] = [];
  for (const e of road.edges) {
    for (const f of road.featuresOf(e.index, 'landmark')) {
      const h = f.params?.['frameHeightM'];
      if (!finite(h) || h <= 0) continue;
      const at = road.toWorld(e.index, (f.s0 + f.s1) / 2, (f.d0 + f.d1) / 2, 0);
      const baseY = f.params?.['baseY'];
      out.push({
        x: at.x,
        y: finite(baseY) ? baseY : at.y,
        z: at.z,
        heightM: h,
        radiusM: Math.hypot(f.s1 - f.s0, f.d1 - f.d0) / 2,
      });
    }
  }
  return out;
}

/** The landmark nearest a finish point that is within `reachM` of it, or null. */
export function nearestFocus(
  foci: readonly ShotFocus[],
  x: number,
  z: number,
  reachM: number,
): ShotFocus | null {
  let best: ShotFocus | null = null;
  let bestD = reachM;
  for (const f of foci) {
    const d = Math.hypot(f.x - x, f.z - z);
    if (d <= bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

/**
 * The camera's pose `progress` of the way (0 to 1, eased) from the held chase pose to the shot of `focus`: the
 * camera stays where it was, aims between the landmark's base and top, and has the field its height needs on a
 * screen of `aspect` (never narrower than the chase view's own).
 */
export function shotPose(held: CameraPose, focus: ShotFocus, aspect: number, progress: number): CameraPose {
  const p = Math.min(1, Math.max(0, progress));
  const w = p * p * (3 - 2 * p);
  if (w === 0) return { ...held };
  const dx = focus.x - held.x;
  const dz = focus.z - held.z;
  const dist = Math.max(1, Math.hypot(dx, dz));
  // The landmark's nearest face and farthest side, for the steepest and the shallowest sight lines.
  const near = Math.max(1, dist - focus.radiusM);
  const far = dist + focus.radiusM;
  const topY = focus.y + focus.heightM - held.y;
  const baseY = focus.y - held.y;
  const up = Math.atan2(topY, near);
  const down = Math.min(Math.atan2(baseY, near), Math.atan2(baseY, far));
  const centre = (up + down) / 2;
  const margin = SHOT_MARGIN_DEG * RAD;
  const halfUp = (up - down) / 2 + margin;
  // The width the same way: the landmark's sides seen from its nearest face, in the frame's width.
  const halfAcross = Math.atan(focus.radiusM / near) + margin;
  const halfNeeded = Math.max(halfUp, Math.atan(Math.tan(halfAcross) / Math.max(0.5, aspect)));
  const fov = Math.min(SHOT_MAX_FOV_DEG, Math.max(held.fov, (2 * halfNeeded) / RAD));
  const ux = dx / dist;
  const uz = dz / dist;
  const aim = {
    x: held.x + ux * Math.cos(centre) * AIM_M,
    y: held.y + Math.sin(centre) * AIM_M,
    z: held.z + uz * Math.cos(centre) * AIM_M,
  };
  const l = (a: number, b: number): number => a + (b - a) * w;
  // The roll eases out and the up vector with it (a held pose can be leaning).
  const upX = l(held.upX, 0);
  const upY = l(held.upY, 1);
  const upZ = l(held.upZ, 0);
  const upLen = Math.hypot(upX, upY, upZ) || 1;
  return {
    x: held.x,
    y: held.y,
    z: held.z,
    lookX: l(held.lookX, aim.x),
    lookY: l(held.lookY, aim.y),
    lookZ: l(held.lookZ, aim.z),
    fov: l(held.fov, fov),
    roll: l(held.roll, 0),
    upX: upX / upLen,
    upY: upY / upLen,
    upZ: upZ / upLen,
  };
}
