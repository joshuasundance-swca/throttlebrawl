// The route picker (the maintainer, 2026-10-01: "Yes, add as routes"): after the region, the player
// picks a route. The region's hand-made road is the default; each real road the region carries is
// listed by its real name. app/ hands the list in (`routeChoices`), ui draws it under the region
// picker and reports the pick. Phone-first: chips are full-size touch targets in one row that
// scrolls sideways when the names do not fit, so the Race button never leaves the screen. A row
// that scrolls says so (playtest 4, run B, punch item 10): a "more roads" arrow stands at each end
// it can still go, and tapping it pages the row, so every road is reachable by a tap at every text
// size, not only by a swipe nobody is told about.

/** One route the player can pick, as plain data (app/ maps its route choices to it). */
export interface RouteOption {
  /** The route's qualified id, or null for the region's own road (the default). */
  id: string | null;
  /** The name on the chip, such as "Chuckanut Drive". */
  name: string;
  /** One line under the chips for the picked route. */
  blurb?: string;
}

/** The list app/ gave, cleaned: no blank names, and no route twice (the first one stays). */
export function cleanRoutes(options: readonly RouteOption[]): RouteOption[] {
  const out: RouteOption[] = [];
  for (const o of options) {
    if (!o.name.trim() || (o.id !== null && !o.id.trim())) continue;
    if (out.some((k) => k.id === o.id)) continue;
    out.push(o);
  }
  return out;
}

/**
 * The route to show as picked: `wanted` when it is in the list, else the region's own road (null)
 * when it is offered, else the first option; null for an empty list.
 */
export function pickRoute(options: readonly RouteOption[], wanted?: string | null): string | null {
  if (wanted && options.some((o) => o.id === wanted)) return wanted;
  if (options.some((o) => o.id === null)) return null;
  return options[0]?.id ?? null;
}

/** The chip's element id: `route-own` for the region's road, else from the route's id. */
export const routeChipId = (id: string | null): string =>
  id === null ? 'route-own' : `route-${id.replace(/[^a-z0-9-]/gi, '-')}`;

