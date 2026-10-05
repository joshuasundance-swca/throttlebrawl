import { describe, expect, it } from 'vitest';
import { busTargets, DEFAULT_VOLUMES } from '../audio';
import { DEFAULT_SETTINGS } from '../save';

// Playtest 4, P4-18 (the maintainer: "Effects are too loud by default compared to the other audio").
// The default Effects level went from 90% to 70%. app/ is where the settings record's defaults (save/)
// and the sound engine's own starting levels (audio/) meet, so it is where they are held together;
// the record's own rules are in src/save/save-mix.test.ts, the engine's in src/audio/default-mix.test.ts,
// and the offline render of the real graph is tests/e2e/audio-mix.spec.ts.

const OLD_EFFECTS = 0.9;
/** A bus gain ratio in dB. */
const db = (a: number, b: number) => 20 * Math.log10(a / b);

describe('the default mix across save/ and audio/', () => {
  it("audio's starting levels are the settings record's defaults for the three buses this change is about", () => {
    const { master, music, effects } = DEFAULT_SETTINGS.volumes;
    expect(DEFAULT_VOLUMES).toMatchObject({ master, music, effects });
  });

  it('puts the effects bus a little over the music and under the voices (it sat 7 dB over the music, and over the voices)', () => {
    const at = (effects: number) => busTargets({ ...DEFAULT_SETTINGS.volumes, effects }, false);
    const now = at(DEFAULT_SETTINGS.volumes.effects);
    const before = at(OLD_EFFECTS);
    const overMusic = db(now.effects, now.music);
    const overMusicBefore = db(before.effects, before.music);
    console.log(
      `effects bus over the music bus: ${overMusicBefore.toFixed(1)} dB at 90% -> ${overMusic.toFixed(1)} dB at ` +
        `${DEFAULT_SETTINGS.volumes.effects * 100}%; voices bus over the effects bus: ` +
        `${db(before.voices, before.effects).toFixed(1)} dB -> ${db(now.voices, now.effects).toFixed(1)} dB`,
    );
    // Still louder than the music (effects are where the punch is), but by less than 3 dB.
    expect(overMusic).toBeGreaterThan(0);
    expect(overMusic).toBeLessThan(3);
    // The voices bus is not under the effects bus: a bark carries over the engine.
    expect(now.voices).toBeGreaterThanOrEqual(now.effects);
    // Negative control: the old default fails both checks.
    expect(overMusicBefore).toBeGreaterThan(3);
    expect(before.voices).toBeLessThan(before.effects);
  });
});
