import { describe, expect, it } from 'vitest';
import { ROAD_AHEAD } from '../sim/api';
import {
  cardFindings,
  createCardSlots,
  inViewFindings,
  ownerOf,
  retryButton,
  SLOT_SCREENS,
  TRANSIENT_CARDS,
  type PaintedCard,
  type PaintedThing,
} from './transient-cards';

// The transient-card rule (docs/architecture.md, "Transient cards"): a card the UI raises for a moment
// (the update offer, the did-not-load card, a notice, what's new, the slow-frames offer) sits in the
// flow of the screen that raised it, or in a slot the layout keeps free, never over a title, a
// button, a chip or the road ahead; it goes when its screen changes, and never stays up beside a busy
// "Loading ..." line. The bug class escaped three times (the update card over the career result's
// title, the what's-new card over the route chips, the did-not-load card over the career tabs and the
// region buttons), so the browser spec tests/e2e/ui-transient-cards.spec.ts measures every card here on
// every screen it can appear on, with `cardFindings` as its judge.

describe('the transient cards registry', () => {
  it('names every card once, each on at least one screen, flow cards only on screens with a slot', () => {
    const ids = TRANSIENT_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(['reload-offer', 'load-retry', 'ui-notice', 'whats-new', 'look-offer']),
    );
    for (const c of TRANSIENT_CARDS) {
      expect(c.screens.length, c.id).toBeGreaterThan(0);
      if (c.place === 'flow') for (const s of c.screens) expect(SLOT_SCREENS, `${c.id} on ${s}`).toContain(s);
    }
  });
});

describe('which screen carries a card', () => {
  it('the screen that raised it when it can carry that card, else the menu', () => {
    expect(ownerOf('load-retry', 'career')).toBe('career');
    expect(ownerOf('load-retry', 'raceOptions')).toBe('raceOptions');
    expect(ownerOf('load-retry', 'menu')).toBe('menu');
    // A background load that fails before the start tap, or while a page with no slot is open (the
    // settings, the changelog), is said on the menu the player comes back to.
    expect(ownerOf('load-retry', 'start')).toBe('menu');
    expect(ownerOf('load-retry', 'settings')).toBe('menu');
    expect(ownerOf('ui-notice', 'start')).toBe('start');
    expect(ownerOf('ui-notice', 'career')).toBe('career');
  });
});

describe('a raised card belongs to its screen', () => {
  it('shows on its screen only, and goes when that screen changes (the K2 card followed the player into the career)', () => {
    const slots = createCardSlots();
    slots.raise('load-retry', 'menu');
    expect(slots.visible('menu')).toEqual(['load-retry']);
    slots.screenChanged('career');
    expect(slots.visible('career')).toEqual([]);
    slots.screenChanged('menu');
    expect(slots.visible('menu'), 'gone, not just hidden').toEqual([]);
  });

  it('a card raised before the start tap waits for the menu, then goes when the menu does', () => {
    const slots = createCardSlots();
    slots.raise('load-retry', 'start');
    expect(slots.visible('start')).toEqual([]);
    slots.screenChanged('menu');
    expect(slots.visible('menu')).toEqual(['load-retry']);
    slots.screenChanged('career');
    slots.screenChanged('menu');
    expect(slots.visible('menu')).toEqual([]);
  });

  it('a busy "Loading ..." line takes the did-not-load card down; a notice stays', () => {
    const slots = createCardSlots();
    slots.raise('load-retry', 'menu');
    slots.raise('ui-notice', 'menu');
    slots.busy();
    expect(slots.visible('menu')).toEqual(['ui-notice']);
  });

  it('cards stack in the registry order, and drop takes one down', () => {
    const slots = createCardSlots();
    slots.raise('ui-notice', 'career');
    slots.raise('load-retry', 'career');
    expect(slots.visible('career')).toEqual(['load-retry', 'ui-notice']);
    slots.drop('load-retry');
    expect(slots.visible('career')).toEqual(['ui-notice']);
  });

  // The control: the model is not simply empty; a card raised again after it went shows again.
  it('control: a card raised again on the new screen shows there', () => {
    const slots = createCardSlots();
    slots.raise('load-retry', 'menu');
    slots.screenChanged('career');
    slots.raise('load-retry', 'career');
    expect(slots.visible('career')).toEqual(['load-retry']);
  });

  // Polish batch E's check, punch item 4: the boot notice (settings from a newer build) went with the
  // start screen, so a start tap inside its 4 s lost it and the menu never said it.
  it('a notice on the start screen is carried to the menu the start tap opens, and said there', () => {
    const slots = createCardSlots();
    slots.raise('ui-notice', 'start');
    expect(slots.visible('start')).toEqual(['ui-notice']);
    expect(slots.screenChanged('menu'), 'it is carried').toEqual(['ui-notice']);
    expect(slots.visible('menu')).toEqual(['ui-notice']);
    // On the menu it is the menu's: it goes when the menu does.
    expect(slots.screenChanged('career')).toEqual([]);
    expect(slots.visible('menu')).toEqual([]);
    slots.screenChanged('menu');
    expect(slots.visible('menu')).toEqual([]);
  });

  it('control: a notice on any other screen still goes with it', () => {
    const slots = createCardSlots();
    slots.raise('ui-notice', 'career');
    expect(slots.screenChanged('menu')).toEqual([]);
    expect(slots.visible('menu')).toEqual([]);
    expect(slots.visible('career')).toEqual([]);
  });
});

