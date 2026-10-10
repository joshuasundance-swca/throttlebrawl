import { expect, type Page } from '@playwright/test';

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
