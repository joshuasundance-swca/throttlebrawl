// The menu race's options screen (playtest 4, P4-12 and P4-13), drawn from race-options.ts's rows.
// A lazy chunk (the first-load JavaScript budget), fetched as the game boots like the career's
// screens. Phone first: each option is one row the width of a thumb's reach, an arrow at each end
// (44 px targets) and the value between them, which steps forward too; the rows flow into two or
// three columns on a phone held sideways, and the list scrolls inside the screen while Back and
// Race stay put at the bottom. Keyboard: Tab to a row, the left and right arrows step it, Enter
// presses; Escape is Back (ui's own key handler).
import type { RaceOptionId, RaceOptionRow } from './race-options';

export const RACE_OPTIONS_CSS = `
#ui #race-options { justify-content: flex-start; gap: 6px; padding-top: max(6px, env(safe-area-inset-top));
  padding-bottom: max(6px, env(safe-area-inset-bottom)); }
#ui #race-options .ro-head { display: flex; align-items: baseline; justify-content: center; gap: 4px 12px; flex-wrap: wrap;
  flex-shrink: 0; }
#ui #race-options .ro-title { font: 900 18px/1.2 ui-monospace, 'Courier New', monospace; letter-spacing: 0.06em;
  text-transform: uppercase; background: #111; color: #f2ead8; padding: 1px 10px; transform: rotate(-1deg);
  box-shadow: 3px 3px 0 #e0543a; }
#ui #race-options .ro-where { font: italic 500 13px/1.3 ui-monospace, 'Courier New', monospace; color: #f2ead8;
  text-shadow: 1px 1px 0 #111; }
#ui #race-options .ro-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  width: min(820px, 100%); display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 4px 10px; align-content: start; padding: 2px; box-sizing: border-box; }
#ui #race-options .ro-row { display: flex; align-items: stretch; gap: 4px; min-height: 44px; background: #000a;
  border: 1px dashed #fff6; }
#ui #race-options .ro-step { flex: 0 0 44px; min-height: 44px; padding: 0; cursor: pointer;
  font: 900 20px ui-monospace, monospace; color: #111; background: #f2ead8; border: 2px solid #111; }
#ui #race-options .ro-step:active, #ui #race-options .ro-value:active { transform: translate(1px, 1px); }
#ui #race-options .ro-value { flex: 1 1 auto; min-width: 0; min-height: 44px; padding: 2px 6px; cursor: pointer;
  display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 1px; text-align: left;
  color: #f2ead8; background: transparent; border: 0; font: 800 15px/1.15 ui-monospace, monospace; }
#ui #race-options .ro-label { font: 700 10px/1.1 ui-monospace, monospace; letter-spacing: 0.1em; text-transform: uppercase;
  color: #f5c542; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ui #race-options .ro-choice { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ui #race-options .ro-foot { display: flex; gap: 12px; justify-content: center; align-items: center; flex-shrink: 0; }
@media (max-height: 360px) {
  #ui #race-options { gap: 4px; }
  #ui #race-options .ro-title { font-size: 15px; }
  #ui #race-options .big { font-size: 20px; min-height: 44px; padding: 2px 28px; }
}
`;

export type MakeButton = (
  id: string,
  cls: 'big' | 'small',
  text: string,
  onClick: () => void,
) => HTMLButtonElement;

export interface RaceOptionsScreen {
  readonly root: HTMLElement;
  /** Draws the rows and the line that says where the race runs. Focus stays on the row it was on. */
  draw(rows: readonly RaceOptionRow[], where: string): void;
}

export interface RaceOptionsCallbacks {
  onStep(id: RaceOptionId, dir: 1 | -1): void;
  onBack(): void;
  onRace(): void;
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

export function createRaceOptionsScreen(make: MakeButton, cb: RaceOptionsCallbacks): RaceOptionsScreen {
  const where = node('div', { className: 'ro-where' });
  const list = node('div', { className: 'ro-list', id: 'race-options-list' });
  const root = node(
    'div',
    { id: 'race-options', className: 'screen', hidden: true },
    node(
      'div',
      { className: 'ro-head' },
      node('div', { className: 'ro-title', textContent: 'Race options' }),
      where,
    ),
    list,
    node(
      'div',
      { className: 'ro-foot' },
      make('race-options-back', 'small', 'Back', () => cb.onBack()),
      make('race-options-race', 'big', 'Race', () => cb.onRace()),
    ),
  );

  /** One row's elements, kept across draws so focus and the scroll position stay put. */
  const rows = new Map<
    RaceOptionId,
    { row: HTMLElement; label: HTMLElement; choice: HTMLElement; value: HTMLButtonElement }
  >();
  const rowFor = (id: RaceOptionId) => {
    const have = rows.get(id);
    if (have) return have;
    const step = (dir: 1 | -1, text: string, name: string) => {
      const b = node('button', {
        type: 'button',
        className: 'ro-step',
        id: `race-option-${id}-${name}`,
        textContent: text,
      });
      b.addEventListener('click', () => cb.onStep(id, dir));
      return b;
    };
    const label = node('span', { className: 'ro-label' });
    const choice = node('span', { className: 'ro-choice' });
    const value = node(
      'button',
      { type: 'button', className: 'ro-value', id: `race-option-${id}-value` },
      label,
      choice,
    );
    value.addEventListener('click', () => cb.onStep(id, 1));
    const row = node(
      'div',
      { className: 'ro-row', id: `race-option-${id}` },
      step(-1, '‹', 'prev'),
      value,
      step(1, '›', 'next'),
    );
    row.dataset['option'] = id;
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      cb.onStep(id, e.key === 'ArrowLeft' ? -1 : 1);
    });
    const made = { row, label, choice, value };
    rows.set(id, made);
    return made;
  };

  return {
    root,
    draw(drawn, at) {
      where.textContent = at;
      const shown: HTMLElement[] = [];
      for (const r of drawn) {
        const el = rowFor(r.id);
        const c = r.choices[r.index];
        const text = c?.label ?? '';
        el.label.textContent = c?.note ? `${r.label} · ${c.note}` : r.label;
        el.choice.textContent = text;
        el.value.setAttribute(
          'aria-label',
          `${r.label}: ${text}${c?.note ? `, ${c.note}` : ''}. Tap for the next.`,
        );
        const v = c?.value;
        el.row.dataset['value'] =
          typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
        shown.push(el.row);
      }
      // Rows a view no longer offers leave; the others keep their place and their focus.
      for (const [, el] of rows) if (!shown.includes(el.row)) el.row.remove();
      shown.forEach((row, i) => {
        if (list.children[i] !== row) list.insertBefore(row, list.children[i] ?? null);
      });
    },
  };
}
