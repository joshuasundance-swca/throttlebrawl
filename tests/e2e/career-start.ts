import type { Page } from '@playwright/test';

// A new device's way into the career's first race (playtest 4, P4-5, "Menu first"): the start tap
// lands on the menu, "Start career" opens the career map with the tutorial event suggested, and Ride
// starts it. Specs that need the opening race (its objective up, the bot riding it from its first
// tick) take this path the way a player does, instead of a first tap that raced on its own.

/** From a loaded page: the start tap, Start career, the suggested event, Ride. Waits for the race. */
export async function rideFirstCareerRace(page: Page): Promise<void> {
  await page.locator('#start-screen').click();
  await page.locator('#menu-career').click();
  await page.locator('.career-node.suggested').click();
  await page.locator('#career-ride').click();
  await page.waitForFunction(
    () => (window as Window & { __game?: { state(): string } }).__game?.state() === 'race',
  );
}
