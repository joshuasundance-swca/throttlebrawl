// camera: camera modes as small rigs that read only the interpolated snapshot and the road
// (docs/architecture.md, "Camera"). M1 builds the low chase cam (camera-1): a critically damped
// spring aimed at a look-ahead point on the road, roll at a fraction of the bike's lean, an FOV
// kick with speed, a framing bias toward the auto-target, and event shake scaled by
// camera.shakeScale. M2 (camera-2) adds look-back on the held action, a takedown framing that holds
// the victim in view through the slow motion, a directional hit jolt, and the reduce-shake setting
// (setShakeAmount). M3 (camera-3) adds the far chase and helmet views, picked by the `camera.mode`
// slider, setView/cycleView, and the view key (bindViewKey). The replay cams are later modes.
import type { RoadNetwork, SimEvent, TuningParamDecl } from '../sim/api';
import {
  createChaseRig,
  VIEW_MODES,
  viewOf,
  type CameraContext,
  type CameraPose,
  type CameraTarget,
  type ChaseParams,
  type RigMode,
  type ViewMode,
} from './chase';

export type { CameraContext, CameraPose, CameraTarget, ViewMode } from './chase';
export { VIEW_MODES, wideAmount } from './chase';
export { bindViewKey, CAMERA_VIEW_KEY } from './keys';
export { FALLBACK_IMPULSE } from './jolt';
export { SHAKE_TRAUMA } from './shake';

/**
 * Camera modes. M1 built the chase cam; M2 (camera-2) adds look-back (the held action) and the
 * takedown framing; M3 (camera-3) the far chase and helmet views. The architecture doc lists the
 * rest (replayCinematic).
 */
export type CameraMode = RigMode;

// Every constant of the rig is a tuning parameter [default] (docs/architecture.md, "Camera").
// None affects the sim, so they never enter SimConfig or a replay's outcome.
const decl = (
  key: keyof ChaseParams,
  label: string,
  def: number,
  min: number,
  max: number,
  step: number,
  unit: string,
): TuningParamDecl => ({
  id: `camera.${key}`,
  group: 'camera',
  label,
  default: def,
  min,
  max,
  step,
  unit,
  affectsSim: false,
});

