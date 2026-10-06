// The gzip-copy probe (scripts/gzip-probe.mjs): it reads the worker's config from the host's sw.js
// and judges a gzip copy as the host answered it the way the offline worker would use it.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { workerConfig, workerSource } from './service-worker.mjs';
import { entryOf, firstLoadScriptsOf, judgeCopy, workerConfigOf } from './gzip-probe.mjs';

const enc = (s: string) => new TextEncoder().encode(s);
const PAGE = '<html><script type="module" crossorigin src="./assets/index-AAA.js"></script>';

describe('the gzip-copy probe', () => {
  it("reads the worker's config from the worker file the build writes", () => {
    const config = workerConfig('abc1234', [
      { path: 'index.html', bytes: enc(PAGE) },
      { path: 'assets/index-AAA.js', bytes: enc('x') },
    ]);
    const read = workerConfigOf(workerSource(config, 'self.addEventListener("fetch", () => {});'));
    expect(read).toEqual(config);
    expect(read?.gzip).toEqual(['.glb', '.js', '.json']);
    expect(workerConfigOf('console.log(1);')).toBeNull();
    expect(entryOf(PAGE)).toBe('assets/index-AAA.js');
  });

  it('passes a copy that unpacks to its file, and fails one that is missing, plain or of other bytes', () => {
    const plain = enc('export const x = 1;'.repeat(50));
    const packed = new Uint8Array(gzipSync(plain));
    expect(judgeCopy({ status: 200, encoding: '', body: packed }, plain)).toMatchObject({ ok: true });
    expect(judgeCopy({ status: 200, encoding: 'gzip', body: packed }, plain).how).toMatch(/Content-Encoding/);
    expect(judgeCopy({ status: 404, encoding: '', body: enc('Entry not found') }, plain)).toMatchObject({
      ok: false,
    });
    expect(judgeCopy({ status: 200, encoding: '', body: plain }, plain)).toMatchObject({ ok: false });
    const other = new Uint8Array(gzipSync(enc('export const y = 2;')));
    expect(judgeCopy({ status: 200, encoding: '', body: other }, plain)).toMatchObject({ ok: false });
    expect(judgeCopy({ status: 200, encoding: '', body: packed.subarray(0, 20) }, plain)).toMatchObject({
      ok: false,
    });
  });

  it("samples the page's first-load scripts, which hold the largest copies (punch item 7)", () => {
    // The live page's tags (build bae17cc): content and sim, the two largest copies after the entry,
    // are module preloads; the old probe sampled the first lazy chunk in name order (82 bytes).
    const page =
      '<link rel="manifest" href="./manifest.webmanifest" />' +
      '<script type="module" crossorigin src="./assets/index-DqQGxmLN.js"></script>' +
      '<link rel="modulepreload" crossorigin href="./assets/preload-helper-BaNbYf_w.js">' +
      '<link rel="modulepreload" crossorigin href="./assets/sim-Bp2g9eKY.js">' +
      '<link rel="modulepreload" crossorigin href="./assets/content-D9y6NrEw.js">' +
      '<link rel="preload" as="fetch" crossorigin href="./assets/keys-m1-Bj0C848g.json">';
    expect(firstLoadScriptsOf(page)).toEqual([
      'assets/index-DqQGxmLN.js',
      'assets/preload-helper-BaNbYf_w.js',
      'assets/sim-Bp2g9eKY.js',
      'assets/content-D9y6NrEw.js',
    ]);
    expect(firstLoadScriptsOf('<html></html>')).toEqual([]);
  });

  it('fails a copy whose redirect to the CDN the worker cannot read (no CORS header), and names the CDN', () => {
    // Live, 2026-10-06: content's and sim's copies answer 302 to us.aws.cdn.hf.co, which sends
    // `access-control-allow-origin: *`. The worker's fetch follows that redirect in CORS mode.
    const plain = enc('export const x = 1;'.repeat(50));
    const packed = new Uint8Array(gzipSync(plain));
    const viaCdn = { status: 200, encoding: '', body: packed, via: 'us.aws.cdn.hf.co' };
    const ok = judgeCopy({ ...viaCdn, cors: '*' }, plain);
    expect(ok).toMatchObject({ ok: true });
    expect(ok.how).toMatch(/302 to us\.aws\.cdn\.hf\.co/);
    expect(judgeCopy({ ...viaCdn, cors: '' }, plain)).toMatchObject({ ok: false });
    expect(
      judgeCopy({ ...viaCdn, cors: 'https://elsewhere.example' }, plain, 'https://game.example'),
    ).toMatchObject({
      ok: false,
    });
    expect(
      judgeCopy({ ...viaCdn, cors: 'https://game.example' }, plain, 'https://game.example'),
    ).toMatchObject({
      ok: true,
    });
    // A copy served by the host itself needs no CORS header (the negative control).
    expect(judgeCopy({ status: 200, encoding: '', body: packed, cors: '' }, plain)).toMatchObject({
      ok: true,
    });
  });
});
