// The regional bands (playtest 2, 2026-10-02: "There should be different stations and music in
// different regions"): each composes deterministically, stays in its own tempo range, and uses its
// own instruments, so a Pacific Northwest or San Francisco station never sounds like the Keys' surf
// and rockabilly. Their loudness and clipping are measured offline in tests/e2e/audio-radio.spec.ts.
// Since playtest 4 (P4-17) the Pacific Northwest's grunge and folk are whole songs
// (radio-compose-pnw.ts); radio-p4.test.ts holds the region's dial to San Francisco's bar.
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
import { FOLK_PLAN, GRUNGE_PLAN, PNW_BARS } from './radio-compose-pnw';
import { createRadioPlayer, genreOf, type RadioStation } from './radio';
import { RADIO_BAND } from './radio-band';
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
      // San Francisco's bands loop eight bars; since playtest 4 the Pacific Northwest's are whole
      // sixteen-bar songs (radio-compose-pnw.ts).
      expect(a.bars).toBe(p === 'grunge-band' || p === 'folk-band' ? PNW_BARS : 8);
      for (const n of a.notes) {
        expect(n.step).toBeGreaterThanOrEqual(0);
        expect(n.step).toBeLessThan(a.steps);
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(1);
        expect(Number.isInteger(n.midi)).toBe(true);
      }
    }
  });

  it('keep their own tempos and honour params', () => {
    const ranges: Record<string, [number, number]> = {
      // Playtest 4 (P4-17, "PNW seems very simple and slow"): faster than before (92-132, 92-128).
      'grunge-band': [112, 148],
      'folk-band': [116, 148],
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

  // Playtest 4 (P4-17): the Pacific Northwest's bands are whole songs, section by section.
  const bars = (sec: string, plan: readonly string[]) => plan.flatMap((p, i) => (p === sec ? [i] : []));
  const inBars = (c: Composition, layer: RadioNote['layer'], bs: readonly number[]) =>
    of(c, layer).filter((n) => bs.includes(Math.floor(n.step / 16)));
  const mean = (xs: RadioNote[]) => xs.reduce((a, n) => a + n.vel, 0) / xs.length;

  it('grunge: a drop-tuned riff, a quiet verse, a build, a loud chorus of power chords whose hook returns harmonised', () => {
    for (const s of seeds) {
      const c = compose('grunge-band', s);
      const [verse, pre, chorus, riff] = ['verse', 'pre', 'chorus', 'riff'].map((x) => bars(x, GRUNGE_PLAN));
      // The clean arpeggio lives in the verse only; the riff, the build and the chorus are distorted.
      expect(of(c, 'arp').every((n) => verse!.includes(Math.floor(n.step / 16)))).toBe(true);
      expect(inBars(c, 'arp', verse!).length).toBeGreaterThan(0);
      expect(inBars(c, 'rhythm', verse!)).toHaveLength(0);
      // The riff is a dyad: every strike is a root and its fifth.
      const dyads = new Map<number, number[]>();
      for (const n of inBars(c, 'rhythm', riff!)) dyads.set(n.step, [...(dyads.get(n.step) ?? []), n.midi]);
      for (const ms of dyads.values())
        expect(ms.map((m) => m - Math.min(...ms)).sort((a, b) => a - b)).toEqual([0, 7]);
      // No thirds in a chorus power chord: every strike is root, fifth and octave.
      const byStep = new Map<number, number[]>();
      for (const n of inBars(c, 'rhythm', chorus!))
        byStep.set(n.step, [...(byStep.get(n.step) ?? []), n.midi]);
      expect(byStep.size).toBeGreaterThan(0);
      for (const ms of byStep.values()) {
        const lo = Math.min(...ms);
        expect(ms.map((m) => m - lo).sort((a, b) => a - b)).toEqual([0, 7, 12]);
      }
      // The build rolls: its last bar is a sixteenth snare roll that gets louder.
      const roll = inBars(c, 'snare', [pre!.at(-1)!]);
      expect(roll).toHaveLength(16);
      expect(roll.at(-1)!.vel).toBeGreaterThan(roll[0]!.vel + 0.3);
      // Open cymbals and a harder snare in the chorus than in the verse.
      expect(of(c, 'openhat').every((n) => chorus!.includes(Math.floor(n.step / 16)))).toBe(true);
      expect(mean(inBars(c, 'snare', chorus!))).toBeGreaterThan(mean(inBars(c, 'snare', verse!)) + 0.15);
      // The hook (the chorus's first two bars) returns four bars on, over the same chords, with a
      // harmony over it.
      const hook = inBars(c, 'lead', chorus!.slice(0, 2));
      const again = inBars(c, 'lead', chorus!.slice(4, 6));
      expect(hook.length).toBeGreaterThan(0);
      for (const n of hook) expect(again.some((m) => m.step === n.step + 64 && m.midi === n.midi)).toBe(true);
      expect(again.some((m) => !hook.some((n) => n.step + 64 === m.step && n.midi === m.midi))).toBe(true);
      // Bends.
      expect(of(c, 'lead').some((n) => n.slide === -2)).toBe(true);
    }
  });

  it('folk: a strummed verse with the tune, a build, then a driving chorus with a stomp on every beat and a mandolin', () => {
    for (const s of seeds) {
      const c = compose('folk-band', s);
      const l = layers(c);
      for (const want of ['kick', 'clap', 'tamb', 'rhythm', 'glock', 'arp', 'bass', 'lead'] as const)
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
      // The chorus drives: a stomp on every beat, sixteenth tambourine, banjo rolls.
      const chorus = bars('chorus', FOLK_PLAN);
      for (const b of chorus) {
        expect(inBars(c, 'kick', [b]).map((n) => n.step % 16)).toEqual([0, 4, 8, 12]);
        expect(inBars(c, 'tamb', [b])).toHaveLength(16);
        expect(inBars(c, 'arp', [b])).toHaveLength(16);
      }
      // The verse does not stomp on every beat.
      for (const b of bars('verse', FOLK_PLAN)) expect(inBars(c, 'kick', [b]).length).toBeLessThan(4);
      // The mandolin is tremolo-picked and only in the chorus.
      expect(of(c, 'lead').every((n) => n.trem && chorus.includes(Math.floor(n.step / 16)))).toBe(true);
      // A major key: the tune walks the major scale.
      for (const n of [...of(c, 'glock'), ...of(c, 'lead')])
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
      band: RADIO_BAND,
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
