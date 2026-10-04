// The new moves' HUD (playtest 3, T6.3; the critic's C7). Two pieces, both read from
// `SimSnapshot.moves` and the player's `wheelie` angle:
//
// - The drift chain is the ticker's `meter` item ("DRIFT ×2 +$140"), not a second widget: a run
//   (`driftRun`) the live style meter's slot shows while the chain's unbanked cash is up, and a
//   wipeout empties it. The sim zeroes the cash without a paying event on a crash, a wobble or a
//   hit, so `createDriftMeter` hands back the value that vanished and ui/index.ts lands it on its
//   award when a `drift` pop arrives the same frame, or flashes DRIFT LOST when none does.
// - The wheelie gauge is the only new widget: a thin vertical bar beside the floating stick, the
//   sweet band green, over it red, the loop-out darker, the marker at the front's angle. It shows
//   only while a wheelie is up. `placeGauge` is the layout's settle rule for it (hud-layout.ts,
//   rule 6): it sits beside the stick's ring, on the side toward the middle, level with the thumb,
//   and moves off anything it would cover. The thumb can land anywhere in the stick zone, so the
//   rule is a pure search over where the gauge may stand, tiered: clear of every piece and the
//   road ahead; else clear of every piece; else at least clear of the touch buttons and the text
//   widgets. [default] throughout; the angles are the sim's (sim/riders/wheelie.ts WHEELIE_SWEET
//   and WHEELIE_LOOP_RAD), kept by hand because ui reaches the sim only through sim/api;
//   tests/sim/moves-meter-pins.test.ts holds them together.
import type { MovesSnapshot } from '../sim/api';
import { GAP, overlap, type Box, type TopPlan } from './hud-layout';
import type { MeterRun } from './race-feed';

// ---- The drift chain ---------------------------------------------------------------------------

/** The drift chain as the ticker's meter run, or null while no chain's cash is up. */
export function driftRun(moves: MovesSnapshot | null | undefined): MeterRun | null {
  if (!moves) return null;
  const cash = moves.driftCash;
  if (!Number.isFinite(cash) || cash <= 0) return null;
  return {
    kind: 'drift',
    seconds: Number.isFinite(moves.driftS) ? moves.driftS : 0,
    cash,
    qualifies: true,
    chain: moves.driftChain,
  };
}

/** One frame of the drift meter. */
export interface DriftStep {
  /** The chain to show (null for none). */
  shown: MeterRun | null;
  /** The last value shown of a chain whose cash just left the snapshot: banked, or emptied. */
  ended: MeterRun | null;
  /** A drift is under the rider this frame (not just a chain waiting for the next corner). */
  drifting: boolean;
  /** The snapshot carried moves at all: false between races, when a vanished chain is no wipeout. */
  raceLive: boolean;
}

export interface DriftMeter {
  update(moves: MovesSnapshot | null | undefined): DriftStep;
  reset(): void;
}

/**
 * The drift meter's memory. Unlike the oncoming and air runs, a chain has no clock that restarts:
 * between two chained drifts `driftS` falls back to 0 with the cash still up, and that is not an
 * end. The chain ends when its cash leaves the snapshot, and only then does `ended` come back.
 */
export function createDriftMeter(): DriftMeter {
  let last: MeterRun | null = null;
  return {
    update(moves) {
      const run = driftRun(moves);
      const ended = last && !run ? last : null;
      last = run;
      return {
        shown: run,
        ended,
        drifting: !!run && !!moves && moves.driftS > 0,
        raceLive: !!moves,
      };
    },
    reset() {
      last = null;
    },
  };
}

/**
 * What became of a chain whose cash just left the snapshot: `banked` when a `drift` pop arrived in
 * the same frame (the sim banks and scores in one step), `lost` when none did on a live race (a
 * wipeout emptied it), else `none` (nothing ended, or the race itself went away).
 */
export function driftOutcome(
  drift: DriftStep,
  pops: readonly { kind: string }[],
): 'none' | 'banked' | 'lost' {
  if (!drift.ended) return 'none';
  if (pops.some((p) => p.kind === 'drift')) return 'banked';
  return drift.raceLive ? 'lost' : 'none';
}

