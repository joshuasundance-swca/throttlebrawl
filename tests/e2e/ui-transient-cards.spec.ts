import { expect, test, type Page } from '@playwright/test';
import { buildIdFindings, screenFitFindings, type BuildIdPlace } from '../../src/ui/screen-fit';
import {
  cardFindings,
  inViewFindings,
  TRANSIENT_CARDS,
  type PaintedCard,
  type PaintedThing,
} from '../../src/ui/transient-cards';
import { fastForwardDone, frames } from './lockstep';

// The transient-card rule (docs/architecture.md, "Transient cards"; src/ui/transient-cards.ts). A card
// the UI raises for a moment never lies over a title, a button, a chip or the road ahead. The bug class
// escaped three times in a week: the update card over the career result's title (#613, which this spec
// grew from: it was ui-reload-offer.spec.ts), the what's-new card over the route chips, and the
// did-not-load card (#614), a top-centre layer that hid the career's Map and Garage tabs at 915x412 and
// the title and all three region buttons at 568x320 (polish batch D's check, mustFix 1).
//
// So this raises every card of TRANSIENT_CARDS on every screen it can appear on (the start screen, the
// menu, the race options, the career, a race, the race's result and the career's result), through the
// `window.__uiCards` seam, at 915x412, the 16:9 phone layouts and 568x320, at every Text size, scrolled
// to the top, the middle and the end. `cardFindings` judges each card against everything painted on
// its screen: every control, title, card and line of words (and in a race every HUD piece and the road
// ahead). It also checks that each flow card is in its screen's flow (not fixed, sticky or absolute),
// that nothing lies over it, and that the screen's controls are still hit where they are drawn. Two
// negative controls put a card back where it used to be and the same check must name what it covers.
// A last test fails a region's map file for real and checks the did-not-load card's words, its Retry
// wait, and that it goes with its screen and with a busy "Loading ..." line.
//
// Polish batch E's check added three things. A raised card is IN VIEW, not only clear of what is
// under it: each card is raised again with its screen scrolled to the end and to the top, and
// `inViewFindings` must find it on the screen (mustFix 1: a failed career ride raised the card 420 to
// 590 px above the top of a career scrolled down to the event); a negative control scrolls it away and
// the judge must say so, and a real failed ride on a scrolled career is checked too. Each screen
// fits: `screenFitFindings` names a control, title or line of words that leaves the screen sideways,
// and the menu's footer drawn over anything (punch item 5: at 568x320, largest Text, the lower row was
// cut at both edges, and the scrolled menu's footer lay over Start career and Race), with a negative
// control for each. And the real-failure tests check the wait the loader keeps (punch item 2), a 404's
// Reload (punch item 3), the word in the route row's place (punch item 1) and the boot notice carried
// to the menu (punch item 4).
// `window.__reloadOffer = true` (src/app/index.ts, `testReloadOffer`) stands in for a deploy.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __reloadOffer?: boolean;
  __uiCards?: { raise(id: string): boolean };
  __game?: {
    setBot(on: boolean): void;
    state(): string;
    fastForward(until: () => boolean, opts?: { perFrame?: number }): void;
  };
};

const SIZES = [
  { name: '915x412', width: 915, height: 412 },
  { name: '854x480 (16:9)', width: 854, height: 480 },
  { name: '640x360 (16:9)', width: 640, height: 360 },
  { name: '568x320', width: 568, height: 320 },
] as const;

const TEXT_SIZES = ['normal', 'large', 'largest'] as const;

type ScreenName = (typeof TRANSIENT_CARDS)[number]['screens'][number];

/** The flow cards that can appear on `screen`, from the registry (a new card is checked by being listed). */
const flowCardsOn = (screen: ScreenName): string[] =>
  TRANSIENT_CARDS.filter((c) => c.place === 'flow' && c.screens.includes(screen)).map((c) => c.id);

/**
 * A painted thing, the transient card it belongs to (null when none: a card is never judged against
 * itself), and whether it is the footer's (the footer is never judged against its own words).
 */
type Measured = PaintedThing & { owner: string | null; inFooter: boolean };

interface Painted {
  cards: Omit<PaintedCard, 'place'>[];
  things: Measured[];
  /** The same things cut only by the clipping boxes inside the screen, not by the screen itself. */
  wide: PaintedThing[];
  /** The footer's lines of words as painted now (and the build line's, its stand-in at the end of the menu's column). */
  footer: PaintedThing['box'][];
  /** Where the build id is painted now, whole and on the screen (the menu's footer, the corner stamp, the line). */
  buildIds: BuildIdPlace[];
  words: number;
  controls: number;
  boxes: number;
}

/**
 * Everything painted now: each card in `cardIds` as the judge needs it, and every control, title,
 * card and line of words inside `screenSel` (or, for the race, the HUD pieces).
 */
