import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';

// Playtest 1c, 2026-09-30 [decided]: "The little pop-ups about near miss etc get in the way of
// seeing what's ahead. Maybe they could be less intrusive and/or less centered". The style pop-ups
// (ui-3) must stay out of the central look-ahead: the middle half of the screen's width, from above
// the horizon (hills and cresting traffic) down to just above the rider. Measured on the race
// screens of the dev machine's software renderer, the horizon sits at about 44% of the height and
// the rider's head at about 53% in every shape tried, so the rectangle below has a wide margin.
// They must also keep off the bark bubble, the HUD, the pause button and the touch buttons, on a
// phone held sideways and upright, a small phone, the left-handed mirror and a laptop.
//
// The pop-ups come from `window.__uiStyleFeed` (ui's test seam): style events fed through the same
// tally the sim's events go through, because the seeded bot race does not reliably earn style cash
// early. The bubble's line is swapped for the base pack's longest line while it is up, so it is
// measured at its widest real content.

const LOOK_AHEAD = { left: 0.25, right: 0.75, top: 0.25, bottom: 0.65 };

interface BarkSetFile {
  lines: { text: string }[];
}
const LONGEST_LINE = readdirSync('packs/base/barks')
  .flatMap((f) => (JSON.parse(readFileSync(`packs/base/barks/${f}`, 'utf8')) as BarkSetFile).lines)
  .map((l) => l.text)
  .reduce((a, b) => (b.length > a.length ? b : a), '');

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface Measured {
  viewport: { w: number; h: number };
  pops: { text: string; box: Box; labelPx: number; cashPx: number; opacity: number; duration: string }[];
  bubble: Box | null;
  bubbleText: string;
  others: { id: string; box: Box }[];
  /** Whether every chip had slid in and the stack had stopped moving, and when (ms after the feed). */
  settled: boolean;
  settledMs: number;
}
type FeedPop = { kind: string; points?: number };
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { setBot(on: boolean): void; snapshot(): { tick: number } | null };
  __uiStyleFeed?: (pops: FeedPop[]) => void;
};

/** Twelve near misses, a long oncoming stretch and a big combo: the widest pop-ups a race makes. */
const WIDE_FEED: FeedPop[] = [
  ...Array.from({ length: 12 }, () => ({ kind: 'nearMiss', points: 25 })),
  { kind: 'oncoming', points: 1440 },
  { kind: 'takedownCombo', points: 12345 },
];

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
}

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

async function startRace(page: Page, opts: { portrait?: boolean; mirror?: boolean } = {}) {
  await page.addInitScript((portrait) => {
    (window as TestWindow).__GAME_TEST__ = true;
    // A phone held upright shows platform/'s rotate screen and pauses (its own spec covers that).
    // To measure the race screen in that shape, the page is told it is not portrait.
    if (portrait) {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => {
        const list = real(q);
        if (!q.includes('orientation: portrait')) return list;
        return new Proxy(list, {
          get(target, key) {
            if (key === 'matches') return false;
            const value: unknown = Reflect.get(target, key, target);
            return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
          },
        });
      };
    }
  }, opts.portrait ?? false);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  if (opts.mirror) {
    await page.locator('#menu-settings').click();
    await page.locator('#settings-tab-controls').click();
    await page.locator('#settings-mirror').check();
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu-race')).toBeVisible();
  }
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 20);
  await expect(page.locator('#bark-bubble')).toBeVisible({ timeout: 10_000 });
}

/**
 * Widens the bark bubble to the longest base-pack line, feeds the pop-ups, waits until they have
 * settled (the slide-in and any move below the bubble take about 0.1 s) and measures everything in
 * one go, while the bubble is still up. Measuring mid-slide would read a box still moving into
 * place; waiting a fixed time instead could land in the fade-out on a slow machine.
 */
