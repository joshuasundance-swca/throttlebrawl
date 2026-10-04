// The HUD's top layout (playtest 3, the maintainer: "The race objective sits over the heat meter. The
// black and white text pop-ups block the actual game."; interview round 1 [decided]: "Top ticker
// strip", the objective must stop sitting over the heat meter). One pure function settles where the
// movable top pieces go, from the screen's size and where the layout record puts the position
// badge and the rival's bar, so no two pieces overlap and nothing reaches into the road ahead:
//
//   Row A, the top band (a 44 px slot): the position badge, the pause button, the rival's bar and
//   the ticker. The rival's bar slot is reserved even while the bar is hidden, so nothing jumps
//   when a rival comes up (rule 1).
//   Inline mode: where the widest gap in row A is 260 px or more, the ticker sits in it (rule 2).
//   Stacked mode: otherwise the ticker takes its own row under row A (rule 3).
//   A rival's bar that would overlap the position badge or the pause button leaves row A and tops
//   the column under it (rule 4).
//   Row C, under that: the objective (at most two lines, three in the far column's narrow width) and the heat badge. Their slots are
//   reserved while hidden too (rule 5).
//   Settle: a text widget that overlaps a touch button moves up off its anchored edge until it is
//   6 px clear (rule 6, `settleLifts`).
//
// The slow-frames offer (the toast; app/ takes it into the ticker as a line in a later task) has its
// own reserved slot: in inline mode the near column under the position badge (so it never meets the
// objective or the heat badge in the far column), in stacked mode the ticker's slot (the strip
// steps aside while it is up). docs/product-spec.md ("Nothing covers the road ahead") and
// docs/architecture.md ("One top ticker") say why. Sizes are upper bounds of what the widgets
// paint, so a widget inside its slot never overlaps another slot. [default]
//
// The slot rules follow the design spec for this task, with two changes the browser layout check
// (tests/e2e/ui-style-popups.spec.ts) forced: row C goes to the column on the pause button's side
// in inline mode (the objective needs the width, and the left of the road ahead holds the toast),
// and no slot reaches the road ahead (the middle half across, 25-65 % down).
import { placeElement, type LayoutElement } from '../sim/api';

/** A screen box in CSS pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The road ahead, as fractions of the screen: the middle half across, 25-65 % down. The browser check holds the same box. */
export const LOOK_AHEAD = { left: 0.25, right: 0.75, top: 0.25, bottom: 0.65 } as const;

/** Upper bounds of the painted widgets, CSS px (the browser spec measures the real ones). */
export const HUD_SIZE = {
  /** The position badge ("10th / 12" at 22 px) and the speed readout. */
  position: [150, 40],
  speed: [150, 40],
  /** Health bars: 130 px of bar and 10 px of padding each side. */
  health: [150, 38],
  pause: [48, 44],
  /** The heat badge at its widest label (ROADBLOCK). */
  heat: [160, 38],
} as const;
/** The ticker's slot height (one line at 15 px, or two at 12 px). */
export const TICKER_H = 44;
/** The slow-frames offer in the ticker's slot: one line of words over one row of buttons. */
export const TOAST_STACK_H = 76;
/** The same offer in the near column: words, then each button on its own row. */
export const TOAST_COLUMN_H = 150;
/** The objective's lines: 12 px type on a 16 px line, with 2 px of padding above and below. */
export const OBJECTIVE_LINE_H = 16;
/** Its height for a number of lines. */
export const objectiveHeight = (lines: number) => lines * OBJECTIVE_LINE_H + 4;
/** Two lines where it has the row (stacked); three in the far column's narrower width (inline). */
export const OBJECTIVE_LINES: Record<'inline' | 'stacked', number> = { inline: 3, stacked: 2 };
/** The air between pieces. */
export const GAP = 6;
/** Where the ticker goes inline: the widest row A gap, at least this wide. */
export const INLINE_MIN_GAP = 260;
/** On a screen too short for the stacked row, the ticker squeezes into a gap at least this wide. */
export const SQUEEZE_MIN_GAP = 150;
/** The ticker's widest slot. */
export const TICKER_MAX_W = 560;
/** The objective's widest slot. */
export const OBJECTIVE_MAX_W = 420;

