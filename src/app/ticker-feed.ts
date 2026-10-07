// What app/ puts on the top ticker (playtest 3, the maintainer: "The black and white text pop-ups
// block the actual game"; the design spec's "The integration side"). The strip itself is ui/'s
// (ui/ticker.ts, ui/ticker-view.ts); this is the app side of it, kept pure so it is unit-tested:
//
// - the producer's ask, and its thank-you, as `ask` items tagged PRODUCER;
// - the landing one-liner, picked here from the region's `landingLines` on the player's own landing
//   that paid (a `land` event with `data.surge`), as a vetoable `line` item. It is on the strip, off
//   the bike and off the road: render/ no longer draws a landing line of its own;
// - the poll for the signs and billboards in view, so the veto's "recently seen" list names them.
import type { BoardItem, VisibleContent } from '../render';
import { SIM_DT, type SimEvent } from '../sim/api';
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
 * Which line comes next: never the one just shown when the pool has another. The rule the
 * renderer's old overlay used, so a seeded race picks the lines it always did.
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

/**
 * Whether the player's fall is being waited out: the line is said at the first `splash` of a fall (the rider's body
 * and the bike's each splash) and not again until he has woken (`respawn`).
 */
export interface OutOfBoundsState {
  open: boolean;
}

export const createOutOfBounds = (): OutOfBoundsState => ({ open: false });

/** A new race: nothing is being waited out. */
export const resetOutOfBounds = (state: OutOfBoundsState): void => {
  state.open = false;
};

/**
 * The out-of-bounds line (the maintainer, 2026-10-06, [decided]: a road race in a physical world with honest
 * edges; crossing the course's edge has a visible, consistent consequence, the quick reset with its time penalty).
 * A fall that has no gag of its own reads at a glance as a short, plain `system` line on the top ticker, in the
 * tone guide's deadpan sign voice and no joke: out of bounds onto ground (`past: 'ground'`) or a low drop onto it
 * (`past: 'drop'`), by the player. A splash into water keeps its gator or fisherman and its sound, and a high drop
 * is a clean cut-away with no line of text (tone guide, "Fall off a bridge"), so neither says anything here.
 * Said once a fall (`state`), with the wait the sim asked for (`penaltyTicks`).
 */
export function outOfBoundsLineFor(
  events: readonly SimEvent[],
  playerId: SimEvent['actor'],
  state: OutOfBoundsState,
): TickerItem | null {
  let line: TickerItem | null = null;
  for (const e of events) {
    if (e.actor !== playerId) continue;
    if (e.type === 'respawn') state.open = false;
    if (e.type !== 'splash' || state.open) continue;
    const past = e.data['past'];
    if ((past !== 'ground' && past !== 'drop') || e.data['high'] === true) continue;
    state.open = true;
    const ticks = e.data['penaltyTicks'];
    const seconds =
      typeof ticks === 'number' && Number.isFinite(ticks) ? Math.max(1, Math.round(ticks * SIM_DT)) : 0;
    const wait = seconds > 0 ? `IN ${seconds} ${seconds === 1 ? 'SECOND' : 'SECONDS'}` : 'SOON';
    line = { cls: 'system', text: `OUT OF BOUNDS. BACK ON THE ROAD ${wait}.` };
  }
  return line;
}

/** The producer's ask, as it is put (it pays `cash` when met). Not vetoable: it is a game mechanic. */
export function producerAskItem(ask: { text: string; cash: number }): TickerItem {
  return { cls: 'ask', tag: PRODUCER_TAG, text: ask.text, cash: ask.cash };
}

/** The producer's thank-you when the ask is met. */
export function producerThanksItem(ask: { cash: number }): TickerItem {
  return { cls: 'ask', tag: PRODUCER_TAG, text: 'Got it.', cash: ask.cash, dwellMs: PRODUCER_THANKS_MS };
}

// The slow-frames offer is not here: it is ui's toast, which carries its own buttons (one tap to
// Classic, or "No thanks"), and the strip does not repeat it (playtest 3, wave-B live check: the
// toast and a ticker note said the same thing at once).

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
