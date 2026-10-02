import { describe, expect, it } from 'vitest';
import type { AssetIndexEntry } from '../core';
import { createAssetManifest, datasetIndex, datasetRegions, type AssetProgress } from './index';

// assets-1 acceptance (docs/milestones/M1.md): a missing optional asset falls back to its
// procedural stand-in. Plus the baked loader, the hash check, per-asset progress and the
// procedural source. Fetch is injected, so this runs in Node against the same code the browser runs.

const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const entry = (over: Partial<AssetIndexEntry>): AssetIndexEntry => ({
  id: 'base:thing',
  kind: 'data-page',
  source: 'baked',
  path: 'assets/thing.bin',
  bytes: 0,
  hash: '',
  packId: 'base',
  ...over,
});

/** A fetch over an in-memory file table; unknown paths answer 404. Records the URLs asked for. */
function fakeFetch(files: Record<string, Uint8Array<ArrayBuffer>>) {
  const asked: string[] = [];
  const fn = (url: string | URL | Request) => {
    const href = url instanceof Request ? url.url : url.toString();
    asked.push(href);
    const path = new URL(href).pathname.replace(/^\/game\//, '');
    const file = files[path];
    if (!file) return Promise.resolve(new Response('missing', { status: 404 }));
    // Two chunks, so progress sees a partial state.
    const half = Math.ceil(file.length / 2);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(file.slice(0, half));
        if (file.length > half) c.enqueue(file.slice(half));
        c.close();
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  };
  return { fn: fn, asked };
}

const decodeText = (data: ArrayBuffer) => new TextDecoder().decode(data);
const BASE = 'https://example.test/game/';

describe('the asset manifest', () => {
  it('falls back to the procedural stand-in when an optional baked asset is missing', async () => {
    const f = fakeFetch({});
    const m = createAssetManifest(
      () => [entry({ id: 'base:horn', kind: 'audio', path: 'assets/horn.ogg' })],
      {
        baseUrl: BASE,
        fetchFn: f.fn,
      },
    );
    const got = await m.load('base:horn', () => 'synth horn', { decode: decodeText });
    expect(got).toMatchObject({ id: 'base:horn', source: 'procedural', value: 'synth horn', fellBack: true });
    expect(got.error).toMatch(/404/);
    expect(f.asked).toEqual(['https://example.test/game/assets/horn.ogg']);
    expect(m.progress().perAsset['base:horn']).toBe('fallback');
  });

  it('falls back for an id the manifest does not know, without fetching', async () => {
    const f = fakeFetch({});
    const m = createAssetManifest(() => [], { baseUrl: BASE, fetchFn: f.fn });
    const got = await m.load('base:nothing', () => 42);
    expect(got).toMatchObject({ source: 'procedural', value: 42, fellBack: true });
    expect(f.asked).toEqual([]);
  });

  it('loads a baked asset relative to the base, checks its SHA-256, and reports progress', async () => {
    const data = bytes('the road page, baked');
    const f = fakeFetch({ 'assets/page.bin': data });
    const e = entry({
      id: 'base:page',
      path: 'assets/page.bin',
      bytes: data.length,
      hash: await sha256(data),
    });
    const m = createAssetManifest(() => [e], { baseUrl: BASE, fetchFn: f.fn });
    const seen: AssetProgress[] = [];
    m.onProgress((p) => seen.push(p));
    const got = await m.load('base:page', () => 'stand-in', { decode: decodeText });
    expect(got).toMatchObject({ source: 'baked', value: 'the road page, baked', fellBack: false });
    const last = m.progress();
    expect(last).toMatchObject({
      total: 1,
      done: 1,
      fellBack: 0,
      bytesLoaded: data.length,
      bytesTotal: data.length,
    });
    expect(last.perAsset['base:page']).toBe('loaded');
    // A partial byte count arrived before the end.
    expect(seen.some((p) => p.bytesLoaded > 0 && p.bytesLoaded < data.length)).toBe(true);
  });

  it('refuses a baked asset whose hash does not match, and uses the stand-in', async () => {
    const f = fakeFetch({ 'assets/page.bin': bytes('tampered') });
    const e = entry({ id: 'base:page', path: 'assets/page.bin', hash: await sha256(bytes('original')) });
    const m = createAssetManifest(() => [e], { baseUrl: BASE, fetchFn: f.fn });
    const got = await m.load('base:page', () => 'stand-in', { decode: decodeText });
    expect(got).toMatchObject({ value: 'stand-in', fellBack: true });
    expect(got.error).toMatch(/hash/);
  });

  it('falls back when decoding fails or when no decoder is given', async () => {
    const f = fakeFetch({ 'assets/a.bin': bytes('x') });
    const m = createAssetManifest(() => [entry({ id: 'base:a', path: 'assets/a.bin' })], {
      baseUrl: BASE,
      fetchFn: f.fn,
    });
    const bad = await m.load('base:a', () => 'stand-in', {
      decode: () => {
        throw new Error('not an image');
      },
    });
    expect(bad).toMatchObject({ value: 'stand-in', fellBack: true });
    const none = await createAssetManifest(() => [entry({ id: 'base:a', path: 'assets/a.bin' })], {
      baseUrl: BASE,
      fetchFn: f.fn,
    }).load('base:a', () => 'stand-in');
    expect(none).toMatchObject({ value: 'stand-in', fellBack: true });
  });

  it('falls back when the network itself throws', async () => {
    const m = createAssetManifest(() => [entry({})], {
      baseUrl: BASE,
      fetchFn: () => Promise.reject(new TypeError('offline')),
    });
    expect(await m.load('base:thing', () => 's', { decode: decodeText })).toMatchObject({ fellBack: true });
  });

  it('makes procedural assets from their generator, as a normal load', async () => {
    const f = fakeFetch({});
    const m = createAssetManifest(
      () => [entry({ id: 'base:rider-box', kind: 'procedural', source: 'procedural', path: 'box' })],
      { baseUrl: BASE, fetchFn: f.fn },
    );
    const got = await m.load('base:rider-box', () => ({ w: 0.6 }));
    expect(got).toMatchObject({ source: 'procedural', value: { w: 0.6 }, fellBack: false });
    expect(f.asked).toEqual([]);
  });

  it('treats the remote source as not built yet in M1: the stand-in, with a reason', async () => {
    const m = createAssetManifest(() => [entry({ source: 'remote' })], {
      baseUrl: BASE,
      fetchFn: fakeFetch({}).fn,
    });
    const got = await m.load('base:thing', () => 's', { decode: decodeText });
    expect(got).toMatchObject({ fellBack: true });
    expect(got.error).toMatch(/remote/);
  });

  it('loads each id once, however many callers ask at the same time', async () => {
    const f = fakeFetch({ 'assets/a.bin': bytes('once') });
    const m = createAssetManifest(() => [entry({ id: 'base:a', path: 'assets/a.bin' })], {
      baseUrl: BASE,
      fetchFn: f.fn,
    });
    const [a, b] = await Promise.all([
      m.load('base:a', () => '', { decode: decodeText }),
      m.load('base:a', () => '', { decode: decodeText }),
    ]);
    expect(a.value).toBe('once');
    expect(b.value).toBe('once');
    expect(f.asked).toHaveLength(1);
  });

  it('lists and resolves the pack index entries', () => {
    const m = createAssetManifest(() => [entry({ id: 'base:a' }), entry({ id: 'base:b' })], {
      baseUrl: BASE,
    });
    expect(m.entries().map((e) => e.id)).toEqual(['base:a', 'base:b']);
    expect(m.resolve('base:b')?.id).toBe('base:b');
    expect(m.resolve('base:c')).toBeNull();
    expect(m.progress()).toMatchObject({ total: 2, done: 0 });
  });

  it('loads a dataset asset (run W-Q) from the build like a baked one, hash-checked', async () => {
    const data = bytes('a real rider model');
    const path = 'assets/ds/florida-keys/deacon-12345678.glb';
    const f = fakeFetch({ [path]: data });
    const e = entry({
      id: 'models/riders/deacon',
      kind: 'mesh',
      source: 'dataset',
      path,
      bytes: data.length,
      hash: await sha256(data),
      region: 'florida-keys',
    });
    const m = createAssetManifest(() => [e], { baseUrl: BASE, fetchFn: f.fn });
    const got = await m.load('models/riders/deacon', () => 'box rider', { decode: decodeText });
    expect(got).toMatchObject({ source: 'dataset', value: 'a real rider model', fellBack: false });
    expect(f.asked).toEqual([`https://example.test/game/${path}`]);
    const otherHash = await sha256(bytes('other'));
    const bad = createAssetManifest(() => [{ ...e, hash: otherHash }], {
      baseUrl: BASE,
      fetchFn: fakeFetch({ [path]: data }).fn,
    });
    expect((await bad.load('models/riders/deacon', () => 'box rider', { decode: decodeText })).fellBack).toBe(
      true,
    );
  });
});

describe('the dataset rows this build carries (assets.lock.json)', () => {
  it('lists each pinned file as a dataset row, every region or one', () => {
    const rows = datasetIndex();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.source).toBe('dataset');
      expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.bytes).toBeGreaterThan(0);
      expect(r.id).not.toMatch(/\.[a-z0-9]+$/);
    }
    const shared = rows.filter((r) => r.region === undefined);
    for (const region of ['florida-keys', ...datasetRegions()]) {
      const mine = datasetIndex(region);
      expect(mine.filter((r) => r.region === undefined)).toEqual(shared);
      expect(mine.every((r) => r.region === undefined || r.region === region)).toBe(true);
    }
  });
});