// Playtest 1 (2026-09-30) [decided]: "Camera too low to see oncoming traffic". M1's 5.5 m back and
// 1.6 m up put the camera below the rider's helmet (about 1.9 m), so the rider hid the horizon
// where oncoming traffic appears. At 7 m back and 2.6 m up the sight line to a car 125 m ahead
// (the reaction range) clears the helmet with room to spare (reaction-range.test.ts).
export const CAMERA_TUNING: readonly TuningParamDecl[] = [
  decl('chaseDistanceM', 'Chase distance', 7, 3, 14, 0.25, 'm'),
  decl('heightM', 'Camera height', 2.6, 0.8, 5, 0.1, 'm'),
  decl('lookAheadM', 'Look-ahead', 18, 5, 40, 1, 'm'),
  decl('lookHeightM', 'Aim height', 0.9, 0, 3, 0.1, 'm'),
  decl('springRate', 'Camera stiffness', 5, 1, 15, 0.5, '1/s'),
  decl('rollFraction', 'Roll with lean', 0.3, 0, 0.6, 0.05, ''),
  decl('fovBaseDeg', 'Field of view', 60, 45, 80, 1, '°'),
  decl('fovKickDeg', 'Speed FOV kick', 12, 0, 25, 1, '°'),
  decl('fovKickSpeedMps', 'Full kick at', 38, 10, 80, 1, 'm/s'),
  decl('targetBias', 'Target framing', 0.35, 0, 1, 0.05, ''),
  decl('shakeScale', 'Camera shake', 1, 0, 2, 0.05, ''),
  // camera-2 (docs/milestones/M2.md) [default]: look-back, the takedown framing and the hit jolt.
  decl('lookBackDistanceM', 'Look-back: ahead of rider', 2.5, 1, 8, 0.25, 'm'),
  decl('lookBackHeightM', 'Look-back: height', 2.3, 1, 4, 0.1, 'm'),
  decl('lookBackAimM', 'Look-back: aim behind', 25, 5, 60, 1, 'm'),
  decl('takedownDistanceM', 'Takedown cam distance', 9, 4, 20, 0.5, 'm'),
  decl('takedownHeightM', 'Takedown cam height', 3.6, 1.5, 8, 0.1, 'm'),
  decl('takedownSwingDeg', 'Takedown cam swing', 30, 0, 75, 1, '°'),
  decl('takedownFocus', 'Takedown: aim at victim', 0.6, 0, 1, 0.05, ''),
  decl('takedownBlendS', 'Takedown cam blend', 0.3, 0.05, 1, 0.05, 's'),
  decl('takedownHoldS', 'Takedown hold (no slow-mo)', 1, 0.3, 3, 0.1, 's'),
  decl('joltM', 'Hit jolt', 0.35, 0, 1, 0.05, 'm'),
  decl('joltFullImpulse', 'Full jolt at hit strength', 0.9, 0.1, 2, 0.05, ''),
  decl('joltRate', 'Jolt snap-back', 14, 4, 30, 1, '1/s'),
  // Playtest 1 item 11 [decided]: "phone may just be harder". A wide, short phone-landscape view
  // gets a camera higher and further back; a laptop-shaped one is unchanged.
  decl('wideAspectFrom', 'Phone cam: from aspect', 1.9, 1.3, 2.5, 0.05, ''),
  decl('wideAspectFull', 'Phone cam: full at aspect', 2.1, 1.4, 2.8, 0.05, ''),
  decl('wideHeightM', 'Phone cam: extra height', 0.6, 0, 3, 0.1, 'm'),
  decl('wideDistanceM', 'Phone cam: extra distance', 1, 0, 5, 0.25, 'm'),
  // Air that pays (the pitch deck's #13) [default]: "Over a crest the camera tips forward". In the
  // air the aim drops and the camera rises, in full from airTipFullM over the road below.
  decl('airTipM', 'Air: tip forward (aim lower)', 2.5, 0, 8, 0.25, 'm'),
  decl('airLiftM', 'Air: camera lift', 0.8, 0, 3, 0.1, 'm'),
  decl('airTipFullM', 'Air: full tip from height', 2, 0.25, 8, 0.25, 'm'),
  // Playtest 3 [default]: braking into a hairpin is "a first class experience". In a drift the
  // camera slides outside the corner, aims into it and rolls on with the slip (driftRoll is the
  // roll per radian of slip, so full slip, 0.6 rad, rolls 0.12 rad more); on a wheelie it pulls back
  // and looks up with the nose, in full at the sweet band's middle. Reduce-motion halves them.
  decl('driftRoll', 'Drift: extra roll per rad of slip', 0.2, 0, 0.5, 0.05, ''),
  decl('driftSideM', 'Drift: camera slides outside', 1, 0, 3, 0.1, 'm'),
  decl('driftAimM', 'Drift: aim swings into the corner', 1.5, 0, 4, 0.1, 'm'),
  decl('wheelieBackM', 'Wheelie: camera pulls back', 1, 0, 3, 0.1, 'm'),
  decl('wheelieAimM', 'Wheelie: aim rises', 0.9, 0, 3, 0.1, 'm'),
  decl('wheelieFovDeg', 'Wheelie: extra field of view', 4, 0, 12, 0.5, '°'),
  // Playtest 4, P4-9 [default]: "Lombard's hairpins feel impossible to control smoothly". The aim
  // shortens on a bend tighter than this radius (radius over this, down to the floor); 0 is off.
  decl('tightBendRadiusM', 'Tight bends: shorten look-ahead under radius (0 off)', 30, 0, 100, 1, 'm'),
  decl('tightBendMinShare', 'Tight bends: shortest look-ahead share', 0.3, 0.1, 1, 0.05, ''),
  // camera-3 (docs/milestones/M3.md) [default]: the far chase and helmet views. Until ui adds a
  // settings row, the view is this slider (0 low chase, 1 far chase, 2 helmet) and the view key.
  decl('mode', 'View: 0 chase, 1 far, 2 helmet', 0, 0, VIEW_MODES.length - 1, 1, ''),
  decl('farDistanceM', 'Far chase: distance', 11, 6, 25, 0.25, 'm'),
  decl('farHeightM', 'Far chase: height', 4.2, 2, 10, 0.1, 'm'),
  decl('farLookAheadM', 'Far chase: look-ahead', 28, 5, 60, 1, 'm'),
  decl('helmetHeightM', 'Helmet cam: eye height', 1.78, 1.5, 2.1, 0.02, 'm'),
  decl('helmetForwardM', 'Helmet cam: eye forward', 0.1, -0.2, 0.4, 0.02, 'm'),
  // 2026-10-05 [default] (the maintainer: "in first person helmet view it seems easy to clip through
  // cars"): how far the eye swings sideways with the lean, inside the rider's 0.4 m half-width
  // contact box with 0.2 m to spare (chase.ts helmetPlacement; tests/sim/helmet-traffic.test.ts).
  decl('helmetReachM', 'Helmet cam: farthest the eye leans out', 0.2, 0, 1.3, 0.05, 'm'),
  decl('helmetLookAheadM', 'Helmet cam: look-ahead', 30, 8, 60, 1, 'm'),
  decl('helmetAimHeightM', 'Helmet cam: aim height', 1.1, 0, 2, 0.1, 'm'),
  decl('helmetFovDeg', 'Helmet cam: field of view', 70, 50, 95, 1, '°'),
  decl('helmetRollFraction', 'Helmet cam: roll with lean', 0.5, 0, 1, 0.05, ''),
  decl('helmetCalm', 'Helmet cam: calm under reduce-shake', 0.3, 0, 1, 0.05, ''),
  // M5's a11y-1: the share of the chase and far views' lean roll and speed FOV kick that the
  // Reduce motion setting leaves. [default] 30 %, the helmet view's own share.
  decl('motionCalm', 'Chase cams: roll and FOV kick left under reduce-motion', 0.3, 0, 1, 0.05, ''),
];

