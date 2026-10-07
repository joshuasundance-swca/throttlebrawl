import { describe, expect, it } from 'vitest';
import { createAssetManifest } from '../assets';
import { readModel } from './vehicle-pools.test-util';
import { loadVehicleSets, type VehicleRow } from './vehicles';

// Traffic models after the host's wait (polish batch L, lane L2): a race started inside the host's wait
// draws its traffic as boxes; the next race asks for the models again, through the real asset manifest
// and the real model file, and gets them. The host here answers 429 once, scripted; nothing waits.

type AssetIndexEntry = ReturnType<Parameters<typeof createAssetManifest>[0]>[number];
const ASSET = 'models/traffic/box-truck';
const TYPE = 'base:box-truck';
const ROW: ReadonlyMap<string, VehicleRow> = new Map([[TYPE, { models: [ASSET], paint: ['#ffffff'] }]]);

describe('loadVehicleSets after the host held a model back', () => {
  it('draws the box in the first race and the model in the next', async () => {
    const bytes = await readModel(ASSET);
    const entry: AssetIndexEntry = {
      id: ASSET,
      kind: 'mesh',
      source: 'baked',
      path: `assets/${ASSET}.glb`,
      bytes: bytes.byteLength,
      hash: '',
      packId: 'base',
    };
    const answers: ('429' | 'ok')[] = ['429', 'ok'];
    let asks = 0;
    const fetchFn = (() => {
      asks++;
      return Promise.resolve(
        answers.shift() === 'ok' ? new Response(bytes, { status: 200 }) : new Response('no', { status: 429 }),
      );
    }) as typeof fetch;
    const manifest = createAssetManifest(() => [entry], { baseUrl: 'https://example.test/game/', fetchFn });
    // The race inside the wait: no model, so views.ts keeps drawing the box.
    expect((await loadVehicleSets(manifest, [TYPE], ROW)).size).toBe(0);
    // The next race: the model is asked for again and arrives.
    const next = await loadVehicleSets(manifest, [TYPE], ROW);
    expect(next.get(TYPE)?.variants).toHaveLength(1);
    expect(asks).toBe(2);
    // And it is kept for the race after.
    expect((await loadVehicleSets(manifest, [TYPE], ROW)).size).toBe(1);
    expect(asks).toBe(2);
  });

  // Negative control: a model the host does not have (404) is not asked for in every race.
  it('does not ask again for a model the host does not have', async () => {
    const entry: AssetIndexEntry = {
      id: ASSET,
      kind: 'mesh',
      source: 'baked',
      path: `assets/${ASSET}.glb`,
      bytes: 0,
      hash: '',
      packId: 'base',
    };
    let asks = 0;
    const fetchFn = (() => {
      asks++;
      return Promise.resolve(new Response('gone', { status: 404 }));
    }) as typeof fetch;
    const manifest = createAssetManifest(() => [entry], { baseUrl: 'https://example.test/game/', fetchFn });
    expect((await loadVehicleSets(manifest, [TYPE], ROW)).size).toBe(0);
    expect((await loadVehicleSets(manifest, [TYPE], ROW)).size).toBe(0);
    expect(asks).toBe(1);
  });
});
