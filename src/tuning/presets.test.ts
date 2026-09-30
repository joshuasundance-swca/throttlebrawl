import { describe, expect, it } from 'vitest';
import type { TuningParamDecl } from '../core';
import {
  checkPresetValues,
  createMemoryStorage,
  createPresetStore,
  exportPreset,
  presetIdFor,
  REGISTRY_PRESET_ID,
  resolvePreset,
  TUNING_PRESET_RECORD,
  TUNING_PRESET_RECORD_VERSION,
  type PresetLike,
} from './presets';

const DECLS: TuningParamDecl[] = [
  {
    id: 'riders.steerScale',
    group: 'steering',
    label: 'Steering',
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'camera.shakeScale',
    group: 'shake',
    label: 'Shake',
    default: 1,
    min: 0,
    max: 3,
    step: 0.1,
    unit: '×',
    affectsSim: false,
  },
];

describe('preset export', () => {
  it('makes a kebab-case id from the time, in UTC', () => {
    expect(presetIdFor(new Date('2026-09-30T01:02:03Z'))).toBe('playtest-20260930-0102');
  });

  it('exports a tuning-preset entry: the changed values over the registry defaults, keys sorted', () => {
    const preset = exportPreset(
      { 'riders.steerScale': 1.4, 'camera.shakeScale': 0.5 },
      {
        now: new Date('2026-09-30T01:02:03Z'),
        build: 'abc1234',
      },
    );
    expect(preset).toEqual({
      type: 'tuning-preset',
      id: 'playtest-20260930-0102',
      name: 'Playtest 2026-09-30 01:02',
      base: REGISTRY_PRESET_ID,
      values: { 'camera.shakeScale': 0.5, 'riders.steerScale': 1.4 },
      meta: {
        status: 'live',
        notes: 'Exported from the tuning panel on build abc1234.',
        // A role, as the public-safety lint requires: a pasted preset is the maintainer's playtest.
        provenance: { origin: 'human', author: 'maintainer', createdAt: '2026-09-30' },
      },
    });
    expect(Object.keys(preset.values)).toEqual(['camera.shakeScale', 'riders.steerScale']);
  });
});

describe('preset value check (the tuning-key lint)', () => {
  it('accepts known keys in range', () => {
    expect(checkPresetValues(DECLS, { 'riders.steerScale': 2, 'camera.shakeScale': 0 })).toEqual([]);
  });

  it('names unknown keys, out-of-range and non-finite values with a JSON pointer', () => {
    const errors = checkPresetValues(DECLS, {
      'riders.steerScale': 2.5,
      'camera.shakeScale': Number.NaN,
      'steer.responseCurve': 1.4,
    });
    expect(errors).toEqual([
      '/values/riders.steerScale: expected 0.5..2, got 2.5',
      '/values/camera.shakeScale: expected a finite number',
      '/values/steer.responseCurve: not in the parameter registry',
    ]);
  });
});

describe('preset resolution (base chains)', () => {
  const table = new Map<string, PresetLike>([
    [
      'base:soft',
      { id: 'soft', base: 'registry', values: { 'riders.steerScale': 0.8, 'camera.shakeScale': 0.5 } },
    ],
    ['base:softer', { id: 'softer', base: 'soft', values: { 'riders.steerScale': 0.6 } }],
    ['base:loop-a', { id: 'loop-a', base: 'loop-b', values: {} }],
    ['base:loop-b', { id: 'loop-b', base: 'loop-a', values: {} }],
  ]);
  const lookup = (id: string) => table.get(id.includes(':') ? id : `base:${id}`);

  it('the reserved id `registry` is the registry defaults: no values', () => {
    expect(resolvePreset(lookup, 'registry')).toEqual({});
  });

  it('applies bases first, the preset itself last', () => {
    expect(resolvePreset(lookup, 'softer')).toEqual({ 'riders.steerScale': 0.6, 'camera.shakeScale': 0.5 });
    expect(resolvePreset(lookup, 'base:soft')).toEqual({
      'riders.steerScale': 0.8,
      'camera.shakeScale': 0.5,
    });
  });

  it('refuses a missing preset and a base cycle', () => {
    expect(() => resolvePreset(lookup, 'nope')).toThrow(/no tuning preset nope/);
    expect(() => resolvePreset(lookup, 'loop-a')).toThrow(/cycle/);
  });
});

describe('device preset store (a versioned record)', () => {
  const preset = exportPreset(
    { 'riders.steerScale': 1.4 },
    { now: new Date('2026-09-30T01:02:03Z'), build: 'b' },
  );

  it('round-trips through a versioned envelope under a name-neutral key', () => {
    const storage = createMemoryStorage();
    const store = createPresetStore({ storage, keyPrefix: 'app', build: 'abc1234', now: () => 'T' });
    expect(store.persistent).toBe(true);
    expect(store.load()).toBeNull();
    expect(store.save(preset)).toBe(true);
    const raw = JSON.parse(storage.getItem('app:tuning-preset') ?? 'null') as Record<string, unknown>;
    expect(raw).toMatchObject({
      format: TUNING_PRESET_RECORD,
      version: TUNING_PRESET_RECORD_VERSION,
      build: 'abc1234',
      savedAt: 'T',
    });
    expect(store.load()).toEqual(preset);
  });

  it('refuses and keeps a record newer than this build understands', () => {
    const storage = createMemoryStorage();
    const newer = JSON.stringify({
      format: 'tuning-preset',
      version: 99,
      build: 'x',
      savedAt: 'T',
      data: {},
    });
    storage.setItem('app:tuning-preset', newer);
    const store = createPresetStore({ storage, keyPrefix: 'app', build: 'b' });
    expect(store.load()).toBeNull();
    expect(store.save(preset)).toBe(false);
    expect(storage.getItem('app:tuning-preset')).toBe(newer);
    expect(store.notice).toMatch(/newer build/);
  });

  it('treats broken JSON or a wrong shape as nothing saved', () => {
    const storage = createMemoryStorage();
    storage.setItem('app:tuning-preset', '{not json');
    expect(createPresetStore({ storage, keyPrefix: 'app', build: 'b' }).load()).toBeNull();
    storage.setItem(
      'app:tuning-preset',
      JSON.stringify({ format: 'tuning-preset', version: 1, data: { values: 3 } }),
    );
    expect(createPresetStore({ storage, keyPrefix: 'app', build: 'b' }).load()).toBeNull();
  });

  it('survives a storage that throws, and says it is not saving', () => {
    const throwing = {
      getItem(): string | null {
        throw new Error('blocked');
      },
      setItem(): void {
        throw new Error('blocked');
      },
    };
    const store = createPresetStore({ storage: throwing, keyPrefix: 'app', build: 'b' });
    expect(store.load()).toBeNull();
    expect(store.save(preset)).toBe(false);
    expect(store.persistent).toBe(false);
  });
});