async function paint(
  page: Page,
  screenSel: string,
  cardIds: readonly string[],
  race = false,
): Promise<Painted> {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  return page.evaluate(
    ({ sel, ids, race }) => {
      const boxOf = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      const seen = (e: Element) => e.checkVisibility() && getComputedStyle(e).visibility !== 'hidden';
      const screen = document.querySelector<HTMLElement>(sel);
      const cardEls = ids.map((id) => document.getElementById(id));
      const ownerOf = (e: Element) => ids.find((_, i) => cardEls[i]?.contains(e) ?? false) ?? null;
      const nameOf = (e: Element) =>
        `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''} "${(e.textContent ?? '').trim().slice(0, 24)}"`;
      type B = ReturnType<typeof boxOf>;
      // Only what is painted counts: a box is cut to every clipping box around it up to the screen (a
      // road chip scrolled out of its row, a blurb's clamped lines, the screen's own scroll). `inside`
      // stops below the screen: what the screen cuts off at its sides is what the fit check looks for.
      const painted = (b: B, from: Element | null, inside = false): B | null => {
        let out = b;
        for (let p = from; p; p = p.parentElement) {
          if (inside && p === screen) break;
          const cs = getComputedStyle(p);
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
            const r = p.getBoundingClientRect();
            out = {
              left: Math.max(out.left, r.left),
              top: Math.max(out.top, r.top),
              right: Math.min(out.right, r.right),
              bottom: Math.min(out.bottom, r.bottom),
            };
          }
          if (p === screen) break;
        }
        return out.right - out.left > 0.5 && out.bottom - out.top > 0.5 ? out : null;
      };
      const insideCard = (card: HTMLElement, x: number, y: number) => {
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return true; // off screen: not judged here
        const top = document.elementFromPoint(x, y);
        return !!top && card.contains(top);
      };
      const cards = ids.map((id, i) => {
        const card = cardEls[i];
        const shown = !!card && !!screen && seen(card) && seen(screen);
        const empty = { left: 0, top: 0, right: 0, bottom: 0 };
        if (!card || !shown)
          return { id, shown: false, inScreen: false, positioned: [], onTop: false, box: empty };
        const positioned: string[] = [];
        for (let p: HTMLElement | null = card; p && p !== screen; p = p.parentElement) {
          const pos = getComputedStyle(p).position;
          if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') positioned.push(pos);
        }
        const r = card.getBoundingClientRect();
        // Nothing lies over the card: a tap at its centre (a flow card takes touches on itself) and on
        // each of its buttons lands on the card.
        const points = [...card.querySelectorAll('button')]
          .filter(seen)
          .map((b) => b.getBoundingClientRect())
          .map((b) => [b.left + b.width / 2, b.top + b.height / 2] as const);
        if (!race) points.push([r.left + r.width / 2, r.top + r.height / 2]);
        return {
          id,
          shown,
          inScreen: !!screen && screen.contains(card),
          positioned,
          onTop: points.every(([x, y]) => insideCard(card, x, y)),
          box: boxOf(r),
        };
      });
      type Thing = {
        name: string;
        kind: 'control' | 'heading' | 'card' | 'words' | 'hud';
        box: ReturnType<typeof boxOf>;
        owner: string | null;
        inFooter: boolean;
      };
      const things: Thing[] = [];
      const wide: Omit<Thing, 'owner' | 'inFooter'>[] = [];
      const footer: B[] = [];
      let words = 0;
      let controls = 0;
      let boxes = 0;
      if (race) {
        const hud =
          '#hud-pause, .touch-button, #hud-speed, #hud-position, #hud-health, #hud-target, #hud-ticker, ' +
          '#hud-objective, #career-prompt, #hud-heat, #hud-wheelie, #countdown';
        for (const e of document.querySelectorAll(hud)) {
          if (!seen(e)) continue;
          controls++;
          things.push({
            name: `the HUD piece ${nameOf(e)}`,
            kind: 'hud',
            box: boxOf(e.getBoundingClientRect()),
            owner: null,
            inFooter: false,
          });
        }
        return { cards, things, wide, footer, buildIds: [], words, controls, boxes };
      }
      if (!screen) return { cards, things, wide, footer, buildIds: [], words, controls, boxes };
      for (const e of screen.querySelectorAll<HTMLElement>('*')) {
        if (!seen(e)) continue;
        const owner = ownerOf(e);
        const inFooter = !!e.closest('.footer, .menu-build-line');
        const rect = boxOf(e.getBoundingClientRect());
        const own = painted(rect, e.parentElement);
        const across = painted(rect, e.parentElement, true);
        if (e.matches('button, input, select, textarea, a, summary')) {
          const name = `the control ${nameOf(e)}`;
          if (across) wide.push({ name, kind: 'control', box: across });
          if (own) {
            controls++;
            things.push({ name, kind: 'control', box: own, owner, inFooter });
          }
        }
        // A title's box and each card's box: a rotated, shadowed title or a dashed card under a card is
        // covered even where the box has no text of its own.
        if (e.matches('.title, h1, h2, h3, .card, .career-tally, .career-news')) {
          const kind = e.matches('.card') ? 'card' : 'heading';
          const name = `${kind === 'card' ? 'the card' : 'the title'} ${nameOf(e)}`;
          if (across) wide.push({ name, kind, box: across });
          if (own) {
            boxes++;
            things.push({ name, kind, box: own, owner, inFooter });
          }
        }
        for (const n of e.childNodes) {
          if (n.nodeType !== Node.TEXT_NODE || (n.textContent ?? '').trim() === '') continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) {
            const name = `the words of ${nameOf(e)}`;
            const lineAcross = painted(boxOf(r), e, true);
            if (lineAcross) wide.push({ name, kind: 'words', box: lineAcross });
            const line = painted(boxOf(r), e);
            if (!line) continue;
            words++;
            things.push({ name, kind: 'words', box: line, owner, inFooter });
            if (inFooter) footer.push(line);
          }
        }
      }
      // The build id: each place it can be drawn, as painted whole (a half-cut line is not found).
      const buildIds: { name: 'the footer' | 'the corner stamp' | 'the build line'; box: B }[] = [];
      for (const [name, idSel] of [
        ['the footer', '#menu-build'],
        ['the corner stamp', '#build-stamp'],
        ['the build line', '#menu-build-line'],
      ] as const) {
        const e = document.querySelector(idSel);
        if (!e || !seen(e)) continue;
        const range = document.createRange();
        range.selectNodeContents(e);
        const raw = boxOf(range.getBoundingClientRect());
        const cut = painted(raw, e);
        const whole =
          !!cut &&
          Math.abs(cut.left - raw.left) < 1 &&
          Math.abs(cut.right - raw.right) < 1 &&
          Math.abs(cut.top - raw.top) < 1 &&
          Math.abs(cut.bottom - raw.bottom) < 1;
        if (whole) buildIds.push({ name, box: raw });
      }
      return { cards, things, wide, footer, buildIds, words, controls, boxes };
    },
    { sel: screenSel, ids: [...cardIds], race },
  );
}

