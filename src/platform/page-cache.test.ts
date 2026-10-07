import { describe, expect, it } from 'vitest';
import { readsOfflineCaches, type PageCacheEnv } from './page-cache';

// The page's reads of the offline worker's caches before that worker controls it (polish batch F's
// check, punch item 1: three models the install had taken as gzip copies were downloaded again by
// the page). The whole first visit, with the host's real headers, is in offline-worker.test.ts.

const SCOPE = 'https://game.example/sub/';
const MODEL = `${SCOPE}assets/ds/keys/bike-B1.glb`;

function setup(opts: { controlled?: boolean; cached?: Record<string, string>; broken?: boolean } = {}) {
  const asked: string[] = [];
  const inner = ((input: RequestInfo | URL) => {
    asked.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(new Response('from the network'));
  }) as typeof fetch;
  const looked: string[] = [];
  const env: PageCacheEnv = {
    scope: SCOPE,
    controlled: () => opts.controlled ?? false,
    match: (url) => {
      looked.push(url);
      if (opts.broken) return Promise.reject(new Error('SecurityError'));
      const body = opts.cached?.[url];
      return Promise.resolve(body === undefined ? undefined : new Response(body));
    },
  };
  return { fetch: readsOfflineCaches(inner, env), asked, looked };
}

describe("the page's reads of the offline caches", () => {
  it('answers a build file the install has cached without the network', async () => {
    const t = setup({ cached: { [MODEL]: 'glTF from the cache' } });
    expect(await (await t.fetch(MODEL)).text()).toBe('glTF from the cache');
    expect(await (await t.fetch(new Request(MODEL))).text()).toBe('glTF from the cache');
    expect(t.asked).toEqual([]);
  });

  it('asks the network on a miss, and when the caches cannot be read', async () => {
    const miss = setup({ cached: {} });
    expect(await (await miss.fetch(MODEL)).text()).toBe('from the network');
    expect(miss.asked).toEqual([MODEL]);
    const broken = setup({ broken: true });
    expect(await (await broken.fetch(MODEL)).text()).toBe('from the network');
    expect(broken.asked).toEqual([MODEL]);
  });

  it('leaves a page the worker controls, anything but a GET and files outside assets/ alone (the negative control)', async () => {
    const controlled = setup({ controlled: true, cached: { [MODEL]: 'cached' } });
    await controlled.fetch(MODEL);
    expect(controlled.looked).toEqual([]);
    expect(controlled.asked).toEqual([MODEL]);

    const other = setup({ cached: { [MODEL]: 'cached', [`${SCOPE}changelog.json`]: 'cached' } });
    await other.fetch(MODEL, { method: 'POST' });
    await other.fetch(`${SCOPE}changelog.json`);
    await other.fetch('https://elsewhere.example/assets/x.glb');
    expect(other.looked).toEqual([]);
    expect(other.asked).toHaveLength(3);
  });
});
