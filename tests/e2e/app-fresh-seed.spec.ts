import { expect, test, type Page } from '@playwright/test';

// A fresh seed per race in the real game (playtest 1c item 2, 2026-09-30: "I want randomness so
// you don't see the same cars in the same order"). This page runs WITHOUT the test flag, as a
// player's does: the race starts from the menu, the pause screen's "copy debug report" shows the
// race's seed, and Restart starts a new race with a different seed. A new device's first tap lands on
// the menu (playtest 4, "Menu first"), so the race here is the menu's Race. Seeded tests keep their
// fixed seed through the test flag (tests/e2e/dev-report.spec.ts checks "seed 1"). Without the test
// flag the race holds at the grid for its 3-2-1 countdown; the pause button works through it.

type CopyWindow = Window & { __copied?: string[] };

async function copiedReport(page: Page, count: number): Promise<string> {
  await page.locator('#pause-copy-report').click();
  await page.waitForFunction((n) => ((window as CopyWindow).__copied?.length ?? 0) >= n, count);
  return page.evaluate(() => {
    const all = (window as CopyWindow).__copied ?? [];
    return all[all.length - 1] ?? '';
  });
}

function seedOf(report: string): number {
  const m = /state race · tick \d+ · seed (\d+)/.exec(report);
  expect(m, `the report shows the race's seed:\n${report}`).not.toBeNull();
  return Number(m?.[1]);
}

test('each race draws a fresh seed, and the debug report shows it', async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  await page.addInitScript(() => {
    const w = window as CopyWindow;
    w.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          w.__copied?.push(text);
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto('./');
  // A new device's first tap lands on the menu; Race starts a free-play race. Restart below
  // restarts that race.
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible();
  // eslint-disable-next-line no-restricted-syntax -- this page runs as a player's, without the test flag, so there is no tick to wait on: a moment of race before the pause
  await page.waitForTimeout(1500);
  await page.locator('#hud-pause').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  const first = seedOf(await copiedReport(page, 1));

  await page.locator('#pause-restart').click();
  await expect(page.locator('#hud-position')).toBeVisible();
  // eslint-disable-next-line no-restricted-syntax -- this page runs as a player's, without the test flag, so there is no tick to wait on: a moment of race before the pause
  await page.waitForTimeout(1500);
  await page.locator('#hud-pause').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  const second = seedOf(await copiedReport(page, 2));

  console.log(`[print] race seeds: ${first}, then ${second} after Restart`);
  expect(second, 'Restart starts a race with a fresh seed').not.toBe(first);
  expect(problems).toEqual([]);
});