/** What the judge finds wrong with each card painted now (empty when nothing is). */
function judge(p: Painted, viewport: { width: number; height: number }): string[] {
  return p.cards.flatMap((c) => {
    const place = TRANSIENT_CARDS.find((t) => t.id === c.id)?.place ?? 'flow';
    const others: PaintedThing[] = p.things.filter((t) => t.owner !== c.id);
    return cardFindings({ ...c, place }, others, viewport);
  });
}

/** What does not fit the screen painted now: a thing off its sides, the footer over anything. */
function fit(p: Painted, viewport: { width: number; height: number }): string[] {
  const painted: PaintedThing[] = p.things.filter((t) => !t.inFooter);
  return screenFitFindings({ wide: p.wide, painted, footer: p.footer }, viewport);
}

/** The scroll room a screen has (0 where it all fits). */
async function scrollRoom(page: Page, screenSel: string): Promise<number> {
  return page.evaluate((sel) => {
    const e = document.querySelector<HTMLElement>(sel);
    return e ? Math.max(0, e.scrollHeight - e.clientHeight) : 0;
  }, screenSel);
}

async function scrollTo(page: Page, screenSel: string, top: number) {
  await page.evaluate(({ sel, top }) => document.querySelector<HTMLElement>(sel)?.scrollTo({ top }), {
    sel: screenSel,
    top,
  });
}

/**
 * Each control the selectors name is hit where it is drawn (scrolled into view first). `required`
 * must name at least one shown control; `extra` (a card's own buttons) may name none.
 */
async function expectReachable(
  page: Page,
  required: readonly string[],
  extra: readonly string[],
  where: string,
) {
  const selectors = [...required, ...extra];
  const bad: string[] = [];
  let examined = 0;
  for (const sel of selectors) {
    const all = page.locator(sel);
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const target = all.nth(i);
      if (!(await target.isVisible())) continue;
      examined++;
      await target.scrollIntoViewIfNeeded();
      const ok = await target.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && (top === e || e.contains(top) || top.contains(e));
      });
      if (!ok) bad.push(`${sel} #${i}`);
    }
  }
  if (required.length > 0)
    expect.soft(examined, `${where}: controls were examined for a tap`).toBeGreaterThan(0);
  expect.soft(bad, `${where}: every control can be hit where it is drawn`).toEqual([]);
}

async function leaveFullscreen(page: Page) {
  // The start tap went fullscreen; a window resize needs it left first (platform-phone.spec.ts).
  await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
}

async function raise(page: Page, ids: readonly string[]) {
  for (const id of ids) {
    const up = await page.evaluate((id) => (window as TestWindow).__uiCards?.raise(id) ?? false, id);
    expect(up, `the seam raised ${id}`).toBe(true);
  }
}

/**
 * Each card, raised again with its screen scrolled to the end and to the top, comes up in view: the
 * screen brings it there (polish batch E's check, mustFix 1).
 */
async function checkInView(
  page: Page,
  screenSel: string,
  cardIds: readonly string[],
  size: { name: string; width: number; height: number },
  label: string,
) {
  const room = await scrollRoom(page, screenSel);
  // What's new is the one card never brought into view: on a short screen it sits under the menu, a
  // scroll away, so the menu's controls come first (ui-style-popups.spec.ts "menu fit").
  for (const id of cardIds.filter((c) => c !== 'whats-new')) {
    for (const at of room > 0 ? [1, 0] : [0]) {
      await scrollTo(page, screenSel, room * at);
      await raise(page, [id]);
      const p = await paint(page, screenSel, [id]);
      const card = p.cards[0];
      const found = card ? inViewFindings(id, card.box, size) : [`${id} was not measured`];
      const where = `${label} at ${size.name}: ${id} raised with the screen scrolled ${at * 100}% of ${Math.round(room)} px`;
      console.log(`${where}: box ${JSON.stringify(card?.box)}; findings ${JSON.stringify(found)}`);
      expect.soft(found, where).toEqual([]);
    }
  }
}

