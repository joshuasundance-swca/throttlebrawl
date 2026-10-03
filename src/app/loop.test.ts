import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLoop,
  lockstepSteps,
  MAX_FRAME_S,
  MAX_LOCKSTEP,
  MAX_STEPS_PER_FRAME,
  planFrame,
  type GameLoop,
} from './loop';

const DT = 1 / 60;

describe('app/loop: planFrame', () => {
  it('runs one step per 1/60 s and carries the remainder', () => {
    const plan = planFrame(0, 0.025, DT);
    expect(plan.steps).toBe(1);
    expect(plan.accumulator).toBeCloseTo(0.025 - DT, 9);
    expect(plan.alpha).toBeCloseTo((0.025 - DT) / DT, 9);
  });

  it('clamps a long frame to 0.25 s and drops the backlog past 4 steps', () => {
    const plan = planFrame(0, 3, DT);
    expect(plan.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(plan.dropped).toBe(true);
    expect(plan.accumulator).toBeLessThan(DT);
    expect(MAX_FRAME_S).toBe(0.25);
  });
});

describe('app/loop: the frame-rate cap gate', () => {
  let queue: FrameRequestCallback[] = [];
  const realRaf = globalThis.requestAnimationFrame;

  beforeEach(() => {
    queue = [];
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    };
  });
  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
  });

  /** Runs `frames` animation frames at a 90 Hz display, returning render and step counts. */
  function drive(shouldRunFrame: (() => boolean) | undefined, frames: number) {
    let renders = 0;
    let steps = 0;
    queue = []; // each loop gets its own frame queue
    const loop = createLoop(
      {
        stepping: () => true,
        step: () => steps++,
        render: () => renders++,
        ...(shouldRunFrame ? { shouldRunFrame } : {}),
      },
      DT,
    );
    loop.start();
    const hz = 90;
    for (let i = 0; i < frames; i++) {
      const cb = queue.shift();
      if (!cb) throw new Error('the loop stopped asking for frames');
      cb((i * 1000) / hz);
    }
    return { renders, steps };
  }

  it('draws every animation frame with no gate', () => {
    const { renders } = drive(undefined, 90);
    expect(renders).toBe(90);
  });

  it('skips frames the gate holds back, and keeps asking for frames', () => {
    let n = 0;
    const everyThird = () => n++ % 3 === 0;
    const { renders } = drive(everyThird, 90);
    expect(renders).toBe(30);
    expect(queue.length).toBe(1);
  });

  it('keeps sim time whole: a capped loop steps as often as an uncapped one', () => {
    const full = drive(undefined, 181);
    let n = 0;
    const capped = drive(() => n++ % 2 === 0, 181);
    // 180 frames at 90 Hz is 2 s of play: 120 steps either way (give or take the last partial step).
    expect(full.steps).toBeGreaterThanOrEqual(119);
    expect(full.steps).toBeLessThanOrEqual(120);
    expect(Math.abs(capped.steps - full.steps)).toBeLessThanOrEqual(1);
  });
});

// The lockstep test seam (inventory R4, 2026-10-03): whole-race browser specs ride a fixed number
// of ticks per drawn frame, so sim time no longer depends on how fast the runner draws.
describe('app/loop: lockstep', () => {
  let queue: FrameRequestCallback[] = [];
  const realRaf = globalThis.requestAnimationFrame;

  beforeEach(() => {
    queue = [];
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    };
  });
  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
  });

  /** A loop whose steps and renders are counted; `onStep` runs inside each step. */
  function rig(onStep?: (loop: GameLoop, steps: number) => void) {
    const count = { steps: 0, renders: 0, alphas: [] as number[], stepping: true };
    const loop: GameLoop = createLoop(
      {
        stepping: () => count.stepping,
        step: () => {
          count.steps++;
          onStep?.(loop, count.steps);
        },
        render: (alpha) => {
          count.renders++;
          count.alphas.push(alpha);
        },
      },
      DT,
    );
    loop.start();
    let now = 0;
    /** Runs one animation frame `ms` after the last; returns the steps it ran. */
    const frame = (ms: number) => {
      const before = count.steps;
      const cb = queue.shift();
      if (!cb) throw new Error('the loop stopped asking for frames');
      now += ms;
      cb(now);
      return count.steps - before;
    };
    frame(0); // the first frame only sets the clock
    return { loop, count, frame };
  }

  it('takes whole counts from 1 to the cap, and anything else as real time', () => {
    expect(lockstepSteps(8)).toBe(8);
    expect(lockstepSteps(8.9)).toBe(8);
    expect(lockstepSteps(1)).toBe(1);
    expect(lockstepSteps(MAX_LOCKSTEP + 5)).toBe(MAX_LOCKSTEP);
    for (const bad of [0, -3, 0.5, NaN, Infinity, null]) expect(lockstepSteps(bad)).toBeNull();
  });

  it('runs exactly n steps a frame whatever the wall time, and renders the last step whole', () => {
    const { loop, count, frame } = rig();
    loop.setLockstep(8);
    expect(loop.lockstep).toBe(8);
    // A fast display (2 ms), a 60 Hz one, and a software renderer's 400 ms frame: 8 steps each,
    // where real time would give 0, 1 and the loop's cap of 4.
    expect([frame(2), frame(1000 / 60), frame(400)]).toEqual([8, 8, 8]);
    expect(count.alphas.slice(-3)).toEqual([1, 1, 1]);
    // Far more steps than the real-time cap, in one frame (fast-forward).
    loop.setLockstep(240);
    expect(frame(400)).toBe(240);
    expect(240).toBeGreaterThan(MAX_STEPS_PER_FRAME);
  });

  it('goes back to real time with no catch-up burst', () => {
    const { loop, frame } = rig();
    loop.setLockstep(16);
    expect(frame(400)).toBe(16);
    loop.setLockstep(null);
    expect(loop.lockstep).toBeNull();
    expect(frame(1000 / 60)).toBe(1);
    expect(frame(400)).toBe(MAX_STEPS_PER_FRAME);
  });

  it('reads the count before every step, so a step can end the frame early', () => {
    // The test handle's fast-forward stops on its condition by handing the loop a smaller count.
    const { loop, frame } = rig((l, steps) => {
      if (steps === 100) l.setLockstep(4);
    });
    loop.setLockstep(240);
    expect(frame(16)).toBe(100);
    expect(frame(16)).toBe(4);
  });

  it('steps nothing while paused or between races, and stops when the race ends mid-frame', () => {
    const { loop, count, frame } = rig((_l, steps) => {
      if (steps === 30) count.stepping = false; // the race ended on this step
    });
    loop.setLockstep(50);
    expect(frame(16)).toBe(30);
    expect(frame(16)).toBe(0);
    count.stepping = true;
    loop.pause();
    expect(frame(16)).toBe(0);
    loop.resume();
    expect(frame(16)).toBe(50);
  });

  it('is off by default: a new loop keeps real time', () => {
    const { loop, frame } = rig();
    expect(loop.lockstep).toBeNull();
    expect(frame(1000 / 60)).toBe(1);
  });
});