function feedAndMeasure(page: Page, feed: FeedPop[], wideBubble = false): Promise<Measured> {
  return page.evaluate(
    async ({ feed, longest, wideBubble }) => {
      const box = (e: Element): { left: number; top: number; right: number; bottom: number } => {
        const r = e.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const bubble = document.getElementById('bark-bubble');
      const text = bubble?.querySelector('.bark-text');
      if (bubble && !bubble.hidden && text) text.textContent = longest;
      // A bubble far wider than today's (a future layout, or a longer line), reaching the stack.
      if (bubble && wideBubble) Object.assign(bubble.style, { width: '96vw', maxWidth: 'none' });
      (window as TestWindow).__uiStyleFeed?.(feed);
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const host = document.getElementById('style-popups');
      const atRest = () => {
        const chips = [...document.querySelectorAll<HTMLElement>('.style-pop')];
        return (
          chips.length > 0 &&
          chips.every((c) => getComputedStyle(c).transform === 'none') &&
          !!host &&
          getComputedStyle(host).top === host.style.top
        );
      };
      const t0 = performance.now();
      for (let i = 0; i < 2; i++) await frame();
      while (!atRest() && performance.now() - t0 < 1000) await frame();
      const settled = atRest();
      const settledMs = Math.round(performance.now() - t0);
      const pops = [...document.querySelectorAll<HTMLElement>('.style-pop')]
        .filter((e) => e.checkVisibility())
        .map((e) => {
          const label = e.querySelector('.pop-label') ?? e;
          const cash = e.querySelector('.pop-cash') ?? e;
          return {
            text: e.innerText.replace(/\s+/g, ' ').trim(),
            box: box(e),
            labelPx: parseFloat(getComputedStyle(label).fontSize),
            cashPx: parseFloat(getComputedStyle(cash).fontSize),
            opacity: parseFloat(getComputedStyle(e).opacity),
            duration: getComputedStyle(e).animationDuration,
          };
        });
      const others = [
        'hud-speed',
        'hud-position',
        'hud-health',
        'hud-target',
        'hud-pause',
        'touch-attack',
        'touch-brake',
      ]
        .map((id) => document.getElementById(id))
        .filter((e): e is HTMLElement => !!e && e.checkVisibility())
        .map((e) => ({ id: e.id, box: box(e) }));
      const shown = !!bubble && !bubble.hidden && bubble.checkVisibility();
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        pops,
        // The bubble's speech tail hangs 9 px below its box.
        bubble: shown && bubble ? { ...box(bubble), bottom: box(bubble).bottom + 9 } : null,
        bubbleText: shown ? (text?.textContent ?? '') : '',
        others,
        settled,
        settledMs,
      };
    },
    { feed, longest: LONGEST_LINE, wideBubble },
  );
}

function expectClear(m: Measured, where: string) {
  const { w, h } = m.viewport;
  const look: Box = {
    left: LOOK_AHEAD.left * w,
    right: LOOK_AHEAD.right * w,
    top: LOOK_AHEAD.top * h,
    bottom: LOOK_AHEAD.bottom * h,
  };
  console.log(`${where}: look-ahead ${JSON.stringify(look)}`);
  console.log(`${where}: ${m.pops.length} pop-ups ${JSON.stringify(m.pops)}`);
  console.log(`${where}: bubble ${JSON.stringify(m.bubble)} "${m.bubbleText}"`);
  console.log(`${where}: ${m.others.length} HUD pieces and controls ${m.others.map((o) => o.id).join(', ')}`);
  console.log(`${where}: settled ${m.settled} after ${m.settledMs} ms`);
  expect(m.pops.length, `${where}: pop-ups on screen`).toBeGreaterThan(0);
  expect(m.settled, `${where}: measured at rest, after the slide-in and any move`).toBe(true);
  for (const p of m.pops) {
    expect(p.opacity, `${where}: "${p.text}" clearly shown`).toBeGreaterThanOrEqual(0.5);
    expect(overlaps(p.box, look), `${where}: "${p.text}" stays out of the look-ahead`).toBe(false);
  }
  expect(m.bubble, `${where}: the bark bubble was up while measured`).not.toBeNull();
  expect(m.bubbleText).toBe(LONGEST_LINE);
  for (const p of m.pops) {
    if (m.bubble) expect(overlaps(p.box, m.bubble), `${where}: "${p.text}" clear of the bubble`).toBe(false);
    for (const o of m.others)
      expect(overlaps(p.box, o.box), `${where}: "${p.text}" clear of ${o.id}`).toBe(false);
    expect(
      p.box.left >= 0 && p.box.top >= 0 && p.box.right <= w && p.box.bottom <= h,
      `${where}: on screen`,
    ).toBe(true);
  }
}

/**
 * Less intrusive, still readable: small words, a readable cash figure, a short dwell. A chip is one
 * line of words over its cash; on a screen too narrow for the words they may wrap (`maxHeight`).
 */
function expectCompact(m: Measured, where: string, maxHeight = 44) {
  expect(m.pops.map((p) => p.text).sort()).toEqual([
    'COMBO +$12,345',
    'NEAR MISS ×12 +$300',
    'ONCOMING +$1,440',
  ]);
  for (const p of m.pops) {
    expect(p.labelPx, `${where}: small words`).toBeLessThanOrEqual(12);
    expect(p.cashPx, `${where}: readable cash`).toBeGreaterThanOrEqual(14);
    expect(p.box.bottom - p.box.top, `${where}: a compact chip`).toBeLessThanOrEqual(maxHeight);
    expect(parseFloat(p.duration), `${where}: a short dwell`).toBeLessThanOrEqual(1.2);
  }
}

async function shot(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: `test-results/screenshots/ui-style-popups-${name}.png` });
}

