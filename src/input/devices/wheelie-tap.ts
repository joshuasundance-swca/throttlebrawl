// The wheelie gesture's shared parts (playtest 3: "DOUBLE-TAP the throttle to pop it, then BALANCE it
// by thumb height"; docs/architecture.md, "Input"). The touch stick, the keyboard's throttle keys
// and the gamepad's R2 each recognise the same two taps; they differ only in what a "press" is.
//
// - A **tap** is a press that lifts within the window (`input.wheelieTapMs`, 280 ms). A long press is
//   a ride, so lifting off the gas for a corner and getting back on never pops a wheelie by accident
//   (the spec's risk 2: a wheelie from full gas loops out in 0.6 s).
// - The **pair**: a press that begins within the window of a tap's lift is the second press.
// - The **latch** raises `ActionState.wheelie` while the second press holds, once the throttle has
//   reached the sim's pop floor. The sim pops on the flag's rising edge and only if the throttle is
//   at least 0.3 on that tick, so a flag raised under the floor would be spent for nothing: the
//   latch waits for the thumb (or the key's ramp, or the trigger) to get there.

/**
 * The least throttle the sim pops a wheelie at (sim/riders/wheelie.ts, WHEELIE_MIN_THROTTLE, the
 * maintainer's 0.3 floor). It is a copy, not an import: input/ reads the sim only through sim/api.
 * A test pins the two equal.
 */
export const WHEELIE_FLOOR = 0.3;

/**
 * Whether `throttle` still reaches the floor after the sim's quantization (`quantizeInput` rounds to
 * 255 levels, and 76 of them read as 0.298), which is what the sim's check sees.
 */
export function reachesWheelieFloor(throttle: number): boolean {
  return Math.round(Math.min(1, Math.max(0, throttle)) * 255) / 255 >= WHEELIE_FLOOR;
}

/** Pairs a quick tap with the press that follows it. Times in one consistent unit: seconds or ms. */
export class TapPair {
  private pressedAt = Number.NEGATIVE_INFINITY;
  private tapLiftedAt = Number.NEGATIVE_INFINITY;

  /** A press began at `now`. True when it is the second of a pair (a tap lifted within `window`). */
  press(now: number, window: number): boolean {
    const second = now - this.tapLiftedAt <= window;
    this.tapLiftedAt = Number.NEGATIVE_INFINITY;
    this.pressedAt = now;
    return second;
  }

  /** The press lifted at `now`. A press that held no longer than `window` was a tap. */
  lift(now: number, window: number): void {
    this.tapLiftedAt = now - this.pressedAt <= window ? now : Number.NEGATIVE_INFINITY;
  }

  /** Forgets the taps (the window lost focus). */
  reset(): void {
    this.pressedAt = Number.NEGATIVE_INFINITY;
    this.tapLiftedAt = Number.NEGATIVE_INFINITY;
  }
}

/** The wheelie flag for one device: armed by a second press, raised once the throttle is there. */
export class WheelieLatch {
  private armed = false;
  private up = false;

  /** A new press began: armed when it is the second of a pair, and the flag starts down either way. */
  press(second: boolean): void {
    this.armed = second;
    this.up = false;
  }

  /** Drops the flag and the arming (the press ended, or the window lost focus). */
  release(): void {
    this.armed = false;
    this.up = false;
  }

  /**
   * This sample's flag. `held` is whether the second press still holds; `throttle` is the device's
   * own throttle, 0..1. Once raised it stays up while the press holds: the sim ignores it while the
   * front is up, and the throttle is what balances.
   */
  sample(held: boolean, throttle: number): boolean {
    if (!held) {
      this.release();
      return false;
    }
    if (this.armed && reachesWheelieFloor(throttle)) this.up = true;
    return this.up;
  }
}
