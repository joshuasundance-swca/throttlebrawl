import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLoop, MAX_FRAME_S, MAX_STEPS_PER_FRAME, planFrame } from './loop';

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
