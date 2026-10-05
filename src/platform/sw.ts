// The offline service worker's entry (docs/engineering.md, "Deploy: game Space and staging Space",
// Offline). scripts/service-worker.mjs builds this file on its own as `sw.js` beside index.html and
// puts this build's config in front of it as `self.__OFFLINE__`; the policy is offline-worker.ts.
// Only a production build has the worker (platform/'s registerOfflineWorker), so a dev server never
// caches anything.
import { createOfflineWorker, type OfflineConfig, type OfflineEnv } from './offline-worker';

/** The service worker global, reduced to what this entry uses (the DOM lib has no worker types). */
interface WorkerGlobal {
  __OFFLINE__?: OfflineConfig;
  registration: { scope: string };
  caches: CacheStorage;
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  fetch(req: RequestInfo, init?: RequestInit): Promise<Response>;
  addEventListener(
    type: 'install' | 'activate',
    cb: (e: { waitUntil(p: Promise<unknown>): void }) => void,
  ): void;
  addEventListener(
    type: 'fetch',
    cb: (e: { request: Request; respondWith(r: Promise<Response>): void }) => void,
  ): void;
}

const sw = self as unknown as WorkerGlobal;
const config = sw.__OFFLINE__;
// The game's host answers with `Vary: Origin` (index.html and a script on the Space, 2026-10-05); a
// cached copy must match whatever headers the asking request carried.
const MATCH: CacheQueryOptions = { ignoreVary: true };

if (config) {
  const env: OfflineEnv = {
    scope: sw.registration.scope,
    caches: {
      open: async (name) => {
        const c = await sw.caches.open(name);
        return { match: (key) => c.match(key, MATCH), put: (key, res) => c.put(key, res) };
      },
      keys: () => sw.caches.keys(),
      delete: (name) => sw.caches.delete(name),
      match: (key) => sw.caches.match(key, MATCH),
    },
    fetch: (req, init) => sw.fetch(req as Request | string, init),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  const worker = createOfflineWorker(env, config);
  sw.addEventListener('install', (e) => e.waitUntil(worker.install().then(() => sw.skipWaiting())));
  sw.addEventListener('activate', (e) => e.waitUntil(worker.activate().then(() => sw.clients.claim())));
  sw.addEventListener('fetch', (e) => {
    const answer = worker.respond(e.request);
    if (answer) e.respondWith(answer);
  });
}