/** A chip row's scroll state, as the browser reports it (`scrollLeft`, `clientWidth`, `scrollWidth`). */
export interface RowMetrics {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/** Which ends of a chip row have more chips past them. */
export interface ScrollCue {
  /** The row has more than it shows. */
  scrolls: boolean;
  /** There are chips past the left edge. */
  before: boolean;
  /** There are chips past the right edge. */
  after: boolean;
}

/** Layout rounds to fractions of a pixel: less than this is not a scroll. */
const SCROLL_SLACK_PX = 1;
/** Without a chip edge to land on, an arrow pages the row by this share of its width. [default] */
const PAGE_SHARE = 0.8;
/** The room kept beside a chip that is scrolled into view, CSS px. */
const SHOW_MARGIN_PX = 4;

/** The most the row can scroll by. */
const maxScroll = (m: RowMetrics) => Math.max(0, m.scrollWidth - m.clientWidth);

/** Where the row has more chips: the arrows point at these ends, and show only when there is a row to scroll. */
export function scrollCue(m: RowMetrics): ScrollCue {
  const scrolls = m.scrollWidth > m.clientWidth + SCROLL_SLACK_PX;
  return {
    scrolls,
    before: scrolls && m.scrollLeft > SCROLL_SLACK_PX,
    after: scrolls && m.scrollLeft < maxScroll(m) - SCROLL_SLACK_PX,
  };
}

/** A chip's left and right in the row's scrolled content (`offsetLeft`, `offsetLeft + offsetWidth`). */
export interface ChipSpan {
  left: number;
  right: number;
}

/**
 * The `scrollLeft` after an arrow's tap (`dir` -1 for left, 1 for right), kept inside the row. A page
 * lands on a chip's edge: the first chip cut off at the right edge becomes the first in view (the
 * last one cut off at the left becomes the last), so a chip no wider than the row is whole in view on
 * some page and none is skipped. Where no chip would move in view (one wider than the row), or the
 * row's chips are not known, it pages by most of a view.
 */
export function pageScrollLeft(m: RowMetrics, dir: -1 | 1, chips: readonly ChipSpan[] = []): number {
  const end = m.scrollLeft + m.clientWidth;
  let want = m.scrollLeft + dir * m.clientWidth * PAGE_SHARE;
  if (dir === 1) {
    const cut = chips.find((c) => c.right > end + SCROLL_SLACK_PX);
    if (cut && cut.left - SHOW_MARGIN_PX > m.scrollLeft + SCROLL_SLACK_PX) want = cut.left - SHOW_MARGIN_PX;
  } else {
    const cut = [...chips].reverse().find((c) => c.left < m.scrollLeft - SCROLL_SLACK_PX);
    if (cut && cut.right + SHOW_MARGIN_PX - m.clientWidth < m.scrollLeft - SCROLL_SLACK_PX)
      want = cut.right + SHOW_MARGIN_PX - m.clientWidth;
  }
  return Math.min(maxScroll(m), Math.max(0, Math.round(want)));
}

/**
 * The `scrollLeft` that brings a chip (its left and right in the row's scrolled content) into view
 * with the least scroll: unchanged when it is in view already.
 */
export function scrollLeftToShow(m: RowMetrics, left: number, right: number): number {
  const lo = left - SHOW_MARGIN_PX;
  const hi = right + SHOW_MARGIN_PX - m.clientWidth;
  const want = lo < m.scrollLeft ? lo : hi > m.scrollLeft ? hi : m.scrollLeft;
  return Math.min(maxScroll(m), Math.max(0, want));
}

export const ROUTE_PICKER_CSS = `
#route-picker { display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: min(560px, 92vw); }
#route-picker .route-label { font: 800 0.75rem ui-monospace, 'Courier New', monospace; letter-spacing: 0.12em;
  text-transform: uppercase; background: #111; color: #f2ead8; padding: 1px 8px; transform: rotate(-1deg); }
/* The chips, the row and the two "more roads" arrows. The arrows take room beside the row only while
   the row scrolls (no overlap with a chip, and the row never moves once it scrolls), and the one for
   an end with nothing past it is dimmed and off. */
#route-picker .route-scroll { display: flex; align-items: center; gap: 4px; max-width: 100%; }
#route-picker .route-row { display: flex; gap: 10px; flex-wrap: nowrap; overflow-x: auto; flex: 0 1 auto; min-width: 0;
  position: relative; padding: 2px 4px 5px; box-sizing: border-box; scrollbar-width: none;
  overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
#ui #route-picker .route-more { flex: 0 0 auto; min-width: 44px; padding: 6px 0; font-size: 1.375rem; line-height: 1; }
#ui #route-picker .route-more:disabled { opacity: 0.3; cursor: default; box-shadow: none; }
#route-picker .route-scroll:not(.scrolls) .route-more { display: none; }
#route-picker .route-row::-webkit-scrollbar { display: none; }
/* A chip is one line, as wide as its name, unless the name is wider than the row (the largest text
   on a narrow phone, with the what's-new card beside): then it wraps, so every road fits the row whole. */
#route-picker .route { font-size: 0.875rem; white-space: normal; width: max-content; max-width: 100%; flex: 0 0 auto; }
#route-picker .route[aria-checked='true'] { background: #111; color: #f5c542; box-shadow: 3px 3px 0 #e0543a;
  transform: rotate(1deg); }
#route-picker .route-blurb { font: italic 500 0.8125rem/1.3 ui-monospace, 'Courier New', monospace; color: #f2ead8;
  text-shadow: 1px 1px 0 #111; max-width: 100%; }
#region-picker.route-picked .region-blurb { display: none; }
/* The word in the row's place while the picked region's roads are not in (polish batch E's check, punch
   item 1). */
#route-picker .route-note { font: italic 600 0.8125rem/1.3 ui-monospace, 'Courier New', monospace; color: #f2ead8;
  text-shadow: 1px 1px 0 #111; max-width: 100%; }
#ui #route-picker .route-note-action { margin-top: 2px; }
`;

/** A button beside the word (a missing build's Reload, polish batch I's check, punch 4). */
export interface NoteAction {
  label: string;
  run: () => void;
}

export interface RoutePicker {
  /** The picker's element, for the menu. Hidden while there is no choice to make. */
  readonly root: HTMLElement;
  /** The routes to offer and the one to show as picked (the region's own road when left out). */
  set(routes: readonly RouteOption[], picked?: string | null): void;
  /** The picked route's id, or null for the region's own road. */
  readonly route: string | null;
  /**
   * A word in the row's place (the picked region's roads loading, or why they did not load); null
   * takes it away. The picker shows while there is a word, even with no road to choose.
   */
  setNote(text: string | null, action?: NoteAction): void;
  /** Keeps the word back while something else on the screen says it (the did-not-load card). */
  quiet(on: boolean): void;
}

/**
 * The picker under the region chips: a "Which road" label, one chip per route, and a real road's
 * blurb (the region's own blurb stands for its own road, so one line of blurb shows at a time and
 * the menu fits a phone held sideways). It hides while there is only one road to ride (or none).
 * `button` makes a chip in the menu's zine style; `onChange` hears each pick; `onDraw` hears every
 * redraw with whether a real road's blurb is showing. A row too wide for its place gets a "more
 * roads" arrow at each end (`scrollCue`), each live only while there are chips past that end.
 */
export function createRoutePicker(
  button: (id: string, text: string, onClick: () => void) => HTMLButtonElement,
  onChange: (id: string | null) => void,
  onDraw: (realRoadShown: boolean) => void = () => undefined,
): RoutePicker {
  let routes: RouteOption[] = [];
  let route: string | null = null;
  const label = document.createElement('div');
  label.className = 'route-label';
  label.textContent = 'Which road';
  const row = document.createElement('div');
  row.className = 'route-row';
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', 'Road');
  const metrics = (): RowMetrics => ({
    scrollLeft: row.scrollLeft,
    clientWidth: row.clientWidth,
    scrollWidth: row.scrollWidth,
  });
  const spans = (): ChipSpan[] =>
    [...row.children].flatMap((c) =>
      c instanceof HTMLElement ? [{ left: c.offsetLeft, right: c.offsetLeft + c.offsetWidth }] : [],
    );
  const page = (dir: -1 | 1) => row.scrollTo({ left: pageScrollLeft(metrics(), dir, spans()) });
  const before = button('route-before', '‹', () => page(-1));
  const after = button('route-after', '›', () => page(1));
  before.classList.add('route-more');
  after.classList.add('route-more');
  before.setAttribute('aria-label', 'Earlier roads');
  after.setAttribute('aria-label', 'More roads');
  const strip = document.createElement('div');
  strip.className = 'route-scroll';
  strip.append(before, row, after);
  /** Points the arrows at the ends that have more chips. Cheap: three reads, two writes. */
  const syncCue = () => {
    const cue = scrollCue(metrics());
    strip.classList.toggle('scrolls', cue.scrolls);
    before.disabled = !cue.before;
    after.disabled = !cue.after;
  };
  row.addEventListener('scroll', syncCue, { passive: true });
  // The row's width changes with the screen and its chips' with the text size: look again on either.
  const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncCue);
  const blurb = document.createElement('div');
  blurb.className = 'route-blurb';
  const note = document.createElement('div');
  note.id = 'route-note';
  note.className = 'route-note';
  note.setAttribute('role', 'status');
  note.hidden = true;
  const noteButton = button('route-note-action', '', () => noteAction?.run());
  noteButton.classList.add('route-note-action');
  noteButton.hidden = true;
  let noteText: string | null = null;
  let noteAction: NoteAction | null = null;
  let quiet = false;
  const root = document.createElement('div');
  root.id = 'route-picker';
  root.hidden = true;
  root.append(label, strip, blurb, note, noteButton);

