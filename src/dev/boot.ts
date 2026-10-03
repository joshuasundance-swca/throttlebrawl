// The part of dev/ the page loads with its first screen (docs/engineering.md, perf check: the
// first-load JavaScript budget). src/main.ts imports only this file statically. Everything else in
// dev/ (the test handle, the bot, the debug report, the perf overlay) is one lazy chunk: a player
// never needs it before the first screen, and the report's buttons load it on demand.
// - The test flag check and the error capture stay here: the capture must see errors from the
//   first moment, and the report reads the same log later (report/errors.ts).
// - Under the test flag the page waits for the lazy chunk before it boots (main.ts), so the test
//   handle exists before any screen does, as it did when dev/ loaded with the page. Until then,
//   `window.__game` is a stand-in that queues the handle's setters and replays them, in order,
//   the moment the real handle is installed: a spec's `__game?.setSeed(3)` right after the page
//   loads still lands before the first tap, never silently nowhere.

export { installErrorCapture } from './report/errors';

declare global {
  interface Window {
    /** Set by Playwright's init script before the page loads. */
    __GAME_TEST__?: boolean;
  }
}

export function testFlagSet(): boolean {
  return window.__GAME_TEST__ === true;
}

/** The handle's calls that change something; the stand-in queues these and answers reads with undefined. */
export const QUEUED_CALLS: ReadonlySet<string> = new Set(['setBot', 'setSeed', 'tap', 'startRace']);

/** A stand-in for the test handle until the real one is installed. */
export interface PendingHandle {
  /** The object to put at `window.__game` meanwhile. */
  readonly stub: object;
  /** Replays the queued calls, in order, on the real handle. */
  flush(real: object): void;
}

export function createPendingHandle(): PendingHandle {
  const queue: [string, unknown[]][] = [];
  const stub = new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== 'string') return undefined;
        return (...args: unknown[]) => {
          if (QUEUED_CALLS.has(name)) queue.push([name, args]);
          return undefined;
        };
      },
    },
  );
  return {
    stub,
    flush(real) {
      const target = real as Record<string, unknown>;
      for (const [name, args] of queue.splice(0)) {
        const fn = target[name];
        if (typeof fn === 'function') (fn as (...a: unknown[]) => unknown).apply(real, args);
      }
    },
  };
}
