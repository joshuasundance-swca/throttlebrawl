// The transient-card rule (docs/architecture.md, "Transient cards"), written once. A card the UI raises
// for a moment (the update offer, the did-not-load card, a notice, what's new, the slow-frames offer)
// sits in the flow of the screen that raised it (the slot at the top of that screen's column), or in a
// slot the layout keeps free (the race's toast slot, hud-layout.ts); never over a title, a button, a
// chip or the road ahead. It belongs to the screen that raised it and goes when that screen changes,
// and the did-not-load card never stays up beside a busy "Loading ..." line. The bug class escaped
// three times in a week (the update card over the career result's title, #613; the what's-new card
// over the route chips; the did-not-load card over the career tabs and the 568x320 region buttons,
// polish batch D's mustFix 1), so tests/e2e/ui-transient-cards.spec.ts measures every card below on
// every screen it can appear on, at the phone sizes and every Text size, with `cardFindings` as its
// judge. A new card goes in TRANSIENT_CARDS, or that spec does not know it exists.
//
// DOM-free and import-free at run time (types only), so the browser spec can import it in Node.
import type { Screen } from './screen';

/** A screen box in CSS pixels (hud-layout.ts's Box, repeated so this module imports nothing). */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How a card keeps out of the way: first in its screen's flow, or in a slot the layout keeps free. */
export type CardPlace = 'flow' | 'slot';

export interface TransientCard {
  /** The card's element id. */
  readonly id: string;
  /** What it is, in plain words. */
  readonly what: string;
  /** Every screen it can appear on. */
  readonly screens: readonly Screen[];
  readonly place: CardPlace;
}

/** The screens with a card slot at the top of their flow (`cardHost` in ui/index.ts). */
export const SLOT_SCREENS: readonly Screen[] = [
  'start',
  'menu',
  'raceOptions',
  'career',
  'results',
  'careerResults',
];

/**
 * Every transient card the UI can raise, in the order they stack in a slot. In a race a notice goes to
 * the top ticker (a `system` item), the race's one text strip, so it is no card there. The career's
 * teaser raises none (its one button opens the career map), and the settings, changelog and credits
 * pages hand theirs to the menu.
 */
export const TRANSIENT_CARDS: readonly TransientCard[] = [
  {
    id: 'reload-offer',
    what: 'the update offer ("The game was updated while you raced")',
    screens: ['results', 'careerResults'],
    place: 'flow',
  },
  {
    id: 'load-retry',
    what: 'the did-not-load card, with Retry',
    screens: ['menu', 'raceOptions', 'career', 'results', 'careerResults'],
    place: 'flow',
  },
  {
    id: 'ui-notice',
    what: 'a short notice (a save that could not be read, a ride the career refuses)',
    screens: ['start', 'menu', 'raceOptions', 'career', 'results', 'careerResults'],
    place: 'flow',
  },
  {
    id: 'whats-new',
    what: "the what's-new card beside the menu",
    screens: ['menu'],
    place: 'flow',
  },
  {
    id: 'look-offer',
    what: 'the slow-frames offer',
    screens: ['race'],
    place: 'slot',
  },
];

/** The cards app/ raises at any moment and the slot model places. */
export type SlotCardId = 'load-retry' | 'ui-notice';

const cardById = (id: string): TransientCard | undefined => TRANSIENT_CARDS.find((c) => c.id === id);

/**
 * The screen that carries a card raised while `raisedOn` shows: that screen when the card can appear
 * there, else the menu (a background load that fails before the start tap, or while a page with no
 * slot is open, is said on the menu the player comes back to).
 */
export function ownerOf(id: SlotCardId, raisedOn: Screen): Screen {
  return cardById(id)?.screens.includes(raisedOn) ? raisedOn : 'menu';
}

export interface CardSlots {
  /** Raises the card for the screen that shows now (`ownerOf`); a card already up moves with it. */
  raise(id: SlotCardId, on: Screen): void;
  drop(id: SlotCardId): void;
  /**
   * The screen changed: a card that was shown on another screen goes. A notice on the start screen is
   * carried to the menu the start tap opens instead (polish batch E's check, punch item 4: a start tap
   * inside the boot notice's 4 s lost it). Returns the cards carried, so their time starts again.
   */
  screenChanged(to: Screen): SlotCardId[];
  /** A busy "Loading ..." line went up: the did-not-load card goes (the load runs again, and says so if it fails). */
  busy(): void;
  /** The cards to show on `on`, in stacking order. */
  visible(on: Screen): SlotCardId[];
}

export function createCardSlots(): CardSlots {
  const up = new Map<SlotCardId, { owner: Screen; seen: boolean }>();
  const order = TRANSIENT_CARDS.map((c) => c.id);
  return {
    raise(id, on) {
      const owner = ownerOf(id, on);
      up.set(id, { owner, seen: owner === on });
    },
    drop: (id) => void up.delete(id),
    screenChanged(to) {
      const carried: SlotCardId[] = [];
      for (const [id, c] of up) {
        if (c.owner === to) c.seen = true;
        else if (c.owner === 'start' && to === 'menu') {
          up.set(id, { owner: 'menu', seen: true });
          carried.push(id);
        } else if (c.seen) up.delete(id);
      }
      return carried;
    },
    busy: () => void up.delete('load-retry'),
    visible: (on) =>
      [...up]
        .filter(([, c]) => c.owner === on)
        .map(([id]) => id)
        .sort((a, b) => order.indexOf(a) - order.indexOf(b)),
  };
}

