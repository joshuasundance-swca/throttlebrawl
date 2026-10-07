import { describe, expect, it } from 'vitest';
import type { AssetLoad, AssetManifest } from '../../assets';
import { createFlatLook } from '../look';
import { riderLookOf } from '../rider-looks';
import { defaultRenderParams } from '../tuning';
import type { BakedPart } from './bake';
import { RiderRigs } from './index';
import { fakeBike, fakeRider } from './rig-fixtures.test-util';

// A rider's models after the host's wait (polish batch L, lane L2; polish batch I's punch item 1): a
// Keys race started inside San Francisco's 30 s wait never fetched deacon-vane.glb or chopper.glb, nor
// in the next race, because the rigs kept the failed answer for the session. A model the manifest says
// failed because of the host (`retryable`) is asked for again at the next race's `setLooks`; one that
// failed for its own sake is not. The manifest here is scripted, one answer per ask.

const RIDER = 'models/riders/deacon';
const BIKE = 'models/bikes/chopper';

type Step = 'ok' | 'held' | 'gone';

/** A manifest that answers each id from its script, one step per ask (then `ok`), and logs the asks. */
function scripted(script: Record<string, Step[]>) {
  const asked: string[] = [];
  const left = new Map(Object.entries(script).map(([k, v]) => [k, [...v]]));
  const parts: Record<string, BakedPart> = { [RIDER]: fakeRider(), [BIKE]: fakeBike() };
  const pending: Promise<unknown>[] = [];
  const load = (async <T>(id: string, standIn: () => T): Promise<AssetLoad<T>> => {
    await Promise.resolve();
    asked.push(id);
    const step = left.get(id)?.shift() ?? 'ok';
    if (step === 'ok') return { id, source: 'baked', value: parts[id] as T, fellBack: false };
    return {
      id,
      source: 'procedural',
      value: standIn(),
      fellBack: true,
      error: step === 'held' ? 'HTTP 429 for assets/x.glb' : 'HTTP 404 for assets/x.glb',
      ...(step === 'held' ? { retryable: true as const } : {}),
    };
  }) as AssetManifest['load'];
  const manifest = {
    load: <T>(...args: Parameters<AssetManifest['load']>) => {
      const p = (load as (...a: unknown[]) => Promise<AssetLoad<T>>)(...args);
      pending.push(p);
      return p;
    },
  } as unknown as AssetManifest;
  /** Lets the rigs take in every answer given so far. */
  const settle = async () => {
    await Promise.all(pending);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { manifest, asked, settle };
}

function race(script: Record<string, Step[]>) {
  const m = scripted(script);
  const rigs = new RiderRigs(createFlatLook(), m.manifest, defaultRenderParams());
  const looks = () => [
    riderLookOf({
      contentId: 'base:deacon',
      role: 'rival',
      bikeId: 'base:chopper',
      look: { riderModel: RIDER, bikeModel: 'chopper' },
    }),
  ];
  return { ...m, rigs, startRace: () => rigs.setLooks(looks()) };
}

describe('a rider model the host held back (RiderRigs.setLooks)', () => {
  it('arrives at the next race after the wait; a model that loaded is not asked for again', async () => {
    const t = race({ [RIDER]: ['held'], [BIKE]: ['held'] });
    t.startRace();
    await t.settle();
    expect(t.rigs.counts().loaded).toEqual([]);
    expect(t.rigs.counts().failed.map((f) => f.id)).toContain(BIKE);
    // The next race, the wait over: both are asked for again, and both arrive.
    t.startRace();
    await t.settle();
    expect(t.rigs.counts().loaded).toEqual([BIKE, RIDER].sort());
    expect(t.asked.filter((id) => id === RIDER)).toHaveLength(2);
    expect(t.asked.filter((id) => id === BIKE)).toHaveLength(2);
    // And now they are kept.
    t.startRace();
    await t.settle();
    expect(t.asked.filter((id) => id === RIDER)).toHaveLength(2);
  });

  it('is asked for once per race, not once per call, while the host still holds it', async () => {
    const t = race({ [RIDER]: ['held', 'held'] });
    t.startRace();
    t.startRace(); // the same race's looks set twice: one ask is still running
    await t.settle();
    expect(t.asked.filter((id) => id === RIDER)).toHaveLength(1);
    t.startRace();
    await t.settle();
    expect(t.asked.filter((id) => id === RIDER)).toHaveLength(2);
  });

  // Negative control: a model that is not there (a 404) keeps its stand-in and is not asked for again.
  it('keeps the stand-in for a model the host does not have, asking once', async () => {
    const t = race({ [RIDER]: ['gone'], [BIKE]: ['gone'] });
    t.startRace();
    await t.settle();
    t.startRace();
    await t.settle();
    t.startRace();
    await t.settle();
    expect(t.asked.filter((id) => id === RIDER)).toHaveLength(1);
    expect(t.asked.filter((id) => id === BIKE)).toHaveLength(1);
    expect(t.rigs.counts().loaded).toEqual([]);
  });
});
