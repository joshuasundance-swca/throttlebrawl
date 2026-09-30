// The main loop (docs/architecture.md, "Fixed timestep and the loop"): an accumulator of real
// time clamped to 0.25 s per frame, at most 4 sim steps per frame (a backlog beyond that is
// dropped, so the game slows down rather than freezing), and interpolation alpha = min(1, acc/dt).

export const MAX_FRAME_S = 0.25;
export const MAX_STEPS_PER_FRAME = 4;

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
}

export function createLoop(hooks: LoopHooks, dt: number): GameLoop {
  let acc = 0;
  let last = -1;
  let paused = false;
  let started = false;
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
    if (!paused && hooks.stepping()) {
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
  };
}
