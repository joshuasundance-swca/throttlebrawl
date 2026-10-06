// The settings screen's DOM (docs/milestones/M2.md, ui-2), drawn from the table in settings.ts.
// Tabs keep each page inside a phone-landscape screen without scrolling: Sound (the M1 volumes and
// mute), Race (everything that feeds SimConfig), Controls (the mirror and the input options) and
// Display. Opened from the pause menu, the Race rows say "applies next race". Big targets and
// 16px type, so it reads at arm's length.
import type { Settings } from '../save';
import {
  settingDef,
  settingValue,
  SETTINGS,
  SETTINGS_TABS,
  VOLUME_BUSES,
  type SettingId,
  type SettingsChange,
  type SettingsTab,
} from './settings';

export const SETTINGS_CSS = `
#settings { justify-content: flex-start; gap: 8px; padding-top: 8px; }
#settings .settings-bar { display: flex; gap: 6px; align-items: center; justify-content: center; flex-wrap: wrap; }
#settings .settings-tab { min-width: 92px; }
#settings .settings-tab[aria-selected=true] { background: #f5c542; }
#settings .settings-pane { display: flex; flex-direction: column; gap: 6px; align-items: stretch;
  width: min(640px, 94vw); }
#settings .settings-grid { display: grid; grid-template-columns: auto minmax(140px, 260px) 3.5em; gap: 4px 10px;
  align-items: center; font: 700 1rem ui-monospace, monospace; text-align: left; align-self: center; }
#settings input[type=range] { width: 100%; height: 40px; accent-color: #f5c542; }
#settings .toggles { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
#settings .toggles label, #settings .setting-row { display: flex; gap: 10px; align-items: center; min-height: 44px;
  padding: 0 12px; background: #000a; font: 700 1rem ui-monospace, monospace; box-sizing: border-box; }
#settings .toggles label { cursor: pointer; }
#settings .setting-row { justify-content: space-between; flex-wrap: wrap; row-gap: 4px; }
#settings .setting-label { text-align: left; }
#settings .next-race { display: block; font: italic 500 0.75rem ui-monospace, monospace; color: #f5c542; }
#settings .choices { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
#settings .choices button { min-width: 64px; min-height: 40px; padding: 4px 10px; font: 800 0.9375rem ui-monospace, monospace;
  color: #f2ead8; background: #0008; border: 2px solid #f2ead8; cursor: pointer; }
#settings .choices button[aria-pressed=true] { color: #111; background: #f5c542; border-color: #111; }
#settings input[type=checkbox] { width: 24px; height: 24px; accent-color: #f5c542; cursor: pointer; }
`;

type Context = 'menu' | 'pause';

export interface SettingsScreen {
  readonly root: HTMLElement;
  /** Shows the controls for these settings (the rest stay hidden), then redraws. */
  setVisible(ids: readonly SettingId[]): void;
  /** Reads the record into every control. */
  sync(settings: Readonly<Settings>): void;
  /** Opens a tab (the first one when left out) for the menu or over the paused race. */
  open(context: Context, tab?: SettingsTab): void;
  readonly context: Context;
}

export interface SettingsScreenOptions {
  onChange(change: SettingsChange): void;
  onBack(): void;
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

export function createSettingsScreen(opts: SettingsScreenOptions): SettingsScreen {
  const root = node('div', { id: 'settings', className: 'screen', hidden: true });
  let context: Context = 'menu';
  let current: SettingsTab = 'sound';
  let visible = new Set<SettingId>();

  // ---- The bar: Back plus one button per tab -----------------------------------------------
  const back = node('button', {
    id: 'settings-back',
    className: 'small',
    type: 'button',
    textContent: 'Back',
  });
  back.addEventListener('click', () => opts.onBack());
  const bar = node('div', { className: 'settings-bar', role: 'tablist' }, back);
  const tabButtons = new Map<SettingsTab, HTMLButtonElement>();
  const panes = new Map<SettingsTab, HTMLElement>();
  for (const { tab, label } of SETTINGS_TABS) {
    const b = node('button', {
      id: `settings-tab-${tab}`,
      className: 'small settings-tab',
      type: 'button',
      textContent: label,
    });
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => showTab(tab));
    tabButtons.set(tab, b);
    bar.append(b);
    const pane = node('div', { id: `settings-pane-${tab}`, className: 'settings-pane' });
    pane.setAttribute('role', 'tabpanel');
    panes.set(tab, pane);
  }
  root.append(bar, ...panes.values());
  const pane = (tab: SettingsTab) => panes.get(tab) as HTMLElement;

