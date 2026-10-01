import { describe, expect, it } from 'vitest';
import { createLookFallback, LOOK_FALLBACK } from './look-fallback';

// Run W-O, item 2 (maintainer, 2026-10-01: Ink + 60s film is the default look): when the frame time
// stays bad for a sustained stretch of a race on an ink look, app/ offers a one-tap switch to
// Classic. The numbers are [default]; the ink look's phone frame rate is unverified.

const FULL = { racing: true, inkLook: true, divisor: 1 };

/** Feeds `seconds` of frames of `ms` each; returns how many frames said "offer now". */
function feed(w: ReturnType<typeof createLookFallback>, ms: number, seconds: number, ctx = FULL): number {
  let offers = 0;
  for (let t = 0; t < seconds * 1000; t += ms) if (w.frame(ms, ctx)) offers++;
  return offers;
}

describe('the look fallback watch', () => {
  it('offers once after a sustained stretch of slow frames on an ink look', () => {
    const w = createLookFallback();
    // The race's first seconds (shaders, chunks) are never counted.
    expect(feed(w, 50, LOOK_FALLBACK.graceS - 0.1)).toBe(0);
    expect(feed(w, 50, LOOK_FALLBACK.windowS - 0.2)).toBe(0);
    expect(feed(w, 50, 1)).toBe(1);
    // Once a race: no second offer however long it stays slow.
    expect(feed(w, 50, 30)).toBe(0);
    // A new race may offer again.
    w.reset();
    expect(feed(w, 50, LOOK_FALLBACK.graceS + LOOK_FALLBACK.windowS + 1)).toBe(1);
  });

  it('never offers on smooth frames, or on the odd hitch', () => {
    const w = createLookFallback();
    expect(feed(w, 16.7, 60)).toBe(0);
    // One frame in five at 60 ms: well under the bad share.
    let offers = 0;
    for (let i = 0; i < 3000; i++) if (w.frame(i % 5 === 0 ? 60 : 16.7, FULL)) offers++;
    expect(offers).toBe(0);
  });

  it('offers on 30 fps with the frame rate at full, but not when the player capped it at half', () => {
    expect(feed(createLookFallback(), 33.4, 20)).toBe(1);
    expect(feed(createLookFallback(), 33.4, 20, { ...FULL, divisor: 2 })).toBe(0);
    // Half the cap's 33 ms, at 15 fps: slow even for the battery saver.
    expect(feed(createLookFallback(), 66.8, 20, { ...FULL, divisor: 2 })).toBe(1);
  });

  it('never offers on the Classic look, outside a race, or while paused', () => {
    expect(feed(createLookFallback(), 80, 30, { ...FULL, inkLook: false })).toBe(0);
    expect(feed(createLookFallback(), 80, 30, { ...FULL, racing: false })).toBe(0);
  });

  it('starts its window over when the race stops (a pause) or the look changes', () => {
    const w = createLookFallback();
    feed(w, 50, LOOK_FALLBACK.graceS + LOOK_FALLBACK.windowS - 1);
    // A pause: the slow stretch before it does not carry over.
    feed(w, 50, 1, { ...FULL, racing: false });
    expect(feed(w, 50, LOOK_FALLBACK.graceS + LOOK_FALLBACK.windowS - 1)).toBe(0);
    expect(feed(w, 50, 1.5)).toBe(1);
  });

  it('counts a stretch that is mostly slow, not only one that is all slow', () => {
    const w = createLookFallback();
    let offers = 0;
    // Three slow frames in four.
    for (let i = 0; i < 2000; i++) if (w.frame(i % 4 === 0 ? 16.7 : 50, FULL)) offers++;
    expect(offers).toBe(1);
  });
});
