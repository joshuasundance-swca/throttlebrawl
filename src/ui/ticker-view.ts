// The top ticker's DOM (playtest 3, the maintainer: "The black and white text pop-ups block the
// actual game"; interview round 1 [decided]: "Top ticker strip": one line at a time along the top
// edge, fading fast, the road kept clear, takedown names flashing briefly and small).
//
// One dark translucent strip in the HUD, never black on white, no WebGL and no draw call. It shows
// the item the model (ticker.ts) says is up: an optional tag chip (a speaker or source), the words,
// and an optional cash figure. A line too long for the strip steps down 15 px, 13 px, 12 px, then
// wraps to two lines at most; that is one layout read per new item and none per frame. It fades in
// over 100 ms and out over 160 ms (opacity and a 4 px slide only), and the next item crossfades in.
// It never takes a touch (pointer-events none): narrative/veto-ui.ts watches long-presses on its
// box from the document, ignoring the stick and attack zones, so a bark can still be cut.
import { SIM_HZ } from '../sim/api';
import type { ShownBark } from './narrative/director';
import type { BarkSurface } from './narrative/surface';
import { announceBark, listenBarkVoice } from './narrative/voice-link';
import type { MeterRun } from './race-feed';
import {
  createTicker,
  tickerCash,
  tickerLabel,
  type ShownTickerItem,
  type Ticker,
  type TickerItem,
} from './ticker';

/**
 * Where the strip sits and how it looks, per look (`data-look`). The default is the Ink + 60s look,
 * which a new save starts on. Where it sits comes from ui/hud-layout.ts (`--hl-ticker-*` on #ui): in
 * the top row between the position badge and the rival's bar where there is 260 px of room, else its
 * own row under the top row, always clear of every other widget and of the road ahead (the layout
 * check, tests/e2e/ui-style-popups.spec.ts). The fallbacks are for a screen no plan has settled. [default]
 */
export const TICKER_CSS = `
#hud-ticker { --tk-band: rgb(17 17 17 / 72%); --tk-text: #f2ead8; --tk-tag-bg: #e0543a; --tk-tag-fg: #fff;
  --tk-accent: #f5c542; --tk-rule: 2px solid #111;
  position: absolute; left: var(--hl-ticker-x, 50%); top: var(--hl-ticker-y, max(8px, env(safe-area-inset-top)));
  transform: translateX(-50%); width: max-content; max-width: var(--hl-ticker-w, min(80vw, 560px)); box-sizing: border-box; padding: 4px 12px 5px;
  border-radius: 4px; background: var(--tk-band); border-bottom: var(--tk-rule); color: var(--tk-text);
  font: 700 15px/1.2 system-ui, sans-serif; text-align: center; white-space: nowrap; overflow: hidden;
  pointer-events: none; opacity: 0; transition: opacity 160ms ease-out; }
#hud-ticker.up { opacity: 1; }
#hud-ticker.in { animation: tb-tick-in 100ms ease-out; }
#hud-ticker[data-fit='13'] { font-size: 13px; }
#hud-ticker[data-fit='12'] { font-size: 12px; }
#hud-ticker[data-fit='wrap'] { font-size: 12px; white-space: normal; max-height: calc(2.4em + 9px); }
#hud-ticker.held { outline: 2px solid var(--tk-accent); }
#hud-ticker .ticker-tag { display: inline-block; margin-right: 6px; padding: 1px 5px; border-radius: 3px;
  background: var(--tk-tag-bg); color: var(--tk-tag-fg); font: 800 0.78em/1.25 ui-monospace, 'Courier New', monospace;
  letter-spacing: 0.06em; text-transform: uppercase; vertical-align: 1px; }
#hud-ticker .ticker-tag:empty { display: none; }
#hud-ticker .ticker-cash { margin-left: 8px; color: var(--tk-accent); font: 900 1em/1 ui-monospace, 'Courier New', monospace;
  font-variant-numeric: tabular-nums; }
#hud-ticker .ticker-cash:empty { display: none; }
#hud-ticker[data-cls='style'] .ticker-text, #hud-ticker[data-cls='meter'] .ticker-text { font-family: ui-monospace,
  'Courier New', monospace; font-weight: 800; letter-spacing: 0.04em; }
#hud-ticker[data-cls='meter'] { border-bottom-style: dashed; font-variant-numeric: tabular-nums; }
#hud-ticker[data-cls='meter'].pending { opacity: 0.7; }
#hud-ticker[data-cls='meter'].pending .ticker-cash { color: var(--tk-text); }
#hud-ticker[data-cls='name'] { background: none; border-bottom: 1px solid var(--tk-accent); padding: 2px 8px 3px;
  font: 900 12px/1.2 ui-monospace, 'Courier New', monospace; letter-spacing: 0.12em; color: var(--tk-accent);
  text-shadow: 0 1px 2px #000, 0 0 3px #000; }
#hud-ticker[data-cls='teach'] { border-left: 3px solid var(--tk-accent); }
#hud-ticker.landed .ticker-cash { color: var(--tk-accent); }
#hud-ticker[data-look='classic'] { --tk-band: rgb(10 5 20 / 62%); --tk-tag-bg: #f5c542; --tk-tag-fg: #111;
  --tk-rule: 0 solid transparent; }
#hud-ticker[data-look='wasteland'] { --tk-band: rgb(46 30 18 / 66%); --tk-text: #f4e3c1; --tk-tag-bg: #d9822b;
  --tk-tag-fg: #1c120a; --tk-accent: #f0b44c; --tk-rule: 0 solid transparent; }
#hud-ticker[data-look='brush'] { --tk-band: transparent; --tk-text: #fff; --tk-tag-bg: #111; --tk-tag-fg: #f5c542;
  --tk-rule: 0 solid transparent;
  text-shadow: 2px 0 #111, -2px 0 #111, 0 2px #111, 0 -2px #111; }
@keyframes tb-tick-in { 0% { opacity: 0; transform: translate(-50%, -4px); } 100% { opacity: 1; transform: translate(-50%, 0); } }
@media (prefers-reduced-motion: reduce) { #hud-ticker, #hud-ticker.in { transition: none; animation: none; } }
`;

