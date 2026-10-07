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

export type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __reloadOffer?: boolean;
  __uiCards?: { raise(id: string): boolean };
  __game?: {
    setBot(on: boolean): void;
    state(): string;
    fastForward(until: () => boolean, opts?: { perFrame?: number }): void;
  };
};

export const SIZES = [
  { name: '915x412', width: 915, height: 412 },
  { name: '854x480 (16:9)', width: 854, height: 480 },
  { name: '640x360 (16:9)', width: 640, height: 360 },
  { name: '568x320', width: 568, height: 320 },
] as const;

export const TEXT_SIZES = ['normal', 'large', 'largest'] as const;

export type ScreenName = (typeof TRANSIENT_CARDS)[number]['screens'][number];

/** The flow cards that can appear on `screen`, from the registry (a new card is checked by being listed). */
export const flowCardsOn = (screen: ScreenName): string[] =>
  TRANSIENT_CARDS.filter((c) => c.place === 'flow' && c.screens.includes(screen)).map((c) => c.id);

/**
 * A painted thing, the transient card it belongs to (null when none: a card is never judged against
 * itself), and whether it is the footer's (the footer is never judged against its own words).
 */
export type Measured = PaintedThing & { owner: string | null; inFooter: boolean };

export interface Painted {
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
export async function paint(
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
export function judge(p: Painted, viewport: { width: number; height: number }): string[] {
  return p.cards.flatMap((c) => {
    const place = TRANSIENT_CARDS.find((t) => t.id === c.id)?.place ?? 'flow';
    const others: PaintedThing[] = p.things.filter((t) => t.owner !== c.id);
    return cardFindings({ ...c, place }, others, viewport);
  });
}

/** What does not fit the screen painted now: a thing off its sides, the footer over anything. */
export function fit(p: Painted, viewport: { width: number; height: number }): string[] {
  const painted: PaintedThing[] = p.things.filter((t) => !t.inFooter);
  return screenFitFindings({ wide: p.wide, painted, footer: p.footer }, viewport);
}

/** The scroll room a screen has (0 where it all fits). */
export async function scrollRoom(page: Page, screenSel: string): Promise<number> {
  return page.evaluate((sel) => {
    const e = document.querySelector<HTMLElement>(sel);
    return e ? Math.max(0, e.scrollHeight - e.clientHeight) : 0;
  }, screenSel);
}

export async function scrollTo(page: Page, screenSel: string, top: number) {
  await page.evaluate(({ sel, top }) => document.querySelector<HTMLElement>(sel)?.scrollTo({ top }), {
    sel: screenSel,
    top,
  });
}

/**
 * Each control the selectors name is hit where it is drawn (scrolled into view first). `required`
 * must name at least one shown control; `extra` (a card's own buttons) may name none.
 */
export async function expectReachable(
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

export async function leaveFullscreen(page: Page) {
  // The start tap went fullscreen; a window resize needs it left first (platform-phone.spec.ts).
  await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
}

export async function raise(page: Page, ids: readonly string[]) {
  for (const id of ids) {
    const up = await page.evaluate((id) => (window as TestWindow).__uiCards?.raise(id) ?? false, id);
    expect(up, `the seam raised ${id}`).toBe(true);
  }
}

/**
 * Each card, raised again with its screen scrolled to the end and to the top, comes up in view: the
 * screen brings it there (polish batch E's check, mustFix 1).
 */
export async function checkInView(
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
export async function checkFit(page: Page, screenSel: string, label: string) {
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
export async function checkBuildId(
  page: Page,
  label: string,
  sizes: readonly (typeof SIZES)[number][] = SIZES,
) {
  for (const size of sizes) {
    await leaveFullscreen(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    await scrollTo(page, '#menu', 0);
    // Resize queues keepFooterClear: settle that layout before deciding whether the fallback line
    // needs scrolling. At normal Text, 915x412 fits and 854x480 scrolls; reading visibility before
    // the queued update skipped the newly shown line, then the final paint found it below the fold.
    await paint(page, '#menu', []);
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
export async function checkScreen(
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
export async function checkRace(page: Page, label: string) {
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

export async function setTextSize(page: Page, textSize: (typeof TEXT_SIZES)[number]) {
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-access').click();
  const pick = page.locator(`#settings-textSize [data-value="${textSize}"]`);
  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#settings-back').click();
  await expect(page.locator('#menu-race')).toBeVisible();
}

export async function rideToTheEnd(page: Page, what: string) {
  await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    g?.setBot(true);
    g?.fastForward(() => false, { perFrame: 1200 });
  });
  await fastForwardDone(page, what);
}

export function installTransientCards() {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as TestWindow).__GAME_TEST__ = true;
      (window as TestWindow).__reloadOffer = true;
    });
  });
}

/** A region chip on the menu, by its name. */
export const regionChip = (page: Page, name: string) =>
  page.locator('#region-picker button.region', { hasText: name });

export const SF_MAPS = /\/assets\/osm-sf-[^/]*\.json(\?.*)?$/;

export const KEYS_MAPS = /\/assets\/osm-keys-[^/]*\.json(\?.*)?$/;

/**
 * How many painted lines of words on the screen say `words` (a leaf element's text matches). With
 * `plantDoubled` (`said` is then the words) it first plants the doubled state the busy line once drew:
 * the busy line up and the route row's word drawn under it, both saying `said`; it counts and puts
 * everything back, all in one task, so the UI cannot take the busy line down between the planting and
 * the count (trains 426 to 435: the separate style tag left the control at 1 line).
 */
export const linesSaying = (page: Page, words: RegExp, plantDoubled: string | null = null) =>
  page.evaluate(
    ({ source, said }) => {
      const restore: (() => void)[] = [];
      if (said !== null) {
        const busy = document.getElementById('busy');
        const busyText = document.getElementById('busy-text');
        const picker = document.getElementById('route-picker');
        const note = document.getElementById('route-note');
        for (const e of [busy, picker, note]) {
          if (!e) continue;
          const was = e.hidden;
          e.hidden = false;
          restore.push(() => (e.hidden = was));
        }
        for (const e of [busyText, note]) {
          if (!e) continue;
          const was = e.textContent;
          e.textContent = said;
          restore.push(() => (e.textContent = was));
        }
      }
      const n = [...document.querySelectorAll('#ui *, #build-stamp')].filter(
        (e) => e.children.length === 0 && e.checkVisibility() && new RegExp(source).test(e.textContent ?? ''),
      ).length;
      for (const undo of restore.reverse()) undo();
      return n;
    },
    { source: words.source, said: plantDoubled },
  );

export async function toMenu(page: Page) {
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
}

export { buildIdFindings, screenFitFindings } from '../../src/ui/screen-fit';
export { inViewFindings } from '../../src/ui/transient-cards';