test('phone landscape: pop-ups sit clear of the road ahead, merge repeats and fade quickly', async ({
  page,
}) => {
  const problems = watchErrors(page);
  await startRace(page);
  const m = await feedAndMeasure(page, WIDE_FEED);
  expectClear(m, 'phone landscape');
  expectCompact(m, 'phone landscape');
  await shot(page, 'phone');

  // A quick fade: gone well inside two seconds of the screenshot.
  const before = Date.now();
  await expect(page.locator('.style-pop')).toHaveCount(0, { timeout: 2_000 });
  console.log(`pop-ups gone ${Date.now() - before} ms after the screenshot`);

  // A near miss in a later step, while the first one's chip is up, adds to that chip rather than
  // stacking a second one. Both feeds run inside the page, so a slow round trip to the test runner
  // (a loaded machine) cannot let the first chip time out in between.
  const merged = await page.evaluate(async () => {
    const feed = (window as TestWindow).__uiStyleFeed;
    const frames = async () => {
      for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
    };
    feed?.([{ kind: 'nearMiss', points: 25 }]);
    await frames();
    await new Promise((r) => setTimeout(r, 150));
    feed?.([{ kind: 'nearMiss', points: 25 }]);
    await frames();
    return [...document.querySelectorAll<HTMLElement>('.style-pop')].map((e) =>
      e.innerText.replace(/\s+/g, ' ').trim(),
    );
  });
  console.log(`merged across steps: ${JSON.stringify(merged)}`);
  expect(merged).toEqual(['NEAR MISS ×2 +$50']);
  expect(problems).toEqual([]);
});

test('phone landscape, left-handed mirror: pop-ups follow the position badge to the other side', async ({
  page,
}) => {
  const problems = watchErrors(page);
  await startRace(page, { mirror: true });
  const m = await feedAndMeasure(page, WIDE_FEED);
  expectClear(m, 'mirrored');
  const w = m.viewport.w;
  for (const p of m.pops) expect(p.box.left, 'on the right half').toBeGreaterThan(w / 2);
  await shot(page, 'mirrored');
  expect(problems).toEqual([]);
});

test.describe('phone portrait', () => {
  test.use({ viewport: { width: 412, height: 915 } });
  test('pop-ups sit clear of the road ahead', async ({ page }) => {
    const problems = watchErrors(page);
    await startRace(page, { portrait: true });
    const m = await feedAndMeasure(page, WIDE_FEED);
    expectClear(m, 'phone portrait');
    expectCompact(m, 'phone portrait', 60);
    await shot(page, 'portrait');
    expect(problems).toEqual([]);
  });
});

test.describe('small phone landscape', () => {
  test.use({ viewport: { width: 740, height: 360 } });
  test('pop-ups sit clear of the road ahead', async ({ page }) => {
    const problems = watchErrors(page);
    await startRace(page);
    const m = await feedAndMeasure(page, WIDE_FEED);
    expectClear(m, 'small phone');
    await shot(page, 'small');
    expect(problems).toEqual([]);
  });
});

test.describe('laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false });
  test('pop-ups sit clear of the road ahead', async ({ page }) => {
    const problems = watchErrors(page);
    await startRace(page);
    const m = await feedAndMeasure(page, WIDE_FEED);
    expectClear(m, 'laptop');
    expectCompact(m, 'laptop');
    await shot(page, 'laptop');
    expect(problems).toEqual([]);
  });
});

test('a bubble that reaches the stack pushes it below the bubble, still clear of the road', async ({
  page,
}) => {
  const problems = watchErrors(page);
  await startRace(page);
  const m = await feedAndMeasure(page, WIDE_FEED, true);
  expectClear(m, 'wide bubble');
  const bubbleBottom = m.bubble?.bottom ?? Infinity;
  for (const p of m.pops)
    expect(p.box.top, `"${p.text}" below the bubble`).toBeGreaterThanOrEqual(bubbleBottom);
  await shot(page, 'wide-bubble');
  expect(problems).toEqual([]);
});

// The overlap check must fire: a pop-up planted in the middle of the screen is caught.
test('the look-ahead check catches a centred pop-up (negative control)', async ({ page }) => {
  await startRace(page);
  await page.evaluate(() => {
    const host = document.getElementById('style-popups');
    const pop = document.createElement('div');
    pop.className = 'style-pop';
    pop.textContent = 'PLANTED';
    Object.assign(pop.style, { position: 'fixed', left: '45%', top: '40%', animation: 'none', opacity: '1' });
    host?.append(pop);
  });
  const m = await feedAndMeasure(page, []);
  const { w, h } = m.viewport;
  const look: Box = { left: 0.25 * w, right: 0.75 * w, top: 0.25 * h, bottom: 0.65 * h };
  const planted = m.pops.find((p) => p.text === 'PLANTED');
  expect(planted).toBeDefined();
  if (planted) expect(overlaps(planted.box, look)).toBe(true);
});
