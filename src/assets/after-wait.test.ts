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

// The wait's end (lane T2, after polish L's check, punch item 2): a model the host held back is asked
// for again when its wait has passed, not only at the next race. The manifest reads the wait from the
// answer's Retry-After (the loader's own hold answers 429 with the wait that is left) and tells whoever
// listens (`onRetryReady`) once it is over. The timer is scripted here: a test fires it by hand.
describe('the asset manifest when host wait ends', () => {
  /** A scheduler that only records: `fire(i)` runs the i-th timer, as if its wait had passed. */
  function timers() {
    const set: { ms: number; run: () => void; cancelled: boolean }[] = [];
    return {
      later: (run: () => void, ms: number) => {
        const t = { ms, run, cancelled: false };
        set.push(t);
        return () => {
          t.cancelled = true;
        };
      },
      set,
      fire: (i: number) => {
        const t = set[i];
        if (t && !t.cancelled) t.run();
      },
    };
  }
  const held = (retryAfter: string, times = 1): Step[] =>
    Array.from({ length: times }, () => ({ status: 429, retryAfter }));

  it('tells its listeners once the wait it was held by has passed, and the next load gets the model', async () => {
    const h = host(held('30'));
    const t = timers();
    const m = createAssetManifest(() => [deacon], { baseUrl: BASE, fetchFn: h.fn, later: t.later });
    const ready: string[] = [];
    m.onRetryReady((id) => ready.push(id));
    expect((await load(m)).retryable).toBe(true);
    // One timer, no sooner than the wait and not much later.
    expect(t.set).toHaveLength(1);
    expect(t.set[0]?.ms).toBeGreaterThanOrEqual(30_000);
    expect(t.set[0]?.ms).toBeLessThan(31_000);
    expect(ready).toEqual([]);
    t.fire(0);
    expect(ready).toEqual([ID]);
    expect((await load(m)).fellBack).toBe(false);
    expect(h.asked).toHaveLength(2);
  });

  it('stops listening when told to', async () => {
    const h = host(held('30'));
    const t = timers();
    const m = createAssetManifest(() => [deacon], { baseUrl: BASE, fetchFn: h.fn, later: t.later });
    const ready: string[] = [];
    const off = m.onRetryReady((id) => ready.push(id));
    await load(m);
    off();
    t.fire(0);
    expect(ready).toEqual([]);
  });

  // Negative controls: no wait, nothing to be told about.
  it.each([
    ['a 404', 404],
    ['a 503 with no Retry-After', 503],
    ['a connection failure', 'network' as const],
    ['a 429 with a Retry-After of 0', { status: 429, retryAfter: '0' }],
    ['a 429 asking for more than 5 minutes', { status: 429, retryAfter: '3600' }],
    ['a 429 whose Retry-After cannot be read', { status: 429, retryAfter: 'soon' }],
  ] as [string, Step][])('sets no timer after %s', async (_name, step) => {
    const h = host([step]);
    const t = timers();
    const m = createAssetManifest(() => [deacon], { baseUrl: BASE, fetchFn: h.fn, later: t.later });
    await load(m);
    expect(t.set).toHaveLength(0);
  });

  it('says nothing when the model has loaded by then (the next race asked first)', async () => {
    const h = host(held('30'));
    const t = timers();
    const m = createAssetManifest(() => [deacon], { baseUrl: BASE, fetchFn: h.fn, later: t.later });
    const ready: string[] = [];
    m.onRetryReady((id) => ready.push(id));
    await load(m);
    expect((await load(m)).fellBack).toBe(false);
    t.fire(0);
    expect(ready).toEqual([]);
  });

  it('asks again for a wait only a few times in a row, so a host that keeps holding is not chased', async () => {
    const h = host(held('1', 10));
    const t = timers();
    const m = createAssetManifest(() => [deacon], { baseUrl: BASE, fetchFn: h.fn, later: t.later });
    const ready: string[] = [];
    m.onRetryReady((id) => {
      ready.push(id);
      void load(m);
    });
    await load(m);
    for (let i = 0; i < 10; i++) {
      t.fire(i);
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(ready).toHaveLength(3);
    expect(t.set).toHaveLength(3);
  });
});

// Polish L's punch item 3: #666's `res.body.cancel()` on a failed model answer showed in the network record
// as a net::ERR_ABORTED about 10 ms after each one. The answer's small error body is left unread instead.
describe('a failed model answer is not cancelled', () => {
  it.each([404, 429, 503])('leaves the body of a %s answer alone', async (status) => {
    let cancelled = 0;
    const fn = (() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start: (c) => {
              c.enqueue(bytes('no'));
              c.close();
            },
            cancel: () => {
              cancelled++;
            },
          }),
          { status },
        ),
      )) as typeof fetch;
    const m = createAssetManifest(() => [deacon], { baseUrl: BASE, fetchFn: fn });
    expect((await load(m)).fellBack).toBe(true);
    await Promise.resolve();
    expect(cancelled).toBe(0);
  });
});
