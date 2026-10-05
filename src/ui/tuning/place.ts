// Where the tuning panel stands (playtest 4, P4-1, the maintainer: "Tuning on mobile blocks pause
// button and it seems you can't get it to minimize once it's up so you have to refresh the whole
// page/game"). It used to sit 8 px in from the top-right corner, as tall as the screen, over the pause
// button and the touch buttons, and its Close button scrolled away with the sliders. Now:
//
//   - it docks on the pause button's side (the other thumb's side stays free to steer, so the panel
//     is still usable mid-race, as decided), under the pause button, and stops above the touch
//     buttons, scrolling inside that gap;
//   - ui/index.ts already tells the rest of the UI how far the touch buttons reach in from their side
//     and up from the bottom (`--touch-reach`, `--touch-rise` on the UI root, set from the layout
//     record whether or not the touch surface is showing), and the pause button wears `.mirrored`
//     when the left-handed mirror is on: the panel reads those, so it needs nothing in the first-load
//     bundle and follows a resize, a new race and the mirror;
//   - it never covers a control, and its own Close and Minimise controls sit in a header outside the
//     scrolling part (index.ts), so they stay on screen.
//
// Pure: the same input always gives the same plan, so it is unit-tested without a DOM.
import { overlap, pauseBox, type Box, type Safe } from '../hud-layout';

/** The panel's widest, CSS px; on a narrow screen it is `PANEL_VW` of the width. */
export const PANEL_MAX_W = 300;
export const PANEL_VW = 0.46;
/** The air between the panel and the screen's edge, the pause button and the touch buttons. */
export const PANEL_AIR = 8;
/** The header: the title and the two controls, each 40 px to touch (index.ts's CSS). */
export const PANEL_HEAD_H = 46;

export interface PanelInput {
  /** The screen, CSS px. */
  w: number;
  h: number;
  safe: Safe;
  /** The left-handed mirror: the pause button and the touch buttons are on the left. */
  mirror: boolean;
  /** How far the touch buttons reach in from their side, and up from the bottom (0 when there are none). */
  reach: number;
  rise: number;
}

export interface PanelPlan {
  /** The side the panel docks on: the pause button's. */
  side: 'left' | 'right';
  /** Where the panel stands, as the largest box that touches nothing in `clear`. */
  box: Box;
  /** What the panel keeps clear of: the pause button, and the touch buttons' band where there are touch buttons. */
  clear: readonly Box[];
}

/** A CSS length in px, as a number: nothing, a word or a negative reads as 0. */
function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The touch band as ui/ writes it on the root (`--touch-reach`, `--touch-rise`). */
export function touchBand(reach: string, rise: string): { reach: number; rise: number } {
  return { reach: px(reach), rise: px(rise) };
}

export function planPanel(input: PanelInput): PanelPlan {
  const { w, h, safe, mirror, reach, rise } = input;
  const side = mirror ? 'left' : 'right';
  const width = Math.min(PANEL_MAX_W, PANEL_VW * w, w - 2 * PANEL_AIR);
  const edge = Math.max(PANEL_AIR, mirror ? safe.left : safe.right);
  const left = mirror ? edge : w - edge - width;
  const right = left + width;

  const clear: Box[] = [pauseBox(w, safe, mirror)];
  if (reach > 0 && rise > 0) {
    // The touch buttons, as one band along the bottom on the pause button's side.
    clear.push(
      mirror
        ? { left: 0, top: h - rise, right: reach, bottom: h }
        : { left: w - reach, top: h - rise, right: w, bottom: h },
    );
  }

  // The free stretch down the column: under what stands above the middle of the screen, over what
  // stands below it. Only what the column's width actually meets counts.
  let top = Math.max(PANEL_AIR, safe.top);
  let bottom = h - Math.max(PANEL_AIR, safe.bottom);
  const column: Box = { left, top: 0, right, bottom: h };
  for (const b of clear) {
    if (!overlap(column, b)) continue;
    if ((b.top + b.bottom) / 2 < h / 2) top = Math.max(top, b.bottom + PANEL_AIR);
    else bottom = Math.min(bottom, b.top - PANEL_AIR);
  }
  // A screen too short for both: the header still fits (phones are not this short sideways).
  bottom = Math.max(bottom, top + PANEL_HEAD_H);
  return { side, box: { left, top, right, bottom }, clear };
}