  // ---- Sound: the M1 volume sliders and mute -----------------------------------------------
  const grid = node('div', { className: 'settings-grid' });
  const sliders = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement }>();
  for (const { bus, label } of VOLUME_BUSES) {
    const input = node('input', {
      id: `settings-volume-${bus}`,
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
    });
    input.setAttribute('aria-label', `${label} volume`);
    const out = node('output', { id: `settings-volume-${bus}-value` });
    input.addEventListener('input', () => {
      out.textContent = `${input.value}%`;
      opts.onChange({ kind: 'volume', bus, value: Number(input.value) / 100 });
    });
    sliders.set(bus, { input, out });
    grid.append(node('label', { htmlFor: input.id, textContent: label }), input, out);
  }
  const mute = node('input', { id: 'settings-mute', type: 'checkbox' });
  mute.addEventListener('change', () => opts.onChange({ kind: 'mute', value: mute.checked }));
  // The Sound tab's switches (Mute, and the table's sound toggles such as "Voices on") share one
  // row of chips under the sliders, so the tab still fits a 412 px-tall phone screen.
  const soundToggles = node('div', { className: 'toggles' }, node('label', {}, mute, 'Mute'));
  pane('sound').append(grid, soundToggles);

  // ---- Controls: the M1 left-handed mirror first ---------------------------------------------
  const mirror = node('input', { id: 'settings-mirror', type: 'checkbox' });
  mirror.addEventListener('change', () => opts.onChange({ kind: 'mirror', value: mirror.checked }));
  mirror.setAttribute('aria-label', 'Left-handed');
  pane('controls').append(
    node(
      'label',
      { className: 'setting-row' },
      node('span', { className: 'setting-label', textContent: 'Left-handed' }),
      mirror,
    ),
  );

  // ---- The table's rows --------------------------------------------------------------------
  const rows = new Map<SettingId, { row: HTMLElement; sync(s: Readonly<Settings>): void }>();
  const nextRaceTags: HTMLElement[] = [];
  const order: SettingId[] = [];
  const addRow = (id: SettingId) => {
    const def = settingDef(id);
    const label = node('span', { className: 'setting-label', textContent: def.label });
    if (def.nextRace) {
      const tag = node('span', { className: 'next-race', textContent: 'applies next race' });
      nextRaceTags.push(tag);
      label.append(tag);
    }
    // A Sound toggle is a chip beside Mute (see above); every other row is a full-width row.
    const chip = def.tab === 'sound' && def.kind === 'toggle';
    const row = chip ? node('label', {}, label) : node('div', { className: 'setting-row' }, label);
    row.dataset['setting'] = id;
    if (def.kind === 'toggle') {
      const box = node('input', { id: `settings-${id.replace('.', '-')}`, type: 'checkbox' });
      box.setAttribute('aria-label', def.label);
      box.addEventListener('change', () => opts.onChange({ kind: 'set', id, value: box.checked }));
      if (chip) row.prepend(box);
      else row.append(box);
      rows.set(id, { row, sync: (s) => (box.checked = settingValue(s, id) === true) });
    } else {
      const group = node('div', {
        id: `settings-${id.replace('.', '-')}`,
        className: 'choices',
        role: 'radiogroup',
      });
      group.setAttribute('aria-label', def.label);
      const buttons = (def.options ?? []).map((o) => {
        const b = node('button', { type: 'button', textContent: o.label });
        b.dataset['value'] = String(o.value);
        b.addEventListener('click', () => opts.onChange({ kind: 'set', id, value: o.value }));
        group.append(b);
        return { b, value: o.value };
      });
      row.append(group);
      rows.set(id, {
        row,
        sync: (s) => {
          const v = settingValue(s, id);
          for (const { b, value } of buttons) b.setAttribute('aria-pressed', String(value === v));
        },
      });
    }
    order.push(id);
    (chip ? soundToggles : pane(def.tab)).append(row);
  };

  for (const def of SETTINGS) addRow(def.id);

  const tabHasContent = (tab: SettingsTab) =>
    tab === 'sound' ||
    tab === 'controls' ||
    order.some((id) => visible.has(id) && settingDef(id).tab === tab);

  function showTab(tab: SettingsTab) {
    current = tabHasContent(tab) ? tab : 'sound';
    for (const [t, b] of tabButtons) {
      b.hidden = !tabHasContent(t);
      b.setAttribute('aria-selected', String(t === current));
    }
    for (const [t, p] of panes) p.hidden = t !== current;
  }

  const screen: SettingsScreen = {
    root,
    setVisible(ids) {
      visible = new Set(ids);
      for (const [id, r] of rows) r.row.hidden = !visible.has(id);
      showTab(current);
    },
    sync(s) {
      for (const { bus } of VOLUME_BUSES) {
        const slider = sliders.get(bus);
        if (!slider) continue;
        const pct = Math.round(s.volumes[bus] * 100);
        slider.input.value = String(pct);
        slider.out.textContent = `${pct}%`;
      }
      mute.checked = s.mute;
      mirror.checked = s.mirror;
      for (const r of rows.values()) r.sync(s);
    },
    open(ctx, tab) {
      context = ctx;
      for (const t of nextRaceTags) t.hidden = ctx !== 'pause';
      showTab(tab ?? 'sound');
      root.hidden = false;
    },
    get context() {
      return context;
    },
  };
  return screen;
}
