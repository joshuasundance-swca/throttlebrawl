// Radio stations as data (M4 radio-1; radio.ts plays them): the registry's station entries as
// playable stations, and a region's dial. app/ reads these at boot, so they ride in the first-load
// JavaScript apart from the player, which loads with the lazy audio engine (system.ts).
import { pirateSpotFrom, type PirateSpot } from './pirate';
import type { ProceduralSpec } from './radio-compose';

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
  /**
   * A hidden pirate station (run W-Q): never on the dial, heard only near this spot on the route
   * (pirate.ts). null for every ordinary station.
   */
  pirate?: PirateSpot | null;
  /**
   * A rider's own station (run W-U, Pivot FM): never on the dial; it takes the radio over while that
   * rider (a qualified rider id) rides near you (rider-station.ts). null for every other station.
   */
  rider?: string | null;
  /**
   * The bark line a rider's station says after its dead air (`<set>#<line>` in the file; here the
   * content reference `<pack>:bark-set/<set>#<line>`), or null.
   */
  deadAirLine?: string | null;
}

/** A station file's `deadAirLine` (`<set>#<line>`, or `<pack>:<set>#<line>`) as a bark content reference. */
function barkRefFrom(packId: string, v: unknown): string | null {
  if (typeof v !== 'string' || !/^([a-z0-9-]+:)?[a-z0-9-]+#[a-z0-9-]+$/.test(v)) return null;
  const colon = v.indexOf(':');
  return colon < 0 ? `${packId}:bark-set/${v}` : `${v.slice(0, colon)}:bark-set/${v.slice(colon + 1)}`;
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
      pirate: pirateSpotFrom(e['pirate']),
      rider:
        typeof e['rider'] === 'string' && e['rider'].length > 0
          ? e['rider'].includes(':')
            ? e['rider']
            : `${packId}:${e['rider']}`
          : null,
      deadAirLine: barkRefFrom(packId, e['deadAirLine']),
    });
  }
  return out;
}

/**
 * A region's stations, derived from each station's `regions` (docs/content-packs.md, "Region":
 * nothing in a region lists its stations): the regional ones first, then every genre station.
 * A region with two or more stations of its own keeps its dial to itself (playtest 2, 2026-10-02:
 * "There should be different stations and music in different regions"), so its race starts on its
 * own sound and a station saved in another region is not offered there. A region with just one
 * gets the base pack's stations further down the dial, so it still has a choice (2026-10-01: "I
 * actually like the music"). `null` (region not known yet) = every station.
 */
export function stationsForRegion(all: readonly RadioStation[], regionId: string | null): RadioStation[] {
  // A pirate station is never on the dial (pirateStationFor finds it), nor a rider's (riderStationsFor).
  const stations = all.filter((s) => !s.pirate && !s.rider);
  if (regionId === null) return [...stations];
  const want = bare(regionId);
  const own = stations.filter((s) => s.regions.includes(want));
  const genre = stations.filter((s) => s.regions.length === 0);
  const fallback =
    own.length === 1
      ? stations.filter((s) => s.packId === 'base' && !own.includes(s) && !genre.includes(s))
      : [];
  return [...own, ...genre, ...fallback];
}

/** A region's hidden pirate station, or null (a region id, qualified or not). */
export function pirateStationFor(
  stations: readonly RadioStation[],
  regionId: string | null,
): RadioStation | null {
  if (regionId === null) return null;
  const want = bare(regionId);
  return stations.find((s) => s.pirate && s.regions.includes(want)) ?? null;
}

/** A region's riders' own stations (Pivot FM): every station with a `rider`, in that region. */
export function riderStationsFor(stations: readonly RadioStation[], regionId: string | null): RadioStation[] {
  if (regionId === null) return [];
  const want = bare(regionId);
  return stations.filter((s) => !!s.rider && s.regions.includes(want));
}
