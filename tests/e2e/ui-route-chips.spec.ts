import { expect, test, type Page } from '@playwright/test';
import { domId, menuRegions, offeredRoutes } from './packs-on-disk';

// The menu's road chips reach every road, visibly, at every text size (playtest 4, run B, punch
// item 10). The row of chips runs past the screen's right edge (at Largest on San Francisco's nine
// chips, five were off the screen) and it scrolled by swipe with nothing to say so; on a first visit
// the what's-new card stood where the chips were. The row now shows a "more roads" arrow at each end
// that has more chips, a tap pages the row, and the card takes its own room beside (or under) the
// menu. Phone landscape sizes: the 20:9 phones, then the 16:9 ones and the small ones (the stacked
// menu); each at Normal, Large and Largest text, with the card up and after it is dismissed. Each
// check has a negative control: the same measure on a row with no arrows, and on a box over the chips.

type TestWindow = Window & { __GAME_TEST__?: boolean };

/** Two frames on: a scroll's event and the arrows' state follow a tap by a frame. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

const ROW = '#route-picker .route-row';
const STRIP = '#route-picker .route-scroll';

/** The menu on a first visit (the what's-new card is up), with the text size settings reachable. */
async function toMenu(page: Page) {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./?settings=all');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
}

async function setTextSize(page: Page, size: 'normal' | 'large' | 'largest') {
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-access').click();
  await page.locator(`#settings-textSize [data-value="${size}"]`).click();
  await expect(page.locator(`#settings-textSize [data-value="${size}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('#settings-back').click();
  await expect(page.locator('#menu-race')).toBeVisible();
}

/** The region with the most roads: its chips are the longest row (San Francisco today). */
function widestRegion() {
  const all = menuRegions().map(({ region, event }) => ({
    chip: `#region-${domId(region.key)}`,
    roads: 1 + offeredRoutes(event).length,
  }));
  return all.reduce((best, r) => (r.roads > best.roads ? r : best));
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * What the row says about itself and its neighbours, from the page: the row's and strip's boxes, how
 * far the row scrolls, whether each arrow is drawn and live, each chip's box, and the card's box and
 * the pickers it must keep off. Selectors come in so the control can aim the same measure at a plain row.
 */
function measure(page: Page, sel: { strip: string; row: string; before: string; after: string }) {
  return page.evaluate((s) => {
    const box = (e: Element | null): Rect | null => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const row = document.querySelector<HTMLElement>(s.row);
    const arrow = (q: string) => {
      const b = document.querySelector<HTMLButtonElement>(q);
      return { drawn: !!b && b.checkVisibility(), live: !!b && b.checkVisibility() && !b.disabled };
    };
    const card = document.querySelector('#whats-new');
    const shown = (q: string) => {
      const e = document.querySelector(q);
      return e?.checkVisibility() ? box(e) : null;
    };
    return {
      view: { width: innerWidth, height: innerHeight },
      strip: box(document.querySelector(s.strip)),
      row: box(row),
      scrolls: !!row && row.scrollWidth > row.clientWidth + 1,
      scrollLeft: row?.scrollLeft ?? 0,
      before: arrow(s.before),
      after: arrow(s.after),
      chips: [...(row?.children ?? [])].map((c) => ({
        name: (c.textContent ?? '').trim(),
        ...box(c)!,
      })),
      card: card?.checkVisibility() ? box(card) : null,
      pickers: { region: shown('#region-picker'), strip: shown(s.strip) },
    };
  }, sel);
}
type Measure = Awaited<ReturnType<typeof measure>>;

const overlap = (a: Rect, b: Rect) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/** The whole of a chip is inside the row's box (sideways: the menu scrolls up and down on its own). */
const whole = (c: Rect, row: Rect) => c.left >= row.left - 0.5 && c.right <= row.right + 0.5;

/** What is wrong with the row's cue, from one measure: the row scrolls but no live arrow points on. */
function cueProblems(m: Measure): string[] {
  const out: string[] = [];
  if (!m.row || !m.strip) return ['no row'];
  if (m.scrolls) {
    if (!m.after.drawn) out.push('the row scrolls but no "more roads" arrow is drawn');
    else if (m.scrollLeft < 1 && !m.after.live)
      out.push('the row is at its start but the "more" arrow is dead');
    if (m.scrollLeft < 1 && m.before.live) out.push('the "earlier" arrow is live at the row start');
  } else if (m.after.drawn || m.before.drawn) {
    out.push('the row fits but arrows are drawn');
  }
  return out;
}

