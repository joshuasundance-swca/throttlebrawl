// The regional bands (playtest 2, 2026-10-02: "There should be different stations and music in
// different regions"): each composes deterministically, stays in its own tempo range, and uses its
// own instruments, so a Pacific Northwest or San Francisco station never sounds like the Keys' surf
// and rockabilly. Their loudness and clipping are measured offline in tests/e2e/audio-radio.spec.ts.
import { describe, expect, it } from 'vitest';
import { FakeAudioContext } from './fake-context';
import { composeTrack, RADIO_PRESETS, type Composition, type RadioNote } from './radio-compose';
import {
  FOLK_FORMS,
  GRUNGE_FORMS,
  PSYCH_FORMS,
  REGIONAL_PRESETS,
  SYNTH_FORMS,
} from './radio-compose-regional';
import { createRadioPlayer, genreOf, type RadioStation } from './radio';
import { RIG_TRIM } from './radio-rigs';

const layers = (c: Composition) => new Set(c.notes.map((n) => n.layer));
const of = (c: Composition, layer: RadioNote['layer']) => c.notes.filter((n) => n.layer === layer);
const compose = (preset: string, seed: number, params: Record<string, unknown> = {}) => {
  const c = composeTrack({ preset, params }, seed);
  if (!c) throw new Error(`${preset} did not compose`);
  return c;
};
const seeds = Array.from({ length: 24 }, (_, i) => 1000 + i * 7919);

describe('the regional bands', () => {
  it('are presets the stations can name, each composing the same song for the same seed', () => {
    for (const p of REGIONAL_PRESETS) {
      expect(RADIO_PRESETS).toContain(p);
      const a = compose(p, 42);
      const b = compose(p, 42);
      expect(a.notes).toEqual(b.notes);
      expect(compose(p, 43).notes).not.toEqual(a.notes);
      expect(a.stepsPerBeat).toBe(4);
      expect(a.bars).toBe(8);
      for (const n of a.notes) {
        expect(n.step).toBeGreaterThanOrEqual(0);
        expect(n.step).toBeLessThan(a.steps);
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(1);
        expect(Number.isInteger(n.midi)).toBe(true);
      }
    }
  });

  it('keep their own tempos, slower than the Keys (surf 140-175, rockabilly 150-205), and honour params', () => {
    const ranges: Record<string, [number, number]> = {
      'grunge-band': [92, 132],
      'folk-band': [92, 128],
      'synth-band': [98, 126],
      'psych-band': [100, 130],
    };
    for (const [p, [lo, hi]] of Object.entries(ranges)) {
      for (const s of seeds) {
        const c = compose(p, s);
        expect(c.bpm).toBeGreaterThanOrEqual(lo);
        expect(c.bpm).toBeLessThanOrEqual(hi);
      }
      expect(compose(p, 1, { bpm: 400 }).bpm).toBe(hi);
      expect(compose(p, 1, { bpm: 10 }).bpm).toBe(lo);
    }
    expect(compose('grunge-band', 1, { progression: 'drop' }).form).toBe('drop');
    expect(Object.keys(GRUNGE_FORMS)).toContain(compose('grunge-band', 5).form);
    expect(Object.keys(FOLK_FORMS)).toContain(compose('folk-band', 5).form);
    expect(Object.keys(SYNTH_FORMS)).toContain(compose('synth-band', 5).form);
    expect(Object.keys(PSYCH_FORMS)).toContain(compose('psych-band', 5).form);
  });

  it('grunge: a quiet verse into a loud chorus of power chords (root, fifth, octave) and open cymbals', () => {
    for (const s of seeds) {
      const c = compose('grunge-band', s);
      const half = c.steps / 2;
      const chords = of(c, 'rhythm');
      expect(chords.length).toBeGreaterThan(0);
      // Power chords live in the chorus only, the clean arpeggio in the verse only.
      expect(chords.every((n) => n.step >= half)).toBe(true);
      expect(of(c, 'arp').every((n) => n.step < half)).toBe(true);
      expect(of(c, 'arp').length).toBeGreaterThan(0);
      // No thirds in a power chord: every strum is root, fifth and octave.
      const byStep = new Map<number, number[]>();
      for (const n of chords) byStep.set(n.step, [...(byStep.get(n.step) ?? []), n.midi]);
      for (const ms of byStep.values()) {
        const lo = Math.min(...ms);
        expect(ms.map((m) => m - lo).sort((a, b) => a - b)).toEqual([0, 7, 12]);
      }
      expect(of(c, 'openhat').every((n) => n.step >= half)).toBe(true);
      expect(of(c, 'openhat').length).toBeGreaterThan(0);
      const verseSnare = of(c, 'snare').filter((n) => n.step < half);
      const chorusSnare = of(c, 'snare').filter((n) => n.step >= half);
      const mean = (xs: RadioNote[]) => xs.reduce((a, n) => a + n.vel, 0) / xs.length;
      expect(mean(chorusSnare)).toBeGreaterThan(mean(verseSnare) + 0.15);
      // Bends: the chorus lead slides up into its notes.
      expect(of(c, 'lead').some((n) => n.slide === -2)).toBe(true);
    }
  });

  it('folk: stomp and clap, a tambourine, a strummed acoustic with up strokes, a glockenspiel, banjo rolls', () => {
    for (const s of seeds) {
      const c = compose('folk-band', s);
      const l = layers(c);
      for (const want of ['kick', 'clap', 'tamb', 'rhythm', 'glock', 'arp', 'bass'] as const)
        expect(l.has(want)).toBe(true);
      // No drum kit: no snare, hats or cymbals.
      for (const not of ['snare', 'hat', 'openhat', 'crash', 'ride'] as const) expect(l.has(not)).toBe(false);
      // Up strokes start from the high string: on an up stroke the first string hit is the highest.
      const up = of(c, 'rhythm').filter((n) => n.step % 16 === 6);
      const first = up.filter((n) => n.strum === 0);
      expect(first.length).toBeGreaterThan(0);
      for (const f of first) {
        const same = up.filter((n) => n.step === f.step);
        expect(f.midi).toBe(Math.max(...same.map((n) => n.midi)));
      }
      // A major key: the tune walks the major pentatonic and lands on chord tones, all in the major scale.
      for (const n of of(c, 'glock'))
        expect([0, 2, 4, 5, 7, 9, 11]).toContain((((n.midi - c.key) % 12) + 12) % 12);
    }
  });

  it('synth: four on the floor, claps, a held pad, a sixteenth arpeggio and a gliding lead, no guitars', () => {
    for (const s of seeds) {
      const c = compose('synth-band', s);
      const kicks = of(c, 'kick').map((n) => n.step);
      expect(kicks).toEqual(Array.from({ length: c.steps / 4 }, (_, i) => i * 4));
      expect(of(c, 'pad').every((n) => n.len === 16)).toBe(true);
      expect(of(c, 'pad').length).toBe(8 * 4);
      expect(of(c, 'arp').length).toBe(6 * 16);
      expect(of(c, 'lead').every((n) => n.step >= c.steps / 2)).toBe(true);
      const l = layers(c);
      for (const not of ['rhythm', 'snare', 'ride', 'tamb', 'organ'] as const) expect(l.has(not)).toBe(false);
      // The bass pumps octaves.
      const bass = of(c, 'bass');
      expect(bass[1]!.midi - bass[0]!.midi).toBe(12);
    }
  });

  it('psych: an organ with a drone, ride and tambourine, a fuzz lead that runs up the mode', () => {
    for (const s of seeds) {
      const c = compose('psych-band', s);
      const l = layers(c);
      for (const want of ['organ', 'ride', 'tamb', 'lead', 'bass', 'snare'] as const)
        expect(l.has(want)).toBe(true);
      expect(l.has('rhythm')).toBe(false);
      // The drone: the key's root under every organ chord.
      expect(of(c, 'organ').filter((n) => n.midi === c.key).length).toBeGreaterThanOrEqual(8);
      // Bar 5's run: sixteen rising lead notes.
      const run = of(c, 'lead').filter((n) => n.step >= 5 * 16 && n.step < 6 * 16);
      expect(run).toHaveLength(16);
      for (let i = 1; i < run.length; i++) expect(run[i]!.midi).toBeGreaterThanOrEqual(run[i - 1]!.midi);
    }
  });

  it('sound unlike each other: each band has a layer set no other band has', () => {
    const sets = ['surf-trio', 'rockabilly-trio', ...REGIONAL_PRESETS].map((p) =>
      [...layers(compose(p, 9))].sort().join(','),
    );
    expect(new Set(sets).size).toBe(sets.length);
  });
});

