// A screen fits the phone it is on (polish batch E's check, punch item 5). At 568x320 and the largest
// Text size the menu's lower row was wider than the screen ("ettings" and "Copy debug repor" cut at
// both edges: a did-not-load card's one-line width had widened the menu's column past the screen),
// and with the menu scrolled its "build ..." footer, a label out of the flow, was drawn over Start
// career and Race. tests/e2e/ui-transient-cards.spec.ts measures every screen a transient card can
// appear on, at every phone size, Text size and scroll position, with this judge; the menu without
// its cards too.
//
// DOM-free and import-free at run time (types only), so the browser spec can import it in Node.
import type { PaintedThing } from './transient-cards';

/** A screen box in CSS pixels. */
type Box = PaintedThing['box'];

/** Boxes that overlap by more than half a pixel each way. */
const hit = (a: Box, b: Box) =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

export interface ScreenPaint {
  /**
   * Every control, title and line of words of the screen, cut only by the boxes inside it that clip
   * (a road row that scrolls sideways, a blurb clamped to two lines), not by the screen itself: what
   * the screen would cut off at its sides is what this looks for.
   */
  wide: readonly PaintedThing[];
  /** The same things as painted now: cut to the screen and to its scroll. */
  painted: readonly PaintedThing[];
  /** The lines of words of the screen's footer (its build id) as painted now; none when it is hidden. */
  footer: readonly Box[];
}

/**
 * What does not fit, in plain words (empty when all does): a control, title or line of words that
 * leaves the screen sideways, and anything the footer's words are drawn over.
 */
export function screenFitFindings(paint: ScreenPaint, viewport: { width: number; height: number }): string[] {
  const out: string[] = [];
  for (const t of paint.wide)
    if (t.box.left < -0.5 || t.box.right > viewport.width + 0.5)
      out.push(`${t.name} leaves the screen sideways`);
  for (const t of paint.painted)
    if (paint.footer.some((line) => hit(line, t.box))) out.push(`the footer covers ${t.name}`);
  return [...new Set(out)];
}