/** What is wrong with the strip and the card on the screen, from one measure. */
function placeProblems(m: Measure): string[] {
  const out: string[] = [];
  const { width } = m.view;
  const sideways = (name: string, r: Rect | null) => {
    if (r && (r.left < -0.5 || r.right > width + 0.5))
      out.push(
        `${name} leaves the screen sideways [${Math.round(r.left)},${Math.round(r.right)}] of ${width}`,
      );
  };
  sideways('the road strip', m.strip);
  sideways('the what-is-new card', m.card);
  if (m.card) {
    for (const [name, r] of Object.entries(m.pickers))
      if (r && overlap(m.card, r)) out.push(`the what-is-new card covers the ${name} picker`);
  }
  return out;
}

/**
 * Taps the "more roads" arrow until every chip has been whole in the row, and the "earlier" arrow back
 * to the start. Each tap is a real touch point on the arrow (a covered arrow cannot be hit). Returns
 * what went wrong, and the taps it took each way.
 */
async function pageThrough(
  page: Page,
  sel: { strip: string; row: string; before: string; after: string },
  count: number,
) {
  const problems: string[] = [];
  const seen = new Set<string>();
  let forward = 0;
  let back = 0;
  await page.locator(sel.strip).scrollIntoViewIfNeeded();
  for (let i = 0; i < count + 2; i++) {
    const m = await measure(page, sel);
    for (const c of m.chips) if (m.row && whole(c, m.row)) seen.add(c.name);
    if (!m.scrolls || !m.after.live) break;
    await page.locator(sel.after).click();
    forward++;
    await settle(page);
  }
  const end = await measure(page, sel);
  for (const c of end.chips) if (end.row && whole(c, end.row)) seen.add(c.name);
  if (end.scrolls && end.after.live) problems.push('the "more" arrow is still live after paging to the end');
  const names = end.chips.map((c) => c.name);
  const unseen = names.filter((n) => !seen.has(n));
  if (unseen.length) problems.push(`chips never whole in the row: ${unseen.join(', ')}`);
  for (let i = 0; i < count + 2; i++) {
    const m = await measure(page, sel);
    if (!m.before.live) break;
    await page.locator(sel.before).click();
    back++;
    await settle(page);
  }
  const start = await measure(page, sel);
  if (start.scrollLeft > 1) problems.push(`paging back stopped at ${Math.round(start.scrollLeft)} px`);
  return { problems, forward, back, seen: seen.size };
}

const REAL = { strip: STRIP, row: ROW, before: '#route-before', after: '#route-after' };

