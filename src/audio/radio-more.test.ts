// The six newer bands (run W-Q audio, interview 2026-10-02 round 6: "More code-made music only"):
// each composes deterministically, keeps its own tempo range and instruments, and its rig voices
// every layer its composer writes. Loudness and clipping are measured offline in
// tests/e2e/audio-radio.spec.ts.
import { describe, expect, it } from 'vitest';
import { FakeAudioContext } from './fake-context';
import { composeTrack, RADIO_PRESETS, type Composition, type RadioNote } from './radio-compose';
import {
  AMBIENT_FORMS,
  CHIP_FORMS,
  DUB_FORMS,
  FUNK_FORMS,
  ISLAND_FORMS,
  MORE_PRESETS,
  STONER_FORMS,
} from './radio-compose-more';
import { REGIONAL_PRESETS } from './radio-compose-regional';
import { createRadioPlayer, genreOf, type RadioStation } from './radio';
import { createMoreRig, crushCurve, MORE_GENRES, MORE_TRIM, pulseWave } from './radio-rigs-more';

const layers = (c: Composition) => new Set(c.notes.map((n) => n.layer));
const of = (c: Composition, layer: RadioNote['layer']) => c.notes.filter((n) => n.layer === layer);
const bar = (n: RadioNote) => Math.floor(n.step / 16);
const compose = (preset: string, seed: number, params: Record<string, unknown> = {}) => {
  const c = composeTrack({ preset, params }, seed);
  if (!c) throw new Error(`${preset} did not compose`);
  return c;
};
const seeds = Array.from({ length: 24 }, (_, i) => 2000 + i * 7919);

