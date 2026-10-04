// HUD placement from the layout record (docs/content-packs.md, "HUD layout presets"). Offsets are
// fractions of the short side, measured inward from one of nine anchors; the mirror flips left
// and right. Touch controls use core's placeElement (they have a size); text widgets size to their
// content, so they are placed with CSS edges instead and grow away from their anchor.
import type { LayoutElement } from '../sim/api';

/** The closed list of layout elements the code knows (a new widget is a code change). */
export const HUD_ELEMENTS = [
  'speedometer',
  'position',
  'health-self',
  'health-target',
  'minimap', // reserved (M3)
  'bark-bubble', // the old bark bubble; the ticker (ui/hud-layout.ts) places itself now. Kept so saved layouts naming it stay valid
  'touch-attack',
  'touch-brake',
  'touch-stick-zone',
] as const;
export type HudElementName = (typeof HUD_ELEMENTS)[number];

export interface HudStyle {
  left: string;
  right: string;
  top: string;
  bottom: string;
  transform: string;
  transformOrigin: string;
  opacity: string;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/** CSS for one text widget. `unit` is the short side of the screen, in CSS pixels. */
export function hudStyle(el: LayoutElement, unit: number, mirror: boolean): HudStyle {
  const [vertical, across] = el.anchor.includes('-') ? el.anchor.split('-') : ['center', 'center'];
  let horizontal = across ?? 'center';
  if (mirror && horizontal === 'left') horizontal = 'right';
  else if (mirror && horizontal === 'right') horizontal = 'left';
  const ox = el.offset[0] * unit;
  const oy = el.offset[1] * unit;
  const s: HudStyle = {
    left: '',
    right: '',
    top: '',
    bottom: '',
    transform: '',
    transformOrigin: '',
    opacity: '',
  };
  let tx = '0px';
  let ty = '0px';
  if (horizontal === 'left') s.left = px(ox);
  else if (horizontal === 'right') s.right = px(ox);
  else {
    s.left = '50%';
    tx = `calc(-50% + ${px(ox)})`;
  }
  if (vertical === 'top') s.top = px(oy);
  else if (vertical === 'bottom') s.bottom = px(oy);
  else {
    s.top = '50%';
    ty = `calc(-50% + ${px(oy)})`;
  }
  s.transform = `translate(${tx}, ${ty}) scale(${el.scale})`;
  const ox0 = horizontal === 'left' || horizontal === 'right' ? horizontal : 'center';
  const oy0 = vertical === 'top' || vertical === 'bottom' ? vertical : 'center';
  s.transformOrigin = `${ox0} ${oy0}`;
  s.opacity = String(el.opacity);
  return s;
}
