import { describe, expect, it } from 'vitest';
import { COUNTDOWN_BEATS, createCountdown, type Countdown, type CountdownStep } from './countdown';

// The race-start countdown (playtest 4, P4-11): the sim holds at tick 0 for everyone while 3, 2, 1
// count down, then GO. app/ steps this once per loop step instead of the sim; a step that holds is
// not a sim step, so nothing here can move a rider or change a replay. The tests drive it by steps,
// never by wall-clock time.

const PER_BEAT = 60;
const GO_STEPS = 48;

/** Steps the countdown `n` times, collecting what each step said. */
function run(c: Countdown, n: number): CountdownStep[] {
  const out: CountdownStep[] = [];
  for (let i = 0; i < n; i++) out.push(c.step());
  return out;
}

describe('the race-start countdown', () => {
  it('holds the sim for exactly three beats, then lets it run', () => {
    const c = createCountdown(PER_BEAT, GO_STEPS);
    c.begin(true);
    const steps = run(c, COUNTDOWN_BEATS * PER_BEAT + 10);
    const held = steps.filter((s) => s.hold).length;
    expect(held).toBe(COUNTDOWN_BEATS * PER_BEAT);
    // The holds are the first steps, with no gap, and every step after them runs the sim.
    expect(steps.slice(0, held).every((s) => s.hold)).toBe(true);
    expect(steps.slice(held).every((s) => !s.hold)).toBe(true);
  });

  it('counts 3, 2, 1 on the beats and shows GO as the hold ends', () => {
    const c = createCountdown(PER_BEAT, GO_STEPS);
    c.begin(true);
    const steps = run(c, COUNTDOWN_BEATS * PER_BEAT + 1);
    const beats = steps.map((s, i) => ({ i, beat: s.beat })).filter((s) => s.beat !== null);
    expect(beats).toEqual([
      { i: 0, beat: 3 },
      { i: PER_BEAT, beat: 2 },
      { i: 2 * PER_BEAT, beat: 1 },
    ]);
    const shown = steps.flatMap((s, i) => (s.show === undefined ? [] : [{ i, show: s.show }]));
    expect(shown).toEqual([
      { i: 0, show: '3' },
      { i: PER_BEAT, show: '2' },
      { i: 2 * PER_BEAT, show: '1' },
      { i: 3 * PER_BEAT - 1, show: 'GO' },
    ]);
  });

  it('takes GO down after its own short while, counted in sim steps', () => {
    const c = createCountdown(PER_BEAT, GO_STEPS);
    c.begin(true);
    const steps = run(c, COUNTDOWN_BEATS * PER_BEAT + GO_STEPS + 20);
    const firstRun = steps.findIndex((s) => !s.hold);
    const cleared = steps.findIndex((s) => s.show === '');
    // GO stays up for GO_STEPS sim steps and is then cleared, once.
    expect(cleared - firstRun).toBe(GO_STEPS - 1);
    expect(steps.filter((s) => s.show === '')).toHaveLength(1);
  });

  it('never holds when it is off, and says nothing', () => {
    const c = createCountdown(PER_BEAT, GO_STEPS);
    c.begin(false);
    const steps = run(c, 200);
    expect(steps.every((s) => !s.hold && s.beat === null && s.show === undefined)).toBe(true);
  });

  it('starts over on every race, even one begun mid-countdown', () => {
    const c = createCountdown(PER_BEAT, GO_STEPS);
    c.begin(true);
    run(c, 100);
    c.begin(true);
    const steps = run(c, COUNTDOWN_BEATS * PER_BEAT);
    expect(steps.filter((s) => s.hold)).toHaveLength(COUNTDOWN_BEATS * PER_BEAT);
    expect(steps[0]?.beat).toBe(3);
    // A race begun with it off after one with it on holds nothing.
    c.begin(false);
    expect(c.step().hold).toBe(false);
  });

  it('says whether it is holding, for the screen and the pause rules', () => {
    const c = createCountdown(PER_BEAT, GO_STEPS);
    expect(c.holding).toBe(false);
    c.begin(true);
    expect(c.holding).toBe(true);
    run(c, COUNTDOWN_BEATS * PER_BEAT);
    expect(c.holding).toBe(false);
  });
});
