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

/** The panel's two lines: the station (or "The score", "Radio off") and the song, if any. */
export function radioLines(s: RadioState): { station: string; song: string | null } {
  if (s.tunedTo === 'off') return { station: 'Radio off', song: null };
  if (s.tunedTo === 'score') return { station: 'The score', song: null };
  if (s.tunedTo === 'pending') return { station: 'Tuning in…', song: null };
  const playing = s.nowPlaying && s.nowPlaying.stationId === s.tunedTo ? s.nowPlaying : null;
  return { station: playing?.stationName ?? s.tunedTo, song: playing?.title ?? null };
}

export const RADIO_PANEL_CSS = `
#pause-radio { pointer-events: auto; display: flex; flex-direction: column; gap: 6px; padding: 6px 10px 8px; }
#pause-radio .radio-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
#pause-radio .radio-tag { font: 800 11px ui-monospace, 'Courier New', monospace; letter-spacing: 0.12em;
  text-transform: uppercase; background: #f2ead8; color: #111; padding: 1px 6px; transform: rotate(-1deg); }
#pause-radio .radio-station { font: 800 14px ui-monospace, 'Courier New', monospace; color: #f5c542; }
#pause-radio .radio-song { font: italic 600 13px/1.3 system-ui, sans-serif; color: #f2ead8; overflow-wrap: anywhere; }
#pause-radio .radio-song:empty { display: none; }
#pause-radio .row { justify-content: flex-start; gap: 8px; }
#pause-radio .small { min-height: 40px; padding: 4px 12px; font-size: 14px; }
#pause-radio #radio-cut-yes { background: #e0543a; color: #fff; }
`;

export interface RadioPanel {
  readonly root: HTMLElement;
  /** Shows the panel over this source, or hides it for none. */
  setSource(source: RadioSource | null): void;
  /** Reads the radio into the panel (the pause screen opened, or a moment passed). */
  refresh(): void;
}

export interface RadioPanelOptions {
  /** Tunes the radio to a slider value (ui sets `audio.radio` in the tuning registry). */
  tune(choice: number): void;
  /** A song was cut: the flag goes into the settings record. */
  onCut(flag: VetoFlag): void;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const n: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(n, props);
  n.append(...kids);
  return n;
}

function smallButton(id: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = node('button', { id, className: 'small', type: 'button', textContent: text });
  b.addEventListener('click', onClick);
  return b;
}

export function createRadioPanel(opts: RadioPanelOptions): RadioPanel {
  let source: RadioSource | null = null;
  const station = node('span', { className: 'radio-station', id: 'radio-station' });
  const song = node('div', { className: 'radio-song', id: 'radio-song' });
  const next = smallButton('radio-next', 'Next station', () => {
    if (!source) return;
    const s = source.state();
    opts.tune(nextRadioChoice(s.choice, s.stations.length));
    refresh();
  });
  const skip = smallButton('radio-skip', 'Next song', () => {
    source?.skip();
    refresh();
  });
  // "Cut this" takes two taps, as the recently-seen list does: Cut song, then Cut it.
  const cut = smallButton('radio-cut', 'Cut song', () => {
    confirm.hidden = false;
    actions.hidden = true;
  });
  const actions = node('div', { className: 'row' }, next, skip, cut);
  const yes = smallButton('radio-cut-yes', 'Cut it', () => {
    const flag = source?.cut() ?? null;
    if (flag) opts.onCut(flag);
    closeConfirm();
    refresh(flag ? 'Cut. You won’t hear it again on this device.' : null);
  });
  const keep = smallButton('radio-cut-keep', 'Keep', () => closeConfirm());
  const confirm = node('div', { className: 'row', id: 'radio-cut-confirm', hidden: true }, yes, keep);
  const closeConfirm = () => {
    confirm.hidden = true;
    actions.hidden = false;
  };
  const root = node(
    'div',
    { id: 'pause-radio', className: 'card', hidden: true },
    node(
      'div',
      { className: 'radio-head' },
      node('span', { className: 'radio-tag', textContent: 'Radio' }),
      station,
    ),
    song,
    actions,
    confirm,
  );

  function refresh(note: string | null = null) {
    if (!source) return;
    const s = source.state();
    const lines = radioLines(s);
    station.textContent = lines.station;
    song.textContent = note ?? lines.song ?? '';
    const onStation = !!lines.song;
    skip.hidden = !onStation;
    cut.hidden = !onStation;
    if (!onStation) closeConfirm();
  }

  return {
    root,
    setSource(s) {
      source = s;
      root.hidden = !s;
      closeConfirm();
      refresh();
    },
    refresh: () => refresh(),
  };
}
