// The U-turn button (the maintainer, 2026-10-05: "can we customize keyboard settings and stuff? I want
// to be sure it's a joy to play and use all functions"). The U-turn's own gesture is a double tap of
// the brake, the second press held with the bars at full lock (sim/riders/uturn.ts, playtest 4 P4-9
// [decided]). That stays the gesture, and it still works from any brake binding. This is a key or
// pad button that makes the same gesture for the player: held, it first brakes straight long enough
// to retire a previous tap, releases, then taps, releases and holds the brake. The preparation stops
// a prior brake press from consuming its first edge (docs/milestones/uturn-shortcut-handoff.md).
// The player only holds it and steers the way round. It writes the brake and the bars
// into the action state like any other device, so the sim and a replay see the same SimInput the
// two taps make; nothing new reaches the sim. [default]
import type { ActionState } from './actions';

/** Longer than the sim's short-tap window: retire a first tap without starting a turn. */
const RESET_END_S = 0.4;
/** Releasing also retires an armed second press before the shortcut makes its own gesture. */
const RESET_GAP_END_S = RESET_END_S + 0.05;
/** The new first tap lasts about three ticks at 60 Hz. */
const TAP_END_S = RESET_GAP_END_S + 0.04;
/** About three more ticks of release, then the shortcut holds the brake with the player's steer. */
const GAP_END_S = TAP_END_S + 0.05;

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
    if (this.t < RESET_END_S) {
      a.brake = 1;
      a.steer = 0;
    } else if (this.t < RESET_GAP_END_S) {
      a.brake = 0;
      a.steer = 0;
    } else if (this.t < TAP_END_S) {
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
