// Radio stations (M4 radio-1): stations are data (packs/<pack>/stations/<id>.json, the station
// format in docs/content-packs.md), each track a vetoable item. stations.ts turns the registry's
// station entries into playable stations and derives a region's list from each station's `regions`
// (it loads at boot; this file loads with the lazy audio engine). This file orders a session's
// playlist from a seed, and plays it: each code-made (`procedural`) track loops
// a few times, then the next one comes on. AI-made `audioAsset` tracks wait for assets-2 and are
// skipped for now.
//
// "Cut this" as data: every track has a content reference, `<packId>:station/<stationId>#<trackId>`
// (docs/content-packs.md, "In-game veto"). The loader already drops tracks whose `status` is
// `vetoed`; a track cut on this device (a `{contentRef, raceId, tick}` flag in the settings record)
// is skipped too, at once, and `cutFlag` builds that flag for the playing track, so the pause
// menu's station panel (ui-4) only has to call it and store the result.
//
// The band itself (the composers and the rigs, radio-band.ts) is a lazy chunk (main-green-4,
// 2026-10-02): this file holds only the stations, the playlists and the player's clock, and the
// player is handed the band, or a promise of it, and stays silent until it arrives.
import type { Composition } from './radio-compose';
import { isExtra, isMore, isRegional } from './radio-genres';
import type { RadioGenre, RadioRig } from './radio-synth';
import { seededRandom, trackSeed } from './radio-util';

import type { RadioStation, RadioTrack, RadioVetoFlag } from './stations';

export {
  pirateStationFor,
  riderStationsFor,
  stationsForRegion,
  stationsFromTable,
  stationTrackRef,
} from './stations';
export type { RadioStation, RadioTrack, RadioVetoFlag } from './stations';

/** True when this build can play the track (code-made, not vetoed, not cut on this device). */
export function playable(track: RadioTrack, cut: ReadonlySet<string>): boolean {
  return track.status !== 'vetoed' && !cut.has(track.ref) && track.procedural !== null;
}

/** The session's track order for a station: the playable tracks, shuffled by the seed. */
export function playlist(station: RadioStation, seed: number, cut: ReadonlySet<string>): RadioTrack[] {
  const list = station.tracks.filter((t) => playable(t, cut));
  const r = seededRandom((seed ^ trackSeed(`${station.packId}:station/${station.id}`)) >>> 0);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const a = list[i]!;
    list[i] = list[j]!;
    list[j] = a;
  }
  return list;
}

/**
 * What plays the songs (radio-band.ts's RADIO_BAND, a lazy chunk): a track's composition (null
 * when its preset is unknown) and the rig for a genre's band.
 */
export interface RadioBand {
  compose(track: RadioTrack): Composition | null;
  rig(ctx: BaseAudioContext, out: AudioNode, genre: RadioGenre): RadioRig;
}

/** The band a station plays on: its `genre`, surf when the genre has no band of its own yet. */
export const genreOf = (s: RadioStation): RadioGenre =>
  s.genre === 'rockabilly' || isRegional(s.genre) || isMore(s.genre) || isExtra(s.genre) ? s.genre : 'surf';

export interface NowPlaying {
  stationId: string;
  stationName: string;
  trackId: string;
  title: string;
  ref: string;
  origin: string | null;
}

export interface RadioPlayer {
  /** Tunes in (or out, with null). The playlist restarts from the session seed. */
  select(station: RadioStation | null): void;
  /** Schedules notes up to a little past `now`; call every frame. */
  pump(now: number, playing: boolean): void;
  /** The next track now. */
  skip(): void;
  /** Tracks cut on this device: a playing one stops at once. */
  setCut(refs: readonly string[]): void;
  /** Scales the spring and the slapback (0 = dry). */
  setFx(scale: number): void;
  nowPlaying(): NowPlaying | null;
  /** Session history of the tracks that started, oldest first (refs), for tests and the report. */
  history(): readonly string[];
  readonly station: () => RadioStation | null;
  readonly playing: () => boolean;
}

export interface RadioPlayerOptions {
  /** The session seed that orders each station's playlist. */
  seed: number;
  /** Loops of a track before the next one, [default] 3; a function follows a tuning slider. */
  loopsPerTrack?: number | (() => number);
  /**
   * The band (radio-band.ts's RADIO_BAND), or the promise of its lazy chunk: until it arrives the
   * player keeps the tuned station but plays nothing, then starts the station's playlist.
   */
  band: RadioBand | Promise<RadioBand>;
}

const LOOKAHEAD_S = 0.25;
const RADIO_LEVEL = 0.62;

