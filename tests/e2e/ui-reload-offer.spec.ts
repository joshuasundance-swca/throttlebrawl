import { expect, test, type Page } from '@playwright/test';
import { fastForwardDone } from './lockstep';

// The update card on a result screen (playtest 4 run A's second fix check, mustFix: on the career
// result at 915x412 the card, x 229-686 and y 10-64, lay over the title "5TH OF 5. CLEARED." and it
// could not be read; the quick race's result was clear). The card says a deploy replaced the game
// while the player raced and offers "Reload now". It now sits inside the result screen that is
// showing, as that screen's first line, so it takes its own room and scrolls away with the screen.
// This measures it on the painted boxes: on both result screens (the race's and the career's), at
// 915x412, the 16:9 phone layouts and the smallest phone, at every Text size, scrolled to the top, the
// middle and the end: it lies over no word, no control and no card of the screen, it is not
// positioned (fixed, sticky or absolute) so it cannot stay over content that scrolls, and every
// control of the screen can still be hit. The words say exactly when it reloads. A negative control
// puts the card back where it was (fixed at the top) and the same check names the title it covers.
// `window.__reloadOffer = true` (src/app/index.ts, `testReloadOffer`) stands in for a deploy.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __reloadOffer?: boolean;
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

interface Found {
  findings: string[];
  words: number;
  controls: number;
  boxes: number;
}

/**
 * What is wrong with the card on `screenSel` as painted now: it lies over a word, a control, a
 * title or a card of the screen; it is covered itself; it leaves the screen sideways; or it is
 * positioned so it can stay put while the screen scrolls. Also how many words, controls and boxes
 * were examined (a check that examined nothing proves nothing).
 */
async function offerFindings(page: Page, screenSel: string): Promise<Found> {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  return page.evaluate((sel) => {
    interface R4 {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }
    const hit = (a: R4, b: R4) =>
      a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const out = new Set<string>();
    const screen = document.querySelector<HTMLElement>(sel);
    const card = document.getElementById('reload-offer');
    if (!screen || !screen.checkVisibility())
      return { findings: [`${sel} is not shown`], words: 0, controls: 0, boxes: 0 };
    if (!card || !card.checkVisibility())
      return { findings: ['the update card is not shown'], words: 0, controls: 0, boxes: 0 };
    if (!screen.contains(card)) out.add('the update card is not inside the result screen');
    const cr = card.getBoundingClientRect();
    if (cr.left < -0.5 || cr.right > window.innerWidth + 0.5)
      out.add('the update card leaves the screen sideways');
    // Nothing between the card and its screen takes it out of the flow.
    for (let p: HTMLElement | null = card; p && p !== screen.parentElement; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (p !== screen && (pos === 'fixed' || pos === 'sticky' || pos === 'absolute'))
        out.add(`the update card is ${pos}, so it can stay over content that scrolls`);
    }
    const nameOf = (e: HTMLElement) =>
      `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''} "${(e.textContent ?? '').trim().slice(0, 24)}"`;
    let words = 0;
    let controls = 0;
    let boxes = 0;
    for (const e of screen.querySelectorAll<HTMLElement>('*')) {
      if (card.contains(e) || !e.checkVisibility() || getComputedStyle(e).visibility === 'hidden') continue;
      if (e.matches('button, input, select, textarea, a, summary')) {
        controls++;
        if (hit(cr, e.getBoundingClientRect())) out.add(`the update card covers the control ${nameOf(e)}`);
      }
      // The title's box and each card's box: a rotated, shadowed title or a dashed card under the
      // update card is covered even where the box has no text of its own.
      if (e.matches('.title, .card, .career-tally, .career-news')) {
        boxes++;
        if (hit(cr, e.getBoundingClientRect())) out.add(`the update card covers ${nameOf(e)}`);
      }
      for (const n of e.childNodes) {
        if (n.nodeType !== Node.TEXT_NODE || (n.textContent ?? '').trim() === '') continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (r.width < 0.5 || r.height < 0.5) continue;
          words++;
          if (hit(cr, r)) out.add(`the update card covers the words of ${nameOf(e)}`);
        }
      }
    }
    // The card itself is on top where it is drawn on the screen (nothing lies over it).
    const cx = cr.left + cr.width / 2;
    const cy = cr.top + cr.height / 2;
    if (cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight) {
      const top = document.elementFromPoint(cx, cy);
      if (!top || !card.contains(top)) out.add('something lies over the update card');
    }
    return { findings: [...out].sort(), words, controls, boxes };
  }, screenSel);
}

/** The scroll offsets a screen can take: its top, middle and end (just the top where it all fits). */
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