describe('the Retry button while the host asked for a wait', () => {
  it('is off and shows the wait, counting down in whole seconds, then reads Retry', () => {
    expect(retryButton(null, 0)).toEqual({ label: 'Retry', disabled: false });
    expect(retryButton(12_000, 0)).toEqual({ label: 'Retry in 12 s', disabled: true });
    expect(retryButton(12_000, 11_200)).toEqual({ label: 'Retry in 1 s', disabled: true });
    expect(retryButton(12_000, 12_000)).toEqual({ label: 'Retry', disabled: false });
  });

  it('carries another word when the card offers something else (Reload for a build whose files are gone)', () => {
    expect(retryButton(null, 0, 'Reload')).toEqual({ label: 'Reload', disabled: false });
  });
});

// Polish batch E's check, mustFix 1: a failed career ride raised the did-not-load card first in the
// career's flow while the screen was scrolled down to the event, so it sat 420 to 590 px above the
// top of the screen and the player saw no word. A raised card must be in view.
describe('inViewFindings: a raised card is in view', () => {
  const at915 = { width: 915, height: 412 };
  it('names a card above the screen, below it, or with only an edge showing', () => {
    // The live check's geometry: the career at 915x412 (y -474 to -420), and the 568x320 menu
    // scrolled to its end (y -57 to 4: only its 4 px bottom edge showed).
    expect(inViewFindings('load-retry', box(170, -474, 745, -420), at915)).toEqual([
      'load-retry is out of view (y -474 to -420 of a 412 px screen)',
    ]);
    expect(inViewFindings('load-retry', box(142, -57, 426, 4), { width: 568, height: 320 })).toEqual([
      'load-retry is out of view (y -57 to 4 of a 320 px screen)',
    ]);
    expect(inViewFindings('whats-new', box(10, 380, 300, 520), at915)).toHaveLength(1);
  });

  it('control: a card wholly on the screen, or one taller than it that fills it, is in view', () => {
    expect(inViewFindings('load-retry', box(170, 8, 745, 62), at915)).toEqual([]);
    expect(inViewFindings('load-retry', box(170, 0, 745, 412), at915)).toEqual([]);
    expect(inViewFindings('whats-new', box(10, -30, 300, 600), at915)).toEqual([]);
  });

  it('names a card that is not drawn', () => {
    expect(inViewFindings('ui-notice', box(0, 0, 0, 0), at915)).toEqual([
      'ui-notice is out of view (not drawn)',
    ]);
  });
});

