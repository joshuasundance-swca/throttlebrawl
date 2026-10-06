// The U-turn button (the maintainer, 2026-10-05: "can we customize keyboard settings and stuff? I want
// to be sure it's a joy to play and use all functions"). The U-turn's own gesture is a double tap of
// the brake, the second press held with the bars at full lock (sim/riders/uturn.ts, playtest 4 P4-9
// [decided]). That stays the gesture, and it still works from any brake binding. This is a key or
// pad button that makes the same gesture for the player: held, it taps the brake, lets go, then holds
// the brake, so the player only holds it and steers the way round. It writes the brake and the bars
// into the action state like any other device, so the sim and a replay see the same SimInput the
// two taps make; nothing new reaches the sim. [default]
import type { ActionState } from './actions';

/** The first tap lasts until this much of the hold has passed (3 ticks at 60 Hz). */
const TAP_END_S = 0.04;
/** The gap after the tap lasts until this much has passed (3 more ticks); then the brake holds. */
const GAP_END_S = 0.09;

/** One device's U-turn button: call `apply` once per sample with whether the button is held. */
export class UturnMacro {
  /** Seconds since the button went down, or -1 while it is up. */
  private t = -1;

  /** Writes this sample's part of the gesture into `a` (only while the button is held). */
  apply(a: ActionState, held: boolean, dt: number): void {
    if (!held) {
      this.t = -1;
      return;
    }
    this.t = this.t < 0 ? 0 : this.t + dt;
    if (this.t < TAP_END_S) {
      // The tap: brake on, bars straight (the sim reads a tap only with the bars under half lock).
      a.brake = 1;
      a.steer = 0;
    } else if (this.t < GAP_END_S) {
      a.brake = 0;
    } else {
      a.brake = 1;
    }
  }

  clear(): void {
    this.t = -1;
  }
}
