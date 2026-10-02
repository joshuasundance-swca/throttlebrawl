import { expect, test, type Page } from '@playwright/test';

// Run W-P, W-O's skeptic mustFix: the radio kept only its kind across a reload. In a Keys race, R
// twice tunes keys-surf; after a reload the race played keys-rockabilly, the first station, because
// the record stored radio: 'station' only. The record now keeps the exact station too.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { state(): string; snapshot(): { tick: number } | null; setBot(on: boolean): void };
  __app?: { presentation(): { radio: { region: string | null; stations: string[]; tunedTo: string } } };
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
});

const tunedTo = (page: Page) =>
  page.evaluate(() => (window as TestWindow).__app?.presentation().radio.tunedTo ?? null);

const saved = (page: Page) =>
  page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? '';
      if (k.endsWith(':settings')) {
        const rec = JSON.parse(localStorage.getItem(k) ?? 'null') as {
          data?: { radio?: string; radioStation?: string | null };
        } | null;
        return { radio: rec?.data?.radio, station: rec?.data?.radioStation ?? null };
      }
    }
    return null;
  });

async function race(page: Page) {
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => {
    const g = (window as TestWindow).__game;
    return g?.state() === 'race' && (g.snapshot()?.tick ?? 0) > 30;
  });
}

test('the radio keeps the exact station across a reload, not only "a station"', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./');
  await race(page);
  // The default race is the Keys, on its first station (playtest 2, 2026-10-02: a race starts on
  // its region's own station); R once is the second station.
  await expect.poll(() => tunedTo(page), { timeout: 3000 }).toBe('keys-rockabilly');
  await page.keyboard.press('KeyR');
  await expect.poll(() => tunedTo(page), { timeout: 3000 }).toBe('keys-surf');
  await expect.poll(() => saved(page), { timeout: 3000 }).toEqual({ radio: 'station', station: 'keys-surf' });

  await page.reload();
  await race(page);
  expect(await tunedTo(page)).toBe('keys-surf');

  // The score and back to Station (the settings row) returns to the same station.
  await page.keyboard.press('KeyR'); // keys-surf → keys-tradewinds (the third station)
  await page.keyboard.press('KeyR'); // keys-tradewinds → off
  await page.keyboard.press('KeyR'); // off → the score
  await expect
    .poll(() => saved(page), { timeout: 3000 })
    .toEqual({ radio: 'score', station: 'keys-tradewinds' });
  await page.locator('#hud-pause').click();
  await page.locator('#pause-controls').click();
  await page.locator('#settings-tab-sound').click();
  await page.locator('#settings-radio [data-value="station"]').click();
  await expect.poll(() => tunedTo(page), { timeout: 3000 }).toBe('keys-tradewinds');
});
