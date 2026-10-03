// The main loop (docs/architecture.md, "Fixed timestep and the loop"): an accumulator of real
// time clamped to 0.25 s per frame, at most 4 sim steps per frame (a backlog beyond that is
// dropped, so the game slows down rather than freezing), and interpolation alpha = min(1, acc/dt).

export const MAX_FRAME_S = 0.25;
export const MAX_STEPS_PER_FRAME = 4;
/** The most steps one lockstep frame may run (a minute of sim): a typo'd count cannot freeze the page. */
export const MAX_LOCKSTEP = 3600;

export interface FramePlan {
  steps: number;
  accumulator: number;
  alpha: number;
  /** True when the step cap was hit and the remaining backlog was dropped. */
  dropped: boolean;
}

/** Pure planning for one frame: how many fixed steps to run, and the alpha to render with. */
export function planFrame(accumulator: number, elapsedS: number, dt: number): FramePlan {
  let acc = accumulator + Math.min(Math.max(elapsedS, 0), MAX_FRAME_S);
  let steps = 0;
  while (acc >= dt && steps < MAX_STEPS_PER_FRAME) {
    acc -= dt;
    steps++;
  }
  let dropped = false;
  if (steps === MAX_STEPS_PER_FRAME && acc >= dt) {
    acc %= dt;
    dropped = true;
  }
  return { steps, accumulator: acc, alpha: Math.min(1, acc / dt), dropped };
}

export interface LoopHooks {
  /** Runs one fixed sim step (only while running and not paused). */
  step(): void;
  /** Whether stepping is wanted right now (the race state), independent of pause. */
  stepping(): boolean;
  /** Draws a frame; alpha interpolates between the last two snapshots. */
  render(alpha: number, frameDtS: number): void;
  /**
   * The frame-rate cap (tuning's frame gate): false skips this animation frame entirely, so the
   * next frame that runs sees the whole elapsed time and the sim keeps real time.
   */
  shouldRunFrame?: () => boolean;
}

export interface GameLoop {
  start(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** Frame intervals of the last ~10 s, in ms, for the perf probe. */
  frameTimes(): readonly number[];
  /**
   * Lockstep, a test seam (docs/architecture.md, "Testing seams"; the browser specs only, through
   * the test handle): with n set, every frame that steps runs exactly n sim steps whatever the wall
   * time, then renders the last step whole (alpha 1). Sim time then no longer depends on how fast
   * the runner draws: frame k of a race always shows tick k·n. null goes back to real time. The
   * count is read again before every step, so a step listener can end a frame's run early (the
   * test handle's fast-forward stops on its condition that way). Not sim state: the race is the
   * same tick for tick at any n (the sim is stepped the same way, only the frames between differ).
   */
  setLockstep(steps: number | null): void;
  readonly lockstep: number | null;
}

/** A lockstep count as the loop takes it: a whole number from 1 to MAX_LOCKSTEP, else null (real time). */
export function lockstepSteps(steps: number | null): number | null {
  if (steps === null || !Number.isFinite(steps)) return null;
  const n = Math.floor(steps);
  return n >= 1 ? Math.min(n, MAX_LOCKSTEP) : null;
}

export function createLoop(hooks: LoopHooks, dt: number): GameLoop {
  let acc = 0;
  let last = -1;
  let paused = false;
  let started = false;
  let lockstep: number | null = null;
  const times: number[] = [];
  const frame = (now: number) => {
    if (hooks.shouldRunFrame && !hooks.shouldRunFrame()) {
      requestAnimationFrame(frame);
      return;
    }
    const elapsed = last < 0 ? 0 : (now - last) / 1000;
    last = now;
    if (elapsed > 0) {
      times.push(elapsed * 1000);
      if (times.length > 600) times.shift();
    }
    let alpha = 1;
    if (!paused && hooks.stepping() && lockstep !== null) {
      acc = 0;
      for (let i = 0; lockstep !== null && i < lockstep && hooks.stepping(); i++) hooks.step();
    } else if (!paused && hooks.stepping()) {
      const plan = planFrame(acc, elapsed, dt);
      acc = plan.accumulator;
      alpha = plan.alpha;
      for (let i = 0; i < plan.steps && hooks.stepping(); i++) hooks.step();
    } else {
      acc = 0;
    }
    hooks.render(alpha, Math.min(elapsed, MAX_FRAME_S));
    requestAnimationFrame(frame);
  };
  return {
    start() {
      if (started) return;
      started = true;
      requestAnimationFrame(frame);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      last = -1; // no catch-up burst after a pause
    },
    get paused() {
      return paused;
    },
    frameTimes: () => times,
    setLockstep(steps) {
      lockstep = lockstepSteps(steps);
      acc = 0; // real time picks up from here, with no catch-up burst
    },
    get lockstep() {
      return lockstep;
    },
  };
}
