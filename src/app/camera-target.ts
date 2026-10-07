// What the camera is told about the player's rider each frame: the interpolated pose, and what the
// rig reads from the snapshot as it stands (src/camera imports only types, so it is fed data). Kept
// here, not inline in the loop, so a test can hold that what the sim publishes reaches the camera.
import type { CameraTarget } from '../camera';
import type { EntitySnapshot } from '../sim/api';

/** The interpolated entity, as render's `interpolateEntity` gives it. */
type Interpolated = Pick<CameraTarget, 'id' | 'x' | 'y' | 'z' | 'heading' | 'speed' | 'lean'>;

/**
 * The camera's target: the interpolated pose with the snapshot's mode, auto-target, road position, the
 * drift and wheelie (playtest 3's moves), and what lies below a rider in the air (`floorY`, so a roof he
 * is over counts: the maintainer, 2026-10-06, "land on it and ride on it").
 */
export function cameraTargetOf(me: Interpolated, at: EntitySnapshot | undefined): CameraTarget {
  return {
    ...me,
    mode: at?.mode,
    targetId: at?.targetId,
    road: at?.road,
    drift: at?.drift,
    wheelie: at?.wheelie,
    floorY: at?.floorY,
  };
}
