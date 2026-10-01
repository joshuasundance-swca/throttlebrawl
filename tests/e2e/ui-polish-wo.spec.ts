import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';

// Run W-O, the polish-1 follow-ups (skeptic-pol and sync-pol reports):
// - the R key's radio choice is saved the moment it changes, not only when pause or settings opens;
// - the radio panel's "Cut." note is readable on a phone (big, upright, on its own ground);
// - the bark bubble stays within two lines on a 412 px-wide portrait screen, for every line the
//   packs carry.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { state(): string; snapshot(): { tick: number } | null; setBot(on: boolean): void };
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
  expect(await savedRadio(page)).not.toBe('station');
  // R: the score to the first station. Saved without the pause menu or settings opening.
  await page.keyboard.press('KeyR');
  await expect.poll(() => savedRadio(page), { timeout: 3000 }).toBe('station');
  await expect(page.locator('#pause-screen')).toBeHidden();
  // R twice more (the second station, then off): off is saved too.
  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyR');
  await expect.poll(() => savedRadio(page), { timeout: 3000 }).toBe('off');
  // Kept across a reload, and the Radio row shows it.
  await page.reload();
  await page.locator('#start-screen').click();
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-sound').click();
  await expect(page.locator('#settings-radio [data-value="off"]')).toHaveAttribute('aria-pressed', 'true');
});

/** Pauses a race on a station with a song up, cuts it, and returns the note's painted style. */
async function cutNote(page: Page) {
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await raceStarted(page);
  await page.keyboard.press('KeyR'); // the first station
  await page.waitForTimeout(2500); // the station loads and a song starts
  await page.keyboard.press('Escape');
  await expect(page.locator('#radio-song')).not.toBeEmpty({ timeout: 10_000 });
  await page.locator('#radio-cut').click();
  await page.locator('#radio-cut-yes').click();
  await expect(page.locator('#radio-song')).toContainText('Cut');
  return page.locator('#radio-song').evaluate((el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
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
  expect(style.note).toBe(true);
  expect(style.fontSize).toBeGreaterThanOrEqual(15);
  expect(style.fontStyle).toBe('normal');
  expect(style.fontWeight).toBeGreaterThanOrEqual(700);
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.inView).toBe(true);
  // Still up after 1.5 s (the pause screen refreshes the panel every 500 ms). Checked before the
  // screenshot: on a slow CI runner the software-rendered screenshot alone took long enough that
  // the 3 s note had run its time by the check (failed twice in CI on #238, passed locally 6 of 6).
  await page.waitForTimeout(1500);
  await expect(page.locator('#radio-song')).toContainText('Cut');
  await expect(page.locator('#radio-song')).toHaveClass(/\bnote\b/);
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
    expect(style.note).toBe(true);
    expect(style.fontSize).toBeGreaterThanOrEqual(15);
    expect(style.inView).toBe(true);
    await shot(page, 'cut-note-portrait');
  });

  test('the bark bubble holds every pack line in at most two lines', async ({ page }) => {
    test.setTimeout(90_000);
    expect(LINES.length, 'pack lines to measure').toBeGreaterThan(100);
    await page.goto('./');
    await page.locator('#start-screen').click();
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await page.locator('#menu-race').click();
    const bubble = page.locator('#bark-bubble');
    await expect(bubble).toBeVisible({ timeout: 15_000 });
    await shot(page, 'bark-portrait');
    // The real bubble, its own line swapped for each pack line in turn: count the text's line boxes.
    const result = await bubble.evaluate((el, lines) => {
      const text = el.querySelector<HTMLElement>('.bark-text');
      if (!text) return null;
      const own = text.textContent;
      let worst = { lines: 0, text: '' };
      const counts: number[] = [];
      for (const l of lines) {
        text.textContent = l;
        const n = text.getClientRects().length;
        counts.push(n);
        if (n > worst.lines) worst = { lines: n, text: l };
      }
      // The longest line, left up for the screenshot.
      text.textContent = [...lines].sort((a, b) => b.length - a.length)[0] ?? own;
      const r = el.getBoundingClientRect();
      return {
        worst,
        twoLines: counts.filter((n) => n === 2).length,
        oneLine: counts.filter((n) => n === 1).length,
        box: { left: r.left, right: r.right, width: r.width },
        fontSize: parseFloat(getComputedStyle(text).fontSize),
      };
    }, LINES);
    console.log(`bark bubble at 412 px: ${LINES.length} lines measured, ${JSON.stringify(result)}`);
    expect(result).not.toBeNull();
    expect(result?.worst.lines, `worst: "${result?.worst.text}"`).toBeLessThanOrEqual(2);
    expect(result?.fontSize).toBeGreaterThanOrEqual(18);
    expect((result?.box.left ?? -1) >= 0 && (result?.box.right ?? 999) <= 412, 'inside the screen').toBe(
      true,
    );
    await shot(page, 'bark-portrait-longest');
  });
});
