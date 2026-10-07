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

/** Somewhere the menu shows its build id: the footer, the corner stamp, or the line ending its column. */
export interface BuildIdPlace {
  name: 'the footer' | 'the corner stamp' | 'the build line';
  /** As painted now (the page hides a place that gives way, so only a painted one is passed). */
  box: Box;
}

/**
 * The menu's build id is always findable and covers nothing (polish batch I's check, punch 3: at the
 * largest Text size the menu scrolls, and then the footer and the corner stamp both gave way, so no
 * build id showed). `places` are those painted now; a place off the screen does not count as found
 * (the spec scrolls the line into view first). Empty when one is in view and none covers anything.
 */
export function buildIdFindings(
  places: readonly BuildIdPlace[],
  things: readonly PaintedThing[],
  viewport: { width: number; height: number },
): string[] {
  const inView = (b: Box) =>
    b.right - b.left > 0.5 &&
    b.bottom - b.top > 0.5 &&
    b.left >= -0.5 &&
    b.top >= -0.5 &&
    b.right <= viewport.width + 0.5 &&
    b.bottom <= viewport.height + 0.5;
  const seen = places.filter((p) => inView(p.box));
  const out: string[] = seen.length === 0 ? ['the menu shows no build id'] : [];
  for (const p of seen) for (const t of things) if (hit(p.box, t.box)) out.push(`${p.name} covers ${t.name}`);
  return [...new Set(out)];
}
