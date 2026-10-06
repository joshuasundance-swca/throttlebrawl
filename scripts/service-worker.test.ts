// The offline worker's build step (scripts/service-worker.mjs): the worker's precache list is every
// file the build wrote but the worker itself, and its cache name changes whenever any file's bytes
// do, so a deploy always installs a new worker with a new cache and the last build's is dropped.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CACHE_PREFIX } from '../src/platform/offline-worker';
import { SERVICE_WORKER_FILE } from '../src/platform/index';
import { SW_FILE, serviceWorkerPlugin, workerConfig, workerSource } from './service-worker.mjs';

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

  it('writes a gzip copy beside each JavaScript, JSON and model file under assets/, and the worker list leaves the copies out', () => {
    // Playtest 4 run B's live check, punch item 8: the game's host sends every file uncompressed
    // (no Content-Encoding, whatever the browser accepts), so a phone downloaded 1.64 MB of
    // first-load JavaScript, not the 472 KB gzip the budget counts. The host serves stored bytes as
    // they are, so the build stores a `.gz` copy the offline worker downloads and unpacks itself.
    const dir = mkdtempSync(path.join(tmpdir(), 'tb-sw-'));
    try {
      const big =
        'export const road = ' + JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ i, x: i * 2 })));
      const files: Record<string, string> = {
        'index.html': PAGE,
        'assets/index-AAA.js': big,
        'assets/road-R1.json': JSON.stringify({ points: Array.from({ length: 300 }, (_, i) => [i, i]) }),
        'assets/ds/keys/bike-B1.glb': 'glTF'.repeat(500),
        'assets/ds/keys/clip-C1.ogg': 'OggS'.repeat(100),
        'manifest.webmanifest': '{}',
        'icon-192.png': 'png',
        [SW_FILE]: 'self.addEventListener("fetch", () => {});',
      };
      for (const [rel, body] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        writeFileSync(path.join(dir, rel), body);
      }
      const plugin = serviceWorkerPlugin({ root: dir, buildId: 'abc1234' });
      plugin.writeBundle.handler({ dir });

      const gz = readdirSync(dir, { recursive: true })
        .map((p) => String(p).split(path.sep).join('/'))
        .filter((p) => p.endsWith('.gz'))
        .sort();
      expect(gz).toEqual([
        'assets/ds/keys/bike-B1.glb.gz',
        'assets/index-AAA.js.gz',
        'assets/road-R1.json.gz',
      ]);
      for (const p of gz) {
        const original = readFileSync(path.join(dir, p.slice(0, -3)));
        const packed = readFileSync(path.join(dir, p));
        expect(gunzipSync(packed).equals(original), p).toBe(true);
        expect(packed.length, `${p} is smaller than its file`).toBeLessThan(original.length);
      }
      // Negative control: audio, the page, the manifest and the icon get no copy (audio is already
      // compressed; the rest sit outside assets/ and are checked by their bytes).
      expect(gz.some((p) => /\.(ogg|html|webmanifest|png)\.gz$/.test(p))).toBe(false);

      // The worker learns which files have a copy, and never caches a copy as a file of its own.
      const scope: { __OFFLINE__?: { files: string[]; gzip?: string[] } } = {};
      runInNewContext(readFileSync(path.join(dir, SW_FILE), 'utf8'), {
        self: Object.assign(scope, { addEventListener: () => undefined }),
      });
      const config = scope.__OFFLINE__ ?? { files: [] };
      expect(config.gzip).toEqual(['.glb', '.js', '.json']);
      expect(config.files.filter((f) => f.endsWith('.gz'))).toEqual([]);
      expect(config.files).toContain('assets/index-AAA.js');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the files index.html itself loads, which a first visit has in the HTTP cache (punch item 1)', () => {
    // The live page's tags (build bae17cc): the entry script, module preloads and road-file
    // preloads under assets/, plus icon and manifest links outside it, which are not hashed files.
    const page =
      '<!doctype html><link rel="icon" type="image/png" href="./icon-192.png" />' +
      '<link rel="manifest" href="./manifest.webmanifest" />' +
      '<script type="module" crossorigin src="./assets/index-AAA.js"></script>' +
      '<link rel="modulepreload" crossorigin href="./assets/sim-S1.js">' +
      '<link rel="modulepreload" crossorigin href="./assets/three.core-T1.js">' +
      '<link rel="preload" as="fetch" crossorigin href="./assets/c-boardwalk-in-R1.json">' +
      '<link rel="preload" as="fetch" crossorigin href="./assets/not-built-X1.json">';
    const built = [
      'assets/index-AAA.js',
      'assets/sim-S1.js',
      'assets/three.core-T1.js',
      'assets/c-boardwalk-in-R1.json',
    ];
    const cfg = workerConfig('abc1234', [
      { path: 'index.html', bytes: enc(page) },
      { path: 'manifest.webmanifest', bytes: enc('{}') },
      { path: 'icon-192.png', bytes: enc('png') },
      { path: 'assets/landmarks-L1.js', bytes: enc('lazy') },
      ...built.map((p) => ({ path: p, bytes: enc(p) })),
    ]);
    expect(cfg.firstLoad).toEqual([...built].sort());
    // The negative control: a page that loads only its entry names only its entry.
    expect(
      workerConfig('abc1234', [
        { path: 'index.html', bytes: enc(PAGE) },
        { path: 'assets/index-AAA.js', bytes: enc('x') },
        { path: 'assets/landmarks-L1.js', bytes: enc('lazy') },
      ]).firstLoad,
    ).toEqual(['assets/index-AAA.js']);
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
