// Playtest 4 (P4-17): "The more complex SF music is impressive probably my favorite I like Keys music
// too but PNW seems very simple and slow." The maintainer picked all four directions for the Pacific
// Northwest (driving garage and grunge; indie and folk with drive; rainy-night synth for Portland; the
// same vibe, more complex) and "feel free to make more for all regions". These tests hold the rules:
// - the Pacific Northwest's dial is at least as busy, as fast and as sectioned as San Francisco's
//   (read from the station files, so a new station on either dial is held to it too);
// - every band stays inside the phone's budget of sources a second;
// - each new band is the song its spec describes (radio-compose-extra.ts), and every band's rig
//   voices every part its composer writes.
// Loudness is measured offline in a real browser in tests/e2e/audio-radio.spec.ts.
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { FakeAudioContext } from './fake-context';
import { createRadioPlayer, genreOf, stationsForRegion, stationsFromTable, type RadioStation } from './radio';
import { composeFor, createBandRig, RADIO_BAND } from './radio-band';
import { composeTrack, RADIO_PRESETS, type Composition, type RadioNote } from './radio-compose';
import {
  DARKWAVE_FORMS,
  DARKWAVE_PLAN,
  EXTRA_PRESETS,
  GARAGE_FORMS,
  GARAGE_PLAN,
  JAZZ_FORMS,
  SWAMP_FORMS,
} from './radio-compose-extra';
import { PIVOT_BANDS } from './radio-compose-pivot';
import { refit } from './radio-compose-regional';
import { EXTRA_GENRES } from './radio-genres';
import { EXTRA_TRIM } from './radio-rigs-extra';

const all = stationsFromTable(
  registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' })).stations,
);
const songs = (s: RadioStation) => s.tracks.map((t) => composeFor(t)!);
const mean = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
/** Distinct note onsets per second of music: how busy a song feels. */
const pace = (c: Composition) => new Set(c.notes.map((n) => n.step)).size / (c.steps * c.stepS);
/** The bar a note starts in. */
const barOf = (c: Composition, n: RadioNote) => Math.floor(n.step / c.stepsPerBar);
/** How many different line-ups of parts the song's bars have: its sections. */
const sections = (c: Composition) => {
  const lineups = new Set<string>();
  for (let b = 0; b < c.bars; b++)
    lineups.add([...new Set(c.notes.filter((n) => barOf(c, n) === b).map((n) => n.layer))].sort().join(','));
  return lineups.size;
};
const presetOf = (s: RadioStation) => s.tracks[0]!.procedural!.preset;
const pnw = stationsForRegion(all, 'pacific-northwest');
const sf = stationsForRegion(all, 'san-francisco');

describe("the Pacific Northwest's dial meets San Francisco's bar (P4-17)", () => {
  it('reads both dials from the station files', () => {
    expect(pnw.length).toBeGreaterThanOrEqual(2);
    expect(sf.length).toBeGreaterThanOrEqual(2);
    for (const s of [...pnw, ...sf]) expect(s.tracks.length).toBeGreaterThan(0);
  });

  it('every Pacific Northwest station is at least as busy as the calmest San Francisco station', () => {
    const calmest = Math.min(...sf.map((s) => mean(songs(s).map(pace))));
    for (const s of pnw) expect(mean(songs(s).map(pace)), s.id).toBeGreaterThanOrEqual(calmest);
  });

  it('no Pacific Northwest band can be set slower than the slowest San Francisco band', () => {
    const floor = (preset: string) => composeTrack({ preset, params: { bpm: 1 } }, 1)!.bpm;
    const slowest = Math.min(...sf.map((s) => floor(presetOf(s))));
    for (const s of pnw) expect(floor(presetOf(s)), s.id).toBeGreaterThanOrEqual(slowest);
  });

  it('every Pacific Northwest song is a whole song: sixteen bars or more, as many sections as San Francisco`s most varied', () => {
    const most = Math.max(...sf.flatMap((s) => songs(s).map(sections)));
    for (const s of pnw)
      for (const c of songs(s)) {
        expect(c.bars, s.id).toBeGreaterThanOrEqual(16);
        expect(sections(c), s.id).toBeGreaterThanOrEqual(most);
        // Not one loop played twice: the second half is not the first again.
        const half = c.steps / 2;
        const key = (n: RadioNote, d: number) => `${n.step - d}:${n.layer}:${n.midi}`;
        const first = c.notes.filter((n) => n.step < half).map((n) => key(n, 0));
        const second = c.notes.filter((n) => n.step >= half).map((n) => key(n, half));
        expect(second, s.id).not.toEqual(first);
      }
  });
});

