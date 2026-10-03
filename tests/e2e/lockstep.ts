import type { Page } from '@playwright/test';

// Whole-race browser specs ride the loop's lockstep (src/app/loop.ts, through the test handle's
// `lockstep` and `fastForward`; the determinism run's R4, 2026-10-03). A race then runs a fixed
// number of ticks per drawn frame instead of at the speed the runner draws: a software-rendered
// CI runner draws 7 to 19 frames a second, and every wall-clock deadline on a whole race walked
// into its limit as content grew. The waits here are hang guards, not measurements of the race.

interface LockstepHandle {
  state(): string;
  snapshot(): { tick: number } | null;
  fastForwarding(): boolean;
  lockstep(steps: number | null): void;
}
type LockstepWindow = Window & { __game?: LockstepHandle };

/**
 * A hang guard for one fast-forward. At 240 ticks a frame a whole 15-minute race is 225 frames;
 * even at a CI runner's slowest (about 1 s a frame with the sim's steps) that is under 4 minutes.
 */
export const FAST_FORWARD_GUARD_MS = 240_000;

/**
 * Waits until the fast-forward the spec started in the page has stopped (its condition held) or
 * the race is over, and returns the race's tick there. Prints both, so a failure reads as a tick.
 */
export async function fastForwardDone(page: Page, what: string): Promise<number> {
  await page.waitForFunction(
    () => {
      const g = (window as LockstepWindow).__game;
      return !!g && (!g.fastForwarding() || g.state() !== 'race');
    },
    null,
    { timeout: FAST_FORWARD_GUARD_MS, polling: 100 },
  );
  const at = await page.evaluate(() => {
    const g = (window as LockstepWindow).__game;
    return { tick: g?.snapshot()?.tick ?? -1, state: g?.state() ?? '', still: g?.fastForwarding() ?? false };
  });
  console.log(
    `[fast-forward] ${what}: stopped at tick ${at.tick} (${at.state}${at.still ? ', the race ended first' : ''})`,
  );
  return at.tick;
}

/** Waits for `n` more drawn frames (the page's own animation frames, not wall time). */
export async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const next = () => (--left <= 0 ? resolve() : requestAnimationFrame(next));
        requestAnimationFrame(next);
      }),
    n,
  );
}
