// The offline worker's build step (scripts/service-worker.mjs): the worker's precache list is every
// file the build wrote but the worker itself, and its cache name changes whenever any file's bytes
// do, so a deploy always installs a new worker with a new cache and the last build's is dropped.
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CACHE_PREFIX } from '../src/platform/offline-worker';
import { SERVICE_WORKER_FILE } from '../src/platform/index';
import { SW_FILE, workerConfig, workerSource } from './service-worker.mjs';

const enc = (s: string) => new TextEncoder().encode(s);

describe('the offline worker build step', () => {
  it('writes the file the page registers', () => {
    expect(SW_FILE).toBe(SERVICE_WORKER_FILE);
  });

  it('lists every built file but the worker, as page-relative paths', () => {
    const cfg = workerConfig('abc1234', [
      { path: 'index.html', bytes: enc('<html>') },
      { path: 'assets\\index-AAA.js', bytes: enc('x') },
      { path: SW_FILE, bytes: enc('worker') },
      { path: 'icon-192.png', bytes: enc('png') },
    ]);
    expect([...cfg.files].sort()).toEqual(['assets/index-AAA.js', 'icon-192.png', 'index.html']);
    expect(cfg.cache.startsWith(`${CACHE_PREFIX}abc1234-`)).toBe(true);
  });

  it("names a new cache when any file's bytes change, and the same one when nothing does", () => {
    const files = [
      { path: 'index.html', bytes: enc('<html>') },
      { path: 'manifest.webmanifest', bytes: enc('{}') },
    ];
    const a = workerConfig('abc1234', files).cache;
    expect(workerConfig('abc1234', [...files].reverse()).cache).toBe(a);
    expect(
      workerConfig('abc1234', [files[0]!, { path: 'manifest.webmanifest', bytes: enc('{ }') }]).cache,
    ).not.toBe(a);
    // The worker's own bytes are not part of it (they carry the name).
    expect(workerConfig('abc1234', [...files, { path: SW_FILE, bytes: enc('anything') }]).cache).toBe(a);
  });

  it('hands the worker its config ahead of its code', () => {
    const src = workerSource({ cache: 'c', files: ['index.html'] }, 'run();');
    expect(src.indexOf('"index.html"')).toBeLessThan(src.indexOf('run();'));
    const scope: { __OFFLINE__?: unknown } = {};
    runInNewContext(src.replace('run();', ''), { self: scope });
    expect(scope.__OFFLINE__).toEqual({ cache: 'c', files: ['index.html'] });
  });
});