/** Every thing on `screenSel` fits the screen at every size and scroll position (no transient card needed). */
async function checkFit(page: Page, screenSel: string, label: string) {
  for (const size of SIZES) {
    await leaveFullscreen(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    const room = await scrollRoom(page, screenSel);
    for (const at of room > 0 ? [0, 0.5, 1] : [0]) {
      await scrollTo(page, screenSel, room * at);
      const where = `${label} at ${size.name}, scrolled ${at * 100}% of ${Math.round(room)} px`;
      const p = await paint(page, screenSel, []);
      const found = fit(p, size);
      console.log(
        `${where}: ${p.wide.length} things across, ${p.footer.length} footer lines; findings ${JSON.stringify(found)}`,
      );
      expect.soft(p.wide.length, `${where}: things on the screen were examined`).toBeGreaterThan(0);
      expect.soft(found, where).toEqual([]);
    }
    await scrollTo(page, screenSel, 0);
  }
}

/**
 * The menu's build id is findable at every size (polish batch I's check, punch 3: at the largest Text
 * size the menu scrolled and both the footer and the corner stamp gave way): painted whole on the
 * screen, covering no control, with the menu scrolled to the id when the id is the line at the end of
 * its column. A debug report and a playtest need it.
 */
async function checkBuildId(page: Page, label: string) {
  for (const size of SIZES) {
    await leaveFullscreen(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    await scrollTo(page, '#menu', 0);
    const line = page.locator('#menu-build-line');
    // A plain DOM scroll, not Playwright's scrollIntoViewIfNeeded: that waits for the line to hold still
    // over two frames, with no limit but the test's, and on two trains (382 and the one after #648
    // landed) this slice printed the menu's last fit line and then ran out its 10-minute job here
    // (the keeper, 2026-10-07; not reproduced locally, no browser slot). What is judged is the paint.
    if (await line.isVisible())
      await line.evaluate((e) => e.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    const p = await paint(page, '#menu', []);
    const found = buildIdFindings(
      p.buildIds,
      p.things.filter((t) => !t.inFooter),
      size,
    );
    const where = `${label} at ${size.name}`;
    console.log(
      `${where}: build id at ${p.buildIds.map((b) => b.name).join(', ') || 'nowhere'}; findings ${JSON.stringify(found)}`,
    );
    expect.soft(found, `${where}: the build id is on the menu and covers nothing`).toEqual([]);
    await scrollTo(page, '#menu', 0);
  }
}

/** Every card in `cardIds` is clear of everything on `screenSel` at every size and scroll position. */
async function checkScreen(
  page: Page,
  screenSel: string,
  cardIds: readonly string[],
  reachable: readonly string[],
  label: string,
) {
  for (const size of SIZES) {
    await leaveFullscreen(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    const room = await scrollRoom(page, screenSel);
    for (const at of room > 0 ? [0, 0.5, 1] : [0]) {
      await scrollTo(page, screenSel, room * at);
      const where = `${label} at ${size.name}, scrolled ${at * 100}% of ${Math.round(room)} px`;
      const p = await paint(page, screenSel, cardIds);
      const found = [...judge(p, size), ...fit(p, size)];
      console.log(
        `${where}: cards ${cardIds.join(', ')}; ${p.words} words, ${p.controls} controls, ${p.boxes} boxes, ${p.wide.length} across; findings ${JSON.stringify(found)}`,
      );
      // Soft, so one run names every screen and size that is wrong, not only the first.
      // Only what is painted is examined, so scrolled to the middle of a long result it may be words alone.
      expect
        .soft(p.words + p.controls + p.boxes, `${where}: things on the screen were examined`)
        .toBeGreaterThan(0);
      expect.soft(found, where).toEqual([]);
    }
    await scrollTo(page, screenSel, 0);
    // Scrolled to the top, each card starts on the screen: none stands out above it, where no scroll
    // reaches (train 237: the menu row centred a column taller than the screen).
    for (const id of cardIds) {
      const top = (await page.locator(`#${id}`).boundingBox())?.y ?? -1;
      expect.soft(top, `${label} at ${size.name}: ${id} starts on the screen`).toBeGreaterThanOrEqual(0);
    }
    const cardButtons = cardIds.map((id) => `#${id} button`);
    await expectReachable(page, reachable, cardButtons, `${label} at ${size.name}`);
    await checkInView(page, screenSel, cardIds, size, label);
    await scrollTo(page, screenSel, 0);
  }
}

/** The slow-frames offer in its slot during a race: clear of every HUD piece and the road ahead. */
async function checkRace(page: Page, label: string) {
  for (const size of SIZES) {
    await leaveFullscreen(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    await frames(page, 2);
    const where = `${label} at ${size.name}`;
    const p = await paint(page, '#hud', ['look-offer'], true);
    const found = judge(p, size);
    console.log(`${where}: ${p.controls} HUD pieces; findings ${JSON.stringify(found)}`);
    expect.soft(p.controls, `${where}: HUD pieces were examined`).toBeGreaterThan(0);
    expect.soft(found, where).toEqual([]);
  }
}

async function setTextSize(page: Page, textSize: (typeof TEXT_SIZES)[number]) {
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-access').click();
  const pick = page.locator(`#settings-textSize [data-value="${textSize}"]`);
  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#settings-back').click();
  await expect(page.locator('#menu-race')).toBeVisible();
}

async function rideToTheEnd(page: Page, what: string) {
  await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    g?.setBot(true);
    g?.fastForward(() => false, { perFrame: 1200 });
  });
  await fastForwardDone(page, what);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    (window as TestWindow).__reloadOffer = true;
  });
});

