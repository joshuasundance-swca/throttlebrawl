// The settings screen's DOM (docs/milestones/M2.md, ui-2), drawn from the table in settings.ts.
// Tabs keep each page inside a phone-landscape screen without scrolling: Sound (the M1 volumes and
// mute), Race (everything that feeds SimConfig), Controls (the mirror and the input options) and
// Display. Opened from the pause menu, the Race rows say "applies next race". Big targets and
// 16px type, so it reads at arm's length.
//
// Keys (2026-10-05, the maintainer: "can we customize keyboard settings and stuff?"): every action's
// keys or pad buttons, a slot per binding. Tap a slot, then press the key or button for it (Esc
// cancels, Backspace clears); a binding another action also uses is flagged on its rows; Reset puts
// the device back to its defaults. The list scrolls inside the tab. The tab shows where a keyboard or
// a pad can be used (not on a touch-only phone, whose controls never change), and in preview mode.
import {
  BIND_ROWS,
  bindingConflicts,
  bindingFixed,
  bindingLabel,
  bindSlots,
  boundTokens,
  keyBindable,
  withBinding,
  type BindAction,
  type BindDevice,
  type Bindings,
} from '../input';
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
#settings #settings-pane-keys { width: min(960px, 96vw); min-height: 0; gap: 4px; }
#settings .keys-head { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; }
#settings .keys-hint { font: 600 13px ui-monospace, monospace; min-height: 1.3em; color: #f5c542; }
#settings .keys-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 410px), 1fr));
  gap: 4px 10px; overflow-y: auto; max-height: calc(100dvh - 170px); padding-right: 4px; }
#settings .bind-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center;
  min-height: 44px; padding: 2px 8px; background: #000a; font: 700 15px ui-monospace, monospace; text-align: left;
  box-sizing: border-box; }
#settings .bind-slots { display: flex; gap: 4px; }
#settings .bind-slots button { min-width: 72px; min-height: 40px; padding: 2px 6px; font: 800 14px ui-monospace, monospace;
  color: #f2ead8; background: #0008; border: 2px solid #f2ead8; cursor: pointer; white-space: nowrap; }