  /** Shows the picker while there is a road to choose or a word to say; the row only for the first. */
  const syncShown = () => {
    const choice = routes.length >= 2;
    const said = noteText !== null && !quiet;
    if (note.textContent !== (noteText ?? '')) note.textContent = noteText ?? '';
    // A write only when the answer changes: the word is redrawn each quarter second while a wait counts
    // down, and a repeated write to `hidden` would start the menu's layout checks again each time.
    const show = (e: HTMLElement, on: boolean) => {
      if (e.hidden === on) e.hidden = !on;
    };
    show(note, said);
    // The action sits beside the word, and shows and goes with it.
    const action = said ? noteAction : null;
    if (noteButton.textContent !== (action?.label ?? '')) noteButton.textContent = action?.label ?? '';
    show(noteButton, action !== null);
    show(label, choice);
    show(strip, choice);
    show(root, choice || said);
  };
  const draw = () => {
    syncShown();
    row.replaceChildren(
      ...routes.map((o) => {
        const b = button(routeChipId(o.id), o.name, () => tap(o.id));
        b.classList.add('route');
        b.dataset['route'] = o.id ?? '';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(o.id === route));
        return b;
      }),
    );
    watch?.disconnect();
    watch?.observe(row);
    for (const chip of row.children) watch?.observe(chip);
    syncCue();
    const picked = routes.find((o) => o.id === route);
    const real = routes.length >= 2 && picked !== undefined && picked.id !== null && !!picked.blurb;
    blurb.textContent = real ? (picked.blurb ?? '') : '';
    blurb.hidden = !real;
    onDraw(real);
  };
  const tap = (id: string | null) => {
    if (id === route) return;
    route = id;
    draw();
    showPicked();
    onChange(id);
  };
  /** A chip tapped half out of the row is brought fully in, so the pick is seen. */
  const showPicked = () => {
    const chip = [...row.children].find(
      (c): c is HTMLElement => c instanceof HTMLElement && c.dataset['route'] === (route ?? ''),
    );
    if (chip)
      row.scrollTo({
        left: scrollLeftToShow(metrics(), chip.offsetLeft, chip.offsetLeft + chip.offsetWidth),
      });
  };
  return {
    root,
    set(list, picked) {
      const cleaned = cleanRoutes(list);
      // Another region's roads start at the first chip; a refreshed list keeps the row where it is.
      if (cleaned.map((o) => o.id).join('|') !== routes.map((o) => o.id).join('|')) row.scrollLeft = 0;
      routes = cleaned;
      route = pickRoute(routes, picked ?? null);
      draw();
      showPicked();
    },
    get route() {
      return route;
    },
    setNote(text, action) {
      noteText = text;
      noteAction = text === null ? null : (action ?? null);
      syncShown();
    },
    quiet(on) {
      if (on === quiet) return;
      quiet = on;
      syncShown();
    },
  };
}