for (const textSize of TEXT_SIZES) {
  test(`no transient card covers anything on any screen it can appear on, at Text size ${textSize}`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    // The Text size is saved first, so the start screen after a reload draws at it.
    await page.goto('./?settings=all');
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await setTextSize(page, textSize);
    await page.reload();

    // The start screen: a notice (a save that could not be read) sits in its flow.
    await expect(page.locator('#start-screen')).toBeVisible();
    await raise(page, flowCardsOn('start'));
    await checkScreen(page, '#start-screen', flowCardsOn('start'), [], `start, ${textSize}`);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#start-screen .title').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    // A notice on the start screen is carried to the menu the tap opens (polish batch E, punch 4), and
    // sits first in the menu's column.
    await expect(page.locator('#ui-notice'), 'the notice is carried to the menu').toBeVisible();
    expect(
      await page.evaluate(() =>
        document.querySelector('#menu .menu-main')?.contains(document.getElementById('ui-notice')),
      ),
    ).toBe(true);

    // The menu: what's new, the did-not-load card and a notice together.
    await raise(page, flowCardsOn('menu'));
    const menuControls = [
      '#menu-career',
      '#menu-race',
      '#menu-options',
      '#menu-settings',
      '#region-picker button.region',
    ];
    await checkScreen(page, '#menu', flowCardsOn('menu'), menuControls, `menu, ${textSize}`);
    if (textSize === 'normal') {
      // Negative control 1: the did-not-load card where #614 put it (a layer at the top centre). At
      // 568x320 it lies over the title and the region buttons again (polish batch D, mustFix 1), and
      // the same judge says so.
      await leaveFullscreen(page);
      await page.setViewportSize({ width: 568, height: 320 });
      await scrollTo(page, '#menu', 0);
      expect(
        judge(await paint(page, '#menu', ['load-retry']), { width: 568, height: 320 }),
        'the control starts clean',
      ).toEqual([]);
      // As #614 drew it: a layer at the top centre, its width what is left right of the middle, and
      // the menu laid out as the live check saw it (the notice raised above is set aside).
      const oldPlace = await page.addStyleTag({
        content:
          '#ui #load-retry { position: fixed !important; top: 10px; left: 50%; transform: translateX(-50%); ' +
          'z-index: 2; width: auto !important; max-width: 92vw !important; margin: 0 !important; } ' +
          '#ui #ui-notice { display: none !important; }',
      });
      const old = judge(await paint(page, '#menu', ['load-retry']), { width: 568, height: 320 });
      console.log(`negative control 1: ${JSON.stringify(old)}`);
      expect(old).toContain('load-retry is fixed, so it can stay over content that scrolls');
      expect(old.filter((f) => f.startsWith('load-retry covers'))).not.toEqual([]);
      await oldPlace.evaluate((e) => (e as HTMLElement).remove());

      // Negative control 3: a menu column wider than the screen (as the did-not-load card's one-line
      // width made it at 568x320 and the largest Text size): the fit check names what it cuts off.
      expect(fit(await paint(page, '#menu', []), { width: 568, height: 320 }), 'the menu fits').toEqual([]);
      const wideMenu = await page.addStyleTag({
        // Its rows as wide as the column, their buttons out at the row's ends (a wider column alone
        // keeps its centred rows on the screen, and the check rightly finds nothing).
        content:
          '#ui #menu .menu-main { min-width: 130vw !important; max-width: none !important; } ' +
          '#ui #menu .menu-main > .row { align-self: stretch !important; justify-content: space-between !important; }',
      });
      const cut = fit(await paint(page, '#menu', []), { width: 568, height: 320 });
      console.log(`negative control 3: ${JSON.stringify(cut)}`);
      expect(cut.filter((f) => f.endsWith('leaves the screen sideways'))).not.toEqual([]);
      await wideMenu.evaluate((e) => (e as HTMLElement).remove());

      // Negative control 4: the footer drawn over Race, as the scrolled menu drew it over Start career
      // and Race: the fit check names it.
      const raceAt = await page.evaluate(() => {
        const menu = document.getElementById('menu')!;
        const m = menu.getBoundingClientRect();
        const race = document.getElementById('menu-race')!.getBoundingClientRect();
        return {
          top: race.top - m.top + menu.scrollTop + race.height / 2 - 8,
          left: race.left - m.left + menu.scrollLeft,
          width: race.width,
        };
      });
      const overRace = await page.addStyleTag({
        content:
          `#ui #menu #menu-build { display: block !important; visibility: visible !important; ` +
          `top: ${raceAt.top}px !important; bottom: auto !important; left: ${raceAt.left}px !important; ` +
          `right: auto !important; width: ${raceAt.width}px !important; }`,
      });
      const covered = fit(await paint(page, '#menu', []), { width: 568, height: 320 });
      console.log(`negative control 4: ${JSON.stringify(covered)}`);
      expect(
        covered.filter((f) => f.startsWith('the footer covers the control button#menu-race')),
      ).not.toEqual([]);
      await overRace.evaluate((e) => (e as HTMLElement).remove());
    }

    // The race options: the cards raised there sit in its flow; Back takes them down.
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#menu-options').click();
    await expect(page.locator('#race-options')).toBeVisible();
    await expect(page.locator('#load-retry'), 'the menu card went with the menu').toBeHidden();
    await raise(page, flowCardsOn('raceOptions'));
    await checkScreen(
      page,
      '#race-options',
      flowCardsOn('raceOptions'),
      ['#race-options-back'],
      `race options, ${textSize}`,
    );
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#race-options-back').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await expect(page.locator('#load-retry')).toBeHidden();
    await expect(page.locator('#ui-notice')).toBeHidden();
    // The menu as the player comes back to it fits every phone size: no row off its sides, and the
    // footer over nothing, at every scroll.
    await checkFit(page, '#menu', `menu, ${textSize}`);
    await checkBuildId(page, `menu, ${textSize}`);
    if (textSize === 'largest') {
      // Negative control 6: no footer, no stamp and no line (as the largest Text size left the menu
      // before the line): the same judge says the menu shows no build id.
      await leaveFullscreen(page);
      await page.setViewportSize({ width: 568, height: 320 });
      const none = await page.addStyleTag({
        content:
          '#ui #menu #menu-build, #ui #menu .menu-build-line, #build-stamp { display: none !important; }',
      });
      const bare = await paint(page, '#menu', []);
      const missing = buildIdFindings(
        bare.buildIds,
        bare.things.filter((t) => !t.inFooter),
        { width: 568, height: 320 },
      );
      console.log(`negative control 6: ${JSON.stringify(missing)}`);
      expect(missing).toEqual(['the menu shows no build id']);
      await none.evaluate((e) => (e as HTMLElement).remove());
    }
    await page.setViewportSize({ width: 915, height: 412 });

    // The career: the K2 card hid its Map and Garage tabs.
    await page.locator('#menu-career').click();
    await expect(page.locator('#career')).toBeVisible();
    await raise(page, flowCardsOn('career'));
    await checkScreen(
      page,
      '#career',
      flowCardsOn('career'),
      ['#career-back', '#career-tab-map', '#career-tab-garage'],
      `career, ${textSize}`,
    );
    if (textSize === 'normal') {
      // Negative control 5: a raised card scrolled out of view. Raised, it is in view; with the career
      // scrolled away from it, the same judge says it is not.
      await leaveFullscreen(page);
      await page.setViewportSize({ width: 915, height: 412 });
      // The suggested event's card under the map gives the career its scroll room (the live check's case).
      await page.locator('.career-node.suggested').click();
      await expect(page.locator('#career-ride')).toBeVisible();
      await raise(page, ['load-retry']);
      const view = { width: 915, height: 412 };
      const shown = (await paint(page, '#career', ['load-retry'])).cards[0];
      expect(shown && inViewFindings('load-retry', shown.box, view), 'raised: in view').toEqual([]);
      const room = await scrollRoom(page, '#career');
      expect(room, 'the career scrolls at 915x412 (the control needs room)').toBeGreaterThan(100);
      await scrollTo(page, '#career', room);
      const away = (await paint(page, '#career', ['load-retry'])).cards[0];
      const found = away ? inViewFindings('load-retry', away.box, view) : [];
      console.log(`negative control 5: ${JSON.stringify(found)}`);
      expect(found.filter((f) => f.startsWith('load-retry is out of view'))).not.toEqual([]);
      await scrollTo(page, '#career', 0);
    }
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#career-back').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await expect(page.locator('#load-retry'), 'the career card went with the career').toBeHidden();

    // A race: the slow-frames offer in its slot, then the race's result with every card it can carry.
    await page.locator('#menu-race').click();
    await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
    await raise(page, ['look-offer']);
    await checkRace(page, `race, ${textSize}`);
    await page.setViewportSize({ width: 915, height: 412 });
    await rideToTheEnd(page, 'the quick race, to its end');
    await expect(page.locator('#results')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#reload-offer')).toBeVisible();
    await expect(page.locator('#reload-offer .reload-offer-text')).toHaveText(
      'The game was updated while you raced. It reloads when you go back to the menu.',
    );
    await raise(page, ['load-retry', 'ui-notice']);
    await checkScreen(
      page,
      '#results',
      flowCardsOn('results'),
      ['#results-place', '#results-menu', '#results-race'],
      `race result, ${textSize}`,
    );
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#results-menu').click();
    await expect(page.locator('#menu-career')).toBeVisible();
    await expect(page.locator('#reload-offer')).toBeHidden();
    await expect(page.locator('#load-retry')).toBeHidden();

    // The career's result (the first event, ridden by the bot).
    await page.locator('#menu-career').click();
    await page.locator('.career-node.suggested').click();
    await page.locator('#career-ride').click();
    await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
    await rideToTheEnd(page, 'the first career race, to its end');
    await expect(page.locator('#career-results')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#reload-offer')).toBeVisible();
    await expect(page.locator('#reload-offer .reload-offer-text')).toHaveText(
      'The game was updated while you raced. It reloads when you go to the map.',
    );
    await raise(page, ['load-retry', 'ui-notice']);
    await checkScreen(
      page,
      '#career-results',
      flowCardsOn('careerResults'),
      ['#career-results-title', '#career-results-map', '#career-results-retry'],
      `career result, ${textSize}`,
    );

    if (textSize === 'normal') {
      // Negative control 2: the update card where it was before #613 (fixed at the top centre). At
      // 915x412 it lies over the career result's title again, and the same judge says so.
      await leaveFullscreen(page);
      await page.setViewportSize({ width: 915, height: 412 });
      await scrollTo(page, '#career-results', 0);
      expect(
        judge(await paint(page, '#career-results', ['reload-offer']), { width: 915, height: 412 }),
      ).toEqual([]);
      const oldPlace = await page.addStyleTag({
        content:
          '#ui #reload-offer { position: fixed !important; top: 10px; left: 50%; transform: translateX(-50%); z-index: 2; }',
      });
      const old = judge(await paint(page, '#career-results', ['reload-offer']), { width: 915, height: 412 });
      console.log(`negative control 2: ${JSON.stringify(old)}`);
      expect(old).toContain('reload-offer is fixed, so it can stay over content that scrolls');
      expect(old.filter((f) => f.startsWith('reload-offer covers'))).not.toEqual([]);
      await oldPlace.evaluate((e) => (e as HTMLElement).remove());
    }

    // Leaving by the Map is the way out that reloads; with no deploy it only opens the map.
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#career-results-map').click();
    await expect(page.locator('#career')).toBeVisible();
    await expect(page.locator('#reload-offer')).toBeHidden();
    await expect(page.locator('#load-retry')).toBeHidden();
  });
}

/** A region chip on the menu, by its name. */
const regionChip = (page: Page, name: string) =>
  page.locator('#region-picker button.region', { hasText: name });
const SF_MAPS = /\/assets\/osm-sf-[^/]*\.json(\?.*)?$/;
const KEYS_MAPS = /\/assets\/osm-keys-[^/]*\.json(\?.*)?$/;

/** How many painted lines of words on the screen say `words` (a leaf element's text matches). */
const linesSaying = (page: Page, words: RegExp) =>
  page.evaluate(
    ({ source }) =>
      [...document.querySelectorAll('#ui *, #build-stamp')].filter(
        (e) => e.children.length === 0 && e.checkVisibility() && new RegExp(source).test(e.textContent ?? ''),
      ).length,
    { source: words.source },
  );

async function toMenu(page: Page) {
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
}

test('the did-not-load card says what failed, goes with its screen and a busy line, and the menu still says why', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await toMenu(page);
  const sf = regionChip(page, 'San Francisco');
  const keys = regionChip(page, 'Keys');
  const card = page.locator('#load-retry');
  const words = page.locator('#load-retry .reload-offer-text');
  const retry = page.locator('#load-retry-button');
  const note = page.locator('#route-note');

  // A dropped connection says to check the connection, and Retry is on. While the roads load, the
  // route row's place says so.
  await page.route(SF_MAPS, (route) => route.abort('internetdisconnected'));
  await sf.click();
  await expect(note).toHaveText('Loading San Francisco…');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(words).toHaveText('San Francisco did not load. Check the connection, then tap Retry.');
  await expect(retry).toBeEnabled();
  await expect(retry).toHaveText('Retry');
  // It sits first in the menu's column, above the title, not over it; the card says it, so the
  // route row's word steps aside.
  const first = await page.evaluate(
    () => document.querySelector('#menu .menu-main')?.firstElementChild?.id ?? '',
  );
  expect(first).toBe('load-retry');
  await expect(note).toBeHidden();

  // Race runs the load again under a busy "Loading San Francisco" line: the card is not left beside it,
  // and comes back when the load fails again.
  await page.locator('#menu-race').click();
  await expect(page.locator('#busy')).toBeVisible();
  await expect(card).toBeHidden();
  // One place says it, once (polish batch I's check, note-915: the route row's dimmed word drew through
  // the busy line, so "Loading San Francisco" showed doubled): the word steps aside under the line.
  await expect(note).toBeHidden();
  expect(await linesSaying(page, /Loading San Francisco/), 'the busy line says it once').toBe(1);
  // Negative control 7: the word drawn under the line as it was; the same count says twice.
  const doubled = await page.addStyleTag({
    content: '#ui #route-note[hidden] { display: block !important; }',
  });
  expect(await linesSaying(page, /Loading San Francisco/), 'control: the word drawn too').toBe(2);
  await doubled.evaluate((e) => (e as HTMLElement).remove());
  await expect(page.locator('#busy')).toBeHidden({ timeout: 60_000 });
  await expect(card).toBeVisible();

  // The card belongs to the menu: the career does not carry it, and coming back does not bring it
  // back. The menu still says why there is no route row (polish batch E's check, punch item 1).
  await page.locator('#menu-career').click();
  await expect(page.locator('#career')).toBeVisible();
  await expect(card).toBeHidden();
  await expect(page.locator('#career-tab-map')).toBeVisible();
  await page.locator('#career-back').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await expect(card).toBeHidden();
  await expect(sf).toHaveAttribute('aria-checked', 'true');
  await expect(note).toBeVisible();
  await expect(note).toHaveText(
    'San Francisco did not load. Check the connection, then tap Race to try again.',
  );
  // The same after the settings and the race options.
  for (const [open, back] of [
    ['#menu-settings', '#settings-back'],
    ['#menu-options', '#race-options-back'],
  ] as const) {
    await page.locator(open).click();
    await page.locator(back).click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await expect(note, `back from ${open}`).toBeVisible();
  }
  // Control: a region whose roads are in has its route row and no word.
  await keys.click();
  await expect(note).toBeHidden();
  await expect(card, 'a new pick takes the card down').toBeHidden();
  await page.unroute(SF_MAPS);
});

