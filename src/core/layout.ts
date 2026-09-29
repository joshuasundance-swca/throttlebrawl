// The touch-layout record (docs/architecture.md, "Input"): positions, sizes, opacity and the
// left-handed mirror. It lives in core so input/ reads it and ui/ edits it without either
// importing the other. Its shape follows the `hud-layout` pack format (docs/content-packs.md).

export const HUD_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;
export type HudAnchor = (typeof HUD_ANCHORS)[number];

export interface LayoutElement {
  /** A closed list in code, one per HUD widget or touch control (e.g. touch-attack). */
  element: string;
  visible: boolean;
  anchor: HudAnchor;
  /** Fractions of the short side of the safe area, measured inward from the anchor. */
  offset: readonly [number, number];
  /** Width and height as fractions of the short side (zones such as the stick zone). */
  size?: readonly [number, number] | undefined;
  scale: number;
  opacity: number;
  touchOnly?: boolean | undefined;
}

export interface TouchLayout {
  id: string;
  /** Left-handed mirror: flips left and right. */
  mirror: boolean;
  elements: readonly LayoutElement[];
}

/** A screen rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where one layout element sits on a screen of the given size, in CSS pixels. `baseSize` is the
 * element's natural size as a fraction of the short side, used when the element has no `size`.
 */
export function placeElement(
  el: LayoutElement,
  width: number,
  height: number,
  mirror: boolean,
  baseSize = 0.2,
): Rect {
  const unit = Math.min(width, height);
  const w = (el.size ? el.size[0] : baseSize * el.scale) * unit;
  const h = (el.size ? el.size[1] : baseSize * el.scale) * unit;
  const ox = el.offset[0] * unit;
  const oy = el.offset[1] * unit;
  const [vertical, across] = el.anchor.includes('-') ? el.anchor.split('-') : ['center', 'center'];
  let horizontal = across;
  if (mirror && horizontal === 'left') horizontal = 'right';
  else if (mirror && horizontal === 'right') horizontal = 'left';
  const x = horizontal === 'left' ? ox : horizontal === 'right' ? width - ox - w : (width - w) / 2 + ox;
  const y = vertical === 'top' ? oy : vertical === 'bottom' ? height - oy - h : (height - h) / 2 + oy;
  return { x, y, w, h };
}