#settings .bind-slots button.empty { opacity: 0.7; }
#settings .bind-slots button.clash { border-color: #e0543a; color: #ffb3a6; }
#settings .bind-slots button[aria-pressed=true] { color: #111; background: #f5c542; border-color: #111; }
#settings .bind-slots button:disabled { cursor: default; opacity: 0.75; }
#settings .bind-warn { grid-column: 1 / -1; font: 600 12px ui-monospace, monospace; color: #ffb3a6; }
`;

type Context = 'menu' | 'pause';

export interface SettingsScreen {
  readonly root: HTMLElement;
  /** Shows the controls for these settings (the rest stay hidden), then redraws. */
  setVisible(ids: readonly SettingId[]): void;
  /** Reads the record into every control. */
  sync(settings: Readonly<Settings>): void;
  /** Shows or hides the Keys tab (a keyboard or a pad can be used here). */
  setRemap(on: boolean): void;
  /** Opens a tab (the first one when left out) for the menu or over the paused race. */
  open(context: Context, tab?: SettingsTab): void;
  readonly context: Context;
}

export interface SettingsScreenOptions {
  onChange(change: SettingsChange): void;
  onBack(): void;
  /** The connected pads, read while a pad slot waits for a button; navigator.getGamepads by default. */
  gamepads?: () => readonly (PadReading | null | undefined)[];
}

/** The parts of a Gamepad the Keys tab reads to learn a button or a stick. */
export interface PadReading {
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

const browserPads = (): readonly (PadReading | null)[] => {
  try {
    return typeof navigator.getGamepads === 'function' ? (navigator.getGamepads() ?? []) : [];
  } catch {
    return []; // a permissions policy can forbid the Gamepad API
  }
};

/** A stick counts as moved, for the Steer slot, past this share of its travel. */
const AXIS_PICK = 0.6;
const DEVICE_LABEL: Readonly<Record<BindDevice, string>> = { keyboard: 'Keyboard', gamepad: 'Gamepad' };

/** The pads' held buttons and moved axes, as binding tokens. */
function padHeld(pads: readonly (PadReading | null | undefined)[]): Set<string> {
  const now = new Set<string>();
  for (const p of pads) {
    if (!p?.connected) continue;
    p.buttons.forEach((b, i) => {
      if (b.pressed || b.value >= 0.5) now.add(`button${i}`);
    });
    p.axes.forEach((v, i) => {
      if (Math.abs(v) >= AXIS_PICK) now.add(`axis${i}`);
    });
  }
  return now;
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

  // ---- Keys: every action's keys or pad buttons ---------------------------------------------
  let remap = false;
  let device: BindDevice = 'keyboard';
  let last: Readonly<Settings> | null = null;
  /** The slot waiting for a key or button, or null. */
  let waiting: { action: BindAction; slot: number; device: BindDevice } | null = null;
  let padFrame = 0;
  const readPads = opts.gamepads ?? browserPads;
  const deviceButtons = new Map<BindDevice, HTMLButtonElement>();
  const deviceGroup = node('div', { id: 'settings-keys-device', className: 'choices', role: 'radiogroup' });
  deviceGroup.setAttribute('aria-label', 'Device');
  for (const d of ['keyboard', 'gamepad'] as const) {
    const b = node('button', { id: `settings-keys-${d}`, type: 'button', textContent: DEVICE_LABEL[d] });
    b.addEventListener('click', () => {
      stopWaiting();
      device = d;
      drawKeys();
    });
    deviceButtons.set(d, b);
    deviceGroup.append(b);
  }
  const reset = node('button', { id: 'settings-keys-reset', className: 'small', type: 'button' });
  reset.addEventListener('click', () => {
    stopWaiting();
    opts.onChange({ kind: 'bindings', device, bindings: {} });
  });
  const hint = node('div', { id: 'settings-keys-hint', className: 'keys-hint' });
  hint.setAttribute('aria-live', 'polite');
  const list = node('div', { id: 'settings-keys-list', className: 'keys-list' });
  pane('keys').append(node('div', { className: 'keys-head' }, deviceGroup, reset), hint, list);

  const bindingsOf = (d: BindDevice): Bindings =>
    (d === 'keyboard' ? last?.keyBindings : last?.gamepadBindings) ?? {};
  const rowLabel = (action: BindAction) => BIND_ROWS.find((r) => r.action === action)?.label ?? action;
  const idleHint = () =>
    device === 'keyboard'
      ? 'Tap a slot, then press a key. Esc always pauses.'
      : 'Tap a slot, then press a button (move a stick for Steer).';

  function drawKeys() {
    for (const [d, b] of deviceButtons) b.setAttribute('aria-pressed', String(d === device));
    reset.textContent = device === 'keyboard' ? 'Reset keys' : 'Reset buttons';
    if (!waiting) hint.textContent = idleHint();
    const bindings = bindingsOf(device);
    const clashes = bindingConflicts(device, bindings);
    const out: HTMLElement[] = [];
    for (const r of BIND_ROWS) {
      if (!r[device]) continue;
      const tokens = boundTokens(device, bindings, r.action);
      const clash = clashes.get(r.action) ?? [];
      const slots = node('div', { className: 'bind-slots' });
      for (let i = 0; i < bindSlots(device, r.action); i++) {
        const token = tokens[i];
        const isWaiting = waiting?.action === r.action && waiting.slot === i && waiting.device === device;
        const name = token === undefined ? '' : bindingLabel(device, token);
        const b = node('button', {
          type: 'button',
          id: `settings-bind-${device}-${r.action}-${i}`,
          textContent: isWaiting ? '…' : token === undefined ? '+' : name,
        });
        b.dataset['slot'] = String(i);
        b.setAttribute('aria-pressed', String(isWaiting));
        b.setAttribute('aria-label', `${r.label}: ${token === undefined ? 'add' : name}`);
        if (token === undefined) b.classList.add('empty');
        else if (clash.some((c) => c.token === token)) b.classList.add('clash');
        if (token !== undefined && bindingFixed(device, r.action, token)) b.disabled = true;
        b.addEventListener('click', () => (isWaiting ? stopWaiting() : startWaiting(r.action, i)));
        slots.append(b);
        // One empty slot at a time: the "+" that adds the next binding.
        if (token === undefined) break;
      }
      const row = node('div', { className: 'bind-row' }, node('span', { textContent: r.label }), slots);
      row.dataset['bind'] = r.action;
      if (clash.length > 0) {
        const others = [...new Set(clash.flatMap((c) => c.others))];
        row.append(node('span', { className: 'bind-warn', textContent: `Also: ${others.join(', ')}` }));
      }
      out.push(row);
    }
    list.replaceChildren(...out);
  }

  const commit = (token: string | null) => {
    if (!waiting) return;
    const { action, slot, device: d } = waiting;
    const before = bindingsOf(d);
    const next = withBinding(d, before, action, slot, token);
    stopWaiting();
    if (next !== before) opts.onChange({ kind: 'bindings', device: d, bindings: next });
  };

  /** While a keyboard slot waits, the next key is its binding, and nothing else sees that key. */
  const onCaptureKey = (e: KeyboardEvent) => {
    if (!waiting || root.hidden) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') return stopWaiting();
    if (waiting.device !== 'keyboard') return;
    if (e.code === 'Backspace' || e.code === 'Delete') return commit(null);
    if (!keyBindable(waiting.action, e.code)) {
      hint.textContent = 'That key is kept for the tuning panel. Try another.';
      return;
    }
    commit(e.code);
  };

  /** While a pad slot waits, the first button pressed (or stick moved, for Steer) is its binding. */
  const pollPads = (held: ReadonlySet<string>) => {
    padFrame = 0;
    if (!waiting || waiting.device !== 'gamepad' || root.hidden) return;
    const now = padHeld(readPads());
    const kind = waiting.action === 'steer' ? 'axis' : 'button';
    const fresh = [...now].find((t) => !held.has(t) && t.startsWith(kind));
    if (fresh) return commit(fresh);
    // A held control let go counts again when next pressed.
    const still = new Set([...held].filter((t) => now.has(t)));
    padFrame = requestAnimationFrame(() => pollPads(still));
  };

  function startWaiting(action: BindAction, slot: number) {
    stopWaiting();
    waiting = { action, slot, device };
    hint.textContent =
      device === 'keyboard'
        ? `Press a key for ${rowLabel(action)}. Esc cancels, Backspace clears.`
        : `${action === 'steer' ? 'Move a stick' : 'Press a button'} for ${rowLabel(action)}. Tap the slot to cancel.`;
    window.addEventListener('keydown', onCaptureKey, { capture: true });
    if (device === 'gamepad') {
      // What is held already is not the answer.
      const held = padHeld(readPads());
      padFrame = requestAnimationFrame(() => pollPads(held));
    }
    drawKeys();
  }

  function stopWaiting() {
    if (padFrame) cancelAnimationFrame(padFrame);
    padFrame = 0;
    window.removeEventListener('keydown', onCaptureKey, { capture: true });
    if (!waiting) return;
    waiting = null;
    drawKeys();
  }

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
    (tab === 'keys' && remap) ||
    order.some((id) => visible.has(id) && settingDef(id).tab === tab);

  function showTab(tab: SettingsTab) {
    stopWaiting();
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
      last = s;
      drawKeys();
    },
    setRemap(on) {
      remap = on;
      showTab(current);
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
