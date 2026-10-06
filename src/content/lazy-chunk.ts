// A lazy code chunk's import, the loader's rule for code as retry-fetch.ts is for data (polish batch
// F's check, punch item 4). A deploy in the middle of a race renames every file of the build, so the
// open tab's next `import()` answers 404: render/'s landmark chunk did, and the race got two uncaught
// "Failed to fetch dynamically imported module" errors and drew no landmark. Every lazy import the
// game makes mid-race goes through `loadChunk`:
// - it is tried once more, after a short wait (a dropped connection on the phone);
// - when both tries fail it is said once (a console warning, never an uncaught error) and resolves
//   null, so the caller keeps its stand-in (no landmark, the classic look) and the race goes on;
// - a build whose files are gone is platform/stale-build.ts's to handle: Vite's import wrapper
//   (its preload helper) fires `vite:preloadError` on the window for each failed try before the
//   error reaches here, the watch asks the host which build it serves, and a reload to the new one
//   waits for the race's end and is offered on the result screen (the transient-card rule).
//
// The caller passes the import itself (`() => import('./landmarks')`), so the bundler still splits
// the chunk and wraps each try.

/** The wait before the second try (ms). [default] */
export const CHUNK_RETRY_MS = 1000;

/** How a chunk's two tries wait and say they failed; the real ones, or a test's stand-ins. */
export interface ChunkEnv {
  wait(ms: number): Promise<void>;
  warn(message: string, err: unknown): void;
}

const browserChunkEnv: ChunkEnv = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  warn: (message, err) => console.warn(message, err),
};

/**
 * The module `load` imports, tried twice; null when both tries fail (said once as a warning). It
 * never rejects, so `void loadChunk(...).then(...)` leaves no uncaught error.
 */
export async function loadChunk<T>(
  name: string,
  load: () => Promise<T>,
  env: ChunkEnv = browserChunkEnv,
): Promise<T | null> {
  try {
    return await load();
  } catch {
    // tried once more below
  }
  try {
    await env.wait(CHUNK_RETRY_MS);
    return await load();
  } catch (err) {
    env.warn(`the ${name} chunk did not load; the game goes on without it`, err);
    return null;
  }
}
