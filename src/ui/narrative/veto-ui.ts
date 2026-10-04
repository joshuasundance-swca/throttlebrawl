// The DOM side of "cut this": the confirm card, the pause screen's "recently seen" list, and the
// long-press watcher on the ticker. The rules live in veto.ts and long-press.ts.
//
// Two taps from the pause screen: tap a line in the list, then "Cut this". [default]
// The ticker's long-press is watched from the document, so the ticker never takes a touch: a press
// that starts in the stick or attack zones is ignored (docs/architecture.md, "The gesture"), and so
// is any touch mid-race while nobody has told the narrative where those zones are.
import type { ShownBark } from './director';
import { createLongPress } from './long-press';
import type { BarkSurface } from './surface';
import type { SeenItem, SeenLog } from './veto';

const CSS = `
#cut-menu { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 60; pointer-events: auto;
  width: min(420px, calc(100vw - 32px)); box-sizing: border-box; padding: 12px 14px; background: #111; color: #f2ead8;
  border: 3px solid #f2ead8; box-shadow: 5px 5px 0 #e0543a; font: 600 16px/1.35 system-ui, sans-serif; text-align: left; }
#cut-menu[hidden], #cut-done[hidden] { display: none; }
#cut-menu .cut-title { font: 800 13px ui-monospace, 'Courier New', monospace; letter-spacing: 0.08em; text-transform: uppercase;
  color: #f5c542; margin-bottom: 6px; }
#cut-menu .cut-label { margin-bottom: 12px; overflow-wrap: anywhere; }
#cut-menu .cut-row { display: flex; gap: 12px; flex-wrap: wrap; }
#cut-menu button { pointer-events: auto; min-height: 44px; padding: 6px 16px; cursor: pointer;
  font: 800 16px ui-monospace, 'Courier New', monospace; color: #111; background: #f2ead8; border: 3px solid #f2ead8; }
#cut-menu #cut-confirm { background: #e0543a; border-color: #e0543a; color: #fff; }
#cut-done { position: fixed; left: 50%; bottom: max(16px, env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 60;
  padding: 6px 12px; background: #000c; color: #fff; font: 600 14px system-ui, sans-serif; pointer-events: none; }
#recently-seen { pointer-events: auto; width: min(560px, calc(100vw - 32px)); max-height: 26vh; overflow-y: auto;
  box-sizing: border-box; text-align: left; background: #000a; border: 1px dashed #fff8; padding: 6px 8px; }
#recently-seen .rs-title { font: 700 12px ui-monospace, 'Courier New', monospace; opacity: 0.85; margin-bottom: 4px; }
#recently-seen ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
#recently-seen .rs-item { pointer-events: auto; width: 100%; min-height: 44px; text-align: left; cursor: pointer; padding: 6px 8px;
  font: 600 14px/1.3 system-ui, sans-serif; color: #111; background: #f2ead8; border: 2px solid #111; overflow-wrap: anywhere; }
#recently-seen .rs-kind { font: 800 11px ui-monospace, monospace; text-transform: uppercase; color: #b3261e; margin-right: 6px; }
#recently-seen .rs-empty { font: 500 13px system-ui, sans-serif; opacity: 0.8; }
`;

let styled = false;
function style() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.append(s);
}

const hostOf = (host?: () => HTMLElement | null) =>
  host?.() ?? document.getElementById('ui') ?? document.body;

export interface CutMenu {
  /** Shows the confirm card for one item; `onCut` runs when the player taps "Cut this". */
  offer(item: SeenItem, onCut: () => void): void;
  close(): void;
  readonly open: boolean;
}

/** How long the "Cut" notice stays. [default] */
const DONE_MS = 2500;

