// Where the build stamp sits so that it never covers a control (playtest 3 wave B, F1). The stamp is
// a small fixed label in a bottom corner of every screen but the race. A control that reaches the
// bottom of a small screen (the 568x320 menu's Race button sat under it and swallowed the tap) has
// to win: the stamp takes the other bottom corner, and when a control is under that one too it hides
// (the menu and the pause screen carry the build id in their own footers). ui/index.ts measures the
// two corners and the visible controls and applies the answer; this is the decision, kept pure so a
// unit test can pin it. [default]
import type { Box } from './hud-layout';

/** Clear space the stamp keeps from a control, CSS px. */
export const STAMP_CLEARANCE = 2;

export type StampSpot = 'left' | 'right' | 'hidden';

function covers(stamp: Box, control: Box): boolean {
  if (control.right <= control.left || control.bottom <= control.top) return false; // not painted
  const c = STAMP_CLEARANCE;
  return (
    stamp.left < control.right + c &&
    control.left < stamp.right + c &&
    stamp.top < control.bottom + c &&
    control.top < stamp.bottom + c
  );
}

/** The corner that no control is under, the left one first; `hidden` when both have one. */
export function pickStampSpot(corners: { left: Box; right: Box }, controls: readonly Box[]): StampSpot {
  if (!controls.some((c) => covers(corners.left, c))) return 'left';
  if (!controls.some((c) => covers(corners.right, c))) return 'right';
  return 'hidden';
}
