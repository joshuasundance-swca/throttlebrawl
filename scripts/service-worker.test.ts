// The offline worker's build step (scripts/service-worker.mjs): the worker's precache list is every
// file the build wrote but the worker itself, and its cache name changes whenever any file's bytes
// do, so a deploy always installs a new worker with a new cache and the last build's is dropped.
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CACHE_PREFIX } from '../src/platform/offline-worker';
import { SERVICE_WORKER_FILE } from '../src/platform/index';
import { SW_FILE, workerConfig, workerSource } from './service-worker.mjs';

const enc = (s: string) => new TextEncoder().encode(s);
/** A built page: it loads its entry script, as Vite's index.html does. */
const PAGE = '<html><script type="module" crossorigin src="./assets/index-AAA.js"></script>';

describe('the offline worker build step', () => {
  it('writes the file the page registers', () => {
    expect(SW_FILE).toBe(SERVICE_WORKER_FILE);
  });

  it('lists every built file but the worker, as page-relative paths', () => {
    const cfg = workerConfig('abc1234', [
      { path: 'index.html', bytes: enc(PAGE) },
      { path: 'assets\\index-AAA.js', bytes: enc('x') },
      { path: SW_FILE, bytes: enc('worker') },
      { path: 'icon-192.png', bytes: enc('png') },
    ]);
    expect([...cfg.files].sort()).toEqual(['assets/index-AAA.js', 'icon-192.png', 'index.html']);
    expect(cfg.cache.startsWith(`${CACHE_PREFIX}abc1234-`)).toBe(true);
  });

  it("names a new cache when any file's bytes change, and the same one when nothing does", () => {
    const files = [
      { path: 'index.html', bytes: enc(PAGE) },
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

  it("tells the worker how to know each unhashed file is this build's: its SHA-256, or the page's entry script", () => {
    // Playtest 4 run A, mustFix 2: a deploy during a tab's install gave the worker the next build's
    // page. The game Space adds a script of its own to HTML (checked on the live host, 2026-10-05), so
    // a page is known by the entry script it loads, which is renamed whenever the build changes.
    const page =
      '<!doctype html><link rel="modulepreload" crossorigin href="./assets/sim-S1.js">' +
      '<script type="module" crossorigin src="./assets/index-B49G7VWi.js"></script>';
    const cfg = workerConfig('abc1234', [
      { path: 'index.html', bytes: enc(page) },
      { path: 'manifest.webmanifest', bytes: enc('{}') },
      { path: 'assets\\index-B49G7VWi.js', bytes: enc('x') },
      { path: SW_FILE, bytes: enc('worker') },
    ]);
    expect(cfg.checks).toEqual({
      'index.html': { contains: 'assets/index-B49G7VWi.js' },
      // sha256('{}')
      'manifest.webmanifest': { sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a' },
    });
    // A page with no entry script cannot be told apart: the build fails rather than ship a worker
    // that would cache any build's page.
    expect(() => workerConfig('abc1234', [{ path: 'index.html', bytes: enc('<html>') }])).toThrow(
      /index\.html/,
    );
  });

  it('hands the worker its config ahead of its code', () => {
    const config = { cache: 'c', files: ['index.html'], checks: { 'index.html': { contains: 'x.js' } } };
    const src = workerSource(config, 'run();');
    expect(src.indexOf('"index.html"')).toBeLessThan(src.indexOf('run();'));
    const scope: { __OFFLINE__?: unknown } = {};
    runInNewContext(src.replace('run();', ''), { self: scope });
    expect(scope.__OFFLINE__).toEqual(config);
  });
});