export interface Safe {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TopInput {
  /** The screen, CSS px. */
  w: number;
  h: number;
  safe: Safe;
  /** The left-handed mirror: the pause button is on the left and the position badge on the right. */
  mirror: boolean;
  /** The position badge as the layout record places it, or null when it is not in row A. */
  position: Box | null;
  /** The rival's bar as the layout record places it (its slot, shown or not), or null. */
  target: Box | null;
}

export type TopMode = 'inline' | 'stacked';

export interface TopPlan {
  mode: TopMode;
  /** The ticker's slot; the strip is centred in it. */
  ticker: Box;
  /** The slow-frames offer's slot. */
  toast: Box;
  /** Whether the offer is centred in its slot (stacked) or fills it from the near edge (column). */
  toastCentred: boolean;
  objective: Box;
  /** The most lines the objective shows (the rest is cut with an ellipsis). */
  objectiveLines: number;
  heat: Box;
  /** Which side of its slot the objective and the heat badge hug. */
  objectiveSide: 'left' | 'right';
  heatSide: 'left' | 'right';
  /** The rival's bar where it moves to (rule 4), or null while it stays where the record puts it. */
  target: Box | null;
  /** The pause button, as placed. */
  pause: Box;
}

const box = (left: number, top: number, w: number, h: number): Box => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});
const width = (b: Box) => b.right - b.left;

/** Whether two boxes overlap, with `air` px kept clear between them (0.5 px of slack, as the browser check has). */
export function overlap(a: Box, b: Box, air = 0): boolean {
  return (
    a.left < b.right + air - 0.5 &&
    b.left < a.right + air - 0.5 &&
    a.top < b.bottom + air - 0.5 &&
    b.top < a.bottom + air - 0.5
  );
}

export function lookAheadBox(w: number, h: number): Box {
  return {
    left: LOOK_AHEAD.left * w,
    right: LOOK_AHEAD.right * w,
    top: LOOK_AHEAD.top * h,
    bottom: LOOK_AHEAD.bottom * h,
  };
}

/** The pause button: 8 px from the top, in the corner away from the position badge. */
export function pauseBox(w: number, safe: Safe, mirror: boolean): Box {
  const [pw, ph] = HUD_SIZE.pause;
  return mirror ? box(Math.max(8, safe.left), 8, pw, ph) : box(w - Math.max(8, safe.right) - pw, 8, pw, ph);
}

/**
 * A text widget as the layout record places it, as a box: its element, the screen, and its slot
 * size (an upper bound of what it paints, CSS px). Uses core's placement, so the box is exactly
 * where `hudStyle` puts the widget.
 */
export function placedBox(
  el: LayoutElement,
  w: number,
  h: number,
  mirror: boolean,
  size: readonly [number, number],
): Box {
  const unit = Math.min(w, h);
  const sized: LayoutElement = { ...el, size: [(size[0] * el.scale) / unit, (size[1] * el.scale) / unit] };
  const r = placeElement(sized, w, h, mirror);
  return box(r.x, r.y, r.w, r.h);
}

/** The widest gap between row A's pieces inside [16, w - 16], as [from, to]. */
function widestGap(w: number, items: readonly Box[]): [number, number] {
  let best: [number, number] = [16, 16];
  let cursor = 16;
  for (const b of [...items].sort((p, q) => p.left - q.left)) {
    if (b.left - cursor > best[1] - best[0]) best = [cursor, b.left];
    cursor = Math.max(cursor, b.right);
  }
  if (w - 16 - cursor > best[1] - best[0]) best = [cursor, w - 16];
  return best;
}