/** How long the fade-out lasts before the strip is taken out of the layout (ms). */
const FADE_OUT_MS = 160;
/** One frame never moves the strip's clock further than this (ms): a pause or a hiccup does not eat items. */
const MAX_STEP_MS = 1000;

export interface TickerUi {
  readonly root: HTMLElement;
  readonly model: Ticker;
  /** Where barks show: narrative/'s view of the strip. */
  readonly surface: BarkSurface;
  /** Adds an item at the strip's clock. */
  push(item: TickerItem): void;
  /** The player's style run in progress, or null. */
  meter(run: MeterRun | null): void;
  /** One frame: advances the clock (frozen while `paused`) and draws what changed. `realNowMs` is performance.now(). */
  update(realNowMs: number, paused: boolean): void;
  /** The look id (`classic`, `kodak`, `wasteland`, `brush`): the strip's colours. */
  setLook(look: string): void;
  /** The `stylePopups` setting. */
  setStyleEnabled(on: boolean): void;
  /** The browser specs' seam: drops everything, shows these items, and (by default) holds the first up so nothing displaces it. */
  replace(items: readonly TickerItem[], hold?: boolean): void;
  /** A new race starts clean. */
  clear(): void;
  /** The strip's clock, in ms. */
  now(): number;
}

export interface TickerUiOptions {
  /** The HUD the strip goes into. */
  host: HTMLElement;
  /** The takedown name's flash and the landing line's time, in ms (the tuning sliders). */
  nameMs?: () => number;
  lineMs?: () => number;
  /**
   * The browser specs' quiet mode (only under the test flag): barks, style chips and names are
   * dropped, so a spec about the live meter sees nothing else on the strip. A run that paid
   * (`landed`) still lands.
   */
  quiet?: () => boolean;
}