export function createRadioPlayer(
  ctx: BaseAudioContext,
  out: AudioNode,
  opts: RadioPlayerOptions,
): RadioPlayer {
  let station: RadioStation | null = null;
  let cut = new Set<string>();
  let list: RadioTrack[] = [];
  let index = 0;
  /** A song, or one part of a medley: its notes by step, and the band that plays it (null: the station's). */
  interface Part {
    comp: Composition;
    byStep: Map<number, Composition['notes']>;
    genre: RadioGenre | null;
  }
  let current: { track: RadioTrack; parts: Part[] } | null = null;
  /** The part playing (always 0 for an ordinary song; a medley steps through its parts once). */
  let part = 0;
  let comp: Composition | null = null;
  let step = 0;
  let loops = 0;
  let next = 0;
  let on = false;
  const rigs = new Map<RadioGenre, RadioRig>();
  let rig: RadioRig | null = null;
  const started: string[] = [];
  let fx = 1;
  const loopsPerTrack = () => {
    const l = opts.loopsPerTrack;
    return Math.max(1, Math.round((typeof l === 'function' ? l() : l) ?? 3));
  };

  /** The band, once its chunk is here (null until then: the tuned station waits, silent). */
  let band: RadioBand | null = null;

  const rigFor = (b: RadioBand, g: RadioGenre) => {
    let r = rigs.get(g);
    if (!r) {
      r = b.rig(ctx, out, g);
      r.setFx(fx);
      rigs.set(g, r);
    }
    return r;
  };

  /** Loads the track at `index` (skipping any that cannot play), or clears when none can. */
  const load = (from: number) => {
    current = null;
    comp = null;
    if (!band) return;
    for (let k = 0; k < list.length; k++) {
      const i = (from + k) % list.length;
      const track = list[i]!;
      if (!playable(track, cut)) continue;
      const c = band.compose(track);
      if (!c) continue;
      index = i;
      const indexed = (pc: Composition, genre: RadioGenre | null): Part => {
        const byStep = new Map<number, Composition['notes']>();
        for (const n of pc.notes) byStep.set(n.step, [...(byStep.get(n.step) ?? []), n]);
        return { comp: pc, byStep, genre };
      };
      const parts = c.medley?.length ? c.medley.map((p) => indexed(p.comp, p.genre)) : [indexed(c, null)];
      current = { track, parts };
      for (const p of parts) (p.genre ? rigFor(band, p.genre) : stationRig)?.prepare(p.comp.notes);
      enter(0, next);
      loops = 0;
      started.push(track.ref);
      if (started.length > 64) started.shift();
      return;
    }
  };

  const fade = (level: number, at: number) => {
    for (const r of rigs.values()) r.setLevel(r === rig ? level : 0, at);
  };

  /** The station's own band (null before the band arrives). */
  let stationRig: RadioRig | null = null;

  /**
   * Starts part `p` of the current song at `at`: a medley's part brings its own band in, cutting the
   * last one off at the same moment (a pivot is a hard cut).
   */
  function enter(p: number, at: number) {
    part = p;
    step = 0;
    const pt = current?.parts[p];
    comp = pt?.comp ?? null;
    const want = pt?.genre && band ? rigFor(band, pt.genre) : stationRig;
    if (want !== rig) {
      rig = want;
      if (on) fade(RADIO_LEVEL, Math.max(at, ctx.currentTime));
    }
  }

  /** The band arrived: the station tuned meanwhile starts its playlist from the top. */
  const arrive = (b: RadioBand) => {
    band = b;
    if (!station) return;
    rig = stationRig = rigFor(b, genreOf(station));
    fade(0, ctx.currentTime);
    load(index);
  };
  const given = opts.band;
  if ('then' in given) {
    // A chunk that never arrives (offline before it was cached) leaves the radio silent.
    given.then(arrive, () => undefined);
  } else band = given;

  return {
    select(s) {
      station = s;
      list = s ? playlist(s, opts.seed, cut) : [];
      rig = stationRig = s && band ? rigFor(band, genreOf(s)) : null;
      index = 0;
      on = false;
      fade(0, ctx.currentTime);
      if (s) load(0);
      else current = null;
    },
    pump(now, playing) {
      const want = playing && current !== null;
      if (want !== on) {
        on = want;
        fade(want ? RADIO_LEVEL : 0, now);
        if (want) next = now + 0.05;
      }
      if (!on || !current || !rig || !comp) return;
      // After a suspend (the page was hidden), pick up from now instead of catching up.
      if (next < now - 0.1) next = now + 0.05;
      while (next < now + LOOKAHEAD_S && current && rig) {
        const pt = current.parts[part]!;
        const c = pt.comp;
        for (const n of pt.byStep.get(step) ?? []) rig.play(n, next, c.stepS);
        next += c.stepS;
        step++;
        if (step >= c.steps) {
          if (current.parts.length > 1) {
            // A medley pivots to its next part on the next step; after the last part, the next track.
            if (part + 1 < current.parts.length) {
              enter(part + 1, next);
              continue;
            }
            loops = loopsPerTrack();
          } else {
            step = 0;
            loops++;
          }
          if (loops >= loopsPerTrack()) {
            // A beat of air between songs, then the next track.
            next += c.stepS * c.stepsPerBeat;
            load(index + 1);
          }
        }
      }
    },
    skip() {
      if (station && list.length > 0) load(index + 1);
    },
    setFx(scale) {
      fx = scale;
      for (const r of rigs.values()) r.setFx(fx);
    },
    setCut(refs) {
      cut = new Set(refs);
      if (current && !playable(current.track, cut)) load(index + 1);
    },
    nowPlaying() {
      if (!station || !current) return null;
      const t = current.track;
      return {
        stationId: station.id,
        stationName: station.name,
        trackId: t.id,
        title: t.title,
        ref: t.ref,
        origin: t.origin,
      };
    },
    history: () => started.slice(),
    station: () => station,
    playing: () => on,
  };
}

/** The "cut this" flag for a track, in the settings record's format. */
export function cutFlag(ref: string, raceId: string, tick: number): RadioVetoFlag {
  return { contentRef: ref, raceId, tick: Math.max(0, Math.floor(tick)) };
}
