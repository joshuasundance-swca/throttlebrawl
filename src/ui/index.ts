// ui: DOM screens over the canvas (docs/architecture.md, "Rendering": DOM UI is not drawn in
// WebGL). The skeleton has the start screen, a menu with Race, a HUD with speed and position,
// results with the placing, the build stamp and the touch-control visuals. ui-1 owns this folder
// after app-1 (except ui/tuning and ui/narrative): pause, settings, rotate screen, HUD presets.
import { placeElement, type EntitySnapshot, type OnCopyReport, type TouchLayout } from '../sim/api';
import type { TuningRegistry } from '../tuning';
import { createNarrative, type Narrative } from './narrative';
import { createTuningPanel, type TuningPanel } from './tuning';

export type Screen = 'start' | 'menu' | 'race' | 'results';

export interface UiCallbacks {
  /** The start tap. Called inside the pointer event, so platform calls keep user activation. */
  onStartTap(): void;
  onRace(): void;
  onBackToMenu(): void;
  onCopyReport: OnCopyReport;
}

export interface RaceResult {
  place: number;
  of: number;
  prizeCash: number;
  eventName: string;
}

export interface GameUi {
  show(screen: Screen): void;
  updateHud(player: EntitySnapshot | null, riders: number, units: 'mph' | 'kmh'): void;
  showResults(result: RaceResult): void;
  /** The full-screen surface input/ listens on for touches. */
  readonly touchSurface: HTMLElement;
  setLayout(layout: TouchLayout): void;
  notice(text: string): void;
  readonly tuningPanel: TuningPanel;
  readonly narrative: Narrative;
}

export interface UiOptions {
  stampText: string;
  layout: TouchLayout;
  tuning: TuningRegistry;
  callbacks: UiCallbacks;
}

