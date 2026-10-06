import { expect, test, type Page } from '@playwright/test';
import {
  cardFindings,
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

/** A painted thing, and the transient card it belongs to (null when none): a card is never judged against itself. */
type Measured = PaintedThing & { owner: string | null };

interface Painted {
  cards: Omit<PaintedCard, 'place'>[];
  things: Measured[];
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
      // road chip scrolled out of its row, a blurb's clamped lines, the screen's own scroll).
      const painted = (b: B, from: Element | null): B | null => {
        let out = b;
        for (let p = from; p; p = p.parentElement) {
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
      };
      const things: Thing[] = [];
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
          });
        }
        return { cards, things, words, controls, boxes };
      }
      if (!screen) return { cards, things, words, controls, boxes };
      for (const e of screen.querySelectorAll<HTMLElement>('*')) {
        if (!seen(e)) continue;
        const owner = ownerOf(e);
        const own = painted(boxOf(e.getBoundingClientRect()), e.parentElement);
        if (own && e.matches('button, input, select, textarea, a, summary')) {
          controls++;
          things.push({ name: `the control ${nameOf(e)}`, kind: 'control', box: own, owner });
        }
        // A title's box and each card's box: a rotated, shadowed title or a dashed card under a card is
        // covered even where the box has no text of its own.
        if (own && e.matches('.title, h1, h2, h3, .card, .career-tally, .career-news')) {
          boxes++;
          const kind = e.matches('.card') ? 'card' : 'heading';
          things.push({
            name: `${kind === 'card' ? 'the card' : 'the title'} ${nameOf(e)}`,
            kind,
            box: own,
            owner,
          });
        }
        for (const n of e.childNodes) {
          if (n.nodeType !== Node.TEXT_NODE || (n.textContent ?? '').trim() === '') continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) {
            const line = painted(boxOf(r), e);
            if (!line) continue;
            words++;
            things.push({ name: `the words of ${nameOf(e)}`, kind: 'words', box: line, owner });
          }
        }
      }
      return { cards, things, words, controls, boxes };
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
      const found = judge(p, size);
      console.log(
        `${where}: cards ${cardIds.join(', ')}; ${p.words} words, ${p.controls} controls, ${p.boxes} boxes; findings ${JSON.stringify(found)}`,
      );
      // Soft, so one run names every screen and size that is wrong, not only the first.
      expect.soft(p.words, `${where}: words were examined`).toBeGreaterThan(0);
      expect.soft(p.controls + p.boxes, `${where}: controls and boxes were examined`).toBeGreaterThan(0);
      expect.soft(found, where).toEqual([]);
    }
    await scrollTo(page, screenSel, 0);
    const cardButtons = cardIds.map((id) => `#${id} button`);
    await expectReachable(page, reachable, cardButtons, `${label} at ${size.name}`);
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
    await expect(page.locator('#ui-notice'), 'the notice went with the start screen').toBeHidden();

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

test('the did-not-load card says what failed, waits out the host, and goes with its screen and a busy line', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  const sf = page.locator('#region-picker button.region', { hasText: 'San Francisco' });
  const keys = page.locator('#region-picker button.region', { hasText: 'Keys' });
  const card = page.locator('#load-retry');
  const words = page.locator('#load-retry .reload-offer-text');
  const retry = page.locator('#load-retry-button');
  const sfMaps = /\/assets\/osm-sf-[^/]*\.json(\?.*)?$/;

  // The host answers 429 and asks for 30 s, over the loader's 8 s cap: the loader gives up at once,
  // and the card says the game server had a problem, with Retry off and showing the wait.
  let asked = 0;
  await page.route(sfMaps, (route) => {
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
  await retry.click({ force: true });
  await frames(page, 4);
  expect(asked, 'a tap on Retry during the wait asks the host nothing').toBe(askedAtCard);
  // It sits first in the menu's column, above the title, not over it.
  const first = await page.evaluate(
    () => document.querySelector('#menu .menu-main')?.firstElementChild?.id ?? '',
  );
  expect(first).toBe('load-retry');

  // A dropped connection says to check the connection, and Retry is on.
  await page.unroute(sfMaps);
  await page.route(sfMaps, (route) => route.abort('internetdisconnected'));
  await keys.click();
  await expect(card, 'a new pick takes the card down').toBeHidden();
  await sf.click();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(words).toHaveText('San Francisco did not load. Check the connection, then tap Retry.');
  await expect(retry).toBeEnabled();
  await expect(retry).toHaveText('Retry');

  // Race runs the load again under a busy "Loading San Francisco" line: the card is not left beside it,
  // and comes back when the load fails again.
  await page.locator('#menu-race').click();
  await expect(page.locator('#busy')).toBeVisible();
  await expect(card).toBeHidden();
  await expect(page.locator('#busy')).toBeHidden({ timeout: 60_000 });
  await expect(card).toBeVisible();

  // The card belongs to the menu: the career does not carry it, and coming back does not bring it back.
  await page.locator('#menu-career').click();
  await expect(page.locator('#career')).toBeVisible();
  await expect(card).toBeHidden();
  await expect(page.locator('#career-tab-map')).toBeVisible();
  await page.locator('#career-back').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await expect(card).toBeHidden();
  await page.unroute(sfMaps);
});
