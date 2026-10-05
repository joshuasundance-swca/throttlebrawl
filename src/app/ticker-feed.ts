// What app/ puts on the top ticker (playtest 3, the maintainer: "The black and white text pop-ups
// block the actual game"; the design spec's "The integration side"). The strip itself is ui/'s
// (ui/ticker.ts, ui/ticker-view.ts); this is the app side of it, kept pure so it is unit-tested:
//
// - the producer's ask, and its thank-you, as `ask` items tagged PRODUCER;
// - the landing one-liner, picked here from the region's `landingLines` on the player's own landing
//   that paid (a `land` event with `data.surge`), as a vetoable `line` item. render/ gets an empty
//   landing pool (`withoutLandingLines`), so its WebGL overlay never draws one: the line is on the
//   strip, off the bike and off the road;
// - the slow-frames note, as a `system` item;
// - the poll for the signs and billboards in view, so the veto's "recently seen" list names them.
import type { BoardCatalog, BoardItem, VisibleContent } from '../render';
import type { SimEvent } from '../sim/api';
import type { GameUi } from '../ui';

/** An item on the top ticker, as `GameUi.ticker.push` takes it (ui/ticker.ts). */
type TickerItem = Parameters<GameUi['ticker']['push']>[0];

/** The tag on the producer's items. */
export const PRODUCER_TAG = 'PRODUCER';
/** The thank-you's time on the strip (ms). */
export const PRODUCER_THANKS_MS = 2000;

/** One line of words: whitespace runs, newlines included, become one space. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Which line comes next: never the one just shown when the pool has another. The same rule the
 * renderer's overlay used (render/air-pays.ts), so a seeded race picks the lines it always did.
 */
function nextLineIndex(count: number, last: number, tick: number): number {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  const step = 1 + (Math.abs(Math.floor(tick)) % (count - 1));
  return last < 0 ? Math.abs(Math.floor(tick)) % count : (last + step) % count;
}

export interface LandingPick {
  item: BoardItem;
  /** The landing event's tick. */
  tick: number;
}

/**
 * The landing line for one sim step: set when the player's own landing paid (`land` with
 * `data.surge`), none for a rival's landing or any other event. `pool` is the region's live lines
 * (a cut one already out of it); `lastRef` is the line shown last, which is not picked again while
 * the pool has another, and a ref the pool no longer holds counts as no last line.
 */
export function landingLineFor(
  events: readonly SimEvent[],
  playerId: SimEvent['actor'],
  pool: readonly BoardItem[],
  lastRef: string | null,
): LandingPick | null {
  for (const e of events) {
    if (e.type !== 'land' || e.data['surge'] !== true || e.actor !== playerId) continue;
    const last = lastRef === null ? -1 : pool.findIndex((p) => p.ref === lastRef);
    const item = pool[nextLineIndex(pool.length, last, e.tick)];
    if (item) return { item, tick: e.tick };
  }
  return null;
}

/** A landing line as the strip's `line` item: its words on one line, vetoable by its reference. */
export function landingLineItem(item: BoardItem, tick: number, raceId: string): TickerItem {
  return { cls: 'line', text: oneLine(item.text), contentRef: item.ref, tick, raceId };
}

/** The producer's ask, as it is put (it pays `cash` when met). Not vetoable: it is a game mechanic. */
export function producerAskItem(ask: { text: string; cash: number }): TickerItem {
  return { cls: 'ask', tag: PRODUCER_TAG, text: ask.text, cash: ask.cash };
}

/** The producer's thank-you when the ask is met. */
export function producerThanksItem(ask: { cash: number }): TickerItem {
  return { cls: 'ask', tag: PRODUCER_TAG, text: 'Got it.', cash: ask.cash, dwellMs: PRODUCER_THANKS_MS };
}

/**
 * The slow-frames note (the look fallback's offer; run W-O). The buttons stay in the pause menu's
 * card; the strip only says where they are.
 */
export const SLOW_FRAMES_ITEM: TickerItem = {
  cls: 'system',
  text: 'Slow frames? The Classic look is in the pause menu.',
};

/**
 * The board catalog as render/ gets it: the landing pool emptied, so its overlay never draws a line
 * (app/ puts it on the strip). Every other item and pool is kept as it was; the input is not changed.
 */
export function withoutLandingLines(catalog: BoardCatalog): BoardCatalog {
  return { ...catalog, pools: { ...catalog.pools, landing: [] } };
}

/** How often (in rendered frames) the poll reads what is in view. */
export const SEEN_POLL_EVERY = 30;

/** A board or line as the narrative's "recently seen" list takes it. */
export interface SeenNote {
  contentRef: string;
  kind: 'sign' | 'billboard';
  label: string;
}

/** The veto list's kind for what the renderer calls `kind`: billboards stay, the rest are signs. */
export function seenKindOf(kind: VisibleContent['kind']): SeenNote['kind'] {
  return kind === 'billboard' ? 'billboard' : 'sign';
}

export interface SeenPoll {
  /**
   * One rendered frame of a race. Every `every`th frame it calls `read` (the renderer's
   * `visibleContent`) and returns the items not yet noted this race; the frames between return none
   * and do not read.
   */
  frame(read: () => readonly VisibleContent[]): SeenNote[];
  /** A new race: everything may be noted again. */
  reset(): void;
}

export function createSeenPoll(every: number = SEEN_POLL_EVERY): SeenPoll {
  const noted = new Set<string>();
  let frames = 0;
  return {
    frame(read) {
      frames++;
      if (frames % every !== 0) return [];
      const fresh: SeenNote[] = [];
      for (const c of read()) {
        if (noted.has(c.ref)) continue;
        noted.add(c.ref);
        fresh.push({ contentRef: c.ref, kind: seenKindOf(c.kind), label: c.label });
      }
      return fresh;
    },
    reset() {
      noted.clear();
      frames = 0;
    },
  };
}
