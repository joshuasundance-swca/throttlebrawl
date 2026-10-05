// The race-start countdown (playtest 4, P4-11; the maintainer: "Races should have a 3 2 1 go type
// countdown"). Every race holds at the grid while 3, 2, 1 count down, then GO. The hold belongs to
// app/, not to the sim: a held step is simply not a sim step, so the sim stays at tick 0 for every
// rider (the player, the field, the traffic, the cops), nothing is recorded until GO, and a replay
// starts on the first tick as it always did. Input sampled during the hold is dropped. The count is
// in loop steps (SIM_DT each), so the lockstep seam and a paused loop both keep it exact.
// [default] three beats of a second, GO shown for about 0.8 s once the race runs.

/** How many numbers count down before GO. */
export const COUNTDOWN_BEATS = 3;

/** What one loop step says about the countdown. */
export interface CountdownStep {
  /** True while the sim must stay at tick 0: this step is not a sim step. */
  hold: boolean;
  /** The number whose beat starts on this step (3, 2 or 1), for its sound, else null. */
  beat: number | null;
  /** What the screen should show from now on: "3", "2", "1", "GO", or "" for nothing; absent when unchanged. */
  show?: string;
}

export interface Countdown {
  /** Starts the count for a new race, or clears it (`on` false: the race runs at once). */
  begin(on: boolean): void;
  /** Called once per loop step before the sim would step. */
  step(): CountdownStep;
  /** Whether the next step will hold. */
  readonly holding: boolean;
}

/** `stepsPerBeat` loop steps make one beat; GO stays up `goSteps` sim steps after the hold. */
export function createCountdown(stepsPerBeat: number, goSteps: number): Countdown {
  const total = COUNTDOWN_BEATS * stepsPerBeat;
  let left = 0;
  let goLeft = 0;
  return {
    begin(on) {
      left = on ? total : 0;
      goLeft = 0;
    },
    step() {
      if (left > 0) {
        const elapsed = total - left;
        const beat = elapsed % stepsPerBeat === 0 ? COUNTDOWN_BEATS - elapsed / stepsPerBeat : null;
        left--;
        const out: CountdownStep = { hold: true, beat };
        if (beat !== null) out.show = String(beat);
        // The last held step puts GO up; the next step is the sim's tick 0.
        if (left === 0) {
          out.show = 'GO';
          goLeft = goSteps;
        }
        return out;
      }
      if (goLeft > 0 && --goLeft === 0) return { hold: false, beat: null, show: '' };
      return { hold: false, beat: null };
    },
    get holding() {
      return left > 0;
    },
  };
}