test('the host asked for a wait: every load path waits it out, with the same countdown, and never asks', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await toMenu(page);
  const sf = regionChip(page, 'San Francisco');
  const keys = regionChip(page, 'Keys');
  const card = page.locator('#load-retry');
  const words = page.locator('#load-retry .reload-offer-text');
  const retry = page.locator('#load-retry-button');

  // The host answers 429 and asks for 30 s, over the loader's 8 s cap: the loader gives up at once,
  // and the card says the game server had a problem, with Retry off and showing the wait.
  let asked = 0;
  await page.route(SF_MAPS, (route) => {
    asked++;
    return route.fulfill({ status: 429, headers: { 'Retry-After': '30' }, body: 'busy' });
  });
  await sf.click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(words).toHaveText(
    'San Francisco did not load: the game server had a problem. Try again shortly.',
  );
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveText(/^Retry in (30|29|28|27|26|25) s$/);
  const askedAtCard = asked;
  expect(askedAtCard, 'the pick asked the host').toBeGreaterThan(0);
  await retry.click({ force: true });
  await frames(page, 4);
  expect(asked, 'a tap on Retry during the wait asks the host nothing').toBe(askedAtCard);

  // Polish batch I's check, punch 4: off the menu and back, the card has gone with its screen and the
  // route row's word says the time left, the card's own seconds (read in one step, so one tick).
  await page.locator('#menu-settings').click();
  await page.locator('#settings-back').click();
  const word = page.locator('#route-note');
  await expect(word).toBeVisible();
  await expect(word).toHaveText(
    /^San Francisco did not load: the game server had a problem\. Tap Race to try again in \d+ s\.$/,
  );
  const seconds = await page.evaluate(() => ({
    word: /in (\d+) s/.exec(document.getElementById('route-note')?.textContent ?? '')?.[1] ?? 'none',
    button: /in (\d+) s/.exec(document.getElementById('load-retry-button')?.textContent ?? '')?.[1] ?? 'none',
  }));
  expect(seconds.word, 'the word counts the same seconds as the card').toBe(seconds.button);
  expect(Number(seconds.word)).toBeGreaterThan(0);
  expect(Number(seconds.word)).toBeLessThanOrEqual(30);

  // Polish batch E's check, punch item 2: a new pick and a Race tap asked for every file at once. Now
  // the wait is the loader's: each says the same wait at once, and the host is not asked.
  await keys.click();
  await expect(card, 'a new pick takes the card down').toBeHidden();
  await sf.click();
  await expect(card).toBeVisible();
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveText(/^Retry in (30|29|28|27|26|25|24|23|22|21|20) s$/);
  expect(asked, 'a new pick during the wait asks the host nothing').toBe(askedAtCard);
  await page.locator('#menu-race').click();
  await expect(page.locator('#busy')).toBeHidden({ timeout: 30_000 });
  await expect(card).toBeVisible();
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveText(/^Retry in \d+ s$/);
  expect(asked, 'a Race tap during the wait asks the host nothing').toBe(askedAtCard);
  await page.unroute(SF_MAPS);
});

