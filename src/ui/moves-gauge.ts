// The wheelie gauge's DOM and the moves' HUD styles (playtest 3, T6.3; moves-meter.ts holds the
// rules: where the gauge stands and what it shows). A lazy chunk off the first-load JavaScript,
// fetched as the UI starts: the gauge only shows mid-race, while a wheelie is up.
import type { Box } from './hud-layout';
import type { GAUGE, GaugeView } from './moves-meter';

const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;

/**
 * The gauge's and the drift line's styles, appended to the HUD's CSS. ui/index.ts hands in GAUGE
 * (moves-meter.ts, which loads at boot), so this chunk imports nothing from it at run time.
 */
export const movesMeterCss = (gauge: typeof GAUGE): string => `
#hud-wheelie { position: absolute; left: 0; top: 0; width: ${gauge.w}px; height: ${gauge.h}px; pointer-events: none;
  opacity: 0.92; transition: opacity 120ms ease-out; }
#hud-wheelie .gauge-bar { position: absolute; inset: 0; box-sizing: border-box; border: 2px solid #111; border-radius: 6px;
  background: linear-gradient(to top, #c9962f 0 ${pct(gauge.stops.sweetFrom)}, #3fbf5f ${pct(gauge.stops.sweetFrom)} ${pct(gauge.stops.sweetTo)},
    #e0543a ${pct(gauge.stops.sweetTo)} ${pct(gauge.stops.loopFrom)}, #7a1d12 ${pct(gauge.stops.loopFrom)} 100%);
  box-shadow: 0 0 0 1px #fff8; }
#hud-wheelie .gauge-mark { position: absolute; left: -4px; right: -4px; height: 5px; box-sizing: border-box;
  bottom: var(--gauge-mark, 0%); margin-bottom: -2.5px; border: 1px solid #111; border-radius: 2px; background: #fff; }
#hud-wheelie[data-band='high'] .gauge-mark { background: #ffd2c8; }
#hud-ticker[data-kind='driftLost'] .ticker-text { color: var(--tk-tag-bg); text-decoration: line-through; }
#hud-ticker[data-cls='meter'][data-kind='drift'] .ticker-text { color: var(--tk-accent); }
@media (prefers-reduced-motion: reduce) { #hud-wheelie { transition: none; } }
/* The career prompt steps aside while the gauge is up, as it does for the landing line: a wheelie
   lasts seconds and the prompt comes back after. On a short phone held sideways (568x320) and a phone
   held upright, the prompt's band runs past the thumb, and no spot beside the stick is clear of it,
   the touch buttons and the road ahead at once. [default] */
body:has(#hud-wheelie:not([hidden])) #career-prompt { visibility: hidden; }
`;

export interface WheelieGauge {
  readonly root: HTMLElement;
  /** Stands the gauge in this box (or leaves it where it was for null); the box is in HUD pixels. */
  place(box: Box | null): void;
  /** Shows or hides it and moves the marker, touching the DOM only when something changed. */
  update(view: GaugeView): void;
}

export function createWheelieGauge(): WheelieGauge {
  const bar = document.createElement('div');
  bar.className = 'gauge-bar';
  const mark = document.createElement('div');
  mark.className = 'gauge-mark';
  const root = document.createElement('div');
  root.id = 'hud-wheelie';
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  root.append(bar, mark);
  let box: Box | null = null;
  let markPct = '';
  return {
    root,
    place(next) {
      if (!next) return;
      if (box && box.left === next.left && box.top === next.top) return;
      box = next;
      root.style.left = `${next.left}px`;
      root.style.top = `${next.top}px`;
    },
    update(view) {
      if (root.hidden === view.show) root.hidden = !view.show;
      if (!view.show) return;
      const band = view.band ?? '';
      if (root.dataset['band'] !== band) root.dataset['band'] = band;
      const next = pct(view.marker);
      if (next !== markPct) {
        markPct = next;
        root.style.setProperty('--gauge-mark', next);
      }
    },
  };
}
