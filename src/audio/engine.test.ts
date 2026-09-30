import { describe, expect, it } from 'vitest';
import { ENGINE_PRESETS, engineFrequencyHz, harmonicWeights, resolveEngineProfile } from './engine-patch';
import { distanceGain, dopplerFactor } from './spatial';

describe('engine profiles', () => {
  it('resolves the M1 bike preset and falls back to it for an unknown one', () => {
    expect(resolveEngineProfile({ preset: 'single-thump' }).preset).toBe('single-thump');
    expect(resolveEngineProfile({ preset: 'no-such-patch' }).preset).toBe('single-thump');
    expect(resolveEngineProfile(undefined).preset).toBe('single-thump');
  });

  it('applies the pack numbers over the preset, and ignores bad ones', () => {
    const p = resolveEngineProfile({
      preset: 'two-stroke-buzz',
      cylinders: 1,
      idleHz: 38,
      redlineHz: 190,
      roughness: 0.7,
    });
    expect([p.idleHz, p.redlineHz, p.roughness]).toEqual([38, 190, 0.7]);
    const bad = resolveEngineProfile({
      preset: 'v-twin',
      idleHz: -5,
      redlineHz: 'loud',
      roughness: Number.NaN,
    });
    expect(bad.idleHz).toBe(ENGINE_PRESETS['v-twin']?.idleHz);
    expect(bad.redlineHz).toBe(ENGINE_PRESETS['v-twin']?.redlineHz);
    expect(bad.roughness).toBe(ENGINE_PRESETS['v-twin']?.roughness);
  });

  it('rises in pitch with rpm, clamped to the idle..redline range', () => {
    for (const p of Object.values(ENGINE_PRESETS)) {
      const idle = engineFrequencyHz(p, p.idleRpm);
      const mid = engineFrequencyHz(p, (p.idleRpm + p.redlineRpm) / 2);
      const top = engineFrequencyHz(p, p.redlineRpm);
      expect(idle).toBeCloseTo(p.idleHz);
      expect(top).toBeCloseTo(p.redlineHz);
      expect(mid).toBeGreaterThan(idle);
      expect(top).toBeGreaterThan(mid);
      expect(engineFrequencyHz(p, 0)).toBeCloseTo(p.idleHz);
      expect(engineFrequencyHz(p, 1e6)).toBeCloseTo(p.redlineHz);
    }
  });

  it('favours upper harmonics: most of the weight sits above the fundamental', () => {
    for (const p of Object.values(ENGINE_PRESETS)) {
      const w = harmonicWeights(p, 40);
      const total = w.reduce((a, b) => a + b * b, 0);
      const fundamental = (w[0] ?? 0) ** 2;
      expect(fundamental / total, p.preset).toBeLessThan(0.15);
      // Harmonics that land above 300 Hz even at idle carry real weight.
      const firstAbove300 = Math.ceil(300 / p.idleHz);
      const upper = w.slice(firstAbove300 - 1).reduce((a, b) => a + b * b, 0);
      expect(upper / total, p.preset).toBeGreaterThan(0.1);
    }
  });
});

describe('spatial helpers', () => {
  it('attenuates with distance and goes silent past the range', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(20)).toBeLessThan(distanceGain(10));
    expect(distanceGain(10)).toBeLessThan(1);
    expect(distanceGain(1000)).toBe(0);
  });

  it('raises the pitch of an approaching source and lowers a receding one', () => {
    const listener = { x: 0, z: 0, vx: 0, vz: 0 };
    const approaching = dopplerFactor(listener, { x: 0, z: -50, vx: 0, vz: 25 });
    const receding = dopplerFactor(listener, { x: 0, z: -50, vx: 0, vz: -25 });
    expect(approaching).toBeGreaterThan(1.05);
    expect(receding).toBeLessThan(0.95);
    expect(dopplerFactor(listener, { x: 0, z: -50, vx: 0, vz: 0 })).toBe(1);
    // A scale of 0 turns Doppler off.
    expect(dopplerFactor(listener, { x: 0, z: -50, vx: 0, vz: 25 }, 0)).toBe(1);
  });
});
