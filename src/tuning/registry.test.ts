import { describe, expect, it } from 'vitest';
import type { TuningParamDecl } from '../core';
import { createMemoryStorage } from './presets';
import { createPresetStore } from './presets';
import { createTuningRegistry, FRAME_DIVISOR_ID, TUNING_OWN } from './index';

const decl = (over: Partial<TuningParamDecl> & { id: string }): TuningParamDecl => ({
  group: 'steering',
  label: over.id,
  default: 1,
  min: 0.5,
  max: 2,
  step: 0.05,
  unit: '×',
  affectsSim: true,
  ...over,
});

const DECLS = [
  decl({ id: 'riders.steerScale' }),
  decl({ id: 'combat.knockbackScale', group: 'knockback' }),
  decl({ id: 'camera.shakeScale', group: 'shake', affectsSim: false, min: 0, max: 3 }),
];

describe('tuning registry', () => {
  it('holds every declaration plus its own frame-rate cap, each at its default', () => {
    const reg = createTuningRegistry(DECLS, () => {});
    expect(reg.decls.map((d) => d.id)).toEqual([...DECLS.map((d) => d.id), FRAME_DIVISOR_ID]);
    for (const d of reg.decls) expect(reg.get(d.id)).toBe(d.default);
  });

  it('does not add its own declarations twice when app already passed them', () => {
    const reg = createTuningRegistry([...DECLS, ...TUNING_OWN], () => {});
    expect(reg.decls.filter((d) => d.id === FRAME_DIVISOR_ID)).toHaveLength(1);
  });

  it('refuses a duplicate id and a default outside its range', () => {
    expect(() => createTuningRegistry([DECLS[0]!, DECLS[0]!], () => {})).toThrow(/declared twice/);
    expect(() => createTuningRegistry([decl({ id: 'x.y', default: 5 })], () => {})).toThrow(/out of range/);
    expect(() => createTuningRegistry([decl({ id: 'x.y', min: 2, max: 1, default: 1 })], () => {})).toThrow();
    expect(() => createTuningRegistry([decl({ id: 'x.y', step: 0 })], () => {})).toThrow(/step/);
  });

  it('records a sim-affecting change and not a presentation one; clamps; ignores non-numbers', () => {
    const recorded: [string, number][] = [];
    const heard: [string, number][] = [];
    const reg = createTuningRegistry(DECLS, (id, v) => recorded.push([id, v]));
    reg.onChange((id, v) => heard.push([id, v]));
    expect(reg.set('riders.steerScale', 9)).toBe(2);
    expect(reg.set('camera.shakeScale', 0.4)).toBe(0.4);
    expect(reg.set('riders.steerScale', 2)).toBe(2); // unchanged: no second record
    expect(reg.set('riders.steerScale', Number.NaN)).toBe(2);
    expect(recorded).toEqual([['riders.steerScale', 2]]);
    expect(heard).toEqual([
      ['riders.steerScale', 2],
      ['camera.shakeScale', 0.4],
    ]);
    expect(() => reg.set('nope.nope', 1)).toThrow(/unknown/);
  });

  it('simValues carries only sim-affecting values; changed() only what differs from defaults', () => {
    const reg = createTuningRegistry(DECLS, () => {});
    reg.set('camera.shakeScale', 0);
    expect(reg.simValues()).toEqual({ 'riders.steerScale': 1, 'combat.knockbackScale': 1 });
    expect(reg.changed()).toEqual({ 'camera.shakeScale': 0 });
  });

  it('applyPreset starts from the defaults, skips unknown ids and reports them', () => {
    const reg = createTuningRegistry(DECLS, () => {});
    reg.set('camera.shakeScale', 2);
    const skipped = reg.applyPreset({ 'riders.steerScale': 1.5, 'gone.param': 3 });
    expect(skipped).toEqual(['gone.param']);
    expect(reg.changed()).toEqual({ 'riders.steerScale': 1.5 });
  });

  it('boots on the shipped default preset, then the device-saved preset on top; reset returns to the shipped one', () => {
    const storage = createMemoryStorage();
    const store = createPresetStore({ storage, keyPrefix: 'test', build: 'abc1234' });
    const first = createTuningRegistry(DECLS, () => {}, { store });
    first.set('camera.shakeScale', 0.5);
    expect(first.saveToDevice(new Date('2026-09-30T01:02:03Z'))).toBe(true);

    const reg = createTuningRegistry(DECLS, () => {}, {
      store,
      shippedPreset: { 'combat.knockbackScale': 1.25 },
    });
    expect(reg.get('camera.shakeScale')).toBe(0.5); // the device preset
    expect(reg.get('combat.knockbackScale')).toBe(1); // the device preset is a full state
    reg.reset();
    expect(reg.get('camera.shakeScale')).toBe(1);
    expect(reg.get('combat.knockbackScale')).toBe(1.25);
  });

  it('boot values reach simValues() but never the recorder (no race exists yet)', () => {
    const recorded: string[] = [];
    const reg = createTuningRegistry(DECLS, (id) => recorded.push(id), {
      shippedPreset: { 'riders.steerScale': 1.5 },
    });
    expect(recorded).toEqual([]);
    expect(reg.simValues()['riders.steerScale']).toBe(1.5);
    reg.reset(); // after boot a reset is a real change only if something moved
    expect(recorded).toEqual([]);
    reg.set('riders.steerScale', 1);
    expect(recorded).toEqual(['riders.steerScale']);
  });

  it('without a store, saving to the device says so instead of pretending', () => {
    const reg = createTuningRegistry(DECLS, () => {});
    expect(reg.canSaveToDevice).toBe(false);
    expect(reg.saveToDevice(new Date())).toBe(false);
  });
});
