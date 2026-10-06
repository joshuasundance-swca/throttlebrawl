// The wheelie gauge's DOM and the moves' HUD styles (playtest 3, T6.3; moves-meter.ts holds the
// rules: where the gauge stands and what it shows). A lazy chunk off the first-load JavaScript,
// fetched as the UI starts: the gauge only shows mid-race, while a wheelie is up.
import type { Box } from './hud-layout';
import type { GAUGE, GaugeView } from './moves-meter';

const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;

/** The bar's four zones, bottom to top: too low, the sweet band, too high, and the loop-out. */
export const GAUGE_ZONE_ORDER = ['low', 'sweet', 'high', 'loop'] as const;
export type GaugeZone = (typeof GAUGE_ZONE_ORDER)[number];
/** Their colours. Green beside amber, and beside red, is what colour-blind players mix up. */
export const GAUGE_ZONES: Readonly<Record<GaugeZone, string>> = {
  low: '#c9962f',
  sweet: '#3fbf5f',
  high: '#e0543a',
  loop: '#7a1d12',
};

/**
 * The shapes the bar draws over its colours (M5's a11y-1, the shape and colour check): a dark tick
 * on each boundary, the sweet band bracketed wider than the bar, and the loop-out zone hatched. All
 * fractions of the bar, from the bottom. shape-colour.test.ts holds the colours to them.
 */
export function gaugeCues(stops: { sweetFrom: number; sweetTo: number; loopFrom: number }) {
  return {
    ticks: [
      { between: 'low|sweet', at: stops.sweetFrom },
      { between: 'sweet|high', at: stops.sweetTo },
      { between: 'high|loop', at: stops.loopFrom },
    ],
    bracket: { from: stops.sweetFrom, to: stops.sweetTo },
    hatch: { from: stops.loopFrom, to: 1 },
  };
}

/**
 * The gauge's and the drift line's styles, appended to the HUD's CSS. ui/index.ts hands in GAUGE
 * (moves-meter.ts, which loads at boot), so this chunk imports nothing from it at run time.
 */
export const movesMeterCss = (gauge: typeof GAUGE): string => {
  const cues = gaugeCues(gauge.stops);
  const z = GAUGE_ZONES;
  // A 2 px dark line across the bar at each boundary, then the hatch over the loop-out zone, then the colours.
  const ticks = cues.ticks
    .map(
      (t) =>
        `linear-gradient(to top, transparent calc(${pct(t.at)} - 1px), #111 calc(${pct(t.at)} - 1px), #111 calc(${pct(t.at)} + 1px), transparent calc(${pct(t.at)} + 1px))`,
    )
    .join(',\n    ');
  return `
#hud-wheelie { position: absolute; left: 0; top: 0; width: ${gauge.w}px; height: ${gauge.h}px; pointer-events: none;
  opacity: 0.92; transition: opacity 120ms ease-out; }
#hud-wheelie .gauge-bar { position: absolute; inset: 0; box-sizing: border-box; border: 2px solid #111; border-radius: 6px;
  background:
    ${ticks},
    repeating-linear-gradient(135deg, #0007 0 2px, transparent 2px 5px) 0 0 / 100% ${pct(1 - cues.hatch.from)} no-repeat,
    linear-gradient(to top, ${z.low} 0 ${pct(gauge.stops.sweetFrom)}, ${z.sweet} ${pct(gauge.stops.sweetFrom)} ${pct(gauge.stops.sweetTo)},
    ${z.high} ${pct(gauge.stops.sweetTo)} ${pct(gauge.stops.loopFrom)}, ${z.loop} ${pct(gauge.stops.loopFrom)} 100%);
  box-shadow: 0 0 0 1px #fff8; }
#hud-wheelie .gauge-bar::before { content: ''; position: absolute; left: -4px; right: -4px; box-sizing: border-box;
  bottom: ${pct(cues.bracket.from)}; height: ${pct(cues.bracket.to - cues.bracket.from)};
  border: solid #fff; border-width: 0 3px; }
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
};

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
