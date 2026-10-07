import { describe, expect, it } from 'vitest';
import type { AssetIndexEntry } from '../core';
import { createAssetManifest } from './index';

// Models after the host's wait (polish batch L, lane L2; polish batch I's punch item 1): a Keys race
// started inside San Francisco's 30 s wait never fetched deacon-vane.glb or chopper.glb, in that race
// or the next, because the manifest loaded each id once, whatever the answer. An asset that failed
// because of the host (a 429, a busy or briefly down host, no connection) is asked for again the next
// time it is needed; one that failed for its own sake (no such file, a bad hash, a bad decode) keeps
// its stand-in as before. The host is scripted: nothing waits on real time. (The same through the loader's
// hold: src/app/model-after-wait.test.ts.)

const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
const decodeText = (data: ArrayBuffer) => new TextDecoder().decode(data);
const BASE = 'https://example.test/game/';
const GLB = 'assets/models/deacon.glb';
const ID = 'models/riders/deacon';

const deacon: AssetIndexEntry = {
  id: ID,
  kind: 'mesh',
  source: 'baked',
  path: GLB,
  bytes: 0,
  hash: '',
  packId: 'base',
};

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Step = number | 'network' | { status: number; retryAfter: string };

/** A host that answers each ask from its script (one step per ask), then serves the file. */
function host(script: Step[]) {
  const asked: string[] = [];
  const left = [...script];
  const fn = ((input: RequestInfo | URL) => {
    asked.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const step = left.shift() ?? 200;
    if (step === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    const status = typeof step === 'number' ? step : step.status;
    const headers: Record<string, string> =
      typeof step === 'object' ? { 'Retry-After': step.retryAfter } : {};
    return Promise.resolve(
      new Response(status === 200 ? bytes('a real rider model') : 'no', { status, headers }),
    );
  }) as typeof fetch;
  return { fn, asked };
}

const load = (m: ReturnType<typeof createAssetManifest>) =>
  m.load(ID, () => 'box rider', { decode: decodeText });

describe('the asset manifest after the host asked for a wait', () => {
  it.each([429, 503, 500, 408, 425, 'network' as const])(
    'asks again after a %s, and the next load gets the model',
    async (step) => {
      const h = host([step]);
      const m = createAssetManifest(() => [deacon], { baseUrl: BASE, fetchFn: h.fn });
      const first = await load(m);
      expect(first).toMatchObject({
        source: 'procedural',
        value: 'box rider',
        fellBack: true,
        retryable: true,
      });
      expect(m.progress().perAsset[ID]).toBe('fallback');
      const second = await load(m);
      expect(second).toMatchObject({ source: 'baked', value: 'a real rider model', fellBack: false });
      expect(second.retryable).toBeUndefined();
      expect(h.asked).toHaveLength(2);
      expect(m.progress().perAsset[ID]).toBe('loaded');
      // Once it has loaded it is kept: a third load asks nothing.
      await load(m);
      expect(h.asked).toHaveLength(2);
    },
  );

  it('keeps asking while the host keeps answering 429, one ask per load', async () => {
    const h = host([429, 429]);
    const m = createAssetManifest(() => [deacon], { baseUrl: BASE, fetchFn: h.fn });
    expect((await load(m)).fellBack).toBe(true);
    expect((await load(m)).fellBack).toBe(true);
    expect(h.asked).toHaveLength(2);
    expect((await load(m)).fellBack).toBe(false);
    expect(h.asked).toHaveLength(3);
  });

  it('shares one ask between loads made while it is still running', async () => {
    const h = host([429]);
    const m = createAssetManifest(() => [deacon], { baseUrl: BASE, fetchFn: h.fn });
    const [a, b] = await Promise.all([load(m), load(m)]);
    expect(a).toBe(b);
    expect(h.asked).toHaveLength(1);
  });

  // Negative controls: a failure that is the file's own, not the host's, is not asked for again.
  it.each([404, 410, 403])(
    'keeps the stand-in after a %s (the file is not there), asking once',
    async (step) => {
      const h = host([step]);
      const m = createAssetManifest(() => [deacon], { baseUrl: BASE, fetchFn: h.fn });
      const first = await load(m);
      expect(first.fellBack).toBe(true);
      expect(first.retryable).toBeUndefined();
      await load(m);
      await load(m);
      expect(h.asked).toHaveLength(1);
    },
  );

  it('keeps the stand-in after a hash mismatch or a decode failure, asking once each', async () => {
    const otherHash = await sha256(bytes('other'));
    const wrong = createAssetManifest(() => [{ ...deacon, hash: otherHash }], {
      baseUrl: BASE,
      fetchFn: host([]).fn,
    });
    const first = await load(wrong);
    expect(first.error).toMatch(/hash mismatch/);
    expect(first.retryable).toBeUndefined();
    const h = host([]);
    const broken = createAssetManifest(() => [deacon], { baseUrl: BASE, fetchFn: h.fn });
    const second = await broken.load(ID, () => 'box rider', {
      decode: () => {
        throw new Error('not a GLB');
      },
    });
    expect(second.error).toMatch(/decode/);
    expect(second.retryable).toBeUndefined();
    await load(broken);
    expect(h.asked).toHaveLength(1);
  });
});
