// ui/tuning: the hidden tuning panel (docs/milestones/M1.md, tuning-1; docs/architecture.md,
// "Tuning"). It builds itself from the registry: one control per declaration, in the groups of
// ./model. It stays open as a see-through overlay while the race runs, so it is usable mid-race.
//
// Three ways to open it:
//   - the backquote key;
//   - a long-press on any element marked `data-tuning-long-press` (the build id);
//   - a three-finger tap inside any element marked `data-tuning-three-finger` (the pause screen).
// The marks are delegated, so ui-1 only adds the attribute; no call into this module is needed.
import type { TuningParamDecl } from '../../sim/api';
import { frameCapOptions, measureRefreshHz, type TuningRegistry } from '../../tuning';
import { formatValue, panelGroups } from './model';

export const LONG_PRESS_MS = 600;
const LONG_PRESS_SLOP_PX = 12;
const REFRESH_SAMPLES = 45;

export interface TuningPanel {
  readonly element: HTMLElement;
  toggle(open?: boolean): void;
  readonly open: boolean;
  /** The measured screen refresh rate, once the panel has been opened (null before). */
  readonly refreshHz: number | null;
}

export interface TuningPanelOptions {
  /** The clock for exported presets (tests pin it). */
  now?: () => Date;
}

const CSS = `
#tuning-panel.tp { position: absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right));
  width: min(300px, 46vw); max-height: calc(100% - 16px); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain;
  box-sizing: border-box; padding: 6px 10px 8px; pointer-events: auto; z-index: 30; touch-action: pan-y;
  background: rgb(10 5 25 / 45%); color: #fff; border-radius: 8px; font: 600 12px/1.3 system-ui, sans-serif;
  text-shadow: 0 1px 2px #000; text-align: left; }
#tuning-panel.tp[hidden] { display: none; }
#tuning-panel .tp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
#tuning-panel .tp-title { font-size: 14px; font-weight: 800; letter-spacing: 0.04em; }
#tuning-panel .tp-group-title { margin-top: 6px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.8; }
#tuning-panel .tp-row { display: grid; grid-template-columns: 5.6em minmax(0, 1fr) 4em; gap: 6px; align-items: center; min-height: 30px; }
#tuning-panel .tp-row > span { overflow-wrap: anywhere; }
#tuning-panel output { text-align: right; font-variant-numeric: tabular-nums; }
#tuning-panel input[type='range'] { width: 100%; height: 28px; margin: 0; accent-color: #e0543a; }
#tuning-panel .tp-cap { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
#tuning-panel .tp-empty { font-weight: 500; font-style: italic; opacity: 0.65; }
#tuning-panel button { font: inherit; color: #fff; background: rgb(0 0 0 / 55%); border: 1px solid rgb(255 255 255 / 55%);
  border-radius: 6px; padding: 4px 6px; min-height: 32px; cursor: pointer; pointer-events: auto; }
#tuning-panel button[aria-pressed='true'] { background: #e0543a; border-color: #fff; }
#tuning-panel .tp-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
#tuning-panel .tp-status { min-height: 1.3em; margin-top: 4px; font-weight: 500; }
#tuning-panel textarea { box-sizing: border-box; width: 100%; height: 8em; margin-top: 4px; font: 11px/1.3 ui-monospace, monospace;
  color: #fff; background: rgb(0 0 0 / 70%); border: 1px solid rgb(255 255 255 / 40%); border-radius: 4px; user-select: text; -webkit-user-select: text; }
`;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}

function capLabel(label: string, fps: number | null): string {
  return fps === null ? label : `${label} · ${fps} fps`;
}