describe('the phone budget', () => {
  /** Sources (oscillators and buffers) a band starts per second of a song at its fastest tempo. */
  const rate = (preset: string, genre: RadioStation['genre'], seed: number) => {
    const c = composeTrack({ preset, params: { bpm: 999 } }, seed)!;
    const ctx = new FakeAudioContext();
    const rig = createBandRig(
      ctx as unknown as BaseAudioContext,
      ctx.createGain() as unknown as AudioNode,
      genre as Parameters<typeof createBandRig>[2],
    );
    rig.prepare(c.notes);
    const before = ctx.nodes.length;
    for (const n of c.notes) rig.play(n, 1 + n.step * c.stepS, c.stepS);
    const sources = ctx.nodes
      .slice(before)
      .filter((n) => n.kind === 'oscillator' || n.kind === 'bufferSource');
    return sources.length / (c.steps * c.stepS);
  };
  const SEEDS = [11, 22, 33, 44, 55];
  // Every note is one to three sources and a gain. The busiest band already shipping is the Keys'
  // surf at its fastest (its tremolo picking re-picks every half step); no band may start more
  // sources a second than it does, so a new band never costs the phone more than one it plays now.
  const ceiling = Math.max(...SEEDS.map((s) => rate('surf-trio', 'surf', s)));
  it.each(PIVOT_BANDS)(
    '$preset starts no more sources a second than the surf band at its busiest',
    ({ preset, genre }) => {
      for (const seed of SEEDS)
        expect(rate(preset, genre, seed), `${preset} seed ${seed}`).toBeLessThanOrEqual(ceiling);
    },
  );

  it('every band is one the pivot medley and the rigs know, with every rig voicing every part', () => {
    expect(PIVOT_BANDS.map((b) => b.preset).sort()).toEqual([...RADIO_PRESETS].sort());
    for (const { preset, genre } of PIVOT_BANDS) {
      const c = composeTrack({ preset }, 17)!;
      const ctx = new FakeAudioContext();
      const rig = createBandRig(
        ctx as unknown as BaseAudioContext,
        ctx.createGain() as unknown as AudioNode,
        genre,
      );
      expect(rig.genre).toBe(genre);
      rig.prepare(c.notes);
      for (const layer of new Set(c.notes.map((n) => n.layer))) {
        const note = c.notes.find((n) => n.layer === layer)!;
        const before = ctx.nodes.length;
        rig.play(note, 1, c.stepS);
        const made = ctx.nodes
          .slice(before)
          .filter((n) => n.kind === 'oscillator' || n.kind === 'bufferSource');
        expect(made.length, `${genre}/${layer} makes a sound`).toBeGreaterThan(0);
        for (const src of made) expect(src.stoppedAt, `${genre}/${layer} stops`).not.toBeNull();
      }
    }
  });
});

const compose = (preset: string, seed: number, params: Record<string, unknown> = {}) => {
  const c = composeTrack({ preset, params }, seed);
  if (!c) throw new Error(`${preset} did not compose`);
  return c;
};
const of = (c: Composition, layer: RadioNote['layer']) => c.notes.filter((n) => n.layer === layer);
const inBar = (c: Composition, layer: RadioNote['layer'], b: number) =>
  of(c, layer).filter((n) => barOf(c, n) === b);
const seeds = Array.from({ length: 16 }, (_, i) => 3000 + i * 7919);
const pc = (m: number) => ((m % 12) + 12) % 12;

