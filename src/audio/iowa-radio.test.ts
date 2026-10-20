import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../content';
import { FakeAudioContext } from './fake-context';
import { composeFor, RADIO_BAND } from './radio-band';
import { RADIO_PRESETS, trackSeed } from './radio-compose';
import { FOLK_FORMS } from './radio-compose-regional';
import { GARAGE_FORMS } from './radio-compose-extra';
import {
  createRadioPlayer,
  genreOf,
  playlist,
  stationsForRegion,
  stationsFromTable,
  stationTrackRef,
} from './radio';

const all = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const auditionIds = new Set(['iowa-bluffline', 'iowa-third-shift']);
const iowa = stationsForRegion(stationsFromTable(all.stations), 'region-clinton:clinton-iowa').filter(
  (station) => station.packId === 'region-clinton' && auditionIds.has(station.id),
);

describe('Iowa radio audition', () => {
  it('loads two ordinary regional choices with playable seeded alternatives in their existing bands', () => {
    expect(iowa.map((station) => station.id).sort()).toEqual([...auditionIds].sort());
    expect(iowa.map((station) => station.genre).sort()).toEqual(['folk', 'garage']);
    const presetFor = { folk: 'folk-band', garage: 'garage-band' } as const;
    const formsFor = { folk: FOLK_FORMS, garage: GARAGE_FORMS };
    for (const station of iowa) {
      const genre = station.genre as keyof typeof presetFor;
      expect(station.regions).toEqual(['clinton-iowa']);
      expect(station.pirate).toBeNull();
      expect(station.rider).toBeNull();
      expect(genreOf(station)).toBe(genre);
      expect(station.tracks.length).toBeGreaterThanOrEqual(3);
      const songs = new Set<string>();
      const seeds = new Set<number>();
      const forms = new Set<string>();
      for (const track of station.tracks) {
        expect(track.ref).toBe(stationTrackRef(station.packId, station.id, track.id));
        expect(track.origin).toBe('agent');
        expect(track.status).toBe('live');
        expect(track.title.length).toBeGreaterThan(0);
        expect(track.audioAsset).toBeNull();
        expect(RADIO_PRESETS).toContain(track.procedural?.preset);
        expect(track.procedural?.preset).toBe(presetFor[genre]);
        const params = track.procedural?.params;
        expect(Object.keys(formsFor[genre])).toContain(params?.['progression']);
        const song = composeFor(track);
        expect(song).not.toBeNull();
        expect(song!.preset).toBe(presetFor[genre]);
        expect(song!.seed).toBe(trackSeed(track.ref));
        expect(song!.form).toBe(params?.['progression']);
        expect(song!.bpm).toBe(params?.['bpm']);
        expect(song!.notes.length).toBeGreaterThan(0);
        expect(
          song!.notes.every(
            (note) =>
              Number.isFinite(note.step) &&
              Number.isFinite(note.midi) &&
              Number.isFinite(note.len) &&
              Number.isFinite(note.vel),
          ),
        ).toBe(true);
        songs.add(JSON.stringify(song!.notes));
        seeds.add(song!.seed);
        forms.add(song!.form);
      }
      expect(songs.size).toBe(station.tracks.length);
      expect(seeds.size).toBe(station.tracks.length);
      expect(forms.size).toBeGreaterThan(1);
      const cut = new Set([station.tracks[0]!.ref]);
      expect(playlist(station, 7, cut).length).toBe(station.tracks.length - 1);
    }
  });

  it('switches between Iowa rigs and continues after a playing track is cut', () => {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const rigGenres: string[] = [];
    const player = createRadioPlayer(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, {
      seed: 7,
      band: {
        compose: (track) => RADIO_BAND.compose(track),
        rig(context, destination, genre) {
          rigGenres.push(genre);
          return RADIO_BAND.rig(context, destination, genre);
        },
      },
    });
    for (const station of iowa) {
      player.select(station);
      player.pump(ctx.currentTime, true);
      const first = player.nowPlaying();
      expect(first?.stationId).toBe(station.id);
      expect(station.tracks.some((track) => track.ref === first?.ref)).toBe(true);
      player.setCut([first!.ref]);
      expect(player.nowPlaying()?.ref).not.toBe(first!.ref);
      expect(player.nowPlaying()?.stationId).toBe(station.id);
      player.skip();
      expect(station.tracks.some((track) => track.ref === player.nowPlaying()?.ref)).toBe(true);
    }
    expect(rigGenres.sort()).toEqual(iowa.map((station) => station.genre).sort());
  });
});