export function createTuningPanel(
  root: HTMLElement,
  registry: TuningRegistry,
  options: TuningPanelOptions = {},
): TuningPanel {
  const now = options.now ?? (() => new Date());
  if (!document.getElementById('tuning-panel-style')) {
    document.head.append(node('style', { id: 'tuning-panel-style', textContent: CSS }));
  }

  const panel = node('div', { id: 'tuning-panel', className: 'tp', hidden: true });
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Tuning');
  const close = node('button', { id: 'tuning-close', type: 'button', textContent: 'Close' });
  panel.append(
    node(
      'div',
      { className: 'tp-head' },
      node('span', { className: 'tp-title', textContent: 'Tuning' }),
      close,
    ),
  );

  // Every control keeps an updater, so a reset or preset shows at once.
  const updaters = new Map<string, (value: number) => void>();
  const capButtons: HTMLButtonElement[] = [];

  const sliderRow = (d: TuningParamDecl): HTMLElement => {
    const slider = node('input', { type: 'range' });
    slider.min = String(d.min);
    slider.max = String(d.max);
    slider.step = String(d.step);
    slider.value = String(registry.get(d.id));
    slider.dataset['param'] = d.id;
    slider.setAttribute('aria-label', d.label);
    const out = node('output');
    out.dataset['paramValue'] = d.id;
    const show = (v: number) => {
      slider.value = String(v);
      out.textContent = formatValue(d, v);
    };
    show(registry.get(d.id));
    updaters.set(d.id, show);
    slider.addEventListener('input', () => show(registry.set(d.id, Number(slider.value))));
    return node('label', { className: 'tp-row' }, node('span', { textContent: d.label }), slider, out);
  };

  const capRow = (d: TuningParamDecl): HTMLElement => {
    const group = node('div', { className: 'tp-cap' });
    group.dataset['param'] = d.id;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', d.label);
    for (const opt of frameCapOptions(null)) {
      const b = node('button', { type: 'button', textContent: opt.label });
      b.dataset['divisor'] = String(opt.divisor);
      b.addEventListener('click', () => registry.set(d.id, opt.divisor));
      capButtons.push(b);
      group.append(b);
    }
    const show = (v: number) => {
      for (const b of capButtons) b.setAttribute('aria-pressed', String(Number(b.dataset['divisor']) === v));
    };
    show(registry.get(d.id));
    updaters.set(d.id, show);
    return group;
  };

  const body = node('div', { className: 'tp-body' });
  for (const g of panelGroups(registry.decls)) {
    const section = node('section', { className: 'tp-group' });
    section.dataset['group'] = g.group;
    section.append(node('div', { className: 'tp-group-title', textContent: g.title }));
    if (g.empty)
      section.append(node('div', { className: 'tp-empty', textContent: 'Not in this build yet.' }));
    for (const c of g.controls) section.append(c.kind === 'frame-cap' ? capRow(c.decl) : sliderRow(c.decl));
    body.append(section);
  }
  panel.append(body);

  const status = node('div', { id: 'tuning-status', className: 'tp-status' });
  status.setAttribute('aria-live', 'polite');
  const json = node('textarea', { id: 'tuning-json', readOnly: true, hidden: true });
  json.setAttribute('aria-label', 'Preset JSON');
  const save = node('button', { id: 'tuning-save', type: 'button', textContent: 'Save preset' });
  const copy = node('button', { id: 'tuning-copy', type: 'button', textContent: 'Copy preset as JSON' });
  const reset = node('button', { id: 'tuning-reset', type: 'button', textContent: 'Reset' });
  panel.append(node('div', { className: 'tp-actions' }, save, copy, reset), status, json);

  registry.onChange((id, value) => updaters.get(id)?.(value));

  save.addEventListener('click', () => {
    if (registry.saveToDevice(now())) status.textContent = 'Saved on this device. It loads next time.';
    else if (!registry.canSaveToDevice)
      status.textContent = 'This build cannot save presets on the device yet. Copy it instead.';
    else status.textContent = registry.storeNotice ?? 'Could not save on this device.';
  });
  copy.addEventListener('click', () => {
    const text = `${JSON.stringify(registry.exportPreset(now()), null, 2)}\n`;
    json.value = text;
    json.hidden = false;
    const blocked = () => {
      json.select();
      status.textContent = 'Copy was blocked. The preset is in the box below: select it and copy.';
    };
    try {
      const clip = navigator.clipboard as Clipboard | undefined;
      if (!clip) {
        blocked();
        return;
      }
      clip.writeText(text).then(() => (status.textContent = 'Copied. Paste it in chat.'), blocked);
    } catch {
      blocked();
    }
  });
  reset.addEventListener('click', () => {
    registry.reset();
    status.textContent = 'Back to the shipped preset.';
  });

  // Keys pressed on the panel's controls stay on the panel (arrow keys would also steer the bike),
  // except the backquote that closes it.
  for (const type of ['keydown', 'keyup'] as const) {
    panel.addEventListener(type, (e) => {
      if (e.code !== 'Backquote') e.stopPropagation();
    });
  }

  root.append(panel);

  // The refresh rate, measured once on first open, labels the frame-rate cap options.
  let refreshHz: number | null = null;
  let measuring = false;
  const measure = () => {
    if (measuring || refreshHz !== null || typeof requestAnimationFrame !== 'function') return;
    measuring = true;
    const intervals: number[] = [];
    let last = -1;
    const tick = (t: number) => {
      if (last >= 0) intervals.push(t - last);
      last = t;
      if (intervals.length < REFRESH_SAMPLES) {
        requestAnimationFrame(tick);
        return;
      }
      refreshHz = measureRefreshHz(intervals);
      panel.dataset['refreshHz'] = String(refreshHz ?? '');
      frameCapOptions(refreshHz).forEach((opt, i) => {
        const b = capButtons[i];
        if (b) b.textContent = capLabel(opt.label, opt.fps);
      });
    };
    requestAnimationFrame(tick);
  };

  const isOpen = () => panel.hidden === false;
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    if (open) measure();
  };
  close.addEventListener('click', () => setOpen(false));

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote' && !e.repeat) setOpen(!isOpen());
  });

  // Long-press on a marked element (the build id).
  let press: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  const cancelPress = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  // Three-finger tap inside a marked element (the pause screen).
  const fingers = new Set<number>();

  document.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[data-tuning-long-press]')) {
        cancelPress();
        press = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          timer: setTimeout(() => setOpen(true), LONG_PRESS_MS),
        };
      }
      if (e.pointerType === 'touch' && target?.closest('[data-tuning-three-finger]')) {
        fingers.add(e.pointerId);
        if (fingers.size >= 3) {
          fingers.clear();
          setOpen(true);
        }
      }
    },
    { capture: true },
  );
  document.addEventListener(
    'pointermove',
    (e) => {
      if (
        press &&
        e.pointerId === press.id &&
        Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP_PX
      )
        cancelPress();
    },
    { capture: true },
  );
  for (const type of ['pointerup', 'pointercancel'] as const) {
    document.addEventListener(
      type,
      (e) => {
        if (press && e.pointerId === press.id) cancelPress();
        fingers.delete(e.pointerId);
      },
      { capture: true },
    );
  }

  return {
    element: panel,
    toggle(open) {
      setOpen(open === undefined ? !isOpen() : open);
    },
    get open() {
      return isOpen();
    },
    get refreshHz() {
      return refreshHz;
    },
  };
}