test("a 404 says this build's files are gone and offers Reload, not Retry", async ({ page }) => {
  test.setTimeout(120_000);
  await toMenu(page);
  const card = page.locator('#load-retry');
  const button = page.locator('#load-retry-button');
  let asked = 0;
  await page.route(SF_MAPS, (route) => {
    asked++;
    return route.fulfill({ status: 404, body: 'gone' });
  });
  await regionChip(page, 'San Francisco').click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#load-retry .reload-offer-text')).toHaveText(
    "San Francisco did not load: this build's files are gone, most likely because a newer build replaced them. Reload for the newest build.",
  );
  await expect(button).toHaveText('Reload');
  await expect(button).toBeEnabled();
  // Off the menu and back, the route row's place says the same.
  await page.locator('#menu-settings').click();
  await page.locator('#settings-back').click();
  await expect(page.locator('#route-note')).toHaveText(
    "San Francisco did not load: this build's files are gone. Reload the game for the newest build.",
  );
  // The word has the Reload action beside it (polish batch I's check, punch 4), not only advice.
  await expect(page.locator('#route-note-action')).toBeVisible();
  await expect(page.locator('#route-note-action')).toHaveText('Reload');
  // Race asks again and brings the card back; its Reload reloads the page.
  await page.locator('#menu-race').click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  expect(asked, 'the host was asked (the pick, then Race)').toBeGreaterThan(0);
  await Promise.all([page.waitForEvent('load'), button.click()]);
  await expect(page.locator('#start-screen')).toBeVisible();
  await page.unroute(SF_MAPS);
});

