// The pause menu's radio panel (M4 ui-4, radio-1's follow-up; docs/architecture.md, "Audio"): what
// is playing, the next station, the next song, and "cut this" on the song, in the zine style. ui
// never imports audio/: app/ hands in a `RadioSource` over the audio system, and ui tunes through
// the `audio.radio` tuning slider (0 off, 1 the score, 2 and up the stations in switch order), so
// the slider, the R key's choice and this panel stay in step.
import type { VetoFlag } from '../save';

/** What the radio is doing: the shape of `audio.inspect().radio`, so app/ can hand it straight in. */
export interface RadioState {
  /** The `audio.radio` choice now: 0 off, 1 the score, 2 and up the stations below. */
  choice: number;
  /** 'off', 'score', 'pending' (stations loading), or the station's id. */
  tunedTo: string;
  /** The stations to switch through, in order. */
  stations: readonly string[];
  nowPlaying: { stationId: string; stationName: string; title: string; ref: string } | null;
}

/** app/'s handle on the radio (from the audio system). */
export interface RadioSource {
  state(): RadioState;
  /** The next song on the station playing now (`audio.skipTrack`). */
  skip(): void;
  /**
   * "Cut this" on the song playing (`audio.cutPlayingTrack(raceId, tick)`): it stops now, and the
   * flag comes back for the settings record; null when no station song is playing.
   */
  cut(): VetoFlag | null;
  /**
   * Optional: told each choice ui tunes to. app/ need not pass it, since the `audio.radio` slider
   * already reaches the audio system through the tuning registry; the browser specs' stand-in
   * source uses it to follow along.
   */
  tune?(choice: number): void;
}

export const RADIO_OFF = 0;
export const RADIO_SCORE = 1;
export const RADIO_FIRST_STATION = 2;

/**
 * The choice after this one, as the R key cycles: the score, each station, off, the score again.
 * Before the stations have loaded (none listed yet) it counts two, as the audio system does.
 */
export function nextRadioChoice(choice: number, stations: number): number {
  const c = Math.round(choice);
  const n = stations > 0 ? stations : 2;
  if (c <= RADIO_OFF) return RADIO_SCORE;
  return c + 1 >= n + RADIO_FIRST_STATION ? RADIO_OFF : c + 1;
}

/** The settings record's radio choice for a slider value. */
export function radioSettingOf(choice: number): 'off' | 'score' | 'station' {
  const c = Math.round(choice);
  return c <= RADIO_OFF ? 'off' : c === RADIO_SCORE ? 'score' : 'station';
}

/** The slider value a settings choice starts on: a station means the first one. */
export function radioChoiceOf(setting: 'off' | 'score' | 'station'): number {
  return setting === 'off' ? RADIO_OFF : setting === 'score' ? RADIO_SCORE : RADIO_FIRST_STATION;
}

/**
 * The slider value a saved choice tunes (run W-P, W-O's mustFix): the saved station when the race's
 * region offers it, else the kind's start (a station means the first one).
 */
export function radioChoiceFor(
  setting: 'off' | 'score' | 'station',
  station: string | null,
  stations: readonly string[],
): number {
  const i = setting === 'station' && station !== null ? stations.indexOf(station) : -1;
  return i >= 0 ? RADIO_FIRST_STATION + i : radioChoiceOf(setting);
}

/** The station a radio state plays, or null on the score, off, or while the stations load. */
export function playingStation(s: RadioState): string | null {
  return radioSettingOf(s.choice) === 'station' && s.stations.includes(s.tunedTo) ? s.tunedTo : null;
}

/** The panel's two lines: the station (or "The score", "Radio off") and the song, if any. */
export function radioLines(s: RadioState): { station: string; song: string | null } {
  if (s.tunedTo === 'off') return { station: 'Radio off', song: null };
  if (s.tunedTo === 'score') return { station: 'The score', song: null };
  if (s.tunedTo === 'pending') return { station: 'Tuning in…', song: null };
  const playing = s.nowPlaying && s.nowPlaying.stationId === s.tunedTo ? s.nowPlaying : null;
  return { station: playing?.stationName ?? s.tunedTo, song: playing?.title ?? null };
}

/**
 * How long a note ("Cut. You won't hear it again") stays up before the panel names the song again.
 * The pause screen refreshes the panel every 500 ms, which used to overwrite the note at once.
 * [default]
 */
export const RADIO_NOTE_HOLD_MS = 3000;

/** A note the panel shows in place of the song: its text, when it went up, and the station then. */
export interface RadioNote {
  text: string;
  at: number;
  tunedTo: string;
}

/** The note still to show at `now` on `tunedTo`: null once it has run its time or the station changed. */
export function heldRadioNote(note: RadioNote | null, now: number, tunedTo: string): string | null {
  if (!note || note.tunedTo !== tunedTo) return null;
  return now - note.at < RADIO_NOTE_HOLD_MS ? note.text : null;
}
