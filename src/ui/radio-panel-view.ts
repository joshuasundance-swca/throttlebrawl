// The pause menu's radio panel itself (M4 ui-4; radio-panel.ts holds its rules): a lazy chunk off
// the first-load JavaScript, fetched as the UI starts. The pause screen it sits in only opens mid-race.
import type { VetoFlag } from '../save';
import { heldRadioNote, nextRadioChoice, radioLines, type RadioNote, type RadioSource } from './radio-panel';

export const RADIO_PANEL_CSS = `
#pause-radio { pointer-events: auto; display: flex; flex-direction: column; gap: 6px; padding: 6px 10px 8px; }
#pause-radio .radio-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
#pause-radio .radio-tag { font: 800 11px ui-monospace, 'Courier New', monospace; letter-spacing: 0.12em;
  text-transform: uppercase; background: #f2ead8; color: #111; padding: 1px 6px; transform: rotate(-1deg); }
#pause-radio .radio-station { font: 800 14px ui-monospace, 'Courier New', monospace; color: #f5c542; }
#pause-radio .radio-song { font: italic 600 13px/1.3 system-ui, sans-serif; color: #f2ead8; overflow-wrap: anywhere; }
#pause-radio .radio-song:empty { display: none; }
#pause-radio .radio-song.note { font: 800 15px/1.3 ui-monospace, 'Courier New', monospace; font-style: normal;
  color: #111; background: #f5c542; padding: 3px 8px; align-self: flex-start; }
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
  /** The clock for how long a note stays up (ms); `performance.now` by default. */
  now?: () => number;
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
  let note: RadioNote | null = null;
  const now = opts.now ?? (() => performance.now());
  const station = node('span', { className: 'radio-station', id: 'radio-station' });
  const song = node('div', { className: 'radio-song', id: 'radio-song' });
  const next = smallButton('radio-next', 'Next station', () => {
    if (!source) return;
    const s = source.state();
    opts.tune(nextRadioChoice(s.choice, s.stations.length));
    refresh();
  });
  const skip = smallButton('radio-skip', 'Next song', () => {
    note = null;
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

  function refresh(text: string | null = null) {
    if (!source) return;
    const s = source.state();
    const lines = radioLines(s);
    if (text !== null) note = { text, at: now(), tunedTo: s.tunedTo };
    const held = heldRadioNote(note, now(), s.tunedTo);
    if (held === null) note = null;
    station.textContent = lines.station;
    song.textContent = held ?? lines.song ?? '';
    // A note ("Cut. You won't hear it again") reads at arm's length: big, upright, on its own ground.
    song.classList.toggle('note', held !== null);
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
