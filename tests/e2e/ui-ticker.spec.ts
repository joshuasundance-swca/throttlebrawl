import { expect, test, type Page } from '@playwright/test';
import { rideFirstCareerRace } from './career-start';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';

// Playtest 3 (the maintainer, 2026-10-03): "The black and white text pop-ups block the actual game."
// Interview round 1 [decided]: "Top ticker strip": one line at a time along the top edge, fading fast,
// the road kept clear, takedown names flashing briefly and small. This spec drives the real strip
// (#hud-ticker) in the real build:
// - on a phone held sideways, a small phone and a phone held upright, a short bark, the longest
//   bark in the base pack, a wide style chip and a takedown name each fit the strip (one slot,
//   at most 44 px tall), stay clear of the road ahead and off every other HUD piece, in a career
//   race (the objective is up);
// - the painted pixels differ from the same frame without the strip, in each of the four looks (the
//   text and its ground really drew; it is never black on white);
// - the old bark bubble and the style-pop-up stack are gone;
// - style events from the sim's own feed reach the strip and merge ("NEAR MISS ×2 +$50").
// The strip's words come from `window.__uiTicker` (ui's test seam: it drops what shows, shows these
// items and holds the first up so the live race cannot displace it while the spec measures it).
// The HUD's whole layout, with the strip in it, is in ui-style-popups.spec.ts.

const LOOK_AHEAD = { left: 0.25, right: 0.75, top: 0.25, bottom: 0.65 };

interface BarkSetFile {
  lines: { text: string }[];
}
const LINES = readdirSync('packs/base/barks')
  .flatMap((f) => (JSON.parse(readFileSync(`packs/base/barks/${f}`, 'utf8')) as BarkSetFile).lines)
  .map((l) => l.text);
const LONGEST_LINE = LINES.reduce((a, b) => (b.length > a.length ? b : a), '');
const SHORT_LINE = LINES.find((l) => l.length >= 36 && l.length <= 48) ?? 'Nice wheelie, nerd.';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface TickerItemLike {
  cls: string;
  text: string;
  tag?: string;
  cash?: number | null;
  kind?: string;
  contentRef?: string;
  dwellMs?: number;
}
interface Measured {
  viewport: { w: number; h: number };
  cls: string;
  words: string;
  tag: string;
  cash: string;
  fontPx: number;
  opacity: number;
  band: string;
  box: Box;
  others: { id: string; box: Box }[];
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: {
    setBot(on: boolean): void;
    setSeed(seed: number): void;
    state(): string;
    snapshot(): { tick: number } | null;
  };
  __uiTicker?: (items: TickerItemLike[], hold?: boolean) => void;
  __uiStyleFeed?: (pops: { kind: string; points?: number }[]) => void;
};

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

/** The career's first event's seed: its race has an objective up from the start. */
const CAREER_SEED = 4;

async function startRace(page: Page, opts: { portrait?: boolean; look?: string } = {}) {
  if (opts.look) {
    await page.addInitScript((look) => {
      const record = {
        format: 'settings',
        version: 1,
        build: 'e2e',
        savedAt: '2026-10-04T00:00:00.000Z',
        data: { look },
      };
      localStorage.setItem('mbrawl:settings', JSON.stringify(record));
    }, opts.look);
  }
  await page.addInitScript(
    ({ portrait }) => {
      const w = window as TestWindow;
      w.__GAME_TEST__ = true;
      // A phone held upright shows platform/'s rotate screen and pauses; to measure the race screen
      // in that shape the page is told it is not portrait (as ui-style-popups.spec.ts does).
      if (portrait) {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (q: string) => {
          const list = real(q);
          if (!q.includes('orientation: portrait')) return list;
          return new Proxy(list, {
            get(target, key) {
              if (key === 'matches') return false;
              const value: unknown = Reflect.get(target, key, target);
              return typeof value === 'function'
                ? (value as (...a: unknown[]) => unknown).bind(target)
                : value;
            },
          });
        };
      }
    },
    { portrait: opts.portrait ?? false },
  );
  await page.goto('./');
  await page.evaluate((seed) => {
    const g = (window as TestWindow).__game;
    g?.setSeed(seed);
    g?.setBot(true);
  }, CAREER_SEED);
  await rideFirstCareerRace(page);
  await expect(page.locator('#hud-objective')).toBeVisible();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 20);
}

/**
 * Puts these items on the strip (held up), lets its fade and slide finish, and measures it with the
 * other HUD pieces in the same frozen frame.
 */