describe('the six newer bands', () => {
  it('are presets the stations can name, each composing the same song for the same seed', () => {
    for (const p of MORE_PRESETS) {
      expect(RADIO_PRESETS).toContain(p);
      const a = compose(p, 42);
      const b = compose(p, 42);
      expect(a.notes).toEqual(b.notes);
      expect(compose(p, 43).notes).not.toEqual(a.notes);
      expect(a.stepsPerBeat).toBe(4);
      expect(a.bars).toBe(8);
      expect(a.notes.length).toBeGreaterThan(20);
      for (const n of a.notes) {
        expect(n.step).toBeGreaterThanOrEqual(0);
        expect(n.step).toBeLessThan(a.steps);
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(1);
        expect(Number.isInteger(n.midi)).toBe(true);
        expect(n.len).toBeGreaterThan(0);
      }
    }
  });

  it('keep their own tempos and honour params', () => {
    const ranges: Record<string, [number, number]> = {
      'island-band': [100, 124],
      'dub-band': [66, 82],
      'stoner-band': [62, 88],
      'ambient-band': [54, 68],
      'funk-band': [104, 122],
      'chip-band': [138, 164],
    };
    for (const [p, [lo, hi]] of Object.entries(ranges)) {
      for (const s of seeds) {
        const c = compose(p, s);
        expect(c.bpm, p).toBeGreaterThanOrEqual(lo);
        expect(c.bpm, p).toBeLessThanOrEqual(hi);
      }
      expect(compose(p, 1, { bpm: 900 }).bpm).toBe(hi);
      expect(compose(p, 1, { bpm: 1 }).bpm).toBe(lo);
    }
    const forms = {
      'island-band': ISLAND_FORMS,
      'dub-band': DUB_FORMS,
      'stoner-band': STONER_FORMS,
      'ambient-band': AMBIENT_FORMS,
      'funk-band': FUNK_FORMS,
      'chip-band': CHIP_FORMS,
    };
    for (const [p, f] of Object.entries(forms)) {
      for (const s of seeds.slice(0, 6)) expect(Object.keys(f)).toContain(compose(p, s).form);
      const id = Object.keys(f)[1]!;
      expect(compose(p, 3, { progression: id }).form).toBe(id);
      expect(Object.keys(f)).toContain(compose(p, 3, { progression: 'nope' }).form);
    }
  });

  it('island: a steel pan answers itself over congas, a shaker and a tumbao', () => {
    for (const s of seeds) {
      const c = compose('island-band', s);
      const l = layers(c);
      for (const want of ['kick', 'conga', 'tamb', 'bass', 'rhythm', 'steel'] as const) {
        expect(l.has(want), want).toBe(true);
      }
      for (const not of ['snare', 'hat', 'organ', 'stab'] as const) expect(l.has(not)).toBe(false);
      // The pan waits for the groove: nothing in the first two bars.
      expect(of(c, 'steel').every((n) => n.step >= 32)).toBe(true);
      // Bars 4-5 repeat bars 2-3, two bars on.
      const steel = of(c, 'steel');
      for (const n of steel.filter((x) => bar(x) === 2 || bar(x) === 3)) {
        expect(steel.some((m) => m.step === n.step + 32 && m.midi === n.midi)).toBe(true);
      }
      // The tumbao: a bass note on the downbeat of every bar, and the pan ends on a chord tone of the key.
      for (let b = 0; b < 8; b++) expect(of(c, 'bass').some((n) => n.step === b * 16)).toBe(true);
      expect([0, 4, 7]).toContain((((steel.at(-1)!.midi - c.key) % 12) + 12) % 12);
      // Two drums: the deep and the bright conga.
      expect(new Set(of(c, 'conga').map((n) => n.midi))).toEqual(new Set([60, 72]));
    }
  });

  it('dub: the one-drop (kick and rim on beat three only), skanks on the offbeats, a sparse melodica', () => {
    for (const s of seeds) {
      const c = compose('dub-band', s);
      expect(of(c, 'kick').every((n) => n.step % 16 === 8)).toBe(true);
      expect(of(c, 'kick')).toHaveLength(8);
      expect(of(c, 'snare').filter((n) => n.step % 16 === 8)).toHaveLength(8);
      expect(of(c, 'skank').every((n) => [2, 6, 10, 14].includes(n.step % 16))).toBe(true);
      expect(of(c, 'skank').every((n) => n.len === 1)).toBe(true);
      // The melodica is sparse: a few notes a bar, in some bars only.
      const lead = of(c, 'lead');
      expect(lead.length).toBeGreaterThan(0);
      expect(new Set(lead.map(bar)).size).toBeLessThan(6);
      // The sub bass sits low.
      expect(Math.min(...of(c, 'bass').map((n) => n.midi))).toBeLessThan(60);
    }
  });

  it('stoner: one riff repeated, half-time drums, a wah solo that bends in the middle', () => {
    for (const s of seeds) {
      const c = compose('stoner-band', s);
      // Half-time: the snare is on beat three only.
      expect(of(c, 'snare').every((n) => n.step % 16 === 8)).toBe(true);
      // The riff has one rhythm: the same steps in every bar the guitar plays.
      const stepsIn = (b: number) => [
        ...new Set(
          of(c, 'rhythm')
            .filter((n) => bar(n) === b)
            .map((n) => n.step % 16),
        ),
      ];
      const first = stepsIn(0).sort((a, b) => a - b);
      for (const b of [1, 2, 3, 4, 5, 6]) expect(stepsIn(b).sort((x, y) => x - y)).toEqual(first);
      // The guitar plays fifths (root and fifth, an octave above the bass).
      const bass = of(c, 'bass');
      expect(Math.min(...of(c, 'rhythm').map((n) => n.midi))).toBeGreaterThan(
        Math.min(...bass.map((n) => n.midi)),
      );
      // The solo: bars 4-6, bent.
      const solo = of(c, 'lead');
      expect(solo.length).toBeGreaterThan(0);
      expect(solo.every((n) => bar(n) >= 4 && bar(n) <= 6)).toBe(true);
      expect(solo.some((n) => n.slide === -2)).toBe(true);
      // The riff goes quiet under the solo.
      const mean = (xs: RadioNote[]) => xs.reduce((a, n) => a + n.vel, 0) / xs.length;
      expect(mean(of(c, 'rhythm').filter((n) => bar(n) === 5))).toBeLessThan(
        mean(of(c, 'rhythm').filter((n) => bar(n) === 1)) - 0.15,
      );
    }
  });

  it('ambient: no drums, long pads over a drone, sparse bells', () => {
    for (const s of seeds) {
      const c = compose('ambient-band', s);
      const l = layers(c);
      expect([...l].sort()).toEqual(['bass', 'glock', 'lead', 'pad']);
      expect(of(c, 'pad').every((n) => n.len === 16 && n.step % 16 === 0)).toBe(true);
      expect(of(c, 'bass').every((n) => n.len === 16)).toBe(true);
      // Two to four bells a bar, never on one step twice.
      for (let b = 0; b < 8; b++) {
        const bells = of(c, 'glock').filter((n) => bar(n) === b);
        expect(bells.length).toBeGreaterThanOrEqual(2);
        expect(bells.length).toBeLessThanOrEqual(4);
        expect(new Set(bells.map((n) => n.step)).size).toBe(bells.length);
      }
      // The pad's colour: a ninth or a seventh above the root in every chord.
      const root = of(c, 'bass')[0]!.midi;
      expect(
        of(c, 'pad')
          .filter((n) => bar(n) === 0)
          .some((n) => [2, 10, 11].includes((((n.midi - root) % 12) + 12) % 12)),
      ).toBe(true);
    }
  });

  it('funk: ghost-note snare, a 16th slap bass with octave pops, chicken scratch, horns from bar four', () => {
    for (const s of seeds) {
      const c = compose('funk-band', s);
      for (const want of ['kick', 'snare', 'hat', 'openhat', 'bass', 'rhythm', 'stab'] as const) {
        expect(layers(c).has(want), want).toBe(true);
      }
      expect(of(c, 'snare').some((n) => n.vel < 0.4)).toBe(true);
      expect(
        of(c, 'snare')
          .filter((n) => n.step % 16 === 4 || n.step % 16 === 12)
          .every((n) => n.vel > 0.8),
      ).toBe(true);
      expect(of(c, 'hat')).toHaveLength(8 * 16);
      expect(of(c, 'rhythm').every((n) => n.len === 1)).toBe(true);
      // Octave pops: a short bass note an octave over the bar's root.
      const pops = of(c, 'bass').filter((n) => n.len === 1 && n.vel < 0.75);
      expect(pops.length).toBeGreaterThanOrEqual(8);
      expect(of(c, 'stab').filter((n) => bar(n) < 3)).toHaveLength(0);
      expect(of(c, 'stab').filter((n) => bar(n) >= 4).length).toBeGreaterThan(8);
    }
  });

  it('chip: a pulse arpeggio and lead over a triangle bass and a noise kit; the hook returns higher', () => {
    for (const s of seeds) {
      const c = compose('chip-band', s);
      const arp = of(c, 'arp');
      expect(arp).toHaveLength(7 * 16);
      expect(arp.every((n) => n.len === 1)).toBe(true);
      expect(of(c, 'bass').every((n) => n.len === 2)).toBe(true);
      expect(of(c, 'bass')).toHaveLength(8 * 8);
      const lead = of(c, 'lead');
      const hook = lead.filter((n) => bar(n) === 2 || bar(n) === 3);
      expect(hook.length).toBeGreaterThan(0);
      for (const n of hook) {
        const again = lead.find((m) => m.step === n.step + 64);
        expect(again, `step ${n.step}`).toBeDefined();
        expect(again!.midi).toBeGreaterThanOrEqual(n.midi);
      }
      expect(lead.every((n) => bar(n) >= 2)).toBe(true);
    }
  });

  it('sound unlike every other band: each has a layer set no other band has', () => {
    const sets = ['surf-trio', 'rockabilly-trio', ...REGIONAL_PRESETS, ...MORE_PRESETS].map((p) =>
      [...layers(compose(p, 9))].sort().join(','),
    );
    expect(new Set(sets).size).toBe(sets.length);
    expect(sets).toHaveLength(12);
  });
});