const CSS = `
#ui { position: fixed; inset: 0; pointer-events: none; font: 600 16px/1.3 system-ui, sans-serif; color: #fff; }
#ui button { pointer-events: auto; font: inherit; }
#ui .screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 12px; text-align: center; background: rgb(20 10 40 / 45%); }
#ui .screen[hidden], #ui [hidden] { display: none; }
#ui .title { font-size: 34px; font-weight: 800; letter-spacing: 0.04em; text-shadow: 0 2px 0 #000; }
#ui .big { font-size: 22px; padding: 14px 34px; border: 3px solid #fff; border-radius: 10px;
  background: #e0543a; color: #fff; cursor: pointer; }
#ui .small { font-size: 13px; padding: 6px 12px; border: 1px solid #fff8; border-radius: 6px;
  background: #0006; color: #fff; cursor: pointer; }
#ui .card { max-width: 440px; font-size: 13px; font-weight: 500; background: #0008; padding: 8px 12px; border-radius: 8px; }
#start-screen { pointer-events: auto; cursor: pointer; }
#hud-speed, #hud-position { position: absolute; padding: 4px 10px; background: #0007; border-radius: 6px; }
#hud-speed { left: max(12px, env(safe-area-inset-left)); bottom: 12px; font-size: 22px; }
#hud-position { left: max(12px, env(safe-area-inset-left)); top: 10px; font-size: 22px; }
#touch-surface { position: absolute; inset: 0; touch-action: none; }
#touch-surface[hidden] { display: none; }
.touch-button { position: absolute; border: 3px solid #fff; border-radius: 50%; background: #0004;
  display: flex; align-items: center; justify-content: center; font-size: 13px; pointer-events: none; }
#tuning-panel { position: absolute; right: 10px; top: 10px; width: 260px; padding: 8px 10px; pointer-events: auto;
  background: rgb(0 0 0 / 60%); border-radius: 8px; font-size: 13px; }
#tuning-panel .tuning-row { display: grid; grid-template-columns: 1fr 1.4fr auto; gap: 6px; align-items: center; }
#build-stamp.in-race { display: none; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

export function createUi(host: HTMLElement, opts: UiOptions): GameUi {
  const style = el('style', { textContent: CSS });
  document.head.append(style);
  const root = el('div', { id: 'ui' });

  const stamp = el('div', { id: 'build-stamp', textContent: opts.stampText });

  const start = el(
    'div',
    { id: 'start-screen', className: 'screen' },
    el('div', { className: 'title', textContent: 'throttlebrawl' }),
    el('div', { className: 'big', textContent: 'Tap to start' }),
    el('div', {
      className: 'card',
      textContent:
        'Keys: W or Up to ride, S or Down to brake, A and D to steer, J to attack. ' +
        'Touch: drag up with your left thumb to ride, sideways to steer, lift to coast.',
    }),
  );
  start.addEventListener('click', () => opts.callbacks.onStartTap());

  const raceButton = el('button', { id: 'menu-race', className: 'big', textContent: 'Race' });
  raceButton.addEventListener('click', () => opts.callbacks.onRace());
  const copyButton = el('button', {
    id: 'menu-copy-report',
    className: 'small',
    textContent: 'Copy debug report',
  });
  copyButton.addEventListener('click', () => {
    void opts.callbacks.onCopyReport();
  });
  const menu = el(
    'div',
    { id: 'menu', className: 'screen', hidden: true },
    el('div', { className: 'title', textContent: 'throttlebrawl' }),
    raceButton,
    copyButton,
  );

  const speed = el('div', { id: 'hud-speed' });
  const position = el('div', { id: 'hud-position' });
  const hud = el('div', { id: 'hud', hidden: true }, speed, position);

  const resultPlace = el('div', { id: 'results-place', className: 'title' });
  const resultPrize = el('div', { id: 'results-prize', className: 'card' });
  const backButton = el('button', { id: 'results-menu', className: 'big', textContent: 'Back to menu' });
  backButton.addEventListener('click', () => opts.callbacks.onBackToMenu());
  const results = el(
    'div',
    { id: 'results', className: 'screen', hidden: true },
    resultPlace,
    resultPrize,
    backButton,
  );

  const touchSurface = el('div', { id: 'touch-surface', hidden: true });
  const touchButtons: HTMLElement[] = [];
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let layout = opts.layout;
  const drawTouch = () => {
    for (const b of touchButtons.splice(0)) b.remove();
    if (!coarse) return;
    const w = touchSurface.clientWidth || window.innerWidth;
    const h = touchSurface.clientHeight || window.innerHeight;
    for (const e of layout.elements) {
      if (!e.visible || !e.element.startsWith('touch-') || e.element === 'touch-stick-zone') continue;
      const r = placeElement(e, w, h, layout.mirror);
      const b = el('div', {
        className: 'touch-button',
        textContent: e.element === 'touch-attack' ? 'HIT' : 'BRAKE',
      });
      Object.assign(b.style, {
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.w}px`,
        height: `${r.h}px`,
        opacity: String(e.opacity),
      });
      touchSurface.append(b);
      touchButtons.push(b);
    }
  };
  window.addEventListener('resize', drawTouch);

  const noticeBox = el('div', { className: 'card', hidden: true });
  Object.assign(noticeBox.style, {
    position: 'absolute',
    top: '10px',
    left: '50%',
    transform: 'translateX(-50%)',
  });

  root.append(touchSurface, hud, start, menu, results, noticeBox);
  host.append(root, stamp);
  const tuningPanel = createTuningPanel(root, opts.tuning);
  const narrative = createNarrative();

  const screens: Record<Screen, HTMLElement[]> = {
    start: [start],
    menu: [menu],
    race: [hud, touchSurface],
    results: [results],
  };

  return {
    show(screen) {
      for (const [name, els] of Object.entries(screens)) for (const e of els) e.hidden = name !== screen;
      stamp.classList.toggle('in-race', screen === 'race');
      if (screen === 'race') drawTouch();
    },
    updateHud(player, riders, units) {
      if (!player) return;
      const v = units === 'mph' ? player.speed * 2.2369363 : player.speed * 3.6;
      speed.textContent = `${Math.round(v)} ${units === 'mph' ? 'mph' : 'km/h'}`;
      position.textContent = `${ordinal(player.place)} / ${riders}`;
    },
    showResults(r) {
      resultPlace.textContent = `${ordinal(r.place)} of ${r.of}`;
      resultPrize.textContent = `${r.eventName}. Prize: $${r.prizeCash.toLocaleString('en-US')}. Nobody is paying it yet.`;
    },
    touchSurface,
    setLayout(l) {
      layout = l;
      drawTouch();
    },
    notice(text) {
      noticeBox.textContent = text;
      noticeBox.hidden = false;
      setTimeout(() => (noticeBox.hidden = true), 4000);
    },
    tuningPanel,
    narrative,
  };
}