function showAndMeasure(page: Page, items: TickerItemLike[]): Promise<Measured> {
  return page.evaluate((items) => {
    (window as TestWindow).__uiTicker?.(items);
    const root = document.getElementById('hud-ticker');
    if (!root) throw new Error('no #hud-ticker');
    // The 100 ms slide-in and the opacity fade, finished: measured at rest.
    for (const a of document.getAnimations()) {
      if (a.effect instanceof KeyframeEffect && a.effect.target === root) a.finish();
    }
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const style = getComputedStyle(root);
    const others = [
      'hud-speed',
      'hud-position',
      'hud-health',
      'hud-target',
      'hud-pause',
      'hud-heat',
      'hud-objective',
      'look-offer',
      'touch-attack',
      'touch-brake',
    ]
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => !!e && e.checkVisibility())
      .map((e) => ({ id: e.id, box: box(e) }));
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      cls: root.dataset['cls'] ?? '',
      words: root.querySelector('.ticker-text')?.textContent ?? '',
      tag: root.querySelector('.ticker-tag')?.textContent ?? '',
      cash: root.querySelector('.ticker-cash')?.textContent ?? '',
      fontPx: parseFloat(style.fontSize),
      opacity: parseFloat(style.opacity),
      band: style.backgroundColor,
      box: box(root),
      others,
    };
  }, items);
}

const bark = (text: string): TickerItemLike => ({
  cls: 'bark',
  tag: 'Deacon Vane',
  text,
  contentRef: 'base:bark-set/deacon-core#test',
  dwellMs: 600_000,
});
const WIDE_CHIP: TickerItemLike = { cls: 'style', text: 'NEAR MISS ×12', kind: 'nearMiss', cash: 300 };
const NAME: TickerItemLike = { cls: 'name', text: 'CATCH OF THE DAY', dwellMs: 600_000 };

function expectClear(m: Measured, where: string) {
  const { w, h } = m.viewport;
  const look = {
    left: LOOK_AHEAD.left * w,
    right: LOOK_AHEAD.right * w,
    top: LOOK_AHEAD.top * h,
    bottom: LOOK_AHEAD.bottom * h,
  };
  const height = m.box.bottom - m.box.top;
  console.log(
    `${where}: ${m.cls} "${m.tag} ${m.words} ${m.cash}" box ${JSON.stringify(m.box)} font ${m.fontPx} px, ` +
      `against ${m.others.map((o) => o.id).join(', ')}`,
  );
  expect(m.opacity, `${where}: clearly shown`).toBeGreaterThanOrEqual(0.9);
  expect(height, `${where}: one slot, at most 44 px`).toBeLessThanOrEqual(44);
  expect(height, `${where}: a real box`).toBeGreaterThan(14);
  expect(m.box.left, `${where}: on screen`).toBeGreaterThanOrEqual(0);
  expect(m.box.top, `${where}: on screen`).toBeGreaterThanOrEqual(0);
  expect(m.box.right, `${where}: on screen`).toBeLessThanOrEqual(w);
  expect(m.box.bottom, `${where}: on screen`).toBeLessThanOrEqual(h);
  expect(overlaps(m.box, look), `${where}: the road ahead is clear`).toBe(false);
  for (const o of m.others) expect(overlaps(m.box, o.box), `${where}: clear of ${o.id}`).toBe(false);
}

async function shot(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: `test-results/screenshots/ui-ticker-${name}.png` });
}

/** Each kind of item, measured on the strip. */
async function exerciseStrip(page: Page, where: string) {
  const short = await showAndMeasure(page, [bark(SHORT_LINE)]);
  expectClear(short, `${where}, a short bark`);
  expect(short.cls).toBe('bark');
  expect(short.tag.toLowerCase()).toBe('deacon vane');
  expect(short.fontPx, `${where}: small`).toBeLessThanOrEqual(15);
  await shot(page, `${where.replace(/\s+/g, '-')}-bark`);

  const longest = await showAndMeasure(page, [bark(LONGEST_LINE)]);
  expectClear(longest, `${where}, the longest bark`);
  expect(longest.words).toBe(LONGEST_LINE);
  expect(longest.fontPx, `${where}: small`).toBeLessThanOrEqual(15);

  const chip = await showAndMeasure(page, [WIDE_CHIP]);
  expectClear(chip, `${where}, a wide style chip`);
  expect(`${chip.words} ${chip.cash}`).toBe('NEAR MISS ×12 +$300');

  const name = await showAndMeasure(page, [NAME]);
  expectClear(name, `${where}, a takedown name`);
  expect(name.cls).toBe('name');
  expect(name.fontPx, `${where}: a name is small`).toBeLessThanOrEqual(12);
  await shot(page, `${where.replace(/\s+/g, '-')}-name`);
}

