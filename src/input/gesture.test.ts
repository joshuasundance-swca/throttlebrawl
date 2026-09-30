// input-1: the gesture-timing invariant (docs/milestones/M1.md, "input-1" and "Starting
// numbers"). A swipe or side drag must be recognised, and sampled on the next tick, before the
// wind-up it modifies ends; otherwise a real kick would sometimes come out as a punch.
import { describe, expect, it } from 'vitest';
import { gestureTimingProblems, gestureWindowTicks, INPUT_TUNING, inputDefaults } from './index';

// The shipped weapons. None exist before combat-1; this picks them up the moment they land.
const shipped = Object.entries(
  import.meta.glob<{ id: string; windupS: number }>('../../packs/base/weapons/*.json', {
    eager: true,
    import: 'default',
  }),
).map(([path, w]) => ({ id: w.id, windupS: w.windupS, path }));

// M1's starting punch wind-up (0.12 s, 7 ticks), used as the floor while no punch file exists.
const M1_PUNCH = { id: 'punch', windupS: 0.12 };

describe('input-1: gesture timing invariant', () => {
  it('converts milliseconds to the ticks a gesture can span, rounding up', () => {
    expect(gestureWindowTicks(80)).toBe(5);
    expect(gestureWindowTicks(100)).toBe(6);
    expect(gestureWindowTicks(50)).toBe(3);
  });

  it('holds for the shipped values', () => {
    const defaults = inputDefaults();
    const weapons = shipped.some((w) => w.id === 'punch') ? shipped : [...shipped, M1_PUNCH];
    expect(gestureTimingProblems(defaults, weapons)).toEqual([]);
  });

  it('fails when the swipe window plus one tick reaches the punch wind-up', () => {
    const t = { ...inputDefaults(), kickSwipeMs: 100 };
    const problems = gestureTimingProblems(t, [M1_PUNCH]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/kickSwipeMs/);
  });

  it('fails when the side-drag window is too long, including for the kick wind-up', () => {
    const t = { ...inputDefaults(), attackDragMs: 250 };
    const problems = gestureTimingProblems(t, [M1_PUNCH, { id: 'kick', windupS: 0.22 }]);
    expect(problems.filter((p) => p.includes('attackDragMs'))).toHaveLength(2);
  });

  it('does not ask the kick to convert into itself', () => {
    const problems = gestureTimingProblems(inputDefaults(), [{ id: 'base:kick', windupS: 0.05 }]);
    expect(problems.some((p) => p.includes('kickSwipeMs'))).toBe(false);
  });

  it('the slider ranges cannot break the invariant against the M1 punch', () => {
    for (const id of ['input.kickSwipeMs', 'input.attackDragMs'] as const) {
      const decl = INPUT_TUNING.find((d) => d.id === id);
      expect(decl, id).toBeDefined();
      const key = id === 'input.kickSwipeMs' ? 'kickSwipeMs' : 'attackDragMs';
      const t = { ...inputDefaults(), [key]: decl!.max };
      expect(gestureTimingProblems(t, [M1_PUNCH]), id).toEqual([]);
    }
  });

  it('declares every threshold as presentation-side tuning (inputs are recorded, not re-derived)', () => {
    const ids = INPUT_TUNING.map((d) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'input.attackDragPx',
        'input.attackDragMs',
        'input.kickSwipePx',
        'input.kickSwipeMs',
      ]),
    );
    for (const d of INPUT_TUNING) {
      expect(d.affectsSim, d.id).toBe(false);
      expect(d.default).toBeGreaterThanOrEqual(d.min);
      expect(d.default).toBeLessThanOrEqual(d.max);
    }
  });
});