// The judge the browser spec uses, on the geometry the live check measured (polish batch D,
// mustFix 1, 568x320, normal Text size).
const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const viewport = { width: 568, height: 320 };
const menuAt568: PaintedThing[] = [
  { name: 'the title "THROTTLEBRAWL"', kind: 'heading', box: box(200, 49, 368, 75) },
  { name: 'the control #region-the-keys', kind: 'control', box: box(69, 60, 162, 100) },
  { name: 'the control #region-pnw', kind: 'control', box: box(168, 60, 361, 100) },
  { name: 'the control #region-sf', kind: 'control', box: box(367, 60, 499, 100) },
  { name: 'the words of div "Ride where"', kind: 'words', box: box(250, 40, 318, 54) },
];
const clean = (over: Partial<PaintedCard> = {}): PaintedCard => ({
  id: 'load-retry',
  place: 'flow',
  shown: true,
  inScreen: true,
  positioned: [],
  onTop: true,
  box: box(142, 4, 426, 40),
  ...over,
});

describe('cardFindings, the layout judge', () => {
  it('a card in the flow above the title covers nothing', () => {
    const shifted = menuAt568.map((t) => ({
      ...t,
      box: { ...t.box, top: t.box.top + 40, bottom: t.box.bottom + 40 },
    }));
    expect(cardFindings(clean(), shifted, viewport)).toEqual([]);
  });

  it('negative control: the K2 card (a top-centre layer, x 142-426, y 10-75) names all five things under it', () => {
    const k2 = clean({ box: box(142, 10, 426, 75), positioned: ['absolute'] });
    const found = cardFindings(k2, menuAt568, viewport);
    for (const t of menuAt568) expect(found, t.name).toContain(`load-retry covers ${t.name}`);
    expect(found).toContain('load-retry is absolute, so it can stay over content that scrolls');
  });

  it('a slot card may be positioned, but never over the road ahead', () => {
    const toast = clean({ id: 'look-offer', place: 'slot', positioned: ['absolute'], inScreen: true });
    const w = { width: 915, height: 412 };
    expect(cardFindings({ ...toast, box: box(12, 60, 200, 140) }, [], w)).toEqual([]);
    // The road ahead: the middle half across, 25-65 % down (core/layout.ts ROAD_AHEAD).
    expect(cardFindings({ ...toast, box: box(200, 120, 400, 200) }, [], w)).toEqual([
      'look-offer covers the road ahead',
    ]);
  });

  it("holds the same road ahead as core's ROAD_AHEAD", () => {
    const w = { width: 1000, height: 1000 };
    const toast = clean({ id: 'look-offer', place: 'slot', positioned: [] });
    const inside = { left: ROAD_AHEAD.left * 1000 + 1, top: ROAD_AHEAD.top * 1000 + 1 };
    const justOut = box(0, 0, ROAD_AHEAD.left * 1000, ROAD_AHEAD.top * 1000);
    expect(cardFindings({ ...toast, box: box(0, 0, inside.left, inside.top) }, [], w)).toEqual([
      'look-offer covers the road ahead',
    ]);
    expect(cardFindings({ ...toast, box: justOut }, [], w)).toEqual([]);
    const right = box(ROAD_AHEAD.right * 1000, ROAD_AHEAD.bottom * 1000, 1000, 1000);
    expect(cardFindings({ ...toast, box: right }, [], w)).toEqual([]);
  });

  it('names a card that is not drawn, not in its screen, covered, or off the side', () => {
    expect(cardFindings(clean({ shown: false }), menuAt568, viewport)).toEqual(['load-retry is not shown']);
    expect(
      cardFindings(clean({ inScreen: false, onTop: false, box: box(-4, 4, 300, 40) }), [], viewport),
    ).toEqual([
      'load-retry is not inside its screen',
      'load-retry leaves the screen sideways',
      'something lies over load-retry',
    ]);
  });
});