describe('the newer rigs', () => {
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
  const presetOf: Record<string, string> = {
    island: 'island-band',
    dub: 'dub-band',
    stoner: 'stoner-band',
    ambient: 'ambient-band',
    funk: 'funk-band',
    chip: 'chip-band',
  };

  it('a station plays on the band its genre names', () => {
    for (const g of MORE_GENRES) expect(genreOf(station(g, presetOf[g]!))).toBe(g);
    for (const t of Object.values(MORE_TRIM)) expect(t).toBeGreaterThan(0);
    expect(MORE_GENRES).toHaveLength(6);
  });

  it.each(MORE_GENRES)('%s voices every layer its composer writes, all scheduled to stop', (genre) => {
    const c = compose(presetOf[genre]!, 17);
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const rig = createMoreRig(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, genre);
    expect(rig.genre).toBe(genre);
    rig.prepare(c.notes);
    for (const layer of layers(c)) {
      const note = c.notes.find((n) => n.layer === layer)!;
      const before = ctx.nodes.length;
      rig.play(note, 1, c.stepS);
      const made = ctx.nodes
        .slice(before)
        .filter((n) => n.kind === 'oscillator' || n.kind === 'bufferSource');
      expect(made.length, `${genre}/${layer} makes a sound`).toBeGreaterThan(0);
      for (const src of made) {
        expect(src.startedAt).not.toBeNull();
        expect(src.stoppedAt).not.toBeNull();
      }
    }
  });

  it.each(MORE_GENRES)('%s schedules its notes through the player', (genre) => {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const player = createRadioPlayer(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, {
      seed: 3,
    });
    player.select(station(genre, presetOf[genre]!));
    const before = ctx.nodes.length;
    for (let t = 0; t < 4; t += 1 / 30) {
      ctx.currentTime = t;
      player.pump(t, true);
    }
    expect(player.nowPlaying()?.ref).toBe(`test:station/x-${genre}#t`);
    expect(ctx.nodes.length).toBeGreaterThan(before + 10);
  });

  it('the rig output follows its level times its trim, and the fx slider scales its sends', () => {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const rig = createMoreRig(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, 'dub');
    const rigOut = ctx.inputsOf(out, 'gain')[0]!;
    rig.setLevel(0.5, 1);
    expect(rigOut.gain.target).toBeCloseTo(0.5 * MORE_TRIM.dub, 5);
    rig.setFx(0);
    const sends = ctx.nodes.filter(
      (n) => n.kind === 'gain' && n.gain.calls.some((c) => c.method === 'setTargetAtTime' && c.value === 0),
    );
    expect(sends.length).toBeGreaterThan(0);
  });

  it('a pulse wave of duty d has the right harmonics, and the crusher is a staircase', () => {
    const ctx = new FakeAudioContext();
    const w = pulseWave(ctx as unknown as BaseAudioContext, 0.25, 8) as unknown as {
      real: Float32Array;
      imag: Float32Array;
    };
    // A square (duty 0.5) has only odd harmonics; a quarter pulse has the second but not the fourth.
    const sq = pulseWave(ctx as unknown as BaseAudioContext, 0.5, 8) as unknown as {
      real: Float32Array;
      imag: Float32Array;
    };
    const mag = (p: { real: Float32Array; imag: Float32Array }, n: number) =>
      Math.hypot(p.real[n]!, p.imag[n]!);
    expect(mag(sq, 2)).toBeLessThan(1e-6);
    expect(mag(sq, 1)).toBeGreaterThan(1);
    expect(mag(w, 2)).toBeGreaterThan(0.3);
    expect(mag(w, 4)).toBeLessThan(1e-6);
    const c = crushCurve(7);
    expect(new Set(c).size).toBe(15);
    expect(c[0]).toBe(-1);
    expect(c.at(-1)).toBe(1);
  });
});