/**
 * The one run the ticker's meter line shows: a drift under the rider first, else a live oncoming
 * or air run, else the open chain waiting for its next corner.
 */
export function meterLine(drift: DriftStep, styleRun: MeterRun | null): MeterRun | null {
  return drift.drifting ? drift.shown : (styleRun ?? drift.shown);
}

/** The ticker chip a wipeout leaves where the drift chain was (it empties visibly). */
export const DRIFT_LOST = { kind: 'driftLost', text: 'DRIFT LOST' } as const;

// ---- The wheelie gauge -------------------------------------------------------------------------

const SWEET_LO_RAD = 0.35;
const SWEET_HI_RAD = 0.85;
const LOOP_RAD = 1.2;
/** The bar's top, radians: a little past the loop-out, so the marker has room to show it. */
const MAX_RAD = 1.3;

/** The gauge's numbers: the bar, its bands (radians, the sim's) and where it stands (CSS px). */
export const GAUGE = {
  maxRad: MAX_RAD,
  /** The sim's sweet band and loop-out angle. */
  sweetLoRad: SWEET_LO_RAD,
  sweetHiRad: SWEET_HI_RAD,
  loopRad: LOOP_RAD,
  /** The painted bar. */
  w: 12,
  h: 88,
  /** The floating stick's ring radius (ui/index.ts STICK_RING_PX) and the air between ring and gauge. */
  ringPx: 60,
  gap: 8,
  /** How far the bar reaches above the thumb's base: the thumb's travel is the throttle. */
  riseAbove: 64,
  /** The screen edge the gauge keeps off. */
  edge: 8,
  /** The bands as fractions of the bar, from the bottom. */
  stops: {
    sweetFrom: SWEET_LO_RAD / MAX_RAD,
    sweetTo: SWEET_HI_RAD / MAX_RAD,
    loopFrom: LOOP_RAD / MAX_RAD,
  },
} as const;

export type WheelieBand = NonNullable<MovesSnapshot['wheelieBand']>;

export interface GaugeView {
  show: boolean;
  band: WheelieBand | null;
  /** The marker's height on the bar, 0 (bottom) to 1. */
  marker: number;
}

/** What the gauge shows this frame, from `snapshot.moves` and the player's `wheelie` angle (radians). */
export function gaugeView(moves: MovesSnapshot | null | undefined, theta: number | undefined): GaugeView {
  const band = moves?.wheelieBand ?? null;
  if (!band) return { show: false, band: null, marker: 0 };
  const t = typeof theta === 'number' && Number.isFinite(theta) ? theta : 0;
  return { show: true, band, marker: Math.min(1, Math.max(0, t / GAUGE.maxRad)) };
}

// ---- Placing the gauge (rule 6, the settle rule) ------------------------------------------------

/** What the gauge must stay off: every other piece (`all`), and of those the ones it must never cover (`hard`). */
export interface GaugeBlockers {
  all: readonly Box[];
  hard: readonly Box[];
}

/**
 * The boxes the gauge keeps off, from the top plan's reserved slots (shown or not, so nothing jumps
 * when a rival or a heat badge comes up), the touch buttons and the settled text widgets.
 */
export function gaugeBlockers(parts: {
  plan: TopPlan;
  position: Box | null;
  target: Box | null;
  buttons: readonly Box[];
  text: readonly Box[];
}): GaugeBlockers {
  const { plan, position, target, buttons, text } = parts;
  const hard = [...buttons, ...text];
  const top = [
    position,
    plan.target ?? target,
    plan.pause,
    plan.ticker,
    plan.toast,
    plan.objective,
    plan.heat,
  ];
  return { all: [...top.filter((b): b is Box => b !== null), ...hard], hard };
}

export interface GaugeInput {
  w: number;
  h: number;
  /** Where the stick's ring is centred (or would be), CSS px. */
  base: { x: number; y: number };
  /** The left-handed mirror: the stick is on the right, so its inner side is the left. */
  mirror: boolean;
  blockers: GaugeBlockers;
  /** The road ahead (hud-layout.ts `lookAheadBox`). */
  look: Box;
  ringPx?: number;
}

export interface GaugeSpot {
  box: Box;
  /** `all`: clear of every piece and the road ahead; `pieces`: of every piece; `hard`: of the buttons and text only. */
  tier: 'all' | 'pieces' | 'hard';
}

