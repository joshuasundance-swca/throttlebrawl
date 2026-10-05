// Playtest 4, run C (task C8). The maintainer on the radio: "I'm surprised how good the music is lol
// feel free to make more for all regions :P" (San Francisco his favourite, then the Keys). Every region
// that has music gets one more code-made station on a band of its own: Ninety Miles 90.0 FM (Cuban son,
// the Keys), Sunbreak 92.5 (motorik dream pop, the Pacific Northwest) and Hella Latency 96.1 (Bay Area
// beats, San Francisco). These tests hold the rules:
// - each of the three bands is the song its spec describes (radio-compose-trio.ts);
// - every region's dial has its new station, every station on every dial plays through the real band
//   on a band of its own, and no band's output is set louder than the loudest rig already shipping, so
//   the quieter default mix (music 60%) holds for every station.
// Loudness itself is measured offline in a real browser in tests/e2e/audio-radio.spec.ts.
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { FakeAudioContext } from './fake-context';
import {
  createRadioPlayer,
  genreOf,
  RADIO_LEVEL,
  stationsForRegion,
  stationsFromTable,
  type RadioStation,
} from './radio';
import { composeFor, createBandRig, RADIO_BAND } from './radio-band';
import { composeTrack, RADIO_PRESETS, type Composition, type RadioNote } from './radio-compose';
import {
  BEAT_FORMS,
  BEAT_PLAN,
  DREAM_FORMS,
  DREAM_PLAN,
  SON_FORMS,
  SON_PLAN,
  TRIO_PRESETS,
} from './radio-compose-trio';
import { TRIO_GENRES } from './radio-genres';
import { TRIO_TRIM } from './radio-rigs-trio';

const all = stationsFromTable(
  registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' })).stations,
);
const compose = (preset: string, seed: number, params: Record<string, unknown> = {}) => {
  const c = composeTrack({ preset, params }, seed);
  if (!c) throw new Error(`${preset} did not compose`);
  return c;
};
const of = (c: Composition, layer: RadioNote['layer']) => c.notes.filter((n) => n.layer === layer);
const barOf = (c: Composition, n: RadioNote) => Math.floor(n.step / c.stepsPerBar);
const inBar = (c: Composition, layer: RadioNote['layer'], b: number) =>
  of(c, layer).filter((n) => barOf(c, n) === b);
const stepsIn = (c: Composition, layer: RadioNote['layer'], b: number) =>
  inBar(c, layer, b).map((n) => n.step % c.stepsPerBar);
const seeds = Array.from({ length: 16 }, (_, i) => 5000 + i * 7919);
const rhythmOf = (c: Composition, layer: RadioNote['layer'], b: number) =>
  inBar(c, layer, b).map((n) => `${n.step % c.stepsPerBar}:${n.len}`);

