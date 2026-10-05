// The countdown is noticed at first glance (the maintainer, 2026-10-05: "the 3 2 1 go is much better but
// now it's hard to see at first without knowing where to look lol"): each beat arrives bigger and full
// bright and settles small and translucent; the first beat arrives bigger still; the strip clips it
// across, so it never reaches the road ahead. The browser check (tests/e2e/ui-menu-first.spec.ts)
// measures the drawn number at rest and at the entrance's peak.
import { describe, expect, it } from 'vitest';
import {
  COUNT_FIRST_PEAK_SCALE,
  COUNT_PEAK_SCALE,
  COUNT_REST_OPACITY,
  COUNTDOWN_CSS,
  countClasses,
} from './countdown-view';

describe('the countdown number', () => {
  it('marks the first number after the grid appears, and GO, and nothing else', () => {
    expect(countClasses('3', '')).toBe('count first');
    expect(countClasses('2', '3')).toBe('count');
    expect(countClasses('1', '2')).toBe('count');
    expect(countClasses('GO', '1')).toBe('count go');
    // A new race after the number was hidden starts over.
    expect(countClasses('3', '')).toContain('first');
  });

  it('arrives bigger and full bright, the first beat bigger still, and rests small and translucent', () => {
    expect(COUNT_PEAK_SCALE).toBeGreaterThanOrEqual(1.3);
    expect(COUNT_FIRST_PEAK_SCALE).toBeGreaterThan(COUNT_PEAK_SCALE + 0.2);
    expect(COUNT_REST_OPACITY).toBeLessThan(0.7);
    const keyframes = (name: string): string =>
      new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\} \\}`).exec(COUNTDOWN_CSS)?.[1] ?? '';
    const beat = keyframes('tb-count-in');
    const first = keyframes('tb-count-first');
    expect(beat).toMatch(new RegExp(`from \\{ transform: scale\\(${COUNT_PEAK_SCALE}\\); opacity: 1;`));
    expect(first).toMatch(
      new RegExp(`from \\{ transform: scale\\(${COUNT_FIRST_PEAK_SCALE}\\); opacity: 1;`),
    );
    for (const k of [beat, first])
      expect(k).toMatch(new RegExp(`to \\{ transform: scale\\(1\\); opacity: ${COUNT_REST_OPACITY};`));
    expect(COUNTDOWN_CSS).toContain('#countdown .count.first { animation: tb-count-first');
  });

  it('is clipped to its strip across, and still under reduced motion', () => {
    expect(COUNTDOWN_CSS).toMatch(/#countdown \{[^}]*width: 25%;[^}]*overflow-x: clip;/);
    expect(COUNTDOWN_CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{ #countdown \.count, #countdown \.count\.first \{ animation: none; \} \}/,
    );
  });
});
