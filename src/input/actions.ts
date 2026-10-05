// The action state (docs/architecture.md, "Input", step 2): every device writes into one of these
// per tick, and it becomes one quantized SimInput.
import { InputFlag, quantizeInput, type SimInput } from '../sim/api';

export interface ActionState {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** A press edge: true on exactly one tick per press. */
  attack: boolean;
  /** -1 forced left, 1 forced right, 0 auto-target side. Level-held while the gesture holds. */
  attackSide: -1 | 0 | 1;
  /** Level-held while the kick gesture or key holds. */
  kick: boolean;
  /**
   * The straight kick at the rider ahead (playtest 2's directional kick: a swipe UP, the I key, L1),
   * level-held like `kick`. It reaches the sim as the kick flag plus BOTH side flags. Optional, so
   * hand-built action states stay valid.
   */
  kickStraight?: boolean;
  lookBack: boolean;
  skipRunBack: boolean;
  /**
   * A press edge for the camera's next view (camera-3's views; the C key, a gamepad button).
   * Presentation only: it never reaches the SimInput, so a replay does not record it.
   */
  cycleCamera?: boolean;
  /**
   * The wheelie (playtest 4, P4-7: the wheelie button, a held key or pad button): level-held while the
   * button is. It reaches the sim as InputFlag.wheelie (hold lifts the front, release drops it); the
   * throttle stays the throttle. Optional, so hand-built action states stay valid.
   */
  wheelie?: boolean;
}

export function emptyActions(): ActionState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    attack: false,
    attackSide: 0,
    kick: false,
    lookBack: false,
    skipRunBack: false,
  };
}

/** Converts an action state to the quantized command the sim steps on. */
export function toSimInput(a: ActionState): SimInput {
  let flags = 0;
  if (a.attack) flags |= InputFlag.attack;
  if (a.attackSide < 0) flags |= InputFlag.attackSideLeft;
  if (a.attackSide > 0) flags |= InputFlag.attackSideRight;
  if (a.kick || a.kickStraight) flags |= InputFlag.kick;
  if (a.kickStraight) flags |= InputFlag.attackSideLeft | InputFlag.attackSideRight;
  if (a.lookBack) flags |= InputFlag.lookBack;
  if (a.skipRunBack) flags |= InputFlag.skipRunBack;
  if (a.wheelie) flags |= InputFlag.wheelie;
  return quantizeInput({ steer: a.steer, throttle: a.throttle, brake: a.brake, flags });
}