export function createTickerUi(options: TickerUiOptions): TickerUi {
  let clock = 0;
  let lastReal = -1;
  const model = createTicker({
    ...(options.nameMs ? { nameMs: options.nameMs } : {}),
    ...(options.lineMs ? { lineMs: options.lineMs } : {}),
    onShow: (i) => {
      // The voice plays with its subtitle: announced when the bark is DISPLAYED, not when queued.
      if (i.cls === 'bark' && i.contentRef)
        announceBark({
          contentRef: i.contentRef,
          speakerName: i.tag ?? '',
          text: i.text,
          durationS: (i.endsAt - i.startedAt) / 1000,
        });
    },
  });
  listenBarkVoice((ref, durationS) => model.extend(ref, clock + durationS * 1000));

  const tag = document.createElement('span');
  tag.className = 'ticker-tag';
  const text = document.createElement('span');
  text.className = 'ticker-text';
  const cash = document.createElement('span');
  cash.className = 'ticker-cash';
  const root = document.createElement('div');
  root.id = 'hud-ticker';
  root.hidden = true;
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.append(tag, text, cash);
  options.host.append(root);

  const setText = (node: HTMLElement, value: string) => {
    if (node.textContent !== value) node.textContent = value;
  };

  let shownId = -1;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  const fit = () => {
    for (const size of ['15', '13', '12']) {
      root.dataset['fit'] = size;
      if (root.scrollWidth <= root.clientWidth + 1) return;
    }
    root.dataset['fit'] = 'wrap';
  };
  const draw = (item: Readonly<ShownTickerItem> | null) => {
    if (!item) {
      if (shownId === -1) return;
      shownId = -1;
      root.classList.remove('up');
      if (fadeTimer !== null) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        fadeTimer = null;
        if (shownId === -1) root.hidden = true;
      }, FADE_OUT_MS);
      return;
    }
    if (fadeTimer !== null) clearTimeout(fadeTimer);
    fadeTimer = null;
    const fresh = item.id !== shownId;
    const words = tickerLabel(item);
    const money = tickerCash(item);
    setText(tag, item.tag ?? '');
    setText(text, words);
    setText(cash, money);
    root.dataset['cls'] = item.cls;
    if (item.kind) root.dataset['kind'] = item.kind;
    else delete root.dataset['kind'];
    if (item.contentRef) root.dataset['contentRef'] = item.contentRef;
    else delete root.dataset['contentRef'];
    root.setAttribute('aria-live', item.cls === 'meter' ? 'off' : 'polite');
    root.classList.toggle('held', item.held);
    root.classList.toggle('pending', item.pending);
    root.classList.toggle('landed', item.landed);
    if (fresh || item.cls !== 'meter') {
      root.hidden = false;
      fit();
    }
    if (fresh) {
      shownId = item.id;
      // A new item crossfades in: the animation restarts (one layout read per new item).
      root.classList.remove('in');
      void root.offsetWidth;
      root.classList.add('in');
    }
    root.classList.add('up');
  };
  const render = () => {
    const step = model.step(clock);
    if (step.changed) draw(step.item);
  };

  const asBark = (item: Readonly<ShownTickerItem>): ShownBark => ({
    contentRef: item.contentRef ?? '',
    speakerName: item.tag ?? '',
    text: item.text,
    startS: (item.tick ?? 0) / SIM_HZ,
    durationS: (item.endsAt - item.startedAt) / 1000,
    tick: item.tick ?? 0,
    raceId: item.raceId ?? '',
    ...(item.cls === 'line' ? { strip: 'line' as const } : {}),
  });

  const surface: BarkSurface = {
    show(bark) {
      if (options.quiet?.()) return;
      model.push(
        {
          cls: 'bark',
          tag: bark.speakerName,
          text: bark.text,
          contentRef: bark.contentRef,
          raceId: bark.raceId,
          tick: bark.tick,
          dwellMs: bark.durationS * 1000,
        },
        clock,
      );
    },
    hide() {
      model.clearClass('bark');
      render();
    },
    current() {
      const item = model.current();
      return item && item.contentRef ? asBark(item) : null;
    },
    element: () => root,
    hold(on) {
      model.hold(on, clock);
      render();
    },
    cut(ref) {
      model.cut(ref);
      render();
    },
  };

  return {
    root,
    model,
    surface,
    push(item) {
      if (options.quiet?.() && !item.landed) return;
      model.push(item, clock);
    },
    meter: (run) => model.meter(run, clock),
    update(realNowMs, paused) {
      if (lastReal >= 0 && !paused) clock += Math.min(Math.max(realNowMs - lastReal, 0), MAX_STEP_MS);
      lastReal = realNowMs;
      render();
    },
    setLook(look) {
      if (root.dataset['look'] !== look) root.dataset['look'] = look;
    },
    setStyleEnabled: (on) => model.setStyleEnabled(on),
    replace(items, hold = true) {
      model.clear();
      for (const item of items) model.push(item, clock);
      render();
      if (hold) {
        model.hold(true, clock);
        render();
      }
    },
    clear() {
      model.clear();
      render();
    },
    now: () => clock,
  };
}