describe("run C's bands", () => {
  it('compose the same song for the same seed, keep their tempos and honour their params', () => {
    const ranges: Record<string, [number, number]> = {
      'son-band': [92, 116],
      'dream-band': [124, 146],
      'beat-band': [84, 100],
    };
    const forms: Record<string, Readonly<Record<string, unknown>>> = {
      'son-band': SON_FORMS,
      'dream-band': DREAM_FORMS,
      'beat-band': BEAT_FORMS,
    };
    expect([...TRIO_PRESETS].sort()).toEqual(Object.keys(ranges).sort());
    for (const p of TRIO_PRESETS) {
      expect(RADIO_PRESETS).toContain(p);
      expect(compose(p, 42).notes).toEqual(compose(p, 42).notes);
      expect(compose(p, 43).notes).not.toEqual(compose(p, 42).notes);
      const [lo, hi] = ranges[p]!;
      for (const s of seeds) {
        const c = compose(p, s);
        expect(c.preset).toBe(p);
        expect(c.bpm).toBeGreaterThanOrEqual(lo);
        expect(c.bpm).toBeLessThanOrEqual(hi);
        expect(Object.keys(forms[p]!)).toContain(c.form);
        // A whole song: sixteen bars on a sixteenth grid.
        expect(c.bars).toBeGreaterThanOrEqual(16);
        expect(c.stepsPerBar).toBe(16);
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

  it('son: a 3-2 clave all song, a tumbao, a bass that anticipates the chord, brass only where it calls', () => {
    for (const s of seeds) {
      const c = compose('son-band', s);
      expect(c.bars).toBe(SON_PLAN.length);
      for (let b = 0; b < c.bars; b++) {
        // Three strikes, then two: 0, 6, 12 and then 4, 8.
        expect(stepsIn(c, 'clave', b), `bar ${b}`).toEqual(b % 2 ? [4, 8] : [0, 6, 12]);
      }
      // The bass lands on the "and" of two and on four, in every playing bar and the intro's second
      // (never in the intro's first bar or the break).
      for (let b = 0; b < c.bars; b++) {
        const sec = SON_PLAN[b]!;
        const steps = stepsIn(c, 'bass', b);
        if (b === 0 || sec === 'break') expect(steps, `bar ${b}`).toHaveLength(0);
        else {
          expect(steps, `bar ${b}`).toContain(6);
          expect(steps, `bar ${b}`).toContain(12);
        }
      }
      // The brass calls over the coro, hits in the break's last bar and closes the song.
      const brassBars = new Set(of(c, 'stab').map((n) => barOf(c, n)));
      for (let b = 0; b < c.bars; b++) {
        const expected = SON_PLAN[b] === 'coro' || b === SON_PLAN.lastIndexOf('break') || b === c.bars - 1;
        expect(brassBars.has(b), `bar ${b}`).toBe(expected);
      }
      // The piano's montuno is three, three, two, three, three, two.
      const bar8 = stepsIn(c, 'ep', SON_PLAN.indexOf('montuno'));
      expect(bar8).toEqual([0, 3, 6, 8, 11, 14]);
      // The trumpet's theme comes back note for note (the first answer and the one at the end).
      const theme = SON_PLAN.indexOf('tema');
      const last = c.bars - 2;
      for (const k of [0, 1])
        expect(rhythmOf(c, 'lead', last + k), `bar ${last + k}`).toEqual(rhythmOf(c, 'lead', theme + k));
      expect(inBar(c, 'lead', theme).length).toBeGreaterThan(0);
      // The break is percussion alone: nothing melodic until the brass hits.
      for (const layer of ['lead', 'ep', 'bass'] as const)
        for (let b = 0; b < c.bars; b++)
          if (SON_PLAN[b] === 'break') expect(inBar(c, layer, b)).toHaveLength(0);
    }
  });

  it('dream: the arpeggio and pad open alone, the motorik drive, a crest, a haze with no bass, the crest again', () => {
    for (const s of seeds) {
      const c = compose('dream-band', s);
      expect(c.bars).toBe(DREAM_PLAN.length);
      const lineup = (b: number) =>
        [...new Set(c.notes.filter((n) => barOf(c, n) === b).map((n) => n.layer))].sort();
      expect(lineup(0)).toEqual(['arp', 'pad']);
      for (const l of ['kick', 'snare', 'rhythm', 'lead'] as const) expect(inBar(c, l, 0)).toHaveLength(0);
      for (let b = 0; b < c.bars; b++) {
        const sec = DREAM_PLAN[b]!;
        // The arpeggio and the pad never stop.
        expect(inBar(c, 'arp', b).length, `arp ${b}`).toBeGreaterThan(0);
        expect(inBar(c, 'pad', b).length, `pad ${b}`).toBeGreaterThan(0);
        if (sec === 'verse' || sec === 'crest' || sec === 'return') {
          // Kick on one, three and the "and" of three; snare on two and four; hats on every eighth.
          expect(stepsIn(c, 'kick', b), `kick ${b}`).toEqual([0, 8, 10]);
          expect(
            [...new Set(stepsIn(c, 'snare', b))].filter((x) => x === 4 || x === 12),
            `snare ${b}`,
          ).toEqual([4, 12]);
          expect(stepsIn(c, 'hat', b), `hat ${b}`).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
          expect(inBar(c, 'bass', b), `bass ${b}`).toHaveLength(8);
        }
        if (sec === 'crest' || sec === 'return') {
          expect(inBar(c, 'rhythm', b).length, `rhythm ${b}`).toBeGreaterThan(0);
          expect(inBar(c, 'lead', b).length, `lead ${b}`).toBeGreaterThan(0);
        } else {
          expect(inBar(c, 'rhythm', b), `rhythm ${b}`).toHaveLength(0);
          expect(inBar(c, 'lead', b), `lead ${b}`).toHaveLength(0);
        }
        if (sec === 'haze') {
          expect(inBar(c, 'bass', b), `haze bass ${b}`).toHaveLength(0);
          expect(stepsIn(c, 'kick', b)).toEqual([0]);
        }
      }
      // The crest's hook and answer return in the last four bars, rhythm for rhythm.
      const crest = DREAM_PLAN.indexOf('crest');
      const back = DREAM_PLAN.indexOf('return');
      for (let k = 0; k < 4; k++)
        expect(rhythmOf(c, 'lead', back + k), `return ${k}`).toEqual(rhythmOf(c, 'lead', crest + k));
    }
  });

  it('beats: boom-bap kick, snare with a clap on two and four, an 808 that glides, a Rhodes and a whistle that returns', () => {
    for (const s of seeds) {
      const c = compose('beat-band', s);
      expect(c.bars).toBe(BEAT_PLAN.length);
      for (let b = 0; b < c.bars; b++) {
        const sec = BEAT_PLAN[b]!;
        const drums = sec === 'beat' || sec === 'hook' || sec === 'return';
        if (drums) {
          expect(stepsIn(c, 'kick', b).slice(0, 2), `kick ${b}`).toEqual([0, b % 2 ? 6 : 10]);
          // Every snare hit on two and four has its clap on the same step.
          const hits = (l: RadioNote['layer']) =>
            [...new Set(stepsIn(c, l, b))].filter((x) => x === 4 || x === 12);
          expect(hits('snare'), `snare ${b}`).toEqual([4, 12]);
          expect(hits('clap'), `clap ${b}`).toEqual([4, 12]);
          expect(inBar(c, 'bass', b).length, `808 ${b}`).toBeGreaterThan(1);
        } else {
          // The intro and the break keep the kick, the 808 and the Rhodes; the snare and the clap
          // are out.
          expect(inBar(c, 'snare', b)).toHaveLength(0);
          expect(inBar(c, 'clap', b)).toHaveLength(0);
          expect(stepsIn(c, 'kick', b)).toEqual([0]);
          expect(inBar(c, 'bass', b).length, `808 ${b}`).toBeGreaterThan(1);
        }
        // The Rhodes plays seventh chords: four notes at each hit.
        const ep = inBar(c, 'ep', b);
        expect(ep.length % 4, `ep ${b}`).toBe(0);
        expect(ep.length).toBeGreaterThan(0);
      }
      // Each bar's first 808 note glides in from below.
      for (let b = 0; b < c.bars; b++) expect(inBar(c, 'bass', b)[0]?.slide, `slide ${b}`).toBeLessThan(0);
      // The whistle's hook and answer come back, rhythm for rhythm, in the last four bars.
      const hook = BEAT_PLAN.indexOf('hook');
      const back = BEAT_PLAN.indexOf('return');
      for (let k = 0; k < 4; k++) {
        expect(inBar(c, 'lead', hook + k).length).toBeGreaterThan(0);
        expect(rhythmOf(c, 'lead', back + k), `return ${k}`).toEqual(rhythmOf(c, 'lead', hook + k));
      }
      // Nothing whistles before the hook.
      for (let b = 0; b < hook; b++) expect(inBar(c, 'lead', b)).toHaveLength(0);
    }
  });
});

/** Every region id any station names, with the three the game ships. */
const regions = [
  ...new Set([...all.flatMap((s) => s.regions), 'florida-keys', 'pacific-northwest', 'san-francisco']),
].sort();
const presetOf = (s: RadioStation) => s.tracks[0]!.procedural!.preset;

describe('every region has its new station, and every station on every dial plays inside the mix', () => {
  const want: Record<string, string> = {
    'florida-keys': 'son-band',
    'pacific-northwest': 'dream-band',
    'san-francisco': 'beat-band',
  };

  it('puts one new code-made station on each region`s dial, every track vetoable and composing as written', () => {
    for (const [region, preset] of Object.entries(want)) {
      const dial = stationsForRegion(all, region);
      const s = dial.find((x) => presetOf(x) === preset);
      expect(s, `${region} has a ${preset} station`).toBeDefined();
      if (!s) continue;
      expect(s.regions).toContain(region);
      expect(s.pirate ?? null).toBeNull();
      expect(s.tracks.length).toBeGreaterThanOrEqual(5);
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

  it('every dial station plays on a band of its own, through the real player, at or under the loudest rig', () => {
    // The loudest rig shipping trims to 1.4 (the synth band); no band is set above it.
    const maxTrim = 1.4;
    let played = 0;
    for (const region of regions) {
      const dial = stationsForRegion(all, region);
      expect(dial.length, region).toBeGreaterThan(0);
      for (const s of dial) {
        // A station's genre names its band; only Pivot FM, which pivots between bands, has none.
        if (presetOf(s) !== 'pivot-medley') expect(genreOf(s), `${region}/${s.id}`).toBe(s.genre);
        const ctx = new FakeAudioContext();
        const out = ctx.createGain();
        const player = createRadioPlayer(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, {
          seed: 5,
          band: RADIO_BAND,
        });
        player.select(s);
        const before = ctx.nodes.length;
        for (let t = 0; t < 4; t += 1 / 30) {
          ctx.currentTime = t;
          player.pump(t, true);
        }
        expect(player.nowPlaying()?.stationId, `${region}/${s.id}`).toBe(s.id);
        const sources = ctx.nodes
          .slice(before)
          .filter((n) => (n.kind === 'oscillator' || n.kind === 'bufferSource') && (n.startedAt ?? 0) > 0);
        expect(sources.length, `${region}/${s.id} makes sound`).toBeGreaterThan(20);
        for (const src of sources) expect(src.stoppedAt, `${region}/${s.id} stops`).not.toBeNull();
        // Its rig fades up to the radio's level times its trim, within the mix.
        const rigOut = ctx.inputsOf(out, 'gain').filter((g) => g.gain.target > 0);
        expect(rigOut.length, `${region}/${s.id} is audible`).toBeGreaterThan(0);
        for (const g of rigOut) {
          expect(g.gain.target, `${region}/${s.id} level`).toBeGreaterThan(0);
          expect(g.gain.target, `${region}/${s.id} level`).toBeLessThanOrEqual(RADIO_LEVEL * maxTrim);
        }
        played++;
      }
    }
    expect(played).toBeGreaterThanOrEqual(15);
  });

  it('the new bands play on rigs of their own, at a trim each, inside the same ceiling', () => {
    for (const g of TRIO_GENRES) {
      const ctx = new FakeAudioContext();
      const out = ctx.createGain();
      const rig = createBandRig(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, g);
      expect(rig.genre).toBe(g);
      expect(TRIO_TRIM[g]).toBeGreaterThan(0);
      expect(TRIO_TRIM[g]).toBeLessThanOrEqual(1.4);
      rig.setLevel(RADIO_LEVEL, 1);
      expect(ctx.inputsOf(out, 'gain')[0]!.gain.target).toBeCloseTo(RADIO_LEVEL * TRIO_TRIM[g], 5);
    }
  });
});
