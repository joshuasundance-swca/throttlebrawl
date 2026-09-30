import { expect, test, type Page } from '@playwright/test';

// Playtest 1 (2026-09-30): "idk how to kick on the laptop", and "don't clutter the in-game HUD with
// those controls". The keyboard legend (K kicks, J punches, U and O punch to a side) is on the pause
// screen only: visible there, and no legend text anywhere on the race HUD.

type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: { snapshot(): { tick: number } | null } };

const LEGEND = ['K kick', 'J punch', 'U punch left', 'O punch right', 'Esc pause'];

async function toRace(page: Page) {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 30);
}

/** The visible text of everything the race shows while it runs: the HUD and the touch surface. */
const raceText = (page: Page) =>
  page.evaluate(() =>
    ['#hud', '#touch-surface']
      .map((sel) => document.querySelector<HTMLElement>(sel)?.innerText ?? '')
      .join('\n'),
  );

const norm = (s: string) => s.replace(/\s+/g, ' ');

test.describe('laptop', () => {
  test.use({ isMobile: false, hasTouch: false, viewport: { width: 1280, height: 720 } });

  test('the keyboard legend shows on the pause screen and never on the HUD', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    await toRace(page);

    // Racing: the HUD is up and carries none of the legend.
    const hud = norm(await raceText(page));
    console.log(`race HUD text: ${JSON.stringify(hud)}`);
    for (const line of LEGEND) expect(hud, `"${line}" is not on the HUD`).not.toContain(line);
    await expect(page.locator('#pause-keys')).toBeHidden();

    // Paused: the legend is open and readable.
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-screen')).toBeVisible();
    const legend = page.locator('#pause-keys');
    await expect(legend).toBeVisible();
    await expect(legend.locator('.keys-grid')).toBeVisible();
    const text = norm(await legend.innerText());
    console.log(`pause legend: ${JSON.stringify(text)}`);
    for (const line of LEGEND) expect(text).toContain(line);
    // It fits on the screen: the whole card is inside the viewport.
    const box = await legend.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(720);
    await page.screenshot({ path: 'test-results/pause-keys-laptop.png' });

    // Resumed: gone again, and still not on the HUD.
    await page.locator('#pause-resume').click();
    await expect(legend).toBeHidden();
    const after = norm(await raceText(page));
    for (const line of LEGEND) expect(after).not.toContain(line);
    expect(problems).toEqual([]);
  });
});

test('phone: the legend is one folded line on the pause screen, and opens on a tap', async ({ page }) => {
  await toRace(page);
  const hud = norm(await raceText(page));
  for (const line of LEGEND) expect(hud).not.toContain(line);

  await page.locator('#hud-pause').click();
  const legend = page.locator('#pause-keys');
  await expect(legend).toBeVisible();
  await expect(legend.locator('.keys-grid')).toBeHidden();
  // The pause screen's buttons stay on the phone's screen with the legend folded.
  const view = page.viewportSize()!;
  for (const id of ['#pause-resume', '#pause-quit', '#pause-copy-report', '#pause-keys summary']) {
    const b = await page.locator(id).boundingBox();
    expect(b, id).not.toBeNull();
    expect(b!.y + b!.height, `${id} is on screen`).toBeLessThanOrEqual(view.height);
  }
  await page.screenshot({ path: 'test-results/pause-keys-phone.png' });
  await legend.locator('summary').click();
  await expect(legend.locator('.keys-grid')).toBeVisible();
  expect(norm(await legend.innerText())).toContain('K kick');
});
