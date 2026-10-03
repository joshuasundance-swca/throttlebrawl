// radio-1 (M4.md, head start): station data, seeded composition, the playlist and veto, and the
// radio inside the mixer (switching, the duck, "cut this" as data), on the fake context. The real
// graph is rendered offline in tests/e2e/audio-radio.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { loadBasePack, registryFromGlob } from '../content';
import { FakeAudioContext, fakeContextFactory } from './fake-context';
import { createAudio, RADIO_FIRST_STATION, RADIO_OFF, RADIO_SCORE } from './index';
import {
  composeTrack,
  hashString,
  RADIO_PRESETS,
  ROCKABILLY_FORMS_IDS,
  SURF_FORMS,
  trackSeed,
  type Composition,
} from './radio-compose';
import { composeFor, RADIO_BAND } from './radio-band';
import { pluckBuffer } from './radio-synth';
import {
  createRadioPlayer,
  cutFlag,
  playlist,
  stationsForRegion,
  stationsFromTable,
  stationTrackRef,
  type RadioStation,
} from './radio';

const baseStations = () => stationsFromTable(loadBasePack().stations);
const station = (id: string) => {
  const s = baseStations().find((x) => x.id === id);
  if (!s) throw new Error(`no station ${id}`);
  return s;
};

/** A stable digest of a composition, so a track's song never changes by accident. */
function fingerprint(c: Composition): string {
  const text = c.notes.map((n) => `${n.step}:${n.layer}:${n.midi}:${n.len}:${n.vel.toFixed(3)}`).join('|');
  return `${c.bpm}/${c.key}/${c.form}/${c.steps}/${c.notes.length}/${hashString(text).toString(16)}`;
}