describe("playtest 4's bands", () => {
  it('compose the same song for the same seed, keep their tempos and honour their params', () => {
    const ranges: Record<string, [number, number]> = {
      'garage-band': [148, 184],
      'darkwave-band': [98, 120],
      'swamp-band': [84, 108],
      'jazz-band': [132, 184],
    };
    const forms: Record<string, Readonly<Record<string, unknown>>> = {
      'garage-band': GARAGE_FORMS,
      'darkwave-band': DARKWAVE_FORMS,
      'swamp-band': SWAMP_FORMS,
      'jazz-band': JAZZ_FORMS,
    };
    for (const p of EXTRA_PRESETS) {
      expect(RADIO_PRESETS).toContain(p);
      expect(compose(p, 42).notes).toEqual(compose(p, 42).notes);
      expect(compose(p, 43).notes).not.toEqual(compose(p, 42).notes);
      const [lo, hi] = ranges[p]!;
      for (const s of seeds) {
        const c = compose(p, s);
        expect(c.bpm).toBeGreaterThanOrEqual(lo);
        expect(c.bpm).toBeLessThanOrEqual(hi);
        expect(Object.keys(forms[p]!)).toContain(c.form);
        for (const n of c.notes) {
          expect(n.step).toBeGreaterThanOrEqual(0);
          expect(n.step).toBeLessThan(c.steps);
          expect(n.vel).toBeGreaterThan(0);
          expect(n.vel).toBeLessThanOrEqual(1);
          expect(Number.isInteger(n.midi)).toBe(true);
          expect(n.len).toBeGreaterThan(0);
        }
      }
      expect(compose(p, 1, { bpm: 999 }).bpm).toBe(hi);
      expect(compose(p, 1, { bpm: 1 }).bpm).toBe(lo);
      const id = Object.keys(forms[p]!)[1]!;
      expect(compose(p, 3, { progression: id }).form).toBe(id);
    }
  });

  it('bring a phrase back over another chord with its rhythm kept and its strong steps on the chord', () => {
    const phrase: RadioNote[] = [0, 2, 4, 8, 12].map((step, i) => ({
      step,
      layer: 'lead',
      midi: 60 + i,
      len: 2,
      vel: 0.7,
    }));
    const key = 48; // C
    const moved = refit(
      phrase,
      32,
      { root: 5, minor: false },
      key,
      [0, 2, 4, 5, 7, 9, 11],
      key + 10,
      key + 30,
    );
    expect(moved.map((n) => n.step)).toEqual(phrase.map((n) => n.step + 32));
    expect(moved.map((n) => n.len)).toEqual(phrase.map((n) => n.len));
    for (const n of moved) {
      const strong = (n.step % 16) % 8 === 0;
      // F major: F, A, C on the strong steps; C major's scale between.
      expect(strong ? [5, 9, 0] : [0, 2, 4, 5, 7, 9, 11]).toContain(pc(n.midi));
      expect(n.midi).toBeGreaterThanOrEqual(key + 10);
      expect(n.midi).toBeLessThanOrEqual(key + 30);
    }
  });

  it('play on bands of their own, at a trim each', () => {
    for (const g of EXTRA_GENRES) {
      const s = { ...all[0]!, genre: g };
      expect(genreOf(s)).toBe(g);
      expect(EXTRA_TRIM[g]).toBeGreaterThan(0);
    }
  });

  it('garage: the organ riff opens alone over the floor tom, a stop-time break, a rave-up, the hook again', () => {
    for (const s of seeds) {
      const c = compose('garage-band', s);
      expect(c.bars).toBe(GARAGE_PLAN.length);
      // Bar 0: the organ and the floor tom, no kit, no bass, no guitar yet.
      expect(inBar(c, 'organ', 0).length).toBeGreaterThan(0);
      expect(inBar(c, 'tom', 0).length).toBeGreaterThan(0);
      for (const l of ['kick', 'snare', 'bass', 'rhythm'] as const) expect(inBar(c, l, 0), l).toHaveLength(0);
      // The break: the band hits together on one and the "and" of two, nothing else of the kick.
      const brk = GARAGE_PLAN.indexOf('break');
      for (const b of [brk, brk + 1]) {
        expect(inBar(c, 'kick', b).map((n) => n.step % 16)).toEqual([0, 6]);
        expect(inBar(c, 'lead', b).length).toBeGreaterThan(0);
      }
      // The rave-up: the solo's last bar is sixteen lead notes, each beat a step higher or the same.
      const rave = inBar(c, 'lead', GARAGE_PLAN.lastIndexOf('solo'));
      expect(rave).toHaveLength(16);
      for (let k = 4; k < 16; k += 4) expect(rave[k]!.midi).toBeGreaterThanOrEqual(rave[k - 4]!.midi);
      // The chorus hook comes back in the outro: its first bar's organ rhythm, note for note, fitted
      // to the outro's chord.
      const chorus = GARAGE_PLAN.indexOf('chorus');
      const outro = GARAGE_PLAN.indexOf('outro');
      const hookAt = (b: number) => inBar(c, 'organ', b).map((n) => `${n.step % 16}:${n.len}`);
      expect(hookAt(chorus).length).toBeGreaterThan(0);
      expect(hookAt(outro)).toEqual(hookAt(chorus));
    }
  });

  it('darkwave: the parts enter one by one over the rain, and the hook returns after the break', () => {
    for (const s of seeds) {
      const c = compose('darkwave-band', s);
      expect(c.bars).toBe(DARKWAVE_PLAN.length);
      // Rain every bar.
      for (let b = 0; b < c.bars; b++) expect(inBar(c, 'rain', b).length).toBeGreaterThan(0);
      // Bar 0: pad, piano and rain only; bar 1 adds the sequencer bass; the drums come in at bar 2.
      const lineup = (b: number) =>
        [...new Set(c.notes.filter((n) => barOf(c, n) === b).map((n) => n.layer))].sort();
      expect(lineup(0)).toEqual(['ep', 'pad', 'rain']);
      expect(lineup(1)).toEqual(['bass', 'ep', 'pad', 'rain']);
      expect(inBar(c, 'bass', 0)).toHaveLength(0);
      expect(inBar(c, 'bass', 1)).toHaveLength(16);
      expect(inBar(c, 'kick', 1)).toHaveLength(0);
      expect(inBar(c, 'kick', 2).length).toBeGreaterThan(0);
      // The sequencer bass moves in sixteenths.
      expect(of(c, 'bass').every((n) => n.len === 1)).toBe(true);
      // The hook (bars 8-9) returns in bars 14-15: its rhythm note for note, fitted to their chords.
      const at = (b: number) => inBar(c, 'lead', b).map((n) => `${n.step % 16}:${n.len}`);
      const hook = DARKWAVE_PLAN.indexOf('hook');
      const back = DARKWAVE_PLAN.indexOf('return');
      expect(at(hook).length).toBeGreaterThan(0);
      expect(at(back)).toEqual(at(hook));
      expect(at(back + 1)).toEqual(at(hook + 1));
    }
  });

  it('swamp: a 12/8 shuffle, the harmonica calls and the slide answers, a washboard on the triplets, a turnaround', () => {
    for (const s of seeds) {
      const c = compose('swamp-band', s);
      const form = SWAMP_FORMS[c.form]!;
      expect(c.stepsPerBeat).toBe(3);
      expect(c.stepsPerBar).toBe(12);
      // Two choruses of the form.
      expect(c.bars).toBe(2 * form.length);
      // First chorus: the harmonica in bars 0-1, the slide in bars 2-3.
      expect(inBar(c, 'harp', 0).length).toBeGreaterThan(0);
      expect(inBar(c, 'lead', 0)).toHaveLength(0);
      expect(inBar(c, 'lead', 2).length).toBeGreaterThan(0);
      expect(inBar(c, 'harp', 2)).toHaveLength(0);
      // Every slide note glides in.
      const slides = of(c, 'lead').filter((n) => barOf(c, n) % form.length !== form.length - 1);
      expect(slides.every((n) => n.slide !== undefined)).toBe(true);
      // The washboard scrapes every triplet, the beat hardest.
      const bar1 = inBar(c, 'scrape', 1);
      expect(bar1).toHaveLength(12);
      const beat = bar1.filter((n) => n.step % 3 === 0);
      expect(Math.min(...beat.map((n) => n.vel))).toBeGreaterThan(
        Math.max(...bar1.filter((n) => n.step % 3 === 1).map((n) => n.vel)),
      );
      // The turnaround: the chorus's last bar walks down chromatically.
      const turn = inBar(c, 'lead', form.length - 1).map((n) => n.midi);
      expect(turn).toHaveLength(4);
      for (let k = 1; k < 4; k++) expect(turn[k]).toBe(turn[k - 1]! - 1);
    }
  });

  it('jazz: the ride swings, the bass walks into each chord, the piano never doubles the root, the horn swings eighths', () => {
    for (const s of seeds) {
      const c = compose('jazz-band', s);
      const changes = JAZZ_FORMS[c.form]!;
      expect(c.stepsPerBar).toBe(12);
      expect(c.bars).toBe(2 * changes.length);
      for (let b = 0; b < c.bars; b++) {
        // Ding, ding-a, ding, ding-a.
        expect(inBar(c, 'ride', b).map((n) => n.step % 12)).toEqual([0, 3, 5, 6, 9, 11]);
        // Four walking quarter notes; the first is the bar's chord root.
        const walk = inBar(c, 'bass', b);
        expect(walk.map((n) => n.step % 12)).toEqual([0, 3, 6, 9]);
        const chords = changes[b % changes.length]!;
        expect(pc(walk[0]!.midi - c.key)).toBe(pc(chords[0]!.root));
        // Beat four leans a half step into the next bar's root.
        const next = changes[(b + 1) % changes.length]![0]!;
        expect([1, 11]).toContain(pc(walk[3]!.midi - c.key - next.root));
      }
      // Rootless voicings: no piano chord has its chord's root in it.
      const byStep = new Map<number, number[]>();
      for (const n of of(c, 'ep')) byStep.set(n.step, [...(byStep.get(n.step) ?? []), n.midi]);
      for (const [step, ms] of byStep) {
        const b = Math.floor(step / 12);
        const cs = changes[b % changes.length]!;
        const chord = cs.length === 1 ? cs[0]! : cs[step % 12 < 6 ? 0 : 1]!;
        for (const m of ms) expect(pc(m - c.key)).not.toBe(pc(chord.root));
      }
      // The solo (the second chorus) swings: its notes land on the swung eighths or a triplet run.
      const solo = of(c, 'lead').filter((n) => barOf(c, n) >= changes.length);
      expect(solo.length).toBeGreaterThan(changes.length * 2);
      expect(solo.every((n) => [0, 1, 2, 3, 5, 6, 8, 9, 11].includes(n.step % 12))).toBe(true);
    }
  });

  it('their stations are on their regions` dials, every track code-made, vetoable and composing as written', () => {
    for (const preset of EXTRA_PRESETS) {
      const s = all.find((x) => presetOf(x) === preset);
      expect(s, preset).toBeDefined();
      if (!s) continue;
      expect(stationsForRegion(all, s.regions[0]!)).toContain(s);
      for (const t of s.tracks) {
        expect(t.ref).toBe(`${s.packId}:station/${s.id}#${t.id}`);
        expect(t.status).toBe('live');
        expect(t.origin).toBe('agent');
        const c = composeFor(t)!;
        expect(c.bpm).toBe(t.procedural?.params?.['bpm']);
        expect(c.form).toBe(t.procedural?.params?.['progression']);
      }
    }
  });

  it.each(EXTRA_GENRES)('%s plays through the radio player', (genre) => {
    const s = all.find((x) => x.genre === genre)!;
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const player = createRadioPlayer(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, {
      seed: 3,
      band: RADIO_BAND,
    });
    player.select(s);
    const before = ctx.nodes.length;
    for (let t = 0; t < 3; t += 1 / 30) {
      ctx.currentTime = t;
      player.pump(t, true);
    }
    expect(player.nowPlaying()?.stationId).toBe(s.id);
    expect(ctx.nodes.length).toBeGreaterThan(before + 20);
  });
});
