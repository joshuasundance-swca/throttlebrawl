// The countdown is noticed at first glance (the maintainer, 2026-10-05: "the 3 2 1 go is much better but
// now it's hard to see at first without knowing where to look lol"): each beat arrives bigger and full
// bright and settles small and translucent; the first beat arrives bigger still; the strip clips it
// across, so it never reaches the road ahead. The browser check (tests/e2e/ui-menu-first.spec.ts)
// measures the drawn number at rest and at the entrance's peak.
import { describe, expect, it } from 'vitest';
import {
  COUNT_FILL,
  COUNT_FIRST_PEAK_SCALE,
  COUNT_OUTLINE,
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
    expect(COUNT_REST_OPACITY).toBeLessThan(1);
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

// HUD punch item 9 (playtest 4, run A's live check): "At rest, the number is a grey 37 px digit at opacity
// 0.6. Over a pale building (Keys start) it is low contrast. Only the 0.8 s entrance is bright." The
// fix gives it contrast, without making it bigger or moving it: the maintainer's two vetoes stand (not
// obstructive, and noticeable), so the size, the strip and the clip are pinned below too.

/** WCAG relative luminance of a #rgb or #rrggbb colour, 0 to 1. */
function luminance(hex: string): number {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1);
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** A colour drawn at `alpha` over a background, as a luminance (sRGB mixing, then WCAG). */
function over(fg: string, bg: string, alpha: number): number {
  const rgb = (hex: string) => {
    const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const f = rgb(fg);
  const b = rgb(bg);
  const mixed = f.map((c, i) => Math.round(alpha * c + (1 - alpha) * (b[i] ?? 0)));
  return luminance(`#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`);
}
/**
 * How well the number reads at rest over a background: the fill against its outline (the glyph's edge) and the
 * better of the outline and the fill against the background (the glyph's silhouette), as WCAG ratios, with the
 * whole element at `opacity` (the outline fades with it).
 */
function restReading(fill: string, outline: string, opacity: number, bg: string) {
  const f = over(fill, bg, opacity);
  const o = over(outline, bg, opacity);
  const b = luminance(bg);
  return { edge: ratio(f, o), silhouette: Math.max(ratio(o, b), ratio(f, b)) };
}
/** Pale buildings and sky (the Keys start's walls), and a dark road. */
const BACKGROUNDS = ['#ffffff', '#e9e6df', '#d8cfb8', '#202020'];
const READABLE = 7;

describe('the countdown number reads over pale buildings (HUD punch item 9)', () => {
  it('at rest, its edge and its silhouette both reach a contrast ratio of 7 over every background', () => {
    for (const bg of BACKGROUNDS) {
      const r = restReading(COUNT_FILL, COUNT_OUTLINE, COUNT_REST_OPACITY, bg);
      expect(r.edge, `${bg}: fill against outline`).toBeGreaterThanOrEqual(READABLE);
      expect(r.silhouette, `${bg}: against the background`).toBeGreaterThanOrEqual(READABLE);
    }
  });

  it('measures what it claims: the old grey digit at opacity 0.6 fails the same check (negative control)', () => {
    const failing = BACKGROUNDS.filter((bg) => {
      const r = restReading('#f2ead8', '#111', 0.6, bg);
      return r.edge < READABLE || r.silhouette < READABLE;
    });
    expect(failing).toEqual(expect.arrayContaining(['#ffffff', '#e9e6df', '#d8cfb8']));
  });

  it('is outlined all round at rest, not just shadowed to one side', () => {
    const rest =
      /to \{ transform: scale\(1\); opacity: [\d.]+; text-shadow: ([^;}]*);/.exec(COUNTDOWN_CSS)?.[1] ?? '';
    const offsets = [...rest.matchAll(/(-?\d+(?:\.\d+)?(?:px)?) (-?\d+(?:\.\d+)?(?:px)?) 0 /g)].map((m) => [
      Math.sign(parseFloat(m[1] ?? '0')),
      Math.sign(parseFloat(m[2] ?? '0')),
    ]);
    for (const dir of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      expect(offsets, `outline step ${dir.join(',')}`).toContainEqual(dir);
    expect(COUNTDOWN_CSS).toMatch(/#countdown \.count \{[^}]*text-shadow: [^;]*(-?\d+px 0 0 #111)/);
  });

  it('is no bigger and no nearer the road than before: the size, the strip and the clip are the vetoes', () => {
    // The 37 px digit on a 412 px short side (clamp 28 to 56 px at 9 % of it), in the strip a quarter of the
    // width across, centred 45 % down, clipped across so even the entrance's peak stays out of the road.
    expect(COUNTDOWN_CSS).toContain('font: 900 clamp(28px, 9vmin, 56px)/1.05');
    expect(COUNTDOWN_CSS).toMatch(
      /#countdown \{ position: absolute; left: 0; width: 25%; top: 45%; transform: translateY\(-50%\);/,
    );
    expect(COUNTDOWN_CSS).toContain('overflow-x: clip');
    expect(COUNT_PEAK_SCALE).toBe(1.45);
    expect(COUNT_FIRST_PEAK_SCALE).toBe(1.8);
  });
});
