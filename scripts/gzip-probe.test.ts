// The gzip-copy probe (scripts/gzip-probe.mjs): it reads the worker's config from the host's sw.js
// and judges a gzip copy as the host answered it the way the offline worker would use it.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { workerConfig, workerSource } from './service-worker.mjs';
import { entryOf, judgeCopy, workerConfigOf } from './gzip-probe.mjs';

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
});