/** The whole seconds left of the host's wait (`waitUntil` and `now` on one clock); 0 when there is none or it has passed. */
export function waitSeconds(waitUntil: number | null, now: number): number {
  const left = waitUntil === null ? 0 : waitUntil - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/**
 * The Retry button while the host's wait runs (`waitUntil`, ms on the same clock as `now`): off, and
 * counting the wait down in whole seconds; then plain Retry. `label` is the button's word when it
 * offers something else (Reload, for a build whose files are gone).
 */
export function retryButton(
  waitUntil: number | null,
  now: number,
  label = 'Retry',
): { label: string; disabled: boolean } {
  const secs = waitSeconds(waitUntil, now);
  if (secs === 0) return { label, disabled: false };
  return { label: `${label} in ${secs} s`, disabled: true };
}

/**
 * Where the menu's word about the picked region's roads (the route row's place) takes the host's wait
 * (polish batch I's check, punch 4: inside the wait it said "try again shortly" with no time left).
 * The word's text carries this slot; `withWait` fills it with the card's own countdown.
 */
export const WAIT_SLOT = '{wait}';

/** `text` with its wait slot filled: " in 27 s" while the wait runs, nothing once it has passed. */
export function withWait(text: string, waitUntil: number | null, now: number): string {
  const secs = waitSeconds(waitUntil, now);
  return text.replace(WAIT_SLOT, secs > 0 ? ` in ${secs} s` : '');
}

/**
 * Whether the route row's word keeps back: while a busy "Loading ..." line is up (it says the same, so
 * the dimmed word drew through it, doubled: polish batch I's check, note-915) or while the did-not-load
 * card is up on the menu (it says the same with its button).
 */
export function routeNoteQuiet(on: { screen: Screen; busy: boolean; cardUp: boolean }): boolean {
  return on.busy || (on.screen === 'menu' && on.cardUp);
}

// ---- The layout judge (the browser spec measures, this decides) -----------------------------------

/** A card as painted: its box and what the page says about where it sits. */
export interface PaintedCard {
  id: string;
  place: CardPlace;
  shown: boolean;
  /** Inside the screen that shows (a flow card must be). */
  inScreen: boolean;
  /** The `position` of every element from the card up to its screen that takes it out of the flow. */
  positioned: string[];
  /** The card is what a tap at its centre hits (nothing lies over it). */
  onTop: boolean;
  box: Box;
}

/** Something on the screen a card must never lie over. */
export interface PaintedThing {
  /** How a finding names it: 'the control #career-tab-map "Map"'. */
  name: string;
  kind: 'control' | 'heading' | 'card' | 'words' | 'hud';
  box: Box;
}

/** The road ahead as fractions of the screen (core/layout.ts ROAD_AHEAD; repeated: no run-time import). */
const ROAD_AHEAD = { left: 0.25, right: 0.75, top: 0.25, bottom: 0.65 } as const;

/** Boxes that overlap by more than half a pixel each way. */
const hit = (a: Box, b: Box) =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

/**
 * What is wrong with a card as painted, in plain words (empty when nothing is): it is not shown; a
 * flow card is not inside its screen, or is positioned so it can stay put while the screen scrolls; it
 * leaves the screen sideways; something lies over it; it covers any of `things`; a slot card covers
 * the road ahead.
 */
export function cardFindings(
  card: PaintedCard,
  things: readonly PaintedThing[],
  viewport: { width: number; height: number },
): string[] {
  if (!card.shown) return [`${card.id} is not shown`];
  const out: string[] = [];
  if (card.place === 'flow') {
    if (!card.inScreen) out.push(`${card.id} is not inside its screen`);
    for (const pos of new Set(card.positioned))
      out.push(`${card.id} is ${pos}, so it can stay over content that scrolls`);
  }
  if (card.box.left < -0.5 || card.box.right > viewport.width + 0.5)
    out.push(`${card.id} leaves the screen sideways`);
  if (!card.onTop) out.push(`something lies over ${card.id}`);
  for (const t of things) if (hit(card.box, t.box)) out.push(`${card.id} covers ${t.name}`);
  if (card.place === 'slot') {
    const road: Box = {
      left: ROAD_AHEAD.left * viewport.width,
      right: ROAD_AHEAD.right * viewport.width,
      top: ROAD_AHEAD.top * viewport.height,
      bottom: ROAD_AHEAD.bottom * viewport.height,
    };
    if (hit(card.box, road)) out.push(`${card.id} covers the road ahead`);
  }
  return [...new Set(out)];
}

/**
 * A card just raised must be in view (polish batch E's check, mustFix 1: a failed career ride raised
 * the did-not-load card first in the career's flow while the screen was scrolled down to the event,
 * 420 to 590 px above the top of the screen, and the player saw no word). In view: all of it is on
 * the screen, or, for a card taller than the screen, it fills the screen. Empty when it is.
 */
export function inViewFindings(id: string, box: Box, viewport: { width: number; height: number }): string[] {
  const height = box.bottom - box.top;
  if (height <= 0.5 || box.right - box.left <= 0.5) return [`${id} is out of view (not drawn)`];
  const seen = Math.min(box.bottom, viewport.height) - Math.max(box.top, 0);
  if (seen >= Math.min(height, viewport.height) - 1) return [];
  return [
    `${id} is out of view (y ${Math.round(box.top)} to ${Math.round(box.bottom)} of a ${viewport.height} px screen)`,
  ];
}