const STEP_Y = 4;
const STEP_X = 8;
const MAX_X_STEPS = 10;
/** What a step off the nearest spot costs, against sliding along the bar's own axis. */
const OUTER_SIDE_COST = 40;
const FAR_STEP_COST = 2;

/**
 * Where the gauge stands for a stick at `base`: beside the ring on the side toward the middle, level
 * with the thumb's travel, else the other side, else slid up or down or a little farther out, the
 * cheapest spot that is clear (see the header for the tiers). Null only when no spot on the screen
 * is clear of even the touch buttons and the text widgets. Pure.
 */
export function placeGauge(input: GaugeInput): GaugeSpot | null {
  const { w, h, base, mirror, blockers, look } = input;
  const ring = input.ringPx ?? GAUGE.ringPx;
  const inner = mirror ? -1 : 1;
  const nominalTop = Math.min(Math.max(base.y - GAUGE.riseAbove, GAUGE.edge), h - GAUGE.edge - GAUGE.h);
  const tiers: { tier: GaugeSpot['tier']; against: readonly Box[]; lookToo: boolean }[] = [
    { tier: 'all', against: blockers.all, lookToo: true },
    { tier: 'pieces', against: blockers.all, lookToo: false },
    { tier: 'hard', against: blockers.hard, lookToo: false },
  ];
  const maxTop = h - GAUGE.edge - GAUGE.h;
  if (maxTop < GAUGE.edge) return null;
  const tops: number[] = [nominalTop];
  for (let y = GAUGE.edge; y <= maxTop; y += STEP_Y) tops.push(y);
  tops.push(maxTop);
  for (const { tier, against, lookToo } of tiers) {
    let best: { box: Box; cost: number } | null = null;
    for (const side of [inner, -inner]) {
      for (let k = 0; k <= MAX_X_STEPS; k++) {
        const reach = ring + GAUGE.gap + k * STEP_X;
        const left = side === 1 ? base.x + reach : base.x - reach - GAUGE.w;
        if (left < GAUGE.edge || left + GAUGE.w > w - GAUGE.edge) continue;
        for (const top of tops) {
          const cost =
            Math.abs(top - nominalTop) + (side === inner ? 0 : OUTER_SIDE_COST) + k * FAR_STEP_COST;
          if (best && cost >= best.cost) continue;
          const box: Box = { left, top, right: left + GAUGE.w, bottom: top + GAUGE.h };
          if (lookToo && overlap(box, look)) continue;
          if (against.some((b) => overlap(box, b, GAP))) continue;
          best = { box, cost };
        }
      }
    }
    if (best) return { box: best.box, tier };
  }
  return null;
}

/**
 * Where a thumb lands when none is down, so the gauge has a place for a keyboard or gamepad rider
 * and the layout check has one to measure: a third of the way into the stick zone, a little under
 * its middle. The zone is the layout record's `touch-stick-zone` box.
 */
export function restBase(zone: Box, mirror: boolean): { x: number; y: number } {
  const width = zone.right - zone.left;
  return {
    x: mirror ? zone.right - 0.3 * width : zone.left + 0.3 * width,
    y: zone.top + 0.7 * (zone.bottom - zone.top),
  };
}

// ---- The gauge's DOM ---------------------------------------------------------------------------

const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;

/** The gauge's and the drift line's styles: appended to the HUD's CSS. */
export const MOVES_METER_CSS = `
#hud-wheelie { position: absolute; left: 0; top: 0; width: ${GAUGE.w}px; height: ${GAUGE.h}px; pointer-events: none;
  opacity: 0.92; transition: opacity 120ms ease-out; }
#hud-wheelie .gauge-bar { position: absolute; inset: 0; box-sizing: border-box; border: 2px solid #111; border-radius: 6px;
  background: linear-gradient(to top, #c9962f 0 ${pct(GAUGE.stops.sweetFrom)}, #3fbf5f ${pct(GAUGE.stops.sweetFrom)} ${pct(GAUGE.stops.sweetTo)},
    #e0543a ${pct(GAUGE.stops.sweetTo)} ${pct(GAUGE.stops.loopFrom)}, #7a1d12 ${pct(GAUGE.stops.loopFrom)} 100%);
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