test('phone landscape: barks, chips and names fit one slot and keep the road and the HUD clear', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const problems = watchErrors(page);
  await startRace(page);
  // The old black-on-white bubble and the stack of chips are gone.
  await expect(page.locator('#bark-bubble')).toHaveCount(0);
  await expect(page.locator('#style-popups')).toHaveCount(0);
  await exerciseStrip(page, 'phone landscape');
  expect(problems).toEqual([]);
});

test.describe('small phone landscape', () => {
  test.use({ viewport: { width: 740, height: 360 } });
  test('the same items fit', async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watchErrors(page);
    await startRace(page);
    await exerciseStrip(page, 'small phone');
    expect(problems).toEqual([]);
  });
});

test.describe('phone portrait', () => {
  test.use({ viewport: { width: 412, height: 915 } });
  test('the same items fit, under the top row', async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watchErrors(page);
    await startRace(page, { portrait: true });
    await exerciseStrip(page, 'phone portrait');
    expect(problems).toEqual([]);
  });
});

/** How many pixels of the same clip differ by more than 60 levels of luminance between two PNGs. */
async function differingPixels(
  page: Page,
  a: Buffer,
  b: Buffer,
): Promise<{ differing: number; total: number }> {
  return page.evaluate(
    async ({ a, b }) => {
      const read = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      const [x, y] = await Promise.all([read(a), read(b)]);
      const luma = (d: Uint8ClampedArray, i: number) =>
        0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0);
      let differing = 0;
      const n = Math.min(x.data.length, y.data.length) / 4;
      for (let p = 0; p < n; p++) if (Math.abs(luma(x.data, p * 4) - luma(y.data, p * 4)) > 60) differing++;
      return { differing, total: n };
    },
    { a: a.toString('base64'), b: b.toString('base64') },
  );
}

for (const look of ['classic', 'kodak', 'wasteland', 'brush']) {
  test(`the ${look} look paints the strip: its words and ground differ from the frame without it`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const problems = watchErrors(page);
    await startRace(page, { look });
    const m = await showAndMeasure(page, [bark(SHORT_LINE)]);
    expectClear(m, `${look} look`);
    expect(await page.locator('#hud-ticker').getAttribute('data-look')).toBe(look);
    const clip = {
      x: Math.max(0, Math.floor(m.box.left)),
      y: Math.max(0, Math.floor(m.box.top)),
      width: Math.ceil(m.box.right - m.box.left) + 1,
      height: Math.ceil(m.box.bottom - m.box.top) + 1,
    };
    const withStrip = await page.screenshot({ clip });
    // The same frame region with the strip hidden (its layout stays): what it painted is the difference.
    await page.evaluate(() => {
      const root = document.getElementById('hud-ticker');
      if (root) root.style.visibility = 'hidden';
    });
    const without = await page.screenshot({ clip });
    await page.evaluate(() => {
      const root = document.getElementById('hud-ticker');
      if (root) root.style.visibility = '';
    });
    const { differing, total } = await differingPixels(page, withStrip, without);
    console.log(`${look} look: ${differing} of ${total} pixels differ with the strip drawn (band ${m.band})`);
    // Text strokes on a 15 px line are at least a few dozen strongly different pixels, in every look.
    expect(differing, `${look}: the strip painted something`).toBeGreaterThanOrEqual(40);
    mkdirSync('test-results/screenshots', { recursive: true });
    await page.screenshot({ path: `test-results/screenshots/ui-ticker-look-${look}.png` });
    expect(problems).toEqual([]);
  });
}

test('style events from the sim feed reach the strip and merge into one line', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watchErrors(page);
  await startRace(page);
  // A bark from the live race can take the strip for a moment, so the feed is tried again (cleared
  // first) until the two near misses are one line.
  await expect(async () => {
    const text = await page.evaluate(async () => {
      const w = window as TestWindow;
      w.__uiTicker?.([]);
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      w.__uiStyleFeed?.([{ kind: 'nearMiss', points: 25 }]);
      await frame();
      await frame();
      w.__uiStyleFeed?.([{ kind: 'nearMiss', points: 25 }]);
      await frame();
      await frame();
      await frame();
      const root = document.getElementById('hud-ticker');
      if (!root || root.hidden) return '';
      const words = root.querySelector('.ticker-text')?.textContent ?? '';
      const cash = root.querySelector('.ticker-cash')?.textContent ?? '';
      return `${root.dataset['cls']}|${words} ${cash}`;
    });
    expect(text).toBe('style|NEAR MISS ×2 +$50');
  }).toPass({ timeout: 30_000 });
  expect(problems).toEqual([]);
});
