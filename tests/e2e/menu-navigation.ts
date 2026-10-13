import { expect, type Page } from '@playwright/test';

/** A repeated navigation may leave an active attempt or a completed, cleared race. */
export async function enterReloadedMenu(page: Page) {
  await page.waitForFunction(() => !!(window as Window & { __game?: unknown }).__game);
  const hasAttempt = await page.evaluate(() => localStorage.getItem('mbrawl:race') !== null);
  if (hasAttempt) {
    await expect(page.locator('#resume-card')).toBeVisible();
    await page.locator('#resume-start-over').click();
  } else await page.locator('#start-screen').click();
  await expect(page.locator('#menu')).toBeVisible();
}

/** Reach the actual Quick Play pane, retaining any region and setup picks already made. */
export async function openQuickPlay(page: Page) {
  await expect(page.locator('#menu')).toBeVisible();
  if (!(await page.locator('#quick-play').isVisible())) await page.locator('#menu-quick-play').click();
  await expect(page.locator('#quick-play')).toBeVisible();
  await expect(page.locator('#menu-race')).toBeVisible();
}

/** Return through the same Menu button a player uses, without changing the game state. */
export async function openMainMenu(page: Page) {
  await expect(page.locator('#menu')).toBeVisible();
  if (await page.locator('#quick-play').isVisible()) await page.locator('#quick-play-back').click();
  await expect(page.locator('#menu-quick-play')).toBeVisible();
}

/** Secondary functions stay accessible through the native More disclosure. */
export async function openMenuMore(page: Page) {
  await openMainMenu(page);
  if (!(await page.locator('#menu-more').evaluate((n) => (n as HTMLDetailsElement).open)))
    await page.locator('#menu-more > summary').click();
}
