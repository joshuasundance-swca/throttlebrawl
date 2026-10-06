import { afterEach, describe, expect, it } from 'vitest';
import { createPackLibrary } from '../content';
import { retryingFetch } from '../platform';

// The page's real region loader, on a host that fails first (polish lane K2; the playtest 4 run A
// second fix check: one failed San Francisco map file left 0 routes): content/'s pack library fetches
// a region's road data with the page's `fetch` (platform/retry-fetch.ts wraps it once in
// `startOffline`), so a map file that answers 503 once is fetched again instead of failing the load.

/** Reads a repo file as text (a src test has no node types; render/atlas.test.ts does the same). */
async function readRepoFile(rel: string): Promise<string> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string, enc: 'utf8'): string };
  return fs.readFileSync(rel, 'utf8');
}

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

/**
 * The page's fetch over a host that serves the repo's pack files from disk, answering `fail(url, n)`
 * first when it returns a status; `retry` wraps it as `startOffline` does. A built page serves
 * Vite's `?url` imports as `assets/<name>`; here they are `/packs/...` paths, put under `assets/`.
 */
function install(fail: (url: string, n: number) => number | null, retry: boolean) {
  const seen = new Map<string, number>();
  const inner = (async (input: RequestInfo | URL) => {
    const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
    const n = (seen.get(url) ?? 0) + 1;
    seen.set(url, n);
    const status = fail(url, n);
    if (status !== null) return new Response('no', { status });
    const file = new URL(url).pathname.replace(/^\/assets\//, '').replace(/^\/+/, '');
    return new Response(await readRepoFile(file));
  }) as typeof fetch;
  const page = retry
    ? retryingFetch(inner, {
        scope: 'http://localhost/',
        online: () => true,
        now: () => 0,
        wait: () => Promise.resolve(),
      })
    : inner;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    page(
      typeof input === 'string' && !input.startsWith('http')
        ? `http://localhost/assets/${input.replace(/^\/+/, '')}`
        : input,
      init,
    );
  return seen;
}

describe("San Francisco's road data on a host that answers 503 first for every file", () => {
  it('loads, each file asked for twice', async () => {
    const seen = install((_url, n) => (n === 1 ? 503 : null), true);
    const lib = createPackLibrary();
    expect(lib.hasRoads('region-sf')).toBe(false);
    await lib.loadRoads('region-sf');
    expect(lib.hasRoads('region-sf')).toBe(true);
    expect(seen.size).toBeGreaterThan(0);
    for (const n of seen.values()) expect(n).toBe(2);
  });

  it('control: without the retry the same load fails on the first 503, with nothing in', async () => {
    install(() => 503, false);
    const lib = createPackLibrary();
    await expect(lib.loadRoads('region-sf')).rejects.toThrow(/HTTP 503/);
    expect(lib.hasRoads('region-sf')).toBe(false);
  });

  it('a permanent failure still rejects after the four tries, so the screen can say so', async () => {
    const seen = install(() => 503, true);
    const lib = createPackLibrary();
    await expect(lib.loadRoads('region-sf')).rejects.toThrow(/HTTP 503/);
    expect(lib.hasRoads('region-sf')).toBe(false);
    for (const n of seen.values()) expect(n).toBeLessThanOrEqual(4);
  });

  it('control: a file that is missing (404) is asked for once, then rejects', async () => {
    const seen = install(() => 404, true);
    const lib = createPackLibrary();
    await expect(lib.loadRoads('region-sf')).rejects.toThrow(/HTTP 404/);
    for (const n of seen.values()) expect(n).toBe(1);
  });
});
