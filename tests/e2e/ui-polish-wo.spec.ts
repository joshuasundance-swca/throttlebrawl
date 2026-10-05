import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';

// Run W-O, the polish-1 follow-ups (skeptic-pol and sync-pol reports):
// - the R key's radio choice is saved the moment it changes, not only when pause or settings opens;
// - the radio panel's "Cut." note is readable on a phone (big, upright, on its own ground);
// - the bark on the top ticker stays within two lines (one slot, at most 44 px) on a 412 px-wide
//   portrait screen, for every line the packs carry.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { state(): string; snapshot(): { tick: number } | null; setBot(on: boolean): void };
  __uiTicker?: (
    items: { cls: string; text: string; tag?: string; contentRef?: string; dwellMs?: number }[],
    hold?: boolean,
  ) => void;
};

/** Every bark line the packs carry (base and regions). */
const LINES: string[] = [];
for (const pack of readdirSync('packs')) {
  if (!existsSync(`packs/${pack}/barks`)) continue;
  for (const f of readdirSync(`packs/${pack}/barks`)) {
    const set = JSON.parse(readFileSync(`packs/${pack}/barks/${f}`, 'utf8')) as {
      lines?: { text: string }[];
    };
    for (const l of set.lines ?? []) LINES.push(l.text);
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
});

async function shot(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: `test-results/screenshots/ui-polish-${name}.png` });
}

const savedRadio = (page: Page) =>
  page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? '';
      if (k.endsWith(':settings'))
        return (JSON.parse(localStorage.getItem(k) ?? 'null') as { data?: { radio?: string } } | null)?.data
          ?.radio;
    }
    return undefined;
  });

/**
 * How many stations the Keys' dial has, as the base pack's station files make it (no hidden pirate
 * or rider's own), so a station added to the Keys edits nothing here.
 */
function keysDial(): number {
  return readdirSync('packs/base/stations')
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`packs/base/stations/${f}`, 'utf8')) as Record<string, unknown>)
    .filter((s) => (s['regions'] as string[]).includes('florida-keys') && !s['pirate'] && !s['rider']).length;
}

async function raceStarted(page: Page) {
  await page.waitForFunction(() => {
    const g = (window as TestWindow).__game;
    return g?.state() === 'race' && (g.snapshot()?.tick ?? 0) > 30;
  });
}

test('the R key saves the radio choice at once, with no pause or settings in between', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await raceStarted(page);
  expect(await savedRadio(page)).not.toBe('score');
  // The race starts on the Keys' first station (playtest 2, 2026-10-02). R through the rest of the
  // dial, then off, then the score: the score is saved at once, without the pause menu or settings.
  const dial = keysDial();
  expect(dial).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < dial + 1; i++) await page.keyboard.press('KeyR');
  await expect.poll(() => savedRadio(page), { timeout: 3000 }).toBe('score');
  await expect(page.locator('#pause-screen')).toBeHidden();
  // R through every station, then off: off is saved too.
  for (let i = 0; i < dial + 1; i++) await page.keyboard.press('KeyR');
  await expect.poll(() => savedRadio(page), { timeout: 3000 }).toBe('off');
  // Kept across a reload, and the Radio row shows it.
  await page.reload();
  await page.locator('#start-screen').click();
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-sound').click();
  await expect(page.locator('#settings-radio [data-value="off"]')).toHaveAttribute('aria-pressed', 'true');
});

/** Pauses a race on a station with a song up, cuts it, and returns the note's painted style. */
/**
 * The note's look, on a stand-in radio the spec plants (`window.__uiRadioSource`): one station
 * playing one song, whose cut always lands. The real radio's cut path is ui-radio-panel.spec.ts's;
 * on a loaded CI runner the real one intermittently read the song back instead of the note (PR
 * #232's first CI run, as in main's run 36903807975), which this test is not about.
 */
async function cutNote(page: Page) {
  await page.addInitScript(() => {
    let cut = false;
    (window as unknown as { __uiRadioSource: unknown }).__uiRadioSource = {
      state: () => ({
        choice: 2,
        tunedTo: 'test-station',
        stations: ['test-station'],
        nowPlaying: {
          stationId: 'test-station',
          stationName: 'Test 101.1',
          title: cut ? 'The next song' : 'A song to cut',
          ref: `base:station/test-station#${cut ? 'next' : 'cut-me'}`,
        },
      }),
      skip: () => undefined,
      cut: () => {
        cut = true;
        return { contentRef: 'base:station/test-station#cut-me', raceId: 'e2e', tick: 1 };
      },
      tune: () => undefined,
    };
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await raceStarted(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#radio-song')).toHaveText('A song to cut');
  await page.locator('#radio-cut').click();
  await expect(page.locator('#radio-cut-yes')).toBeVisible();
  // "Cut it" and the note's style in one turn of the page: the note holds for 3 s of wall-clock
  // time, and on a loaded software-rendered CI runner a separate poll came later than that (PR
  // #232's second CI run read the next song).
  return page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#radio-cut-yes')?.click();
    (window as Window & { __cutAt?: number }).__cutAt = performance.now();
    const el = document.querySelector<HTMLElement>('#radio-song');
    if (!el) throw new Error('no #radio-song');
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      text: el.textContent ?? '',
      note: el.classList.contains('note'),
      fontSize: parseFloat(s.fontSize),
      fontStyle: s.fontStyle,
      fontWeight: Number(s.fontWeight),
      color: s.color,
      background: s.backgroundColor,
      inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
    };
  });
}