export interface FollowCamera {
  /** The mode whose framing the last update showed. */
  readonly mode: CameraMode;
  /**
   * Moves the camera toward its target; `dt` is the real frame time in seconds (clamped to 0.25,
   * and 0 or NaN holds the springs). `ctx.entities` lets it frame the rider's auto-target, a
   * takedown's victim and a hit's attacker; `ctx.lookBack` is the held look-back action.
   */
  update(target: CameraTarget, dt: number, ctx?: CameraContext): CameraPose;
  /** Jumps straight to the target's ideal framing and clears any shake (race start, a respawn). */
  snap(target: CameraTarget, ctx?: CameraContext): CameraPose;
  /** Hands the camera a tick's sim events; the ones involving the followed rider shake it. */
  onEvents(events: readonly SimEvent[]): void;
  /** The road handle to aim along; null falls back to the rider's heading. */
  setRoad(road: RoadNetwork | null): void;
  /** Applies a `camera.*` tuning value; other ids are ignored. */
  setParam(id: string, value: number): void;
  /**
   * The player's reduce-screen-shake setting, from 1 (full shake and hit jolt) to 0 (none). It
   * multiplies `camera.shakeScale`; values outside 0..1 are clamped, and NaN means 1.
   */
  setShakeAmount(amount: number): void;
  /**
   * The player's reduce-motion setting, from 1 (full motion) to 0 (reduced): the chase and far
   * views' lean roll and speed FOV kick shrink to `camera.motionCalm`, and the helmet view and the
   * drift and wheelie moves calm as they do under reduce-shake. Clamped to 0..1; NaN means 1. It
   * does not touch the shake and the jolt: app/ sets those through `setShakeAmount` too.
   */
  setMotionAmount(amount: number): void;
  /** The chosen base view (`camera.mode`); `mode` says what the last frame showed. */
  readonly view: ViewMode;
  /** Picks the base view. A later `camera.mode` tuning change overrides it. */
  setView(view: ViewMode): void;
  /** Steps to the next base view (low chase, far chase, helmet, then round) and returns it. */
  cycleView(): ViewMode;
}

export interface FollowCameraOptions {
  road?: RoadNetwork | null;
}

function defaults(): ChaseParams {
  const p: Record<string, number> = {};
  for (const d of CAMERA_TUNING) p[d.id.slice('camera.'.length)] = d.default;
  return p as unknown as ChaseParams;
}

/**
 * The chase cam with its M2 modes and M3 views. The name is the skeleton's; the rig is camera-1's,
 * camera-2's and camera-3's.
 */
export function createFollowCamera(opts: FollowCameraOptions = {}): FollowCamera {
  const params = defaults();
  const rig = createChaseRig(params, opts.road ?? null);
  const setView = (view: ViewMode): void => {
    const i = VIEW_MODES.indexOf(view);
    if (i >= 0) params.mode = i;
  };
  return {
    get mode() {
      return rig.mode;
    },
    get view() {
      return viewOf(params.mode);
    },
    setView,
    cycleView() {
      const next =
        VIEW_MODES[(VIEW_MODES.indexOf(viewOf(params.mode)) + 1) % VIEW_MODES.length] ?? 'lowChase';
      setView(next);
      return next;
    },
    setShakeAmount: (amount) => rig.setShakeAmount(amount),
    setMotionAmount: (amount) => rig.setMotionAmount(amount),
    update: (t, dt, ctx) => rig.update(t, dt, ctx),
    snap: (t, ctx) => rig.snap(t, ctx),
    onEvents: (events) => rig.onEvents(events),
    setRoad: (road) => rig.setRoad(road),
    setParam(id, value) {
      if (!id.startsWith('camera.') || !Number.isFinite(value)) return;
      const key = id.slice('camera.'.length);
      if (key in params) (params as unknown as Record<string, number>)[key] = value;
    },
  };
}
