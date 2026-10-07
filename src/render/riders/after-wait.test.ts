import { describe, expect, it } from 'vitest';
import type { AssetLoad, AssetManifest } from '../../assets';
import type { EntitySnapshot, SimSnapshot } from '../../sim/api';
import { createFlatLook } from '../look';
import { FALLBACK_BIKE_MODEL, riderLookOf } from '../rider-looks';
import { defaultRenderParams } from '../tuning';
import { EntityViews } from '../views';
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
const RIDER_2 = 'models/riders/vane';

type Step = 'ok' | 'held' | 'gone';

/** A manifest that answers each id from its script, one step per ask (then `ok`), and logs the asks. */
function scripted(script: Record<string, Step[]>) {
  const asked: string[] = [];
  const left = new Map(Object.entries(script).map(([k, v]) => [k, [...v]]));
  const parts: Record<string, BakedPart> = {
    [RIDER]: fakeRider(),
    [RIDER_2]: fakeRider(),
    [BIKE]: fakeBike(),
    [FALLBACK_BIKE_MODEL]: fakeBike(),
  };
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
  const listeners = new Set<(id: string) => void>();
  const manifest = {
    load: <T>(...args: Parameters<AssetManifest['load']>) => {
      const p = (load as (...a: unknown[]) => Promise<AssetLoad<T>>)(...args);
      pending.push(p);
      return p;
    },
    onRetryReady: (l: (id: string) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as AssetManifest;
  /** The manifest's word that a held asset's wait is over (the real one sets a timer for it). */
  const waitOver = (id: string) => {
    for (const l of listeners) l(id);
  };
  /** Lets the rigs take in every answer given so far. */
  const settle = async () => {
    await Promise.all(pending);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { manifest, asked, settle, waitOver };
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

// The wait's end (lane T2, after polish L's check, punch item 2): a race that started inside the host's wait
// asks for each held model once the manifest says the wait is over, and the rig swaps in mid-race. The
// swap is made in the next frame's `update` (after the answer came in, between frames), and for no more than
// one rig a frame, so a late arrival is never a frame-time spike.
describe('a rider model that arrives mid-race, after the wait (RiderRigs)', () => {
  const entity = (id: number, contentId: string): EntitySnapshot => ({
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: id * 3,
    y: 0,
    z: 0,
    heading: 0,
    speed: 20,
    lean: 0,
    contentId,
    name: `rider ${id}`,
    faction: 'rider',
    slot: id,
    throttle: 0,
    rpm: 0,
    gear: 1,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: 0,
    distanceToFinish: 0,
    place: 1,
    finished: false,
  });
  const looksFor = (riders: [string, string][]) =>
    riders.map(([id, riderModel]) =>
      riderLookOf({
        contentId: id,
        role: 'rival',
        bikeId: 'base:chopper',
        look: { riderModel, bikeModel: 'chopper' },
      }),
    );

  function drive(script: Record<string, Step[]>, riders: [string, string][]) {
    const m = scripted(script);
    const look = createFlatLook();
    const params = defaultRenderParams();
    const rigs = new RiderRigs(look, m.manifest, params);
    const views = new EntityViews(look, { params });
    views.setRigs(rigs);
    // riderLookOf names the rider model by content id: `base:deacon` is models/riders/deacon.
    rigs.setLooks(looksFor(riders));
    let tick = 0;
    /** One frame of these riders. */
    const frame = () => {
      const entities = riders.map(([id], i) => entity(i, id));
      views.sync(null, { tick, timeScale: 1, entities } as unknown as SimSnapshot, 1, tick / 60);
      rigs.endFrame(1 / 60);
      tick++;
    };
    const meshes = () => rigs.root.children.filter((c) => c.name === 'rig-mesh' || c.children.length > 0);
    return { ...m, rigs, frame, meshes };
  }

  it('asks for the held models when the wait is over, in the same race, and builds the rig', async () => {
    const t = drive({ [RIDER]: ['held'], [BIKE]: ['held'] }, [['base:deacon', RIDER]]);
    await t.settle();
    t.frame();
    expect(t.rigs.counts().rigs, 'held: the rider is still the box rider').toBe(0);
    const askedOf = (id: string) => t.asked.filter((a) => a === id).length;
    expect([askedOf(RIDER), askedOf(BIKE)], 'asked once each at the race start').toEqual([1, 1]);
    // The wait is over: each held model is asked for once, with no new race.
    t.waitOver(RIDER);
    t.waitOver(BIKE);
    await t.settle();
    expect([askedOf(RIDER), askedOf(BIKE)], 'asked once more each').toEqual([2, 2]);
    expect(t.rigs.counts().loaded).toEqual(expect.arrayContaining([BIKE, RIDER]));
    t.frame();
    expect(t.rigs.counts().rigs).toBe(1);
  });

  it('puts the rider on the real bike when it arrives after the rig was built on the starter bike', async () => {
    const t = drive({ [BIKE]: ['held'] }, [['base:deacon', RIDER]]);
    await t.settle();
    t.frame(); // asks for the starter bike, which the failed one falls back to
    await t.settle();
    t.frame();
    const standIn = t.rigs.root.getObjectByName('rig-mesh');
    expect(t.rigs.counts().rigs, 'on the starter bike meanwhile').toBe(1);
    t.waitOver(BIKE);
    await t.settle();
    t.frame();
    const swapped = t.rigs.root.getObjectByName('rig-mesh');
    expect(t.rigs.counts().rigs).toBe(1);
    expect(swapped, 'a new rig, built on the chopper').not.toBe(standIn);
    // A rig that is on its own bike is left alone.
    t.frame();
    expect(t.rigs.root.getObjectByName('rig-mesh')).toBe(swapped);
  });

  it('builds no more than one late rig a frame (no spike when several arrive together)', async () => {
    const t = drive({ [RIDER]: ['held'], [RIDER_2]: ['held'] }, [
      ['base:deacon', RIDER],
      ['base:vane', RIDER_2],
    ]);
    await t.settle();
    t.frame();
    expect(t.rigs.counts().rigs).toBe(0);
    t.waitOver(RIDER);
    t.waitOver(RIDER_2);
    await t.settle();
    t.frame();
    expect(t.rigs.counts().rigs, 'one this frame').toBe(1);
    t.frame();
    expect(t.rigs.counts().rigs, 'the other the next').toBe(2);
  });

  // Negative controls: a model that is not there is not asked for again, and a model that has loaded is not.
  it('does not ask for a model that failed for its own sake, or one already in, when told a wait is over', async () => {
    const t = drive({ [RIDER]: ['gone'] }, [['base:deacon', RIDER]]);
    await t.settle();
    const before = t.asked.length;
    t.waitOver(RIDER);
    t.waitOver(BIKE);
    await t.settle();
    expect(t.asked).toHaveLength(before);
  });
});
