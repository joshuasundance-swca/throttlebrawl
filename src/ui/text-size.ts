// The Text size setting (docs/product-spec.md, "Accessibility"). The record keeps one of three
// names; this file turns it into the factor ui/ draws with. Menus, the ticker, the objective and the
// heat badge size their type in `rem`, and the page's root size follows the factor; the HUD's text
// widgets (speed, position, the two health bars) grow as boxes through the layout record's own scale
// (hud-layout.ts `scaledElement`), so their bars and padding stay in proportion. [default]
import type { TextSize } from '../save';

export type { TextSize };

/** The factor each size draws with. Largest is 1.4: a 640 x 360 phone still fits the top layout (hud-layout.test.ts). */
export const TEXT_SCALE: Readonly<Record<TextSize, number>> = Object.freeze({
  normal: 1,
  large: 1.2,
  largest: 1.4,
});

/** The factor for a size; an unknown name draws as Normal. */
export function textScaleOf(size: string | undefined): number {
  return (size !== undefined && (TEXT_SCALE as Record<string, number>)[size]) || 1;
}

/** The page's root font size at Normal, as a percentage of the browser's own default size (1 rem). */
export const ROOT_FONT_PCT = 100;
