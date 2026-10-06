// The finish shot (playtest 4, run C's live check: "Coit Tower is never seen whole"). A landmark that stands
// right by a finish line is too tall for a camera that follows the road: Coit Tower is 64 m high and 25 m from the
// Lombard line, so its top is 57 degrees up, and the chase camera's frame ends near 36. So a landmark can ask to
// be framed (`params.frameHeightM`, the landmark's height in metres): when the player crosses the finish within
// reach of it, the camera backs off along the road it rode in on, rises a little with it and turns up to the whole
// landmark over `SHOT_EASE_TICKS`, keeping the chase view's own field of view, and stays there for the two seconds
// before the results.
//
// The first shot widened the field to 86 degrees instead, and the fix check found it bent the houses at the right
// of the frame steeply (2026-10-06, the maintainer kept the shot: "Keep all of these"). So the field now stays at
// the chase view's own and never passes `SHOT_MAX_FOV_DEG`; the camera pulls back to fit the landmark instead.
//
// It is the camera's, never the sim's: the shot reads a landmark feature and the live pose and nothing else, runs
// on the player's own screen only, and no replay, hash or sim state reads it. [decided] kept (the maintainer,
// 2026-10-06: "Keep all of these (Recommended)"); the framing is `[default]` (a veto removes the one `frameHeightM`).
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
/**
 * The widest field the shot may use, degrees (a wider one bends the houses at the frame's edge steeply: the
 * first shot's 86 did). [default]
 */
export const SHOT_MAX_FOV_DEG = 75;
/** The narrowest field the shot holds, degrees: a slow finish's chase field is not narrowed past it. [default] */
export const SHOT_MIN_FOV_DEG = 55;
/** The farthest the shot backs the camera off along the way it came, m. [default] */
export const SHOT_PULLBACK_MAX_M = 90;
/** How far the camera rises for each metre it backs off, m. [default] */
export const SHOT_RISE_PER_M = 0.3;
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

/** Where the shot puts the camera and what it needs: the camera's place, its aim point and its field, degrees. */
export interface ShotTarget {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  fov: number;
  /** How far the camera backs off from where it was, m. */
  backM: number;
}

/** What a camera at (`px`, `py`, `pz`) needs to see the whole landmark: the aim's pitch (rad) and the field (deg). */
function frameFrom(
  px: number,
  py: number,
  pz: number,
  focus: ShotFocus,
  aspect: number,
): { centre: number; fovDeg: number } {
  const dist = Math.max(1, Math.hypot(focus.x - px, focus.z - pz));
  // The landmark's nearest face and farthest side, for the steepest and the shallowest sight lines.
  const near = Math.max(1, dist - focus.radiusM);
  const far = dist + focus.radiusM;
  const topY = focus.y + focus.heightM - py;
  const baseY = focus.y - py;
  const up = Math.atan2(topY, near);
  const down = Math.min(Math.atan2(baseY, near), Math.atan2(baseY, far));
  const margin = SHOT_MARGIN_DEG * RAD;
  const halfUp = (up - down) / 2 + margin;
  // The width the same way: the landmark's sides seen from its nearest face, in the frame's width.
  const halfAcross = Math.atan(focus.radiusM / near) + margin;
  const halfNeeded = Math.max(halfUp, Math.atan(Math.tan(halfAcross) / Math.max(0.5, aspect)));
  return { centre: (up + down) / 2, fovDeg: (2 * halfNeeded) / RAD };
}

/**
 * Where the shot ends for a held chase pose: the field stays the chase view's own (between `SHOT_MIN_FOV_DEG` and
 * `SHOT_MAX_FOV_DEG`), and the camera backs off along the way it looked from (the road it rode in on) and rises a
 * little with it, by the least that fits the whole landmark with its margin on a screen of `aspect`. A landmark
 * that would need more than `SHOT_PULLBACK_MAX_M` gets the backing that fits it best, then the widest field the
 * cap allows.
 */
export function shotTarget(held: CameraPose, focus: ShotFocus, aspect: number): ShotTarget {
  const goal = Math.min(SHOT_MAX_FOV_DEG, Math.max(SHOT_MIN_FOV_DEG, held.fov));
  // The way back: opposite the held camera's own look, on the ground plane; toward the road behind it.
  let bx = held.x - held.lookX;
  let bz = held.z - held.lookZ;
  if (Math.hypot(bx, bz) < 1e-6) {
    bx = held.x - focus.x;
    bz = held.z - focus.z;
  }
  const back = Math.hypot(bx, bz) || 1;
  bx /= back;
  bz /= back;
  let best = { b: 0, fovDeg: Infinity, centre: 0 };
  for (let b = 0; b <= SHOT_PULLBACK_MAX_M; b++) {
    const f = frameFrom(held.x + bx * b, held.y + SHOT_RISE_PER_M * b, held.z + bz * b, focus, aspect);
    if (f.fovDeg < best.fovDeg - 1e-9) best = { b, ...f };
    if (f.fovDeg <= goal) {
      best = { b, ...f };
      break;
    }
  }
  const px = held.x + bx * best.b;
  const py = held.y + SHOT_RISE_PER_M * best.b;
  const pz = held.z + bz * best.b;
  const dx = focus.x - px;
  const dz = focus.z - pz;
  const dist = Math.max(1, Math.hypot(dx, dz));
  return {
    x: px,
    y: py,
    z: pz,
    lookX: px + (dx / dist) * Math.cos(best.centre) * AIM_M,
    lookY: py + Math.sin(best.centre) * AIM_M,
    lookZ: pz + (dz / dist) * Math.cos(best.centre) * AIM_M,
    fov: Math.min(SHOT_MAX_FOV_DEG, Math.max(goal, best.fovDeg)),
    backM: best.b,
  };
}

/**
 * The camera's pose `progress` of the way (0 to 1, eased) from the held chase pose to the shot of `focus`: the
 * camera backs off and rises from where it was, aims between the landmark's base and top, and keeps the chase
 * view's own field, never wider than `SHOT_MAX_FOV_DEG`.
 */
export function shotPose(held: CameraPose, focus: ShotFocus, aspect: number, progress: number): CameraPose {
  const p = Math.min(1, Math.max(0, progress));
  const w = p * p * (3 - 2 * p);
  if (w === 0) return { ...held };
  const t = shotTarget(held, focus, aspect);
  const l = (a: number, b: number): number => a + (b - a) * w;
  // The roll eases out and the up vector with it (a held pose can be leaning).
  const upX = l(held.upX, 0);
  const upY = l(held.upY, 1);
  const upZ = l(held.upZ, 0);
  const upLen = Math.hypot(upX, upY, upZ) || 1;
  return {
    x: l(held.x, t.x),
    y: l(held.y, t.y),
    z: l(held.z, t.z),
    lookX: l(held.lookX, t.lookX),
    lookY: l(held.lookY, t.lookY),
    lookZ: l(held.lookZ, t.lookZ),
    fov: l(held.fov, t.fov),
    roll: l(held.roll, 0),
    upX: upX / upLen,
    upY: upY / upLen,
    upZ: upZ / upLen,
  };
}
