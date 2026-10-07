import { describe, expect, it } from 'vitest';
import { CHUNK_RETRY_MS, loadChunk, type ChunkEnv } from './lazy-chunk';

// Polish batch F's check, punch item 4: a deploy mid-race made render/'s landmark chunk answer 404,
// and its bare `void import('./landmarks').then(...)` left two uncaught errors and no landmark. The
// sites that use `loadChunk` are held to it by src/render/lazy-imports.test.ts.

/** A chunk whose first `fails` tries fail as the browser's import does after a deploy. */
function chunk(fails: number) {
  let tries = 0;
  const load = () =>
    ++tries <= fails
      ? Promise.reject(new TypeError('Failed to fetch dynamically imported module: .../landmarks-L1.js'))
      : Promise.resolve({ LandmarkLayer: 'the module' });
  return { load, tries: () => tries };
}

function env() {
  const waits: number[] = [];
  const warnings: string[] = [];
  const e: ChunkEnv = {
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    warn: (message) => void warnings.push(message),
  };
  return { e, waits, warnings };
}

describe('a lazy chunk mid-race', () => {
  it('is tried once more after a short wait, and a second try that loads is used', async () => {
    const c = chunk(1);
    const t = env();
    expect(await loadChunk('landmarks', c.load, t.e)).toEqual({ LandmarkLayer: 'the module' });
    expect(c.tries()).toBe(2);
    expect(t.waits).toEqual([CHUNK_RETRY_MS]);
    expect(t.warnings).toEqual([]);
  });

  it('resolves null and says so once when both tries fail (a build whose files are gone), never rejecting', async () => {
    const c = chunk(Infinity);
    const t = env();
    let used = 0;
    const settled = await loadChunk('landmarks', c.load, t.e)
      .then((m) => {
        if (m) used++;
        return 'resolved';
      })
      .catch(() => 'rejected');
    expect(settled).toBe('resolved');
    expect(used).toBe(0);
    expect(c.tries()).toBe(2);
    expect(t.warnings).toEqual(['the landmarks chunk did not load; the game goes on without it']);
  });

  it('loads at once without a wait when the first try works', async () => {
    const c = chunk(0);
    const t = env();
    expect(await loadChunk('landmarks', c.load, t.e)).not.toBeNull();
    expect(c.tries()).toBe(1);
    expect(t.waits).toEqual([]);
  });

  it('the negative control: the bare `import().then(...)` the landmark site had lets the failure escape, untried', async () => {
    const c = chunk(1);
    let used = 0;
    const bare = c.load().then(() => void used++);
    await expect(bare).rejects.toThrow(/Failed to fetch dynamically imported module/);
    expect(c.tries()).toBe(1);
    expect(used).toBe(0);
  });
});