describe('the regional rigs', () => {
  const station = (genre: string, preset: string): RadioStation => ({
    id: `x-${genre}`,
    packId: 'test',
    name: genre,
    genre,
    regions: [],
    tracks: [
      {
        id: 't',
        title: 'T',
        ref: `test:station/x-${genre}#t`,
        origin: 'agent',
        status: 'live',
        procedural: { preset },
        audioAsset: null,
      },
    ],
  });

  it('a station plays on the band its genre names (unknown genres fall back to surf)', () => {
    expect(genreOf(station('grunge', 'grunge-band'))).toBe('grunge');
    expect(genreOf(station('folk', 'folk-band'))).toBe('folk');
    expect(genreOf(station('synth', 'synth-band'))).toBe('synth');
    expect(genreOf(station('psych', 'psych-band'))).toBe('psych');
    expect(genreOf(station('rockabilly', 'rockabilly-trio'))).toBe('rockabilly');
    expect(genreOf(station('polka', 'surf-trio'))).toBe('surf');
    for (const t of Object.values(RIG_TRIM)) expect(t).toBeGreaterThan(0);
  });

  it.each([
    ['grunge', 'grunge-band', 'shaper'],
    ['folk', 'folk-band', 'bufferSource'],
    ['synth', 'synth-band', 'oscillator'],
    ['psych', 'psych-band', 'oscillator'],
  ])('%s schedules its notes on the fake context', (genre, preset, kind) => {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const player = createRadioPlayer(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, {
      seed: 3,
    });
    player.select(station(genre, preset));
    const before = ctx.nodes.length;
    for (let t = 0; t < 2; t += 1 / 30) {
      ctx.currentTime = t;
      player.pump(t, true);
    }
    expect(player.nowPlaying()?.ref).toBe(`test:station/x-${genre}#t`);
    expect(ctx.nodes.length).toBeGreaterThan(before + 20);
    expect(ctx.nodes.some((n) => n.kind === kind)).toBe(true);
  });
});