/** The ids of the controls and the title that must stay reachable, each hit where it is drawn. */
async function expectReachable(page: Page, ids: readonly string[], where: string) {
  const bad: string[] = [];
  for (const id of ids) {
    const target = page.locator(`#${id}`);
    await target.scrollIntoViewIfNeeded();
    const ok = await target.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (top === e || e.contains(top) || top.contains(e));
    });
    if (!ok) bad.push(id);
  }
  expect(bad, `${where}: everything on the screen can be hit where it is drawn`).toEqual([]);
}

async function bootToMenu(page: Page, textSize: (typeof TEXT_SIZES)[number]) {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    (window as TestWindow).__reloadOffer = true;
  });
  await page.goto('./?settings=all');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
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

/** The card is clear of everything at every size and scroll position of one result screen. */
async function checkScreen(page: Page, screenSel: string, reachable: readonly string[], label: string) {
  for (const size of SIZES) {
    // The start tap went fullscreen; a window resize needs it left first (platform-phone.spec.ts).
    await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
    await page.setViewportSize({ width: size.width, height: size.height });
    const room = await scrollRoom(page, screenSel);
    for (const at of room > 0 ? [0, 0.5, 1] : [0]) {
      await scrollTo(page, screenSel, room * at);
      const where = `${label} at ${size.name}, scrolled ${at * 100}% of ${Math.round(room)} px`;
      const found = await offerFindings(page, screenSel);
      console.log(
        `${where}: ${found.words} words, ${found.controls} controls, ${found.boxes} boxes, findings ${JSON.stringify(found.findings)}`,
      );
      expect(found.words, `${where}: words were examined`).toBeGreaterThan(0);
      expect(found.controls, `${where}: controls were examined`).toBeGreaterThan(0);
      expect(found.findings, where).toEqual([]);
    }
    await scrollTo(page, screenSel, 0);
    // At the top the card is the first line, on the screen, with the title below it.
    const card = await page.locator('#reload-offer').boundingBox();
    expect(card, `${label} at ${size.name}: the card is drawn`).not.toBeNull();
    expect(card?.y ?? -1, `${label} at ${size.name}: the card starts on the screen`).toBeGreaterThanOrEqual(
      0,
    );
    await expectReachable(page, [...reachable, 'reload-offer-reload'], `${label} at ${size.name}`);
  }
}

for (const textSize of TEXT_SIZES) {
  test(`the update card covers nothing on the race result and the career result, at Text size ${textSize}`, async ({
    page,
  }) => {
    test.setTimeout(480_000);
    await bootToMenu(page, textSize);

    // The race's result (a quick race from the menu, ridden by the bot).
    await page.locator('#menu-race').click();
    await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
    await rideToTheEnd(page, 'the quick race, to its end');
    await expect(page.locator('#results')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#reload-offer')).toBeVisible();
    await expect(page.locator('#reload-offer .reload-offer-text')).toHaveText(
      'The game was updated while you raced. It reloads when you go back to the menu.',
    );
    await checkScreen(
      page,
      '#results',
      ['results-place', 'results-menu', 'results-race'],
      `race result, ${textSize}`,
    );
    await page.locator('#results-menu').click();
    await expect(page.locator('#menu-career')).toBeVisible();
    await expect(page.locator('#reload-offer')).toBeHidden();

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
    await checkScreen(
      page,
      '#career-results',
      ['career-results-title', 'career-results-map', 'career-results-retry'],
      `career result, ${textSize}`,
    );

    if (textSize === 'normal') {
      // The negative control: the card where it was (fixed at the top centre, out of the flow). At
      // 915x412 it lies over the title again, and the same check says so.
      await page.setViewportSize({ width: 915, height: 412 });
      await scrollTo(page, '#career-results', 0);
      const clean = await offerFindings(page, '#career-results');
      expect(clean.findings, 'the control starts clean').toEqual([]);
      const oldPlace = await page.addStyleTag({
        content:
          '#ui #reload-offer { position: fixed !important; top: 10px; left: 50%; transform: translateX(-50%); z-index: 2; }',
      });
      const old = await offerFindings(page, '#career-results');
      console.log(`negative control: ${JSON.stringify(old.findings)}`);
      expect(old.findings).toContain('the update card is fixed, so it can stay over content that scrolls');
      expect(old.findings.filter((f) => f.startsWith('the update card covers'))).not.toEqual([]);
      await oldPlace.evaluate((e) => (e as HTMLElement).remove());
    }

    // Leaving by the Map is the way out that reloads; with no deploy it only opens the map.
    await page.locator('#career-results-map').click();
    await expect(page.locator('#career')).toBeVisible();
    await expect(page.locator('#reload-offer')).toBeHidden();
  });
}