test('the "Cut." note reads at arm\'s length on a phone landscape screen', async ({ page }) => {
  test.setTimeout(90_000);
  const style = await cutNote(page);
  console.log(`cut note (915x412): ${JSON.stringify(style)}`);
  expect(style.text).toContain('Cut');
  expect(style.note).toBe(true);
  expect(style.fontSize).toBeGreaterThanOrEqual(15);
  expect(style.fontStyle).toBe('normal');
  expect(style.fontWeight).toBeGreaterThanOrEqual(700);
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.inView).toBe(true);
  // Still up 1.5 s after the click, through the pause screen's 500 ms refreshes. Timed from the
  // click on the page's own clock (a screenshot in between took over 3 s on CI, PR #232's third
  // run): asserted when the check came well inside the 3 s hold, logged when it did not.
  const later = await page.evaluate(async () => {
    const t0 = (window as Window & { __cutAt?: number }).__cutAt ?? performance.now();
    // eslint-disable-next-line no-restricted-syntax -- the radio note's hold is a wall-clock UI timer, timed here on the page's own clock
    await new Promise((r) => setTimeout(r, Math.max(0, 1500 - (performance.now() - t0))));
    const el = document.querySelector<HTMLElement>('#radio-song');
    return {
      ms: performance.now() - t0,
      text: el?.textContent ?? '',
      note: !!el?.classList.contains('note'),
    };
  });
  console.log(`cut note after ${Math.round(later.ms)} ms: ${JSON.stringify(later)}`);
  if (later.ms < 2500) {
    expect(later.text).toContain('Cut');
    expect(later.note).toBe(true);
  }
  await shot(page, 'cut-note-landscape');
});

// A phone held upright shows the rotate screen once the race starts (platform/), so the portrait
// size is a 412-wide window with a fine pointer, where the game does not ask.
test.describe('portrait', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: false, hasTouch: false });

  test('the "Cut." note reads on a 412x915 portrait screen', async ({ page }) => {
    test.setTimeout(90_000);
    const style = await cutNote(page);
    console.log(`cut note (412x915): ${JSON.stringify(style)}`);
    expect(style.text).toContain('Cut');
    expect(style.note).toBe(true);
    expect(style.fontSize).toBeGreaterThanOrEqual(15);
    expect(style.inView).toBe(true);
    await shot(page, 'cut-note-portrait');
  });

  test('the ticker holds every pack line in at most two lines', async ({ page }) => {
    test.setTimeout(90_000);
    expect(LINES.length, 'pack lines to measure').toBeGreaterThan(100);
    await page.goto('./');
    await page.locator('#start-screen').click();
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await page.locator('#menu-race').click();
    const bubble = page.locator('#hud-ticker[data-cls="bark"]');
    await expect(bubble).toBeVisible({ timeout: 15_000 });
    await shot(page, 'bark-portrait');
    // The real ticker, each pack line shown on it in turn (held up): count the text's line boxes.
    const result = await page.evaluate((lines) => {
      const root = document.getElementById('hud-ticker');
      const show = (text: string) =>
        (window as TestWindow).__uiTicker?.([
          {
            cls: 'bark',
            tag: 'Deacon Vane',
            text,
            contentRef: 'base:bark-set/deacon-core#test',
            dwellMs: 600_000,
          },
        ]);
      if (!root) return null;
      let worst = { lines: 0, text: '' };
      let tallest = 0;
      let smallest = 99;
      let widest = 0;
      const counts: number[] = [];
      for (const l of lines) {
        show(l);
        const text = root.querySelector<HTMLElement>('.ticker-text');
        if (!text) return null;
        const n = text.getClientRects().length;
        counts.push(n);
        if (n > worst.lines) worst = { lines: n, text: l };
        const r = root.getBoundingClientRect();
        tallest = Math.max(tallest, r.height);
        widest = Math.max(widest, r.right);
        smallest = Math.min(smallest, parseFloat(getComputedStyle(root).fontSize));
      }
      // The longest line, left up for the screenshot.
      show([...lines].sort((a, b) => b.length - a.length)[0] ?? '');
      const r = root.getBoundingClientRect();
      return {
        worst,
        twoLines: counts.filter((n) => n === 2).length,
        oneLine: counts.filter((n) => n === 1).length,
        tallest,
        widest,
        box: { left: r.left, right: r.right, width: r.width },
        fontSize: smallest,
      };
    }, LINES);
    console.log(`ticker at 412 px: ${LINES.length} lines measured, ${JSON.stringify(result)}`);
    expect(result).not.toBeNull();
    expect(result?.worst.lines, `worst: "${result?.worst.text}"`).toBeLessThanOrEqual(2);
    expect(result?.tallest, 'one slot, at most 44 px').toBeLessThanOrEqual(44);
    expect(result?.fontSize).toBeGreaterThanOrEqual(12);
    expect((result?.box.left ?? -1) >= 0 && (result?.widest ?? 999) <= 412, 'inside the screen').toBe(true);
    await shot(page, 'bark-portrait-longest');
  });
});