/** Settles the top pieces (see the header). Pure: the same input always gives the same plan. */
export function layoutTop(input: TopInput): TopPlan {
  const { w, h, safe, mirror, position, target } = input;
  const top = Math.max(8, safe.top);
  const marginL = Math.max(8, safe.left);
  const marginR = Math.max(8, safe.right);
  const pause = pauseBox(w, safe, mirror);
  const look = lookAheadBox(w, h);
  // Rule 4: the rival's bar leaves row A where it would sit on the position badge or the pause button.
  const displaced =
    target !== null && ((position !== null && overlap(target, position)) || overlap(target, pause));
  const inRowA: Box[] = [pause];
  if (position) inRowA.push(position);
  if (target && !displaced) inRowA.push(target);
  const rowABottom = Math.max(top + TICKER_H, ...inRowA.map((b) => b.bottom));
  const [gapFrom, gapTo] = widestGap(w, inRowA);
  const gap = gapTo - gapFrom;

  // Rules 2 and 3 (and the squeeze: on a screen too short for the stacked row to stay above the road
  // ahead, the ticker takes the widest gap even when it is narrow, and wraps to two lines).
  const stackedTop = rowABottom + GAP;
  let mode: TopMode = gap >= INLINE_MIN_GAP ? 'inline' : 'stacked';
  if (mode === 'stacked' && gap >= SQUEEZE_MIN_GAP && stackedTop + TOAST_STACK_H > look.top) mode = 'inline';
  let ticker: Box;
  if (mode === 'inline') {
    const slotW = Math.min(TICKER_MAX_W, gap - 16);
    ticker = box((gapFrom + gapTo) / 2 - slotW / 2, top, slotW, TICKER_H);
  } else {
    const slotW = Math.min(TICKER_MAX_W, w - 32);
    ticker = box((w - slotW) / 2, stackedTop, slotW, TICKER_H);
  }

  const farRight = !mirror;
  const sideOfFar: 'left' | 'right' = farRight ? 'right' : 'left';
  const sideOfNear: 'left' | 'right' = farRight ? 'left' : 'right';
  const heatW = HUD_SIZE.heat[0];
  const heatH = HUD_SIZE.heat[1];
  const targetH = HUD_SIZE.health[1];
  const targetW = HUD_SIZE.health[0];
  let toast: Box;
  let toastCentred = false;
  const objectiveLines = OBJECTIVE_LINES[mode];
  const objH = objectiveHeight(objectiveLines);
  let objective: Box;
  let heat: Box;
  let moved: Box | null = null;

  if (mode === 'inline') {
    const y0 = rowABottom + GAP;
    // The near column (the position badge's side, up to the road ahead): the slow-frames offer.
    const nearLeft = farRight ? (position ? position.left : marginL) : Math.ceil(look.right) + 1;
    const nearRight = farRight ? Math.floor(look.left) - 1 : position ? position.right : w - marginR;
    toast = box(nearLeft, y0, Math.max(0, nearRight - nearLeft), TOAST_COLUMN_H);
    // The far column (the pause button's side, past the road ahead): the displaced rival's bar,
    // the objective, then the heat badge.
    const colLeft = farRight ? Math.ceil(look.right) + 1 : marginL;
    const colRight = farRight ? w - marginR : Math.floor(look.left) - 1;
    const colW = Math.max(0, colRight - colLeft);
    let y = y0;
    if (displaced) {
      moved = farRight ? box(colRight - targetW, y, targetW, targetH) : box(colLeft, y, targetW, targetH);
      y += targetH + GAP;
    }
    const oW = Math.min(OBJECTIVE_MAX_W, colW);
    objective = farRight ? box(colRight - oW, y, oW, objH) : box(colLeft, y, oW, objH);
    y += objH + GAP;
    const hW = Math.min(heatW, colW);
    heat = farRight ? box(colRight - hW, y, hW, heatH) : box(colLeft, y, hW, heatH);
  } else {
    // The offer takes the ticker's slot; row C starts under it.
    toast = box(ticker.left, ticker.top, width(ticker), TOAST_STACK_H);
    toastCentred = true;
    const y0 = stackedTop + TOAST_STACK_H + GAP;
    const farLeft = farRight ? w - marginR - heatW : marginL;
    if (displaced) {
      moved = farRight
        ? box(w - marginR - targetW, y0, targetW, targetH)
        : box(marginL, y0, targetW, targetH);
    }
    heat = box(farLeft, displaced ? y0 + targetH + GAP : y0, heatW, heatH);
    // The objective takes the rest of the row on the near side.
    const oW = Math.max(120, Math.min(OBJECTIVE_MAX_W, w - marginL - marginR - heatW - 8));
    objective = farRight ? box(marginL, y0, oW, objH) : box(w - marginR - oW, y0, oW, objH);
  }
  return {
    mode,
    ticker,
    toast,
    toastCentred,
    objective,
    objectiveLines,
    heat,
    objectiveSide: mode === 'inline' ? sideOfFar : sideOfNear,
    heatSide: sideOfFar,
    target: moved,
    pause,
  };
}

