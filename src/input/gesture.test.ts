// input-1: the gesture-timing invariant (docs/milestones/M1.md, "input-1" and "Starting
// numbers"). A swipe or side drag must be recognised, and sampled on the next tick, before the
// sim stops honouring it; otherwise a real kick would sometimes come out as a punch.
// Playtest 1 (2026-09-30, "Can't kick"): the swipe window widens to 200 ms, so a natural 180 ms swipe counts, and the kick
// swipe is checked against combat's kick-conversion window (combat.kickConvertMs), not the punch's
// 7-tick wind-up.
import { describe, expect, it } from 'vitest';
import { SIM_TUNING } from '../sim/api';
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

// The shipped kick-conversion window (sim/combat, playtest 1): a kick flag converts an attack at
// most this old, in any phase.
const convertDecl = SIM_TUNING.find((d) => d.id === 'combat.kickConvertMs');
const KICK_CONVERT_MS = convertDecl?.default ?? 0;

describe('input-1: gesture timing invariant', () => {
  it('converts milliseconds to the ticks a gesture can span, rounding up', () => {
    expect(gestureWindowTicks(80)).toBe(5);
    expect(gestureWindowTicks(100)).toBe(6);
    expect(gestureWindowTicks(50)).toBe(3);
    expect(gestureWindowTicks(180)).toBe(11);
  });

  it('holds for the shipped values, against the shipped kick-conversion window', () => {
    expect(convertDecl, 'combat.kickConvertMs is declared by sim/combat').toBeDefined();
    const defaults = inputDefaults();
    const weapons = shipped.some((w) => w.id === 'punch') ? shipped : [...shipped, M1_PUNCH];
    expect(gestureTimingProblems(defaults, weapons, KICK_CONVERT_MS)).toEqual([]);
  });

  it('playtest 1: the kick swipe window is a natural 150-200 ms and outlasts the punch wind-up', () => {
    const ms = inputDefaults().kickSwipeMs;
    expect(ms).toBeGreaterThanOrEqual(150);
    expect(ms).toBeLessThanOrEqual(200);
    // Under M1's rule (no conversion window) this swipe would come out as a punch.
    expect(gestureTimingProblems(inputDefaults(), [M1_PUNCH], 0)).toHaveLength(1);
  });

  it('with no conversion window (M1), fails when the swipe window plus one tick reaches the punch wind-up', () => {
    const problems = gestureTimingProblems({ ...inputDefaults(), kickSwipeMs: 100 }, [M1_PUNCH]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/kickSwipeMs/);
    expect(gestureTimingProblems({ ...inputDefaults(), kickSwipeMs: 80 }, [M1_PUNCH])).toEqual([]);
  });

  it('fails when the swipe window plus one tick outlasts the conversion window', () => {
    // 250 ms is 15 ticks, plus the sampling tick is 16, past a 250 ms (15-tick) window.
    const problems = gestureTimingProblems({ ...inputDefaults(), kickSwipeMs: 250 }, [M1_PUNCH], 250);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/kickConvertMs/);
    // 230 ms is 14 ticks + 1 = 15: inside it.
    expect(gestureTimingProblems({ ...inputDefaults(), kickSwipeMs: 230 }, [M1_PUNCH], 250)).toEqual([]);
  });

  it('fails when the side-drag window is too long, including for the kick wind-up', () => {
    const t = { ...inputDefaults(), attackDragMs: 250 };
    const problems = gestureTimingProblems(t, [M1_PUNCH, { id: 'kick', windupS: 0.22 }], KICK_CONVERT_MS);
    expect(problems.filter((p) => p.includes('attackDragMs'))).toHaveLength(2);
  });

  it('does not ask the kick to convert into itself', () => {
    const problems = gestureTimingProblems(inputDefaults(), [{ id: 'base:kick', windupS: 0.05 }]);
    expect(problems.some((p) => p.includes('kickSwipeMs'))).toBe(false);
  });

  it('the slider ranges cannot break the invariant against the M1 punch and the shipped window', () => {
    for (const id of ['input.kickSwipeMs', 'input.attackDragMs'] as const) {
      const decl = INPUT_TUNING.find((d) => d.id === id);
      expect(decl, id).toBeDefined();
      const key = id === 'input.kickSwipeMs' ? 'kickSwipeMs' : 'attackDragMs';
      const t = { ...inputDefaults(), [key]: decl!.max };
      expect(gestureTimingProblems(t, [M1_PUNCH], KICK_CONVERT_MS), id).toEqual([]);
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
