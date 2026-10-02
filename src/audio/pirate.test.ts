// The hidden pirate station (run W-Q audio): the spot's maths, the station files, the dial, and the
// mixer taking the radio over near the spot and handing it back.
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { fakeContextFactory } from './fake-context';
import { createAudio } from './index';
import {
  inPirateSpot,
  pirateCentreM,
  pirateSpotFrom,
  PIRATE_EXIT_SCALE,
  PIRATE_MIN_RADIUS_M,
} from './pirate';
import { pirateStationFor, stationsForRegion, stationsFromTable, type RadioStation } from './radio';
import { RADIO_BAND } from './radio-band';

const spot = { atFraction: 0.5, radiusM: 300 };

describe('pirateSpotFrom', () => {
  it('reads a good spot and clamps a tiny radius', () => {
    expect(pirateSpotFrom({ atFraction: 0.4, radiusM: 250 })).toEqual({ atFraction: 0.4, radiusM: 250 });
    expect(pirateSpotFrom({ atFraction: 0.4, radiusM: 5 })?.radiusM).toBe(PIRATE_MIN_RADIUS_M);
  });
  it('is null for anything malformed', () => {
    for (const bad of [
      null,
      undefined,
      3,
      'x',
      {},
      { atFraction: 2, radiusM: 100 },
      { atFraction: -1, radiusM: 100 },
      { atFraction: 0.5 },
      { atFraction: 0.5, radiusM: 0 },
      { atFraction: Number.NaN, radiusM: 100 },
      { atFraction: 0.5, radiusM: '100' },
    ]) {
      expect(pirateSpotFrom(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('inPirateSpot', () => {
  it('is on inside the radius around the spot and off outside it, on any route length', () => {
    for (const len of [2000, 5000, 12000]) {
      const c = pirateCentreM(spot, len);
      expect(c).toBe(len / 2);
      expect(inPirateSpot(spot, c, len, false)).toBe(true);
      expect(inPirateSpot(spot, c + 299, len, false)).toBe(true);
      expect(inPirateSpot(spot, c - 299, len, false)).toBe(true);
      expect(inPirateSpot(spot, c + 301, len, false)).toBe(false);
      expect(inPirateSpot(spot, 0, len, false)).toBe(false);
      expect(inPirateSpot(spot, len, len, false)).toBe(false);
    }
  });

  it('stays on a little longer on the way out (no flicker at the edge)', () => {
    const len = 4000;
    const c = pirateCentreM(spot, len);
    const edge = c + spot.radiusM * 1.1;
    expect(inPirateSpot(spot, edge, len, false)).toBe(false);
    expect(inPirateSpot(spot, edge, len, true)).toBe(true);
    expect(inPirateSpot(spot, c + spot.radiusM * (PIRATE_EXIT_SCALE + 0.01), len, true)).toBe(false);
  });

  it('keeps the spot off the very start and finish, and is off for no route or no progress', () => {
    expect(pirateCentreM({ atFraction: 0, radiusM: 100 }, 1000)).toBe(50);
    expect(pirateCentreM({ atFraction: 1, radiusM: 100 }, 1000)).toBe(950);
    expect(inPirateSpot(spot, 100, 0, false)).toBe(false);
    expect(inPirateSpot(spot, Number.NaN, 1000, false)).toBe(false);
  });
});

const FILES = import.meta.glob('/packs/*/stations/*.json', { eager: true, import: 'default' });
const read = (file: string): unknown => {
  const f = FILES[`/packs/${file}`];
  if (f === undefined) throw new Error(`no station file ${file}`);
  return f;
};
const PIRATES = [
  ['base/stations/keys-bootleg.json', 'base', 'florida-keys', 'dub-band'],
  ['region-pnw/stations/pnw-static-cedar.json', 'region-pnw', 'pacific-northwest', 'ambient-band'],
  ['region-sf/stations/sf-zero-day.json', 'region-sf', 'san-francisco', 'chip-band'],
] as const;

describe('the pirate station files', () => {
  it.each(PIRATES)(
    '%s is a hidden station in its region with its own band and a spot',
    (file, pack, region, preset) => {
      const table = { [`${pack}:${file.split('/').pop()!.replace('.json', '')}`]: read(file) };
      const [s] = stationsFromTable(table);
      expect(s!.regions).toEqual([region]);
      expect(s!.pirate).not.toBeNull();
      expect(s!.pirate!.radiusM).toBeGreaterThanOrEqual(PIRATE_MIN_RADIUS_M);
      expect(s!.tracks.length).toBeGreaterThanOrEqual(5);
      expect(s!.tracks.every((t) => t.procedural?.preset === preset && t.status === 'live')).toBe(true);
      expect(s!.tracks.every((t) => t.origin === 'agent')).toBe(true);
    },
  );

  it('each region has a different spot (nobody finds all three in one place along a route)', () => {
    const ats = PIRATES.map(([f]) => (read(f) as { pirate: { atFraction: number } }).pirate.atFraction);
    expect(new Set(ats).size).toBe(3);
  });

  // The career's map lists each pirate as a secret (#339). Its ref is the station's id and its
  // atFraction is the station's spot, so finding the secret and hearing the pirate are one place.
  const CAREERS = import.meta.glob('/packs/*/careers/*.json', { eager: true, import: 'default' });
  it.each(PIRATES)(
    "%s is the career's station secret in its region, at the same spot",
    (file, _pack, region) => {
      const id = file.split('/').pop()!.replace('.json', '');
      const at = (read(file) as { pirate: { atFraction: number } }).pirate.atFraction;
      const careers = Object.values(CAREERS) as {
        region: string;
        secrets: { kind: string; ref: string; atFraction?: number | null }[];
      }[];
      const secrets = careers.filter((c) => c.region === region).flatMap((c) => c.secrets);
      const stations = secrets.filter((s) => s.kind === 'station');
      expect(stations.map((s) => s.ref)).toEqual([id]);
      expect(stations[0]!.atFraction).toBe(at);
    },
  );
});

describe('the dial', () => {
  const station = (id: string, regions: string[], pirate: typeof spot | null = null): RadioStation => ({
    id,
    packId: 'p',
    name: id,
    genre: 'surf',
    regions,
    tracks: [],
    pirate,
  });
  const all = [
    station('a', ['r']),
    station('b', ['r']),
    station('hidden', ['r'], spot),
    station('other', ['x'], spot),
  ];

  it('never lists a pirate, in its own region or any other', () => {
    expect(stationsForRegion(all, 'r').map((s) => s.id)).toEqual(['a', 'b']);
    expect(stationsForRegion(all, null).map((s) => s.id)).toEqual(['a', 'b']);
    expect(stationsForRegion(all, 'x').map((s) => s.id)).toEqual([]);
  });

  it("finds a region's own pirate, and no other region's", () => {
    expect(pirateStationFor(all, 'r')?.id).toBe('hidden');
    expect(pirateStationFor(all, 'p:r')?.id).toBe('hidden');
    expect(pirateStationFor(all, 'x')?.id).toBe('other');
    expect(pirateStationFor(all, 'nope')).toBeNull();
    expect(pirateStationFor(all, null)).toBeNull();
    expect(pirateStationFor([station('a', ['r'])], 'r')).toBeNull();
  });
});

// --- The mixer ---------------------------------------------------------------------------------

function me(over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id: 0,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 30,
    lean: 0,
    contentId: 'player',
    name: 'x',
    faction: 'rider',
    slot: 0,
    throttle: 0.5,
    rpm: 5000,
    gear: 2,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: 0,
    distanceToFinish: 4000,
    place: 1,
    finished: false,
    ...over,
  };
}
const at = (progress: number): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities: [me({ progress })],
  race: { over: false, routeLength: 4000, finishOrder: [] },
});

describe('the mixer tunes the pirate in near the spot and out again', () => {
  const mk = (id: string, genre: string, pirate: typeof spot | null) => ({
    id,
    packId: 'test',
    name: id,
    genre,
    regions: ['florida-keys'],
    pirate,
    tracks: [
      {
        id: 't',
        title: 'T',
        ref: `test:station/${id}#t`,
        origin: 'agent',
        status: 'live',
        procedural: { preset: genre === 'dub' ? 'dub-band' : 'surf-trio' },
        audioAsset: null,
      },
    ],
  });
  async function started(radio: number) {
    const { ctx, create } = fakeContextFactory();
    const audio = createAudio({
      createContext: create,
      radioKeys: null,
      barkEvents: null,
      radioSeed: 5,
      radioBand: RADIO_BAND,
    });
    audio.setStations([mk('plain', 'surf', null), mk('pirate', 'dub', { atFraction: 0.5, radiusM: 300 })]);
    audio.setRegion('test:florida-keys');
    await audio.resume();
    audio.setParam('audio.radio', radio);
    return { ctx, audio };
  }
  const tuned = (a: Awaited<ReturnType<typeof started>>) => a.audio.inspect().radio;
  const frame = (a: Awaited<ReturnType<typeof started>>, progress: number, t: number) => {
    a.ctx.currentTime = t;
    a.audio.frame(at(progress), 0);
  };

  it('is not on the dial', async () => {
    const a = await started(2);
    expect(tuned(a).stations).toEqual(['plain']);
    expect(tuned(a).tunedTo).toBe('plain');
  });

  it('takes the radio over near the spot and gives it back when you ride on', async () => {
    const a = await started(2);
    frame(a, 500, 1);
    expect(tuned(a).tunedTo).toBe('plain');
    frame(a, 1800, 2);
    expect(tuned(a).tunedTo).toBe('pirate');
    expect(tuned(a).nowPlaying?.stationId).toBe('pirate');
    expect(a.audio.inspect().radio.pirate).toEqual({ on: true, station: 'pirate' });
    frame(a, 2050, 3);
    expect(tuned(a).tunedTo).toBe('pirate');
    frame(a, 2500, 4);
    expect(tuned(a).tunedTo).toBe('plain');
    expect(tuned(a).nowPlaying?.stationId).toBe('plain');
    expect(a.audio.inspect().radio.pirate.on).toBe(false);
  });

  it('plays the tuning static going in and coming out', async () => {
    const a = await started(2);
    frame(a, 500, 1);
    frame(a, 2000, 2);
    frame(a, 3000, 3);
    expect(a.audio.inspect().lastCues.filter((c) => c.cue === 'tune')).toHaveLength(2);
  });

  it('takes over the score too, but never a radio that is off', async () => {
    const score = await started(1);
    frame(score, 2000, 1);
    expect(tuned(score).tunedTo).toBe('pirate');
    const off = await started(0);
    frame(off, 2000, 1);
    expect(tuned(off).tunedTo).toBe('off');
    expect(off.audio.inspect().lastCues.filter((c) => c.cue === 'tune')).toHaveLength(0);
  });

  it('turning the radio off at the spot silences it, and back on resumes the pirate', async () => {
    const a = await started(2);
    frame(a, 2000, 1);
    a.audio.setParam('audio.radio', 0);
    expect(tuned(a).tunedTo).toBe('off');
    a.audio.setParam('audio.radio', 2);
    expect(tuned(a).tunedTo).toBe('pirate');
  });

  it('leaving the race drops it', async () => {
    const a = await started(2);
    frame(a, 2000, 1);
    a.audio.frame(null, 0);
    expect(tuned(a).tunedTo).toBe('plain');
    expect(a.audio.inspect().radio.pirate.on).toBe(false);
  });
});