/**
 * Rule 6: a text widget that overlaps a touch button (or an earlier widget in the list) moves up,
 * off its bottom edge, until it is 6 px clear. Returns the lift each widget needs, in CSS px, by
 * name; widgets are settled in the order given (the one lowest on the screen first).
 */
export function settleLifts(
  texts: readonly { name: string; box: Box }[],
  blockers: readonly Box[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const settled: Box[] = [];
  for (const t of texts) {
    let lift = 0;
    for (let pass = 0; pass < 8; pass++) {
      const now = { ...t.box, top: t.box.top - lift, bottom: t.box.bottom - lift };
      const hit = [...blockers, ...settled].find((b) => overlap(now, b, GAP));
      if (!hit) break;
      lift += now.bottom - (hit.top - GAP);
    }
    out[t.name] = Math.ceil(lift);
    settled.push({ ...t.box, top: t.box.top - lift, bottom: t.box.bottom - lift });
  }
  return out;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/**
 * The plan as CSS custom properties on the UI root. The ticker, the offer, the objective and the heat
 * badge read them (ticker-view.ts, index.ts, career-screen.ts, heat-badge.ts), each with a fallback
 * position of its own for a screen no plan has settled. Pure.
 */
export function planVars(plan: TopPlan, w: number): Record<string, string> {
  const side = (b: Box, s: 'left' | 'right') =>
    s === 'right' ? { l: 'auto', r: px(w - b.right) } : { l: px(b.left), r: 'auto' };
  const o = side(plan.objective, plan.objectiveSide);
  const hd = side(plan.heat, plan.heatSide);
  return {
    '--hl-ticker-x': px((plan.ticker.left + plan.ticker.right) / 2),
    '--hl-ticker-y': px(plan.ticker.top),
    '--hl-ticker-w': px(width(plan.ticker)),
    '--hl-toast-x': px(plan.toastCentred ? (plan.toast.left + plan.toast.right) / 2 : plan.toast.left),
    '--hl-toast-y': px(plan.toast.top),
    '--hl-toast-w': plan.toastCentred ? 'max-content' : px(width(plan.toast)),
    '--hl-toast-mw': px(width(plan.toast)),
    '--hl-toast-t': plan.toastCentred ? '-50%' : '0px',
    '--hl-obj-y': px(plan.objective.top),
    '--hl-obj-l': o.l,
    '--hl-obj-r': o.r,
    '--hl-obj-w': px(width(plan.objective)),
    '--hl-obj-a': plan.objectiveSide,
    '--hl-obj-lines': String(plan.objectiveLines),
    '--hl-heat-y': px(plan.heat.top),
    '--hl-heat-l': hd.l,
    '--hl-heat-r': hd.r,
  };
}

/** Writes the plan's variables on the UI root (only the ones that changed) and marks its mode. */
export function applyTopPlan(root: HTMLElement, plan: TopPlan, w: number): void {
  for (const [name, value] of Object.entries(planVars(plan, w)))
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  if (root.dataset['top'] !== plan.mode) root.dataset['top'] = plan.mode;
}

/** The screen's safe-area insets in CSS px, read from the `--hl-safe-*` variables the UI's CSS sets from `env()`. */
export function readSafe(root: HTMLElement): Safe {
  if (typeof getComputedStyle !== 'function') return { top: 0, right: 0, bottom: 0, left: 0 };
  const style = getComputedStyle(root);
  const read = (name: string) => {
    const n = parseFloat(style.getPropertyValue(name));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };
  return {
    top: read('--hl-safe-t'),
    right: read('--hl-safe-r'),
    bottom: read('--hl-safe-b'),
    left: read('--hl-safe-l'),
  };
}
