import { describe, expect, it } from 'vitest';
import { CHUNK_RETRY_MS, failedChunkUrl, loadChunk, RETRY_PARAM, type ChunkEnv } from './lazy-chunk';

// Polish batch F's check, punch item 4: a deploy mid-race made render/'s landmark chunk answer 404,
// and its bare `void import('./landmarks').then(...)` left two uncaught errors and no landmark. The
// sites that use `loadChunk` are held to it by src/render/lazy-imports.test.ts.
//
// Polish batch K's check, mustFix 1: in Chromium a failed `import()` is kept under its URL, so
// importing the same URL again fails at once and asks the network nothing (1 request in all for 3
// imports, live, while the same URL plus `?retry=1` loaded). `browser()` below is that module map: it
// keeps every import's answer, success or failure, under the URL, and counts what reaches the host.

/** A chunk whose first `fails` tries fail as the browser's import does after a deploy. */
function chunk(fails: number) {
  let tries = 0;
  const load = () =>
    ++tries <= fails
      ? Promise.reject(new TypeError('Failed to fetch dynamically imported module: .../landmarks-L1.js'))
      : Promise.resolve({ LandmarkLayer: 'the module' });
  return { load, tries: () => tries };
}

const ORIGIN = 'https://game.example';
const PLAIN = `${ORIGIN}/assets/race-parts-AbC1_2.js`;
const busted = (n: number) => `${PLAIN}?${RETRY_PARAM}=${n}`;

/**
 * A browser's module map over a host: `answer` says whether the host serves the nth request (1-based)
 * of a URL. An import of a URL the map holds returns what it holds and asks the host nothing.
 */
function browser(answer: (url: string, nth: number) => boolean) {
  const requests: string[] = [];
  const map = new Map<string, Promise<unknown>>();
  const importUrl = (url: string): Promise<unknown> => {
    const held = map.get(url);
    if (held) return held;
    requests.push(url);
    const nth = requests.filter((u) => u === url).length;
    const p = answer(url, nth)
      ? Promise.resolve({ part: 'race parts', from: url })
      : Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${url}`));
    p.catch(() => undefined);
    map.set(url, p);
    return p;
  };
  return { importUrl, requests, load: () => importUrl(PLAIN) };
}

function env(importUrl: (url: string) => Promise<unknown> = () => Promise.reject(new Error('no import'))) {
  const waits: number[] = [];
  const warnings: string[] = [];
  const imported: string[] = [];
  const e: ChunkEnv = {
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    warn: (message) => void warnings.push(message),
    importUrl: (url) => {
      imported.push(url);
      return importUrl(url);
    },
    origin: () => ORIGIN,
  };
  return { e, waits, warnings, imported };
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

describe("a retried chunk reaches the network (polish batch K's check, mustFix 1)", () => {
  it('the negative control: importing the same URL again, as the retry did, fails at once with no request', async () => {
    const b = browser((url, nth) => !(url === PLAIN && nth === 1)); // the first request drops
    await expect(b.load()).rejects.toThrow(/Failed to fetch dynamically imported module/);
    await expect(b.load()).rejects.toThrow(/Failed to fetch dynamically imported module/);
    await expect(b.load()).rejects.toThrow(/Failed to fetch dynamically imported module/);
    expect(b.requests).toEqual([PLAIN]);
  });

  it('a chunk whose first request dropped is fetched again under its own URL with a retry query, and used', async () => {
    const b = browser((url, nth) => !(url === PLAIN && nth === 1));
    const t = env(b.importUrl);
    const m = await loadChunk('race parts', b.load, t.e);
    expect(m).toEqual({ part: 'race parts', from: busted(1) });
    expect(b.requests).toEqual([PLAIN, busted(1)]);
    expect(t.waits).toEqual([CHUNK_RETRY_MS]);
    expect(t.warnings).toEqual([]);
  });

  it('once fetched again, a later load of the chunk takes that module: no wait, no request, no second copy', async () => {
    const b = browser((url, nth) => !(url === PLAIN && nth === 1));
    const t = env(b.importUrl);
    const first = await loadChunk('race parts', b.load, t.e);
    const again = await loadChunk('race parts', b.load, t.e);
    expect(again).toBe(first);
    expect(b.requests).toEqual([PLAIN, busted(1)]);
    expect(t.waits).toEqual([CHUNK_RETRY_MS]);
  });

  it('two loads of a failed chunk at once share one retry', async () => {
    const b = browser((url, nth) => !(url === PLAIN && nth === 1));
    const t = env(b.importUrl);
    const [x, y] = await Promise.all([
      loadChunk('race parts', b.load, t.e),
      loadChunk('race parts', b.load, t.e),
    ]);
    expect(x).not.toBeNull();
    expect(y).toBe(x);
    expect(b.requests).toEqual([PLAIN, busted(1)]);
  });

  it('a chunk the host no longer has (every request 404) gives up, and each later ask is a new request', async () => {
    const b = browser(() => false);
    const t = env(b.importUrl);
    expect(await loadChunk('race parts', b.load, t.e)).toBeNull();
    expect(b.requests).toEqual([PLAIN, busted(1)]);
    expect(t.warnings).toEqual(['the race parts chunk did not load; the game goes on without it']);
    // The next road asks again (render/'s setRoad): a fresh URL, never the failure the map holds.
    expect(await loadChunk('race parts', b.load, t.e)).toBeNull();
    expect(b.requests).toEqual([PLAIN, busted(1), busted(2)]);
  });

  it('a chunk that comes back on the next ask is used then', async () => {
    let up = false;
    const b = browser((url) => up && url !== PLAIN);
    const t = env(b.importUrl);
    expect(await loadChunk('race parts', b.load, t.e)).toBeNull();
    up = true;
    expect(await loadChunk('race parts', b.load, t.e)).toEqual({ part: 'race parts', from: busted(2) });
  });

  it("an error that names no URL (WebKit words it so) or another origin's tries the same import once more, as before", async () => {
    for (const message of [
      'Importing a module script failed.',
      'Failed to fetch dynamically imported module: https://elsewhere.example/assets/x-1.js',
    ]) {
      let tries = 0;
      const load = () =>
        ++tries === 1 ? Promise.reject(new TypeError(message)) : Promise.resolve({ ok: 1 });
      const t = env();
      expect(await loadChunk('heat badge', load, t.e)).toEqual({ ok: 1 });
      expect(tries).toBe(2);
      expect(t.imported).toEqual([]);
    }
  });
});

describe('failedChunkUrl', () => {
  it("reads Chromium's and Firefox's words, on the page's origin only, without a retry query", () => {
    expect(
      failedChunkUrl(new TypeError(`Failed to fetch dynamically imported module: ${PLAIN}`), ORIGIN),
    ).toBe(PLAIN);
    expect(failedChunkUrl(new TypeError(`error loading dynamically imported module: ${PLAIN}`), ORIGIN)).toBe(
      PLAIN,
    );
    expect(
      failedChunkUrl(new TypeError(`Failed to fetch dynamically imported module: ${busted(3)}`), ORIGIN),
    ).toBe(PLAIN);
    expect(failedChunkUrl(new TypeError('Importing a module script failed.'), ORIGIN)).toBeNull();
    expect(
      failedChunkUrl(
        new TypeError('Failed to fetch dynamically imported module: https://x.example/a.js'),
        ORIGIN,
      ),
    ).toBeNull();
    expect(
      failedChunkUrl(new TypeError('Failed to fetch dynamically imported module: .../a.js'), ORIGIN),
    ).toBeNull();
    expect(failedChunkUrl('not an error', ORIGIN)).toBeNull();
  });
});
