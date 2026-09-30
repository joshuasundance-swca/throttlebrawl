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
  lookBack: boolean;
  skipRunBack: boolean;
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
  if (a.kick) flags |= InputFlag.kick;
  if (a.lookBack) flags |= InputFlag.lookBack;
  if (a.skipRunBack) flags |= InputFlag.skipRunBack;
  return quantizeInput({ steer: a.steer, throttle: a.throttle, brake: a.brake, flags });
}