for (const [where, width, height] of [
  ['915x412', 915, 412],
  ['844x390', 844, 390],
  ['732x412 (16:9)', 732, 412],
  ['740x360', 740, 360],
  ['640x360 (16:9)', 640, 360],
  ['568x320 (16:9)', 568, 320],
] as const) {
  test.describe(`road chips at ${where}`, () => {
    test.use({ viewport: { width, height } });

    test('every road is reachable and the row says it scrolls, at every text size, with the card up and away', async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const region = widestRegion();
      expect(region.roads, 'the widest region offers several roads').toBeGreaterThan(4);
      await toMenu(page);
      await page.locator(region.chip).click();
      await expect(page.locator(`${ROW} button.route`)).toHaveCount(region.roads, { timeout: 30_000 });
      const cardUp = await page.locator('#whats-new').isVisible();
      expect(cardUp, `${where}: a first visit shows the card`).toBe(true);

      let sawScroll = false;
      // The card is up through the three sizes, then dismissed and the sizes walked back.
      const steps = [
        ['normal', true],
        ['large', true],
        ['largest', true],
        ['largest', false],
        ['large', false],
        ['normal', false],
      ] as const;
      let current = 'normal';
      for (const [size, card] of steps) {
        if (!card && (await page.locator('#whats-new').isVisible())) {
          await page.locator('#whats-new-ok').click();
          await expect(page.locator('#whats-new')).toBeHidden();
        }
        if (size !== current) {
          await setTextSize(page, size);
          current = size;
        }
        await expect(page.locator(`${ROW} button.route`)).toHaveCount(region.roads);
        const label = `${where}, ${size} text, card ${card ? 'up' : 'dismissed'}`;
        const m = await measure(page, REAL);
        console.log(
          `${label}: ${m.chips.length} chips, row ${Math.round((m.row?.right ?? 0) - (m.row?.left ?? 0))} px, scrolls ${m.scrolls}, card ${m.card ? 'shown' : 'hidden'}`,
        );
        expect(!!m.card, `${label}: the card is ${card ? 'up' : 'away'}`).toBe(card);
        expect(m.chips.length, `${label}: chips examined`).toBe(region.roads);
        expect(placeProblems(m), `${label}: placement`).toEqual([]);
        // The arrows follow the row's size by a frame (a ResizeObserver), so poll for the settled state.
        await expect
          .poll(async () => cueProblems(await measure(page, REAL)), { message: `${label}: cue` })
          .toEqual([]);
        const paged = await pageThrough(page, REAL, region.roads);
        console.log(`${label}: ${paged.forward} taps on, ${paged.back} back, ${paged.seen} chips whole`);
        expect(paged.problems, `${label}: paging`).toEqual([]);
        sawScroll ||= m.scrolls;
        // The last road can be picked, and stays whole in the row (a pick half out of the row is brought in).
        const last = page.locator(`${ROW} button.route`).last();
        await last.scrollIntoViewIfNeeded();
        await last.click();
        await expect(last).toHaveAttribute('aria-checked', 'true');
        await settle(page);
        const after = await measure(page, REAL);
        const lastBox = after.chips[after.chips.length - 1]!;
        expect(whole(lastBox, after.row!), `${label}: the picked chip is whole in the row`).toBe(true);
        await page.locator(`${ROW} button.route`).first().click();
        await expect(page.locator('#route-own')).toHaveAttribute('aria-checked', 'true');
      }
      // The control that the check had something to measure: at Largest the row did overflow here.
      expect(sawScroll, `${where}: some text size made the row scroll`).toBe(true);
    });
  });
}

// The checks must fire. A row of the same chips with no arrows, scrolling by swipe only (the old row),
// is named by the cue and by the paging; a box standing over the strip is named by the placement.
test.describe('the road chip checks name what is wrong (negative controls)', () => {
  test.use({ viewport: { width: 915, height: 412 } });

  test('a plain scrolling row with no arrows fails the cue and the paging', async ({ page }) => {
    await toMenu(page);
    await page.evaluate(() => {
      const strip = document.createElement('div');
      strip.id = 'planted-strip';
      Object.assign(strip.style, {
        position: 'fixed',
        left: '40px',
        top: '40px',
        width: '420px',
        zIndex: '9',
      });
      const row = document.createElement('div');
      row.id = 'planted-row';
      Object.assign(row.style, { display: 'flex', gap: '10px', overflowX: 'auto' });
      for (let i = 0; i < 9; i++) {
        const b = document.createElement('button');
        b.textContent = `Chip number ${i}`;
        b.style.flex = '0 0 auto';
        b.style.minWidth = '180px';
        row.append(b);
      }
      strip.append(row);
      document.body.append(strip);
    });
    const plain = { strip: '#planted-strip', row: '#planted-row', before: '#no-before', after: '#no-after' };
    const m = await measure(page, plain);
    expect(m.scrolls, 'the planted row does overflow').toBe(true);
    expect(cueProblems(m)).toEqual(['the row scrolls but no "more roads" arrow is drawn']);
    const paged = await pageThrough(page, plain, 9);
    expect(paged.problems.join(' ')).toContain('chips never whole in the row');
  });

  test('a box over the chips fails the placement check', async ({ page }) => {
    const region = widestRegion();
    await toMenu(page);
    await page.locator(region.chip).click();
    await expect(page.locator(`${ROW} button.route`)).toHaveCount(region.roads, { timeout: 30_000 });
    expect(placeProblems(await measure(page, REAL)), 'the real menu is clean').toEqual([]);
    await page.evaluate(() => {
      const strip = document.querySelector('#route-picker .route-scroll')!.getBoundingClientRect();
      const card = document.querySelector<HTMLElement>('#whats-new')!;
      Object.assign(card.style, {
        position: 'fixed',
        left: `${strip.left + 20}px`,
        top: `${strip.top}px`,
        zIndex: '9',
      });
    });
    const problems = placeProblems(await measure(page, REAL));
    expect(problems.join(' ')).toContain('covers the strip picker');
  });
});
