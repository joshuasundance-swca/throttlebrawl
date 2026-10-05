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

// ---- The touch buttons and the wheelie button's settle rule ------------------------------------
//
// Playtest 4 (P4-7, [decided] "Wheelie button": "a small button by the right thumb"). The attack and
// brake buttons stand where the layout record puts them. The wheelie button starts where the record
// puts it (Classic: left of the attack button, over the brake) and settles off anything it would
// touch: the attack and brake buttons (with TOUCH_GAP_PX of air) and the road ahead (ROAD_AHEAD, the
// box no HUD piece may enter; ui/hud-layout.ts's LOOK_AHEAD is this one). First it shrinks about its
// anchored corner, the one toward the attack button, down to WHEELIE_BUTTON_MIN_PX: on a 16:9 phone
// the road ahead reaches nearer the buttons than on a 20:9 one. If that is not enough (a custom
// layout), it lifts at full size off its anchored edge until it is clear of the buttons, as
// ui/hud-layout.ts's rule 6 lifts a text widget. input/ hit-tests the same boxes ui/ draws: both call
// this. Pure. [default] throughout.

/** The touch buttons the right thumb presses. */
export const TOUCH_BUTTON_ELEMENTS = ['touch-attack', 'touch-brake', 'touch-wheelie'] as const;
/** The air the settle rule keeps between touch buttons, CSS px (ui/hud-layout.ts GAP). */
export const TOUCH_GAP_PX = 6;
/** The smallest the wheelie button shrinks to before it lifts instead, CSS px. */
export const WHEELIE_BUTTON_MIN_PX = 32;
/** The road ahead, fractions of the screen: the middle half across, 25-65 % down. */
export const ROAD_AHEAD = { left: 0.25, right: 0.75, top: 0.25, bottom: 0.65 } as const;

/** Where each visible touch button sits on a screen, CSS px; null when the record has none. */
export interface TouchButtonRects {
  attack: Rect | null;
  brake: Rect | null;
  wheelie: Rect | null;
}

/** Whether two rects come closer than `gap` px (exactly `gap` apart is clear). */
function within(a: Rect, b: Rect, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/** The touch buttons on a `width` × `height` screen, the wheelie button settled (see above). */
export function placeTouchButtons(layout: TouchLayout, width: number, height: number): TouchButtonRects {
  const element = (name: string) => layout.elements.find((e) => e.element === name && e.visible);
  const place = (e: LayoutElement | undefined) => (e ? placeElement(e, width, height, layout.mirror) : null);
  const attack = place(element('touch-attack'));
  const brake = place(element('touch-brake'));
  const own = element('touch-wheelie');
  if (!own) return { attack, brake, wheelie: null };
  const others = [attack, brake].filter((r): r is Rect => r !== null);
  const road: Rect = {
    x: ROAD_AHEAD.left * width,
    y: ROAD_AHEAD.top * height,
    w: (ROAD_AHEAD.right - ROAD_AHEAD.left) * width,
    h: (ROAD_AHEAD.bottom - ROAD_AHEAD.top) * height,
  };
  const onScreen = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height;
  const clear = (r: Rect) =>
    onScreen(r) && !within(r, road, 0) && !others.some((o) => within(r, o, TOUCH_GAP_PX));
  const full = placeElement(own, width, height, layout.mirror);
  if (clear(full)) return { attack, brake, wheelie: full };
  // Shrink about the anchored corner: the same offsets at a smaller scale, a pixel at a time.
  for (let px = Math.floor(full.w) - 1; px >= WHEELIE_BUTTON_MIN_PX; px--) {
    const r = placeElement({ ...own, scale: own.scale * (px / full.w) }, width, height, layout.mirror);
    if (clear(r)) return { attack, brake, wheelie: r };
  }
  // Lift at full size off the anchored edge until it is clear of the other buttons.
  const up = !own.anchor.startsWith('top');
  const r = { ...full };
  for (let i = 0; i < others.length + 1; i++) {
    const hit = others.find((o) => within(r, o, TOUCH_GAP_PX));
    if (!hit) break;
    r.y = up ? hit.y - TOUCH_GAP_PX - r.h : hit.y + hit.h + TOUCH_GAP_PX;
  }
  r.y = Math.min(Math.max(r.y, 0), Math.max(0, height - r.h));
  return { attack, brake, wheelie: r };
}
