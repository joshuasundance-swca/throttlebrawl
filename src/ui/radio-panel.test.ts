import { describe, expect, it } from 'vitest';
import {
  heldRadioNote,
  nextRadioChoice,
  playingStation,
  RADIO_NOTE_HOLD_MS,
  radioChoiceFor,
  radioChoiceOf,
  radioLines,
  radioSettingOf,
  RADIO_FIRST_STATION,
  RADIO_OFF,
  RADIO_SCORE,
  type RadioState,
} from './radio-panel';

// The pause menu's radio panel (radio-1's follow-up): it cycles the `audio.radio` slider the way
// the R key does, and names what plays.

const state = (over: Partial<RadioState> = {}): RadioState => ({
  choice: RADIO_SCORE,
  tunedTo: 'score',
  stations: ['keys-surf', 'keys-rockabilly'],
  nowPlaying: null,
  ...over,
});

describe('the radio panel', () => {
  it('cycles as the R key does: the score, each station, off, the score again', () => {
    const seen = [RADIO_SCORE];
    for (let i = 0; i < 4; i++) seen.push(nextRadioChoice(seen[seen.length - 1] ?? 0, 2));
    expect(seen).toEqual([RADIO_SCORE, 2, 3, RADIO_OFF, RADIO_SCORE]);
    expect(nextRadioChoice(RADIO_SCORE, 1)).toBe(2);
    expect(nextRadioChoice(2, 1)).toBe(RADIO_OFF);
    // Before the stations load it counts two, as the audio system does.
    expect(nextRadioChoice(3, 0)).toBe(RADIO_OFF);
    expect(nextRadioChoice(2, 0)).toBe(3);
  });

  it('tunes the saved station when the region offers it, else the kind (run W-P)', () => {
    const keys = ['keys-rockabilly', 'keys-surf'];
    expect(radioChoiceFor('station', 'keys-surf', keys)).toBe(RADIO_FIRST_STATION + 1);
    expect(radioChoiceFor('station', 'keys-rockabilly', keys)).toBe(RADIO_FIRST_STATION);
    // Another region's station, none saved, or none loaded yet: the first station.
    expect(radioChoiceFor('station', 'pnw-drizzle', keys)).toBe(RADIO_FIRST_STATION);
    expect(radioChoiceFor('station', null, keys)).toBe(RADIO_FIRST_STATION);
    expect(radioChoiceFor('station', 'keys-surf', [])).toBe(RADIO_FIRST_STATION);
    // The score and off ignore the saved station.
    expect(radioChoiceFor('score', 'keys-surf', keys)).toBe(RADIO_SCORE);
    expect(radioChoiceFor('off', 'keys-surf', keys)).toBe(RADIO_OFF);
  });

  it('names the station that plays, and none on the score, off or while loading', () => {
    const stations = ['keys-rockabilly', 'keys-surf'];
    expect(playingStation(state({ choice: 3, tunedTo: 'keys-surf', stations }))).toBe('keys-surf');
    expect(playingStation(state({ choice: 2, tunedTo: 'pending', stations: [] }))).toBeNull();
    expect(playingStation(state({ choice: RADIO_SCORE, tunedTo: 'score', stations }))).toBeNull();
    expect(playingStation(state({ choice: RADIO_OFF, tunedTo: 'off', stations }))).toBeNull();
  });

  it('maps the slider to the saved choice and back (a station starts on the first)', () => {
    expect([0, 1, 2, 3, 6].map(radioSettingOf)).toEqual(['off', 'score', 'station', 'station', 'station']);
    expect(radioChoiceOf('off')).toBe(RADIO_OFF);
    expect(radioChoiceOf('score')).toBe(RADIO_SCORE);
    expect(radioChoiceOf('station')).toBe(RADIO_FIRST_STATION);
  });

  it('names the station and the song, or the score, off and a station still loading', () => {
    expect(radioLines(state())).toEqual({ station: 'The score', song: null });
    expect(radioLines(state({ choice: 0, tunedTo: 'off' }))).toEqual({ station: 'Radio off', song: null });
    expect(radioLines(state({ choice: 2, tunedTo: 'pending' }))).toEqual({
      station: 'Tuning in…',
      song: null,
    });
    const playing = {
      stationId: 'keys-surf',
      stationName: 'Low Tide 91.7',
      title: 'Causeway Twang',
      ref: 'base:station/keys-surf#causeway-twang',
    };
    expect(radioLines(state({ choice: 2, tunedTo: 'keys-surf', nowPlaying: playing }))).toEqual({
      station: 'Low Tide 91.7',
      song: 'Causeway Twang',
    });
    // Just switched: the old station's song is not this station's.
    expect(radioLines(state({ choice: 3, tunedTo: 'keys-rockabilly', nowPlaying: playing }))).toEqual({
      station: 'keys-rockabilly',
      song: null,
    });
  });

  it('holds the "Cut." note through the pause screen 500 ms refresh, then lets the song back', () => {
    const note = { text: 'Cut.', at: 1000, tunedTo: 'keys-surf' };
    expect(RADIO_NOTE_HOLD_MS).toBeGreaterThanOrEqual(2000);
    // Several refreshes later it is still up.
    for (const t of [1000, 1500, 2000, 2500]) expect(heldRadioNote(note, t, 'keys-surf')).toBe('Cut.');
    expect(heldRadioNote(note, 1000 + RADIO_NOTE_HOLD_MS, 'keys-surf')).toBeNull();
    // Another station drops it at once; no note shows nothing.
    expect(heldRadioNote(note, 1100, 'keys-rockabilly')).toBeNull();
    expect(heldRadioNote(null, 1100, 'keys-surf')).toBeNull();
  });
});
