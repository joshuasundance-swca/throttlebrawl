import { describe, expect, it } from 'vitest';
import m1Fixture from './fixtures/settings-v1-m1.json';
import { audioVolumes, DEFAULT_SETTINGS, sanitiseSettings, voiceSettings } from './index';

// Run W-O (maintainer, 2026-10-01: "Extend 'cut this' to voice lines; add a Voices volume and an
// off switch"). The contract with the audio lane: a voice volume (0..1, default 0.8) and an on/off
// switch (default on), saved next to the music and effects volumes. The volume is the record's
// `volumes.voices` (the voices bus slider since M1), so there is one source of truth; `voicesOn` is
// new and additive (the version stays 1).

describe('the voices settings', () => {
  it('defaults to voices on at 80%', () => {
    expect(DEFAULT_SETTINGS.voicesOn).toBe(true);
    expect(DEFAULT_SETTINGS.volumes.voices).toBe(0.8);
    expect(voiceSettings(DEFAULT_SETTINGS)).toEqual({ voiceVolume: 0.8, voicesOn: true });
  });

  it('fills voicesOn in for a record that predates it, and keeps its saved voice volume', () => {
    const loaded = sanitiseSettings(m1Fixture.data);
    expect(loaded.voicesOn).toBe(true);
    expect(loaded.volumes.voices).toBe(m1Fixture.data.volumes.voices);
  });

  it('keeps voices off, and defaults a non-boolean back to on', () => {
    expect(sanitiseSettings({ voicesOn: false }).voicesOn).toBe(false);
    for (const bad of ['off', 0, null, 'false'])
      expect(sanitiseSettings({ voicesOn: bad }).voicesOn).toBe(true);
  });

  it('clamps the voice volume to 0..1', () => {
    expect(sanitiseSettings({ volumes: { voices: 3 } }).volumes.voices).toBe(1);
    expect(sanitiseSettings({ volumes: { voices: -1 } }).volumes.voices).toBe(0);
    expect(sanitiseSettings({ volumes: { voices: 'loud' } }).volumes.voices).toBe(0.8);
  });

  it("hands audio the voices bus at the slider's level, or silent when voices are off", () => {
    const on = { ...DEFAULT_SETTINGS, volumes: { ...DEFAULT_SETTINGS.volumes, voices: 0.4 } };
    expect(audioVolumes(on)).toEqual({ ...on.volumes, voices: 0.4 });
    const off = { ...on, voicesOn: false };
    expect(audioVolumes(off)).toEqual({ ...on.volumes, voices: 0 });
    // The slider's own value is kept: switching voices back on returns to it.
    expect(off.volumes.voices).toBe(0.4);
    expect(voiceSettings(off)).toEqual({ voiceVolume: 0.4, voicesOn: false });
  });
});