test('a failed career ride raises the did-not-load card in view, on a career scrolled down to the event', async ({
  page,
}) => {
  test.setTimeout(180_000);
  // Polish batch E's check, mustFix 1, step for step: the Keys' real roads fail from the first load,
  // Start career, the suggested event, Ride. The card came up 420 to 590 px above the screen's top.
  await page.route(KEYS_MAPS, (route) => route.fulfill({ status: 503, body: 'down' }));
  await toMenu(page);
  const card = page.locator('#load-retry');
  // The boot load's card is on the menu first (it waits for the menu); the career does not carry it.
  await expect(card).toBeVisible({ timeout: 60_000 });
  await page.locator('#menu-career').click();
  await expect(page.locator('#career')).toBeVisible();
  await expect(card).toBeHidden();
  for (const size of [
    { width: 915, height: 412 },
    { width: 568, height: 320 },
  ]) {
    await leaveFullscreen(page);
    await page.setViewportSize(size);
    await page.locator('.career-node.suggested').click();
    await expect(page.locator('#career-ride')).toBeEnabled();
    const room = await scrollRoom(page, '#career');
    await scrollTo(page, '#career', room);
    const scrolled = await page.evaluate(() => document.getElementById('career')?.scrollTop ?? 0);
    // The precondition the check needs: the screen is scrolled down when the ride fails.
    expect(
      scrolled,
      `${size.width}x${size.height}: the career is scrolled down to the event`,
    ).toBeGreaterThan(100);
    await page.locator('#career-ride').click();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#load-retry .reload-offer-text')).toHaveText(
      'The Keys did not load: the game server had a problem. Try again shortly.',
    );
    const p = await paint(page, '#career', ['load-retry']);
    const box = p.cards[0]?.box ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const found = inViewFindings('load-retry', box, size);
    console.log(
      `career ride at ${size.width}x${size.height}: from scrollTop ${scrolled}, card ${JSON.stringify(box)}; findings ${JSON.stringify(found)}`,
    );
    expect(found, `${size.width}x${size.height}: the card is in view`).toEqual([]);
    // Retry is there to tap, where it is drawn.
    await expectReachable(page, [], ['#load-retry button'], `career ride at ${size.width}x${size.height}`);
  }
  await page.unroute(KEYS_MAPS);
});

test('the boot notice (settings from a newer build) is carried to the menu a quick start tap opens', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const record = {
      format: 'settings',
      version: 99,
      build: 'later',
      savedAt: '2026-10-06T00:00:00.000Z',
      data: {},
    };
    localStorage.setItem('mbrawl:settings', JSON.stringify(record));
  });
  await page.goto('./');
  const notice = page.locator('#ui-notice');
  const words = 'Settings come from a newer build; using defaults and keeping them untouched.';
  await expect(notice).toHaveText(words);
  // The tap at once, well inside the notice's 4 s: the menu says it (polish batch E's check, punch
  // item 4: it went with the start screen and was never said again).
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(words);
  expect(
    await page.evaluate(() =>
      document.querySelector('#menu .menu-main')?.contains(document.getElementById('ui-notice')),
    ),
    'first in the menu column',
  ).toBe(true);
});

test("the route row's Reload and its wait fit every size and Text size, and a tap on Reload reloads", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await toMenu(page);
  const card = page.locator('#load-retry');
  await page.route(SF_MAPS, (route) => route.fulfill({ status: 404, body: 'gone' }));
  await regionChip(page, 'San Francisco').click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  for (const textSize of TEXT_SIZES) {
    await leaveFullscreen(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#menu-settings').click();
    await page.locator('#settings-tab-access').click();
    const pick = page.locator(`#settings-textSize [data-value="${textSize}"]`);
    await pick.click();
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#settings-back').click();
    const action = page.locator('#route-note-action');
    await expect(action, `the Reload beside the word, ${textSize}`).toBeVisible();
    // The word and its button fit every phone size at every scroll, are hit where drawn, and the
    // build id is on the menu with them there.
    await checkFit(page, '#menu', `menu with the route Reload, ${textSize}`);
    await checkBuildId(page, `menu with the route Reload, ${textSize}`);
    for (const size of SIZES) {
      await leaveFullscreen(page);
      await page.setViewportSize({ width: size.width, height: size.height });
      await expectReachable(
        page,
        ['#route-note-action', '#menu-race'],
        [],
        `menu with the route Reload, ${textSize} at ${size.name}`,
      );
      const across = await page.evaluate(() => {
        const r = document.getElementById('route-note-action')?.getBoundingClientRect();
        return !!r && r.left >= -0.5 && r.right <= window.innerWidth + 0.5;
      });
      expect.soft(across, `${textSize}, ${size.name}: the button is across the screen`).toBe(true);
    }
  }
  // The wait too, at the largest Text size (the last of the loop): the longest word the row says.
  await page.unroute(SF_MAPS);
  await page.route(SF_MAPS, (route) =>
    route.fulfill({ status: 429, headers: { 'Retry-After': '30' }, body: 'busy' }),
  );
  await regionChip(page, 'Keys').click();
  await regionChip(page, 'San Francisco').click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await page.locator('#menu-settings').click();
  await page.locator('#settings-back').click();
  await expect(page.locator('#route-note')).toHaveText(/ Tap Race to try again in \d+ s\.$/);
  await expect(page.locator('#route-note-action'), 'a 429 offers no Reload').toBeHidden();
  await checkFit(page, '#menu', 'menu with the route wait, largest');
  await checkBuildId(page, 'menu with the route wait, largest');
  await page.unroute(SF_MAPS);
  // A tap on the word's Reload reloads the page, for the newest build.
  await page.route(SF_MAPS, (route) => route.fulfill({ status: 404, body: 'gone' }));
  await regionChip(page, 'Keys').click();
  await regionChip(page, 'San Francisco').click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await page.locator('#menu-settings').click();
  await page.locator('#settings-back').click();
  await leaveFullscreen(page);
  await page.setViewportSize({ width: 915, height: 412 });
  await page.locator('#route-note-action').scrollIntoViewIfNeeded();
  await Promise.all([page.waitForEvent('load'), page.locator('#route-note-action').click()]);
  await expect(page.locator('#start-screen')).toBeVisible();
  await page.unroute(SF_MAPS);
});
