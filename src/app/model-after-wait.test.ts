import { describe, expect, it } from 'vitest';
import { createAssetManifest } from '../assets';
import { retryingFetch } from '../platform';

// A model held back by the loader's own wait (polish batch L, lane L2; polish batch I's punch item 1): the
// page's `fetch` (platform/'s retryingFetch) answers 429 at once, asking the host nothing, for any build
// file inside a wait the host asked for; the manifest (assets/) keeps no record of that answer, so the
// model is asked for again after the wait and arrives. The host and the clock are scripted.

type AssetIndexEntry = ReturnType<Parameters<typeof createAssetManifest>[0]>[number];
const BASE = 'https://example.test/game/';
const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
const decodeText = (data: ArrayBuffer) => new TextDecoder().decode(data);
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
type Step = number | 'network' | { status: number; retryAfter: string };
const load = (m: ReturnType<typeof createAssetManifest>) =>
  m.load(ID, () => 'box rider', { decode: decodeText });

describe('a model held back by the loader during the host wait (polish batch I, punch item 1)', () => {
  const SCOPE = BASE;
  const WAITED = `${SCOPE}assets/osm-sf-lombard-flats.json`;

  /** The page's `fetch` over a scripted host, with a clock the test moves and no real waiting. */
  function page(script: Record<string, Step[]>) {
    const asked: string[] = [];
    const left = new Map(Object.entries(script).map(([k, v]) => [k, [...v]]));
    const inner = ((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      asked.push(url);
      const step = left.get(url)?.shift() ?? 200;
      const status = typeof step === 'number' ? step : step === 'network' ? 0 : step.status;
      if (step === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      const headers: Record<string, string> =
        typeof step === 'object' ? { 'Retry-After': step.retryAfter } : {};
      return Promise.resolve(
        new Response(status === 200 ? bytes('a real rider model') : 'no', { status, headers }),
      );
    }) as typeof fetch;
    const clock = { ms: 0 };
    const fetchFn = retryingFetch(inner, {
      scope: SCOPE,
      online: () => true,
      now: () => clock.ms,
      wait: (ms) => {
        clock.ms += ms;
        return Promise.resolve();
      },
    });
    return { fetchFn, asked, clock };
  }

  it('is held by the wait, falls back, and arrives once the wait has passed', async () => {
    // San Francisco's map file is answered 429 with a 30 s wait, which holds every build file.
    const p = page({ [WAITED]: [{ status: 429, retryAfter: '30' }] });
    const m = createAssetManifest(() => [deacon], { baseUrl: SCOPE, fetchFn: p.fetchFn });
    expect((await p.fetchFn(WAITED)).status).toBe(429);
    const first = await load(m);
    // Held: the host was not asked for the model at all, and the rider keeps its stand-in.
    expect(first).toMatchObject({ fellBack: true, value: 'box rider', retryable: true });
    expect(p.asked).toEqual([WAITED]);
    // The wait passes; the next time the model is needed it is asked for, and it arrives.
    p.clock.ms += 30_000;
    const later = await load(m);
    expect(later).toMatchObject({ fellBack: false, value: 'a real rider model' });
    expect(p.asked).toEqual([WAITED, `${SCOPE}${GLB}`]);
  });

  // The wait's end (lane T2, after polish L's check, punch item 2): a race that started inside the wait
  // has the model once the wait has passed, in the same race. The loader's hold, the manifest and the
  // clock are the real ones; only the host and the manifest's timer are scripted.
  describe('through the real loader, in the same race', () => {
    /** The manifest's timer, tied to the page clock: passing a wait moves the clock to its end. */
    function timer(clock: { ms: number }) {
      const set: { ms: number; run: () => void }[] = [];
      return {
        later: (run: () => void, ms: number) => {
          set.push({ ms, run });
          return () => undefined;
        },
        set,
        passWait: (i: number) => {
          const t = set[i];
          if (!t) throw new Error('no timer set');
          clock.ms += t.ms;
          t.run();
        },
      };
    }
    const race = (script: Record<string, Step[]>, listen = true) => {
      const p = page(script);
      const t = timer(p.clock);
      const m = createAssetManifest(() => [deacon], { baseUrl: SCOPE, fetchFn: p.fetchFn, later: t.later });
      const arrived: Promise<unknown>[] = [];
      if (listen) m.onRetryReady((id) => arrived.push(m.load(id, () => 'box rider', { decode: decodeText })));
      return { ...p, t, m, arrived };
    };

    it('asks for the held model when the wait passes, and it arrives with no next race', async () => {
      const r = race({ [WAITED]: [{ status: 429, retryAfter: '30' }] });
      expect((await r.fetchFn(WAITED)).status).toBe(429);
      expect(await load(r.m)).toMatchObject({ fellBack: true, retryable: true });
      expect(r.asked).toEqual([WAITED]);
      r.t.passWait(0);
      const [got] = (await Promise.all(r.arrived)) as { fellBack: boolean; value: string }[];
      expect(got).toMatchObject({ fellBack: false, value: 'a real rider model' });
      expect(r.asked).toEqual([WAITED, `${SCOPE}${GLB}`]);
    });

    // Control: main's behaviour (nobody told) keeps the stand-in until the next race asks.
    it('without a listener the stand-in stays until the next race asks', async () => {
      const r = race({ [WAITED]: [{ status: 429, retryAfter: '30' }] }, false);
      await r.fetchFn(WAITED);
      await load(r.m);
      r.t.passWait(0);
      await Promise.resolve();
      expect(r.asked).toEqual([WAITED]);
      expect((await load(r.m)).fellBack).toBe(false);
    });

    it('does not ask again for a model the host does not have (a 404)', async () => {
      const r = race({ [`${SCOPE}${GLB}`]: [404] });
      expect(await load(r.m)).toMatchObject({ fellBack: true });
      expect(r.t.set).toHaveLength(0);
      expect(r.asked).toEqual([`${SCOPE}${GLB}`]);
    });
  });
});
