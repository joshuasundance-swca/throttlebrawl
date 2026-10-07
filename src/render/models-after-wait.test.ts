import { describe, expect, it } from 'vitest';
import type { AssetLoad, AssetManifest } from '../assets';
import { atlasAsset, atlasLayoutAsset } from './atlas';
import {
  MODEL_ASSETS,
  loadSceneryModels,
  mergeModelReports,
  retryableKinds,
  type ModelKind,
  type ModelLoadReport,
} from './models';

// Scenery models after the host's wait (polish batch L, lane L2): a model the host held back (a 429, its
// wait, a busy host) is listed for another ask at the next setRoad (render/index.ts `requestModels`),
// and so is one that loaded without its atlas; a model the host does not have is not. The manifest is
// scripted, one answer per ask.

type Step = 'ok' | 'held' | 'gone';

/** A manifest that answers each id from its script (then `ok`). A model's `ok` is an empty baked model. */
function scripted(script: Record<string, Step[]>): AssetManifest {
  const left = new Map(Object.entries(script).map(([k, v]) => [k, [...v]]));
  const load = async <T>(id: string, standIn: () => T): Promise<AssetLoad<T>> => {
    await Promise.resolve();
    const step = left.get(id)?.shift() ?? 'ok';
    if (step !== 'ok')
      return {
        id,
        source: 'procedural',
        value: standIn(),
        fellBack: true,
        error: `HTTP ${step === 'held' ? 429 : 404} for ${id}`,
        ...(step === 'held' ? { retryable: true as const } : {}),
      };
    const kind = (Object.keys(MODEL_ASSETS) as ModelKind[]).find((k) => MODEL_ASSETS[k] === id);
    const value = id.includes('-layout')
      ? { size: 4, tile: 2, white: [0, 0], tiles: {} }
      : id.startsWith('textures/')
        ? { isTexture: true }
        : { kind, variants: [], roles: [], tiles: [[]] };
    return { id, source: 'baked', value: value as T, fellBack: false };
  };
  return { load } as unknown as AssetManifest;
}

describe('loadSceneryModels: what the host held back is listed for another ask', () => {
  it('lists a model the host held back as retryable, and one it does not have as not', async () => {
    const m = scripted({ [MODEL_ASSETS.palms]: ['held'], [MODEL_ASSETS.baitShack]: ['gone'] });
    const { report } = await loadSceneryModels(m, ['palms', 'baitShack']);
    expect(report.fellBack.map((f) => [f.kind, f.retryable ?? false])).toEqual([
      ['palms', true],
      ['baitShack', false],
    ]);
    expect(retryableKinds(report)).toEqual(['palms']);
  });

  it('asked again, the model arrives and the report no longer lists it as fallen back', async () => {
    const m = scripted({ [MODEL_ASSETS.palms]: ['held'] });
    const first = await loadSceneryModels(m, ['palms']);
    expect(first.models.palms).toBeUndefined();
    const second = await loadSceneryModels(m, ['palms']);
    expect(second.models.palms).toBeDefined();
    const merged = mergeModelReports(first.report, second.report);
    expect(merged.loaded).toEqual(['palms']);
    expect(merged.fellBack).toEqual([]);
    expect(retryableKinds(merged)).toEqual([]);
  });

  it('lists a model that loaded without its atlas (the host held the sheet) for another ask', async () => {
    const m = scripted({ [atlasAsset('florida-keys')]: ['held'] });
    const { models, report } = await loadSceneryModels(m, ['duvalKit']);
    expect(models.duvalKit).toBeDefined();
    expect(report.loaded).toEqual(['duvalKit']);
    expect(retryableKinds(report)).toEqual(['duvalKit']);
    const layoutHeld = scripted({ [atlasLayoutAsset('florida-keys')]: ['held'] });
    expect(retryableKinds((await loadSceneryModels(layoutHeld, ['duvalKit'])).report)).toEqual(['duvalKit']);
  });

  // Negative control: a sheet the host does not have is not asked for again.
  it('does not list a model whose sheet is not there', async () => {
    const m = scripted({ [atlasAsset('florida-keys')]: ['gone'] });
    const { report } = await loadSceneryModels(m, ['duvalKit']);
    expect(report.loaded).toEqual(['duvalKit']);
    expect(retryableKinds(report)).toEqual([]);
  });
});

describe('mergeModelReports', () => {
  it('keeps earlier entries for kinds the later load did not answer', () => {
    const a: ModelLoadReport = {
      loaded: ['palms'],
      fellBack: [{ kind: 'baitShack', error: 'HTTP 404' }],
      atlasHeld: [],
    };
    const b: ModelLoadReport = { loaded: ['duvalKit'], fellBack: [], atlasHeld: ['duvalKit'] };
    expect(mergeModelReports(a, b)).toEqual({
      loaded: ['palms', 'duvalKit'],
      fellBack: [{ kind: 'baitShack', error: 'HTTP 404' }],
      atlasHeld: ['duvalKit'],
    });
    expect(mergeModelReports(null, b).loaded).toEqual(['duvalKit']);
  });
});