export function createCutMenu(host?: () => HTMLElement | null): CutMenu {
  let card: HTMLElement | null = null;
  let label: HTMLElement | null = null;
  let done: HTMLElement | null = null;
  let pending: (() => void) | null = null;
  let doneTimer: ReturnType<typeof setTimeout> | null = null;

  const close = () => {
    pending = null;
    if (card) card.hidden = true;
  };
  const mount = () => {
    if (card) return card;
    style();
    card = document.createElement('div');
    card.id = 'cut-menu';
    card.hidden = true;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Cut this?');
    const title = document.createElement('div');
    title.className = 'cut-title';
    title.textContent = 'Cut this?';
    label = document.createElement('div');
    label.className = 'cut-label';
    const row = document.createElement('div');
    row.className = 'cut-row';
    const confirm = document.createElement('button');
    confirm.id = 'cut-confirm';
    confirm.type = 'button';
    confirm.textContent = 'Cut this';
    const keep = document.createElement('button');
    keep.id = 'cut-keep';
    keep.type = 'button';
    keep.textContent = 'Keep';
    // Taps on the card stay on the card: the pause screen and the race never see them.
    card.addEventListener('pointerdown', (e) => e.stopPropagation());
    confirm.addEventListener('click', (e) => {
      e.stopPropagation();
      const run = pending;
      close();
      run?.();
      if (!done) {
        done = document.createElement('div');
        done.id = 'cut-done';
        done.setAttribute('role', 'status');
        done.textContent = "Cut. You won't see it again on this device.";
        hostOf(host).append(done);
      }
      done.hidden = false;
      if (doneTimer !== null) clearTimeout(doneTimer);
      doneTimer = setTimeout(() => {
        if (done) done.hidden = true;
      }, DONE_MS);
    });
    keep.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
    });
    row.append(confirm, keep);
    card.append(title, label, row);
    hostOf(host).append(card);
    return card;
  };

  return {
    offer(item, onCut) {
      const el = mount();
      if (label) label.textContent = item.label;
      el.dataset.contentRef = item.contentRef;
      pending = onCut;
      el.hidden = false;
    },
    close,
    get open() {
      return !!card && !card.hidden;
    },
  };
}

/** The pause screen's "recently seen" list: newest first; tapping a row offers "cut this". */
export function mountRecentlySeen(
  host: HTMLElement,
  log: SeenLog,
  offer: (item: SeenItem) => void,
): { element: HTMLElement; refresh(): void } {
  style();
  const root = document.createElement('div');
  root.id = 'recently-seen';
  const title = document.createElement('div');
  title.className = 'rs-title';
  title.textContent = 'Recently seen: tap one to cut it';
  const list = document.createElement('ul');
  root.append(title, list);
  const refresh = () => {
    const items = log.list();
    const rows: HTMLElement[] = items.map((item) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rs-item';
      b.dataset.contentRef = item.contentRef;
      const kind = document.createElement('span');
      kind.className = 'rs-kind';
      kind.textContent = item.kind;
      b.append(kind, item.label);
      b.addEventListener('click', () => offer(item));
      li.append(b);
      return li;
    });
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'rs-empty';
      li.textContent = 'Nothing yet. Lines, signs and billboards show up here.';
      rows.push(li);
    }
    list.replaceChildren(...rows);
  };
  refresh();
  log.onChange(refresh);
  host.append(root);
  return { element: root, refresh };
}

export interface BubblePressOptions {
  /** True where a press belongs to steering or attacking (client coordinates). */
  inControlZone?: ((x: number, y: number) => boolean) | undefined;
  /** True while a race runs: touches are ignored then unless `inControlZone` is known. */
  racing: () => boolean;
  onLongPress(bark: ShownBark): void;
}

/** Watches long-presses on the ticker's box from the window, without ever consuming a pointer. */
export function watchBubblePresses(bubble: BarkSurface, opts: BubblePressOptions): () => void {
  const lp = createLongPress<ShownBark>({
    onLongPress: (bark) => {
      bubble.hold(false);
      opts.onLongPress(bark);
    },
  });
  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    const el = bubble.element();
    const bark = bubble.current();
    if (!el || el.hidden || !bark) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    // A press on a control drawn over the ticker (a pause-menu button, the cut card) is that control's.
    if (e.target instanceof Element && e.target.closest('button, input, select, label, a, #cut-menu')) return;
    if (opts.inControlZone) {
      if (opts.inControlZone(e.clientX, e.clientY)) return;
    } else if (e.pointerType === 'touch' && opts.racing()) {
      return;
    }
    lp.down(e.pointerId, e.clientX, e.clientY, bark);
    bubble.hold(true);
  };
  const onMove = (e: PointerEvent) => {
    lp.move(e.pointerId, e.clientX, e.clientY);
    if (!lp.pressing) bubble.hold(false);
  };
  const onUp = (e: PointerEvent) => {
    lp.up(e.pointerId);
    if (!lp.pressing) bubble.hold(false);
  };
  const opt = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', onDown, opt);
  window.addEventListener('pointermove', onMove, opt);
  window.addEventListener('pointerup', onUp, opt);
  window.addEventListener('pointercancel', onUp, opt);
  return () => {
    window.removeEventListener('pointerdown', onDown, opt);
    window.removeEventListener('pointermove', onMove, opt);
    window.removeEventListener('pointerup', onUp, opt);
    window.removeEventListener('pointercancel', onUp, opt);
  };
}
