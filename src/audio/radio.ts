// Radio stations (M4 radio-1): stations are data (packs/<pack>/stations/<id>.json, the station
// format in docs/content-packs.md), each track a vetoable item. This file turns the registry's
// station entries into playable stations, derives a region's list from each station's `regions`,
// orders a session's playlist from a seed, and plays it: each code-made (`procedural`) track loops
// a few times, then the next one comes on. AI-made `audioAsset` tracks wait for assets-2 and are
// skipped for now.
//
// "Cut this" as data: every track has a content reference, `<packId>:station/<stationId>#<trackId>`
// (docs/content-packs.md, "In-game veto"). The loader already drops tracks whose `status` is
// `vetoed`; a track cut on this device (a `{contentRef, raceId, tick}` flag in the settings record)
// is skipped too, at once, and `cutFlag` builds that flag for the playing track, so the pause
// menu's station panel (ui-4) only has to call it and store the result.
import {
  composeTrack,
  trackSeed,
  seededRandom,
  type Composition,
  type ProceduralSpec,
} from './radio-compose';
import { createRegionalRig, REGIONAL_GENRES, type RegionalGenre } from './radio-rigs';
import { createRadioRig, type RadioGenre, type RadioRig } from './radio-synth';

export interface RadioTrack {
  id: string;
  title: string;
  /** `<packId>:station/<stationId>#<trackId>`. */
  ref: string;
  origin: string | null;
  status: string;
  procedural: ProceduralSpec | null;
  audioAsset: string | null;
}

export interface RadioStation {
  id: string;
  packId: string;
  name: string;
  genre: string;
  /** Region ids (unqualified); empty = a genre station heard everywhere. */
  regions: readonly string[];
  tracks: readonly RadioTrack[];
}

/** One "cut this" flag, the settings record's shape (docs/architecture.md, "In-game veto"). */
export interface RadioVetoFlag {
  contentRef: string;
  raceId: string;
  tick: number;
}

/** A radio track's content reference (docs/content-packs.md, "In-game veto"). */
export function stationTrackRef(packId: string, stationId: string, trackId: string): string {
  return `${packId}:station/${stationId}#${trackId}`;
}

const bare = (id: string) => id.slice(id.indexOf(':') + 1);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * The registry's station table (keyed by qualified id, `base:keys-surf`) as playable stations,
 * sorted by qualified id so the switch order is stable.
 */
export function stationsFromTable(table: Readonly<Record<string, unknown>>): RadioStation[] {
  const out: RadioStation[] = [];
  for (const key of Object.keys(table).sort()) {
    const e = table[key];
    if (!isRecord(e)) continue;
    const colon = key.indexOf(':');
    const packId = colon < 0 ? 'base' : key.slice(0, colon);
    const id = typeof e['id'] === 'string' ? e['id'] : bare(key);
    const tracks: RadioTrack[] = [];
    for (const t of Array.isArray(e['tracks']) ? e['tracks'] : []) {
      if (!isRecord(t) || typeof t['id'] !== 'string') continue;
      const proc = t['procedural'];
      tracks.push({
        id: t['id'],
        title: typeof t['title'] === 'string' ? t['title'] : t['id'],
        ref: stationTrackRef(packId, id, t['id']),
        origin: typeof t['origin'] === 'string' ? t['origin'] : null,
        status: typeof t['status'] === 'string' ? t['status'] : 'live',
        procedural:
          isRecord(proc) && typeof proc['preset'] === 'string'
            ? {
                preset: proc['preset'],
                ...(isRecord(proc['params']) ? { params: proc['params'] } : {}),
              }
            : null,
        audioAsset: typeof t['audioAsset'] === 'string' ? t['audioAsset'] : null,
      });
    }
    out.push({
      id,
      packId,
      name: typeof e['name'] === 'string' ? e['name'] : id,
      genre: typeof e['genre'] === 'string' ? e['genre'] : '',
      regions: Array.isArray(e['regions']) ? e['regions'].filter((r) => typeof r === 'string').map(bare) : [],
      tracks,
    });
  }
  return out;
}

/**
 * A region's stations, derived from each station's `regions` (docs/content-packs.md, "Region":
 * nothing in a region lists its stations): the regional ones first, then every genre station, then
 * (outside the base pack's own regions) the base pack's stations as fallbacks further down the dial,
 * so a new region keeps the music the maintainer likes (2026-10-01: "I actually like the music").
 * `null` (region not known yet) = every station.
 */
export function stationsForRegion(
  stations: readonly RadioStation[],
  regionId: string | null,
): RadioStation[] {
  if (regionId === null) return [...stations];
  const want = bare(regionId);
  const own = stations.filter((s) => s.regions.includes(want));
  const genre = stations.filter((s) => s.regions.length === 0);
  const fallback = own.length
    ? stations.filter((s) => s.packId === 'base' && !own.includes(s) && !genre.includes(s))
    : [];
  return [...own, ...genre, ...fallback];
}

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

/** The composition a track plays (null when the preset is unknown). */
export function composeFor(track: RadioTrack): Composition | null {
  if (!track.procedural) return null;
  const salt = track.procedural.params?.['seed'];
  return composeTrack(track.procedural, trackSeed(track.ref, typeof salt === 'number' ? salt : 0));
}

const isRegional = (g: string): g is RegionalGenre => (REGIONAL_GENRES as readonly string[]).includes(g);
/** The band a station plays on: its `genre`, surf when the genre has no band of its own yet. */
export const genreOf = (s: RadioStation): RadioGenre =>
  s.genre === 'rockabilly' || isRegional(s.genre) ? s.genre : 'surf';

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
  let current: { track: RadioTrack; comp: Composition; byStep: Map<number, Composition['notes']> } | null =
    null;
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

  const rigFor = (g: RadioGenre) => {
    let r = rigs.get(g);
    if (!r) {
      r = isRegional(g) ? createRegionalRig(ctx, out, g) : createRadioRig(ctx, out, g);
      r.setFx(fx);
      rigs.set(g, r);
    }
    return r;
  };

  /** Loads the track at `index` (skipping any that cannot play), or clears when none can. */
  const load = (from: number) => {
    current = null;
    comp = null;
    for (let k = 0; k < list.length; k++) {
      const i = (from + k) % list.length;
      const track = list[i]!;
      if (!playable(track, cut)) continue;
      const c = composeFor(track);
      if (!c) continue;
      index = i;
      comp = c;
      const byStep = new Map<number, Composition['notes']>();
      for (const n of c.notes) byStep.set(n.step, [...(byStep.get(n.step) ?? []), n]);
      current = { track, comp: c, byStep };
      rig?.prepare(c.notes);
      step = 0;
      loops = 0;
      started.push(track.ref);
      if (started.length > 64) started.shift();
      return;
    }
  };

  const fade = (level: number, at: number) => {
    for (const r of rigs.values()) r.setLevel(r === rig ? level : 0, at);
  };

  return {
    select(s) {
      station = s;
      list = s ? playlist(s, opts.seed, cut) : [];
      rig = s ? rigFor(genreOf(s)) : null;
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
      while (next < now + LOOKAHEAD_S && current) {
        const c = current.comp;
        for (const n of current.byStep.get(step) ?? []) rig.play(n, next, c.stepS);
        next += c.stepS;
        step++;
        if (step >= c.steps) {
          step = 0;
          loops++;
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
