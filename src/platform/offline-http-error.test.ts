import { describe, expect, it } from 'vitest';
import { createOfflineWorker, type OfflineCache, type OfflineCaches } from './offline-worker';

const SCOPE = 'https://game.example/sub/';

describe('installed return when the host answers an HTTP error', () => {
  for (const status of [200, 429, 500, 503]) {
    for (const [rel, mode] of [
      ['', 'navigate'],
      ['index.html', 'cors'],
      ['manifest.webmanifest', 'cors'],
      ['changelog.json', 'cors'],
    ] as const) {
      for (const cached of [true, false]) {
        it(`${status} for ${rel || 'navigation'} ${cached ? 'with' : 'without'} cached content`, async () => {
          const key = new URL(rel || 'index.html', SCOPE).href;
          const saved = new Map<string, Response>();
          if (cached) saved.set(key, new Response('cached game content'));
          const cache: OfflineCache = {
            match: (url) => Promise.resolve(saved.get(url)?.clone()),
            put: (url, res) => {
              saved.set(url, res);
              return Promise.resolve();
            },
          };
          const caches: OfflineCaches = {
            open: () => Promise.resolve(cache),
            keys: () => Promise.resolve(['offline-test']),
            delete: () => Promise.resolve(false),
            match: (url) => cache.match(url),
          };
          const asked: string[] = [];
          const worker = createOfflineWorker(
            {
              scope: SCOPE,
              caches,
              fetch: (req) => {
                asked.push(typeof req === 'string' ? req : req.url);
                return Promise.resolve(new Response('host unavailable', { status }));
              },
              delay: () => new Promise<void>(() => undefined),
            },
            { cache: 'offline-test', files: ['index.html', 'manifest.webmanifest'], checks: {} },
          );
          const res = await worker.respond({ url: new URL(rel, SCOPE).href, method: 'GET', mode });
          const fallback = cached && status !== 200;
          expect(res?.status).toBe(fallback ? 200 : status);
          expect(await res?.text()).toBe(fallback ? 'cached game content' : 'host unavailable');
          expect(asked).toEqual([new URL(rel, SCOPE).href]);
          const refreshed = rel === 'changelog.json' && status === 200;
          expect(saved.size).toBe(cached || refreshed ? 1 : 0);
          if (cached || refreshed)
            expect(await saved.get(key)?.clone().text()).toBe(
              refreshed ? 'host unavailable' : 'cached game content',
            );
        });
      }
    }
  }
});