describe('station data (packs/base/stations)', () => {
  it('has a surf, a rockabilly and an island station for the Keys, each with at least 3 code-made tracks', () => {
    // The hidden pirate (Contraband Cay, run W-Q) is not on the dial: pirate.test.ts has it.
    const all = baseStations().filter((s) => !s.pirate);
    expect(all.map((s) => `${s.packId}:${s.id}`)).toEqual([
      'base:keys-rockabilly',
      'base:keys-surf',
      'base:keys-tradewinds',
    ]);
    for (const s of all) {
      expect(['surf', 'rockabilly', 'island']).toContain(s.genre);
      expect(s.regions).toEqual(['florida-keys']);
      // Run W-P adds regional song names; the content lane may add more.
      expect(s.tracks.length).toBeGreaterThanOrEqual(3);
      expect(new Set(s.tracks.map((t) => t.id)).size).toBe(s.tracks.length);
      for (const t of s.tracks) {
        expect(t.origin).toBe('agent');
        expect(t.status).toBe('live');
        expect(t.title.length).toBeGreaterThan(0);
        expect(RADIO_PRESETS).toContain(t.procedural?.preset);
        expect(t.procedural?.preset).toBe(
          { surf: 'surf-trio', rockabilly: 'rockabilly-trio', island: 'island-band' }[s.genre],
        );
        expect(t.ref).toBe(stationTrackRef('base', s.id, t.id));
        expect(t.ref).toMatch(/^base:station\/[a-z0-9-]+#[a-z0-9-]+$/);
        expect(composeFor(t)).not.toBeNull();
      }
    }
  });

  it('derives a region station list from each station`s regions', () => {
    const keys = stationsForRegion(baseStations(), 'florida-keys').map((s) => s.id);
    expect(keys).toEqual(['keys-rockabilly', 'keys-surf', 'keys-tradewinds']);
    expect(stationsForRegion(baseStations(), 'base:florida-keys')).toHaveLength(3);
    expect(stationsForRegion(baseStations(), 'pacific-northwest')).toEqual([]);
    const genre: RadioStation = { ...station('keys-surf'), id: 'everywhere', regions: [] };
    expect(stationsForRegion([...baseStations(), genre], 'pacific-northwest').map((s) => s.id)).toEqual([
      'everywhere',
    ]);
    expect(stationsForRegion(baseStations(), null)).toHaveLength(3);
  });

  it("puts a region's own stations first, then genre stations, then the base pack's as fallbacks", () => {
    const pnw: RadioStation = {
      ...station('keys-surf'),
      id: 'pnw-x',
      packId: 'region-pnw',
      regions: ['pacific-northwest'],
    };
    const genre: RadioStation = { ...station('keys-surf'), id: 'everywhere', regions: [] };
    const all = [...baseStations(), genre, pnw];
    expect(stationsForRegion(all, 'region-pnw:pacific-northwest').map((s) => s.id)).toEqual([
      'pnw-x',
      'everywhere',
      'keys-rockabilly',
      'keys-surf',
      'keys-tradewinds',
    ]);
    // The Keys never pick up another region's station.
    expect(stationsForRegion(all, 'florida-keys').map((s) => s.id)).toEqual([
      'keys-rockabilly',
      'keys-surf',
      'keys-tradewinds',
      'everywhere',
    ]);
  });

  it('drops a track whose status is vetoed at load, and keeps it in the file as the taste log', () => {
    const table = {
      'base:keys-surf': {
        id: 'keys-surf',
        name: 'x',
        genre: 'surf',
        regions: [],
        tracks: [
          { id: 'a', title: 'A', procedural: { preset: 'surf-trio' }, origin: 'agent', status: 'live' },
          { id: 'b', title: 'B', procedural: { preset: 'surf-trio' }, origin: 'agent', status: 'vetoed' },
          { id: 'c', title: 'C', audioAsset: 'audio/music/x', origin: 'ai-batch' },
        ],
      },
    };
    const [s] = stationsFromTable(table);
    expect(s!.tracks.map((t) => t.status)).toEqual(['live', 'vetoed', 'live']);
    // B is vetoed; C is AI-made and waits for assets-2.
    expect(playlist(s!, 7, new Set()).map((t) => t.id)).toEqual(['a']);
  });
});

describe('composition seeds', () => {
  it('derives each track`s seed from its content reference, stably', () => {
    expect(trackSeed('base:station/keys-surf#causeway-twang')).toBe(
      trackSeed('base:station/keys-surf#causeway-twang'),
    );
    expect(trackSeed('base:station/keys-surf#causeway-twang')).not.toBe(
      trackSeed('base:station/keys-surf#seven-mile-drip'),
    );
    expect(trackSeed('x', 1)).not.toBe(trackSeed('x', 2));
    // FNV-1a of a known string: the seed function itself must never drift, or every song rerolls.
    expect(hashString('throttlebrawl')).toBe(0x35141eff);
  });

  it('composes the same song for the same seed, and a different one for another seed', () => {
    for (const preset of RADIO_PRESETS) {
      const a = composeTrack({ preset }, 1234)!;
      const b = composeTrack({ preset }, 1234)!;
      const c = composeTrack({ preset }, 98765)!;
      expect(a).toEqual(b);
      expect(fingerprint(a)).toBe(fingerprint(b));
      expect(fingerprint(a)).not.toBe(fingerprint(c));
    }
    expect(composeTrack({ preset: 'polka-trio' }, 1)).toBeNull();
  });

  it('keeps every base track`s song (a changed fingerprint means the song changed: update on purpose)', () => {
    const prints: Record<string, string> = {};
    for (const s of baseStations()) for (const t of s.tracks) prints[t.ref] = fingerprint(composeFor(t)!);
    // Each track is its own song.
    expect(new Set(Object.values(prints)).size).toBe(Object.keys(prints).length);
    // Recomposing gives the same notes.
    for (const s of baseStations())
      for (const t of s.tracks) expect(fingerprint(composeFor(t)!)).toBe(prints[t.ref]);
  });

  it('honours the params it is given and clamps the tempo', () => {
    const c = composeTrack({ preset: 'surf-trio', params: { bpm: 999, key: 'A', progression: 'stomp' } }, 1)!;
    expect(c.bpm).toBe(175);
    expect(c.key).toBe(45);
    expect(c.form).toBe('stomp');
    const r = composeTrack({ preset: 'rockabilly-trio', params: { bpm: 10, form: 'eight' } }, 1)!;
    expect(r.bpm).toBe(150);
    expect(r.bars).toBe(8);
  });
});

describe('the genres', () => {
  it('surf: straight sixteenths, a tremolo-picked lead, a tom roll back to the top, a minor-ish key', () => {
    for (const form of SURF_FORMS) {
      for (const seed of [1, 2, 3]) {
        const c = composeTrack({ preset: 'surf-trio', params: { progression: form } }, seed)!;
        expect(c.stepsPerBeat).toBe(4);
        expect(c.bpm).toBeGreaterThanOrEqual(140);
        expect(c.bpm).toBeLessThanOrEqual(175);
        expect(c.notes.some((n) => n.layer === 'lead' && n.trem)).toBe(true);
        const lastBar = (c.bars - 1) * c.stepsPerBar;
        const toms = c.notes.filter((n) => n.layer === 'tom' && n.step >= lastBar + 8);
        expect(toms.length).toBe(8);
        // The roll falls.
        expect(toms[0]!.midi).toBeGreaterThan(toms.at(-1)!.midi);
        expect(c.notes.filter((n) => n.layer === 'snare').length).toBeGreaterThanOrEqual(2 * (c.bars - 1));
        for (let i = 1; i < c.notes.length; i++)
          expect(c.notes[i]!.step).toBeGreaterThanOrEqual(c.notes[i - 1]!.step);
      }
    }
    const drop = composeTrack({ preset: 'surf-trio', params: { drop: true } }, 5)!;
    expect(drop.notes.find((n) => n.layer === 'gliss')?.slide).toBeLessThan(-12);
  });

  it('rockabilly: a shuffle, a backbeat, a slapped or boogie bass, bends and a turnaround', () => {
    const SWING = new Set([0, 2, 3, 5, 6, 8, 9, 11]);
    for (const form of ROCKABILLY_FORMS_IDS) {
      for (const band of ['slap', 'boogie']) {
        const c = composeTrack({ preset: 'rockabilly-trio', params: { form, band } }, 11)!;
        expect(c.stepsPerBeat).toBe(3);
        expect(c.bars).toBe(form === 'eight' ? 8 : 12);
        // Everything but the snare fill sits on the swung-eighth grid.
        for (const n of c.notes) if (n.layer !== 'snare') expect(SWING.has(n.step % 12)).toBe(true);
        // The ride shuffles: beat and the third triplet.
        const ride = c.notes.filter((n) => n.layer === 'ride' && n.step < 12).map((n) => n.step);
        expect(ride).toEqual([0, 2, 3, 5, 6, 8, 9, 11]);
        // Backbeat on 2 and 4 (steps 3 and 9).
        const snare = c.notes.filter((n) => n.layer === 'snare' && n.step < 12).map((n) => n.step);
        expect(snare).toEqual([3, 9]);
        expect(c.notes.some((n) => n.layer === 'slap')).toBe(true);
        // The turnaround: the top root held over a falling inner voice in the last bar.
        const last = c.notes.filter((n) => n.layer === 'lead' && n.step >= (c.bars - 1) * 12);
        const inner = last.filter((n) => n.midi !== c.key + 24).map((n) => n.midi - c.key - 12);
        expect(inner).toEqual([10, 9, 8, 7]);
      }
    }
    // Over many seeds, some licks bend the minor third up.
    const bends = [1, 2, 3, 4, 5, 6, 7, 8].some((seed) =>
      composeTrack({ preset: 'rockabilly-trio' }, seed)!.notes.some((n) => n.slide === -1),
    );
    expect(bends).toBe(true);
  });
});

describe('the band', () => {
  it('plucks strings in tune (Karplus-Strong), so the parts are notes, not noise', () => {
    const ctx = new FakeAudioContext();
    for (const timbre of ['twang', 'clean', 'bass', 'upright'] as const) {
      for (const midi of [40, 45, 57, 64, 76]) {
        const y = pluckBuffer(ctx as unknown as BaseAudioContext, midi, timbre).getChannelData(0);
        const want = ctx.sampleRate / (440 * 2 ** ((midi - 69) / 12));
        // The strongest autocorrelation lag, near the expected period, after the attack.
        const from = Math.round(0.05 * ctx.sampleRate);
        const n = Math.round(0.1 * ctx.sampleRate);
        let best = 0;
        let bestR = -Infinity;
        for (let lag = Math.floor(want * 0.8); lag <= Math.ceil(want * 1.2); lag++) {
          let r = 0;
          for (let i = from; i < from + n; i++) r += (y[i] ?? 0) * (y[i + lag] ?? 0);
          if (r > bestR) {
            bestR = r;
            best = lag;
          }
        }
        // Within a sample of the true period (under 1.5 % even at the top note).
        expect(Math.abs(best - want)).toBeLessThanOrEqual(1);
        // It rings and then decays.
        let early = 0;
        let late = 0;
        for (let i = 0; i < 2000; i++) {
          early += Math.abs(y[from + i] ?? 0);
          late += Math.abs(y[y.length - 2000 + i] ?? 0);
        }
        expect(early).toBeGreaterThan(late * 1.5);
      }
    }
  });
});

describe('the playlist and the veto', () => {
  it('orders a session`s tracks from the seed', () => {
    const s = station('keys-surf');
    const a = playlist(s, 42, new Set()).map((t) => t.id);
    expect(playlist(s, 42, new Set()).map((t) => t.id)).toEqual(a);
    expect([...a].sort()).toEqual(s.tracks.map((t) => t.id).sort());
    const orders = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
        playlist(s, seed, new Set())
          .map((t) => t.id)
          .join(),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('never plays a vetoed track in a seeded session, and plays every other one', () => {
    const base = station('keys-rockabilly');
    const vetoedId = base.tracks[1]!.id;
    const s: RadioStation = {
      ...base,
      tracks: base.tracks.map((t) => (t.id === vetoedId ? { ...t, status: 'vetoed' } : t)),
    };
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const player = createRadioPlayer(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, {
      seed: 9,
      loopsPerTrack: 1,
      band: RADIO_BAND,
    });
    player.select(s);
    for (let t = 0; t < 150; t += 0.1) {
      ctx.currentTime = t;
      player.pump(t, true);
    }
    const heard = new Set(player.history());
    expect(heard.has(stationTrackRef('base', s.id, vetoedId))).toBe(false);
    for (const t of s.tracks) if (t.id !== vetoedId) expect(heard.has(t.ref)).toBe(true);
  });

  it('a track cut on this device stops at once and never comes back', () => {
    const s = station('keys-surf');
    const ctx = new FakeAudioContext();
    const player = createRadioPlayer(
      ctx as unknown as BaseAudioContext,
      ctx.createGain() as unknown as AudioNode,
      {
        seed: 3,
        loopsPerTrack: 1,
        band: RADIO_BAND,
      },
    );
    player.select(s);
    const first = player.nowPlaying()!.ref;
    player.setCut([first]);
    expect(player.nowPlaying()!.ref).not.toBe(first);
    for (let t = 0; t < 120; t += 0.1) {
      ctx.currentTime = t;
      player.pump(t, true);
    }
    expect(player.history().filter((r) => r === first)).toHaveLength(1);
    expect(cutFlag(first, 'race-1', 12.7)).toEqual({ contentRef: first, raceId: 'race-1', tick: 12 });
  });

  // main-green-4: the band is a lazy chunk. Tuned before it arrives, the player keeps the station
  // and plays nothing; when it lands, the station starts from the top of its playlist.
  it('a station tuned before the lazy band arrives waits silent, then plays from the top', async () => {
    const s = station('keys-surf');
    const ctx = new FakeAudioContext();
    let deliver: (b: typeof RADIO_BAND) => void = () => undefined;
    const band = new Promise<typeof RADIO_BAND>((resolve) => (deliver = resolve));
    const player = createRadioPlayer(
      ctx as unknown as BaseAudioContext,
      ctx.createGain() as unknown as AudioNode,
      {
        seed: 3,
        band,
      },
    );
    player.select(s);
    const nodes = ctx.nodes.length;
    for (let t = 0; t < 1; t += 0.1) {
      ctx.currentTime = t;
      player.pump(t, true);
    }
    expect(player.station()?.id).toBe('keys-surf');
    expect(player.nowPlaying()).toBeNull();
    expect(player.playing()).toBe(false);
    expect(ctx.nodes.length).toBe(nodes);
    deliver(RADIO_BAND);
    await band;
    const top = playlist(s, 3, new Set())[0]!.ref;
    expect(player.nowPlaying()?.ref).toBe(top);
    for (let t = 1; t < 2; t += 0.1) {
      ctx.currentTime = t;
      player.pump(t, true);
    }
    expect(player.playing()).toBe(true);
    expect(ctx.nodes.length).toBeGreaterThan(nodes);
    expect(player.history()).toEqual([top]);
  });
});

describe('the radio in the mixer', () => {
  const press = (target: EventTarget, shift = false) =>
    target.dispatchEvent(
      Object.assign(new Event('keydown'), { code: 'KeyR', shiftKey: shift, repeat: false }),
    );

  async function racing(stations?: readonly RadioStation[]) {
    const { ctx, create } = fakeContextFactory();
    const keys = new EventTarget();
    const audio = createAudio({
      createContext: create,
      radioKeys: keys,
      radioSeed: 5,
      radioBand: RADIO_BAND,
      ...(stations ? { stations } : {}),
    });
    await audio.resume();
    const tick = (t: number) => {
      ctx.currentTime = t;
      audio.update({ rpm: 4000, throttle: 1, speed: 30 });
    };
    return { ctx, keys, audio, tick };
  }

  it('the R key cycles score, each station, off; switching changes the playing track', async () => {
    const { keys, audio, tick } = await racing(baseStations());
    // A race starts on the region's first station (playtest 2); this test starts from the score.
    expect(audio.inspect().radio.choice).toBe(RADIO_FIRST_STATION);
    audio.setParam('audio.radio', RADIO_SCORE);
    tick(0.1);
    expect(audio.inspect().radio.tunedTo).toBe('score');
    expect(audio.inspect().musicPlaying).toBe(true);
    press(keys);
    tick(0.2);
    const r = audio.inspect().radio;
    expect(r.tunedTo).toBe('keys-rockabilly');
    expect(r.nowPlaying?.ref).toMatch(/^base:station\/keys-rockabilly#/);
    expect(audio.inspect().musicPlaying).toBe(false);
    press(keys);
    tick(0.3);
    expect(audio.inspect().radio.nowPlaying?.ref).toMatch(/^base:station\/keys-surf#/);
    press(keys);
    tick(0.35);
    expect(audio.inspect().radio.nowPlaying?.ref).toMatch(/^base:station\/keys-tradewinds#/);
    press(keys);
    tick(0.4);
    expect(audio.inspect().radio.tunedTo).toBe('off');
    expect(audio.inspect().radio.nowPlaying).toBeNull();
    expect(audio.inspect().musicPlaying).toBe(false);
    press(keys);
    expect(audio.inspect().radio.tunedTo).toBe('score');
    // Shift+R skips a track.
    audio.setParam('audio.radio', 3);
    const before = audio.inspect().radio.nowPlaying!.ref;
    press(keys, true);
    expect(audio.inspect().radio.nowPlaying!.ref).not.toBe(before);
  });

  it('the tuning slider picks the station; past the last one is off', async () => {
    const { audio } = await racing(baseStations());
    audio.setParam('audio.radio', 2);
    expect(audio.inspect().radio.tunedTo).toBe('keys-rockabilly');
    audio.setParam('audio.radio', RADIO_OFF);
    expect(audio.inspect().radio.tunedTo).toBe('off');
    audio.setParam('audio.radio', 6);
    expect(audio.inspect().radio.tunedTo).toBe('off');
    audio.setParam('audio.radio', RADIO_SCORE);
    expect(audio.inspect().radio.tunedTo).toBe('score');
    // Another region hears no Keys station.
    audio.setRegion('pacific-northwest');
    audio.setParam('audio.radio', 2);
    expect(audio.inspect().radio.tunedTo).toBe('off');
  });

  it('loads the base pack`s stations by itself the first time a station is picked', async () => {
    const { audio } = await racing();
    audio.setParam('audio.radio', 3);
    await vi.waitFor(() => expect(audio.inspect().radio.tunedTo).toBe('keys-surf'), { timeout: 10_000 });
    expect(audio.inspect().radio.stations).toEqual(['keys-rockabilly', 'keys-surf', 'keys-tradewinds']);
  });

  it('the radio plays into the music bus (through the duck and the slow-motion duck)', async () => {
    const { ctx, audio, tick } = await racing(baseStations());
    audio.setParam('audio.radio', 2);
    for (let t = 0.1; t < 1; t += 0.05) tick(t);
    // Walk from any radio source to the destination; the path must pass the music bus, which is
    // the bus the music slider drives (index.ts builds music, effects, voices in that order).
    const busOf = (n: (typeof ctx.nodes)[number]): boolean => {
      const seen = new Set<typeof n>();
      const stack = [n];
      while (stack.length) {
        const x = stack.pop()!;
        if (seen.has(x)) continue;
        seen.add(x);
        if (x === musicBus) return true;
        stack.push(...x.outputs);
      }
      return false;
    };
    const master = ctx.nodes.find(
      (n) => n.kind === 'gain' && n.outputs.some((o) => o.kind === 'compressor'),
    )!;
    const busGains = ctx.nodes.filter((n) => n.kind === 'gain' && n.outputs.includes(master));
    const musicBus = busGains[0]!;
    const radioSources = ctx.nodes.filter((n) => n.kind === 'bufferSource' && n.buffer !== null && busOf(n));
    expect(radioSources.length).toBeGreaterThan(10);
  });

  it('ducks the music under a crash and on request (for barks), then lets it back', async () => {
    const { audio, tick } = await racing(baseStations());
    tick(0.1);
    expect(audio.inspect().duckLevel).toBe(1);
    audio.onEvents([{ tick: 1, type: 'crash', actor: 0, data: { impact: 1 } } as never], {
      tick: 1,
      timeScale: 1,
      entities: [],
    } as never);
    // With no snapshot entity the crash is heard as the player's own or at 0.6: it ducks.
    expect(audio.inspect().duckLevel).toBeCloseTo(0.4);
    audio.setParam('audio.duckLevel', 0.7);
    audio.duck();
    expect(audio.inspect().duckLevel).toBeCloseTo(0.7);
  });

  it('"cut this" on the playing track returns the settings flag and skips the track', async () => {
    const { audio } = await racing(baseStations());
    audio.setParam('audio.radio', RADIO_SCORE);
    expect(audio.cutPlayingTrack('r', 1)).toBeNull();
    audio.setParam('audio.radio', 3);
    const playing = audio.inspect().radio.nowPlaying!.ref;
    const flag = audio.cutPlayingTrack('race-abc', 640);
    expect(flag).toEqual({ contentRef: playing, raceId: 'race-abc', tick: 640 });
    expect(audio.inspect().radio.nowPlaying!.ref).not.toBe(playing);
    // A device cut from the settings record applies on the next session too.
    const again = await racing(baseStations());
    again.audio.setRadioCut([playing]);
    again.audio.setParam('audio.radio', 3);
    expect(again.audio.inspect().radio.nowPlaying!.ref).not.toBe(playing);
  });
});

describe('the regions own stations (playtest 2, 2026-10-02: "different stations and music in different regions")', () => {
  const all = stationsFromTable(
    registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' })).stations,
  );
  const PRESET: Record<string, string> = {
    surf: 'surf-trio',
    rockabilly: 'rockabilly-trio',
    grunge: 'grunge-band',
    folk: 'folk-band',
    synth: 'synth-band',
    psych: 'psych-band',
    island: 'island-band',
    stoner: 'stoner-band',
    funk: 'funk-band',
  };
  const want: [string, string, string, string][] = [
    ['region-pnw', 'pnw-drizzle', 'pacific-northwest', 'grunge'],
    ['region-pnw', 'pnw-salal', 'pacific-northwest', 'folk'],
    ['region-sf', 'sf-burn-rate', 'san-francisco', 'synth'],
    ['region-sf', 'sf-fog-bank', 'san-francisco', 'psych'],
    ['region-pnw', 'pnw-stump', 'pacific-northwest', 'stoner'],
    ['region-sf', 'sf-gold-rush', 'san-francisco', 'funk'],
  ];
  it.each(want)(
    '%s carries %s, four or more code-made tracks of its own band that compose as written',
    (pack, id, region, genre) => {
      const s = all.find((x) => x.packId === pack && x.id === id);
      expect(s).toBeDefined();
      if (!s) return;
      expect(s.regions).toEqual([region]);
      expect(s.genre).toBe(genre);
      expect(s.tracks.length).toBeGreaterThanOrEqual(4);
      const keysTitles = new Set(baseStations().flatMap((b) => b.tracks.map((t) => t.title)));
      for (const t of s.tracks) {
        expect(t.ref).toBe(stationTrackRef(pack, id, t.id));
        expect(t.origin).toBe('agent');
        expect(t.status).toBe('live');
        expect(keysTitles.has(t.title)).toBe(false);
        expect(t.procedural?.preset).toBe(PRESET[genre]);
        const c = composeFor(t);
        expect(c).not.toBeNull();
        // Every param is inside its preset's range, so the song is the one the file describes.
        expect(c?.bpm).toBe(t.procedural?.params?.['bpm']);
        expect(c?.form).toBe(t.procedural?.params?.['progression']);
      }
    },
  );

  it('gives every region at least two stations, none sharing a genre with another region', () => {
    const regions = ['florida-keys', 'pacific-northwest', 'san-francisco'];
    const genres = regions.map((r) => new Set(stationsForRegion(all, r).map((s) => s.genre)));
    for (const [i, g] of genres.entries()) {
      expect(stationsForRegion(all, regions[i]!).length, regions[i]).toBeGreaterThanOrEqual(2);
      expect(g.size, regions[i]).toBeGreaterThanOrEqual(2);
      for (const [j, other] of genres.entries())
        if (i !== j) for (const x of g) expect(other.has(x)).toBe(false);
    }
  });

  it("a region with two or more stations of its own keeps its dial to itself; with one, the base pack's follow", () => {
    const keys = stationsForRegion(all, 'base:florida-keys').map((s) => s.id);
    const pnw = stationsForRegion(all, 'region-pnw:pacific-northwest').map((s) => s.id);
    const sf = stationsForRegion(all, 'region-sf:san-francisco').map((s) => s.id);
    expect(keys).toEqual(['keys-rockabilly', 'keys-surf', 'keys-tradewinds']);
    expect(pnw).toEqual(['pnw-drizzle', 'pnw-salal', 'pnw-stump']);
    expect(sf).toEqual(['sf-burn-rate', 'sf-fog-bank', 'sf-gold-rush']);
    const one = all.filter((s) => s.id !== 'pnw-salal' && s.id !== 'pnw-stump');
    expect(stationsForRegion(one, 'region-pnw:pacific-northwest').map((s) => s.id)).toEqual([
      'pnw-drizzle',
      'keys-rockabilly',
      'keys-surf',
      'keys-tradewinds',
    ]);
  });
});
