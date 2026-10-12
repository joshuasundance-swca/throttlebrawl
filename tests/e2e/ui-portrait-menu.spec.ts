import { expect, test, type Locator } from '@playwright/test';

async function paintedText(element: Locator) {
  return element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    return {
      lines: lines.length,
      font: parseFloat(getComputedStyle(node).fontSize),
      clipped: lines.some((r) => r.left < -1 || r.right > innerWidth + 1),
      overflow: node.scrollWidth > node.clientWidth + 1,
    };
  });
}

for (const textSize of ['normal', 'large', 'largest'] as const) {
  test(`portrait welcome gives the menu its width at ${textSize} text`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((textSize) => {
      (window as Window & { __GAME_TEST__?: boolean }).__GAME_TEST__ = true;
      // Supported optional-API fallback permits viewport rotation in headless Chromium.
      Object.defineProperty(Element.prototype, 'requestFullscreen', {
        configurable: true,
        value: undefined,
      });
      localStorage.setItem(
        'mbrawl:settings',
        JSON.stringify({
          format: 'settings',
          version: 1,
          build: 'test',
          savedAt: '2026-10-11T00:00:00Z',
          data: { textSize, volumes: { master: 0 } },
        }),
      );
    }, textSize);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./');
    await page.locator('#start-screen').click();
    const menu = page.locator('#menu .menu-main');
    const title = page.locator('#menu .title');
    const welcome = page.locator('#whats-new');
    await expect(welcome).toBeVisible();
    const layout = async () => {
      const main = await menu.boundingBox();
      const card = await welcome.boundingBox();
      if (!main || !card) throw new Error('Menu and welcome must be painted');
      return { main, card };
    };
    const { main, card } = await layout();
    expect(main.width, 'the menu uses the available portrait width').toBeGreaterThan(350);
    expect(card.width, 'the welcome uses the available portrait width').toBeGreaterThan(350);
    expect(card.y, 'the welcome follows the entire menu').toBeGreaterThanOrEqual(main.y + main.height);
    const heading = await paintedText(title);
    if (textSize === 'normal') expect(heading.lines).toBe(1);
    const root = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(heading.font / root, 'the heading retains its enlarged text scale').toBeCloseTo(2);
    for (const selector of ['#menu .title', '#menu-home > button', '#whats-new li', '#whats-new button']) {
      const elements = page.locator(selector);
      for (const element of await elements.all()) {
        await element.scrollIntoViewIfNeeded();
        const text = await paintedText(element);
        expect(text.lines, selector).toBeGreaterThan(0);
        expect(text.clipped || text.overflow, selector).toBe(false);
        if (await element.evaluate((e) => e instanceof HTMLButtonElement)) {
          expect(
            await element.evaluate((e) => {
              const r = e.getBoundingClientRect();
              const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return !!hit && e.contains(hit);
            }),
            `${selector}: receives a touch at its centre`,
          ).toBe(true);
        }
      }
    }
    await title.evaluate((e) => {
      (e as HTMLElement).style.width = '80px';
    });
    expect((await paintedText(title)).lines, 'the negative control detects a squeezed title').toBeGreaterThan(
      1,
    );
    await title.evaluate((e) => {
      (e as HTMLElement).style.removeProperty('width');
    });
    await page.setViewportSize({ width: 915, height: 412 });
    const landscape = await layout();
    expect(landscape.card.x).toBeGreaterThanOrEqual(landscape.main.x + landscape.main.width);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#whats-new-ok').click();
    await expect(welcome).toBeHidden();
    expect((await menu.boundingBox())?.width).toBeGreaterThan(350);
    await page.locator('#menu-quick-play').click();
    await expect(page.locator('#quick-play')).toBeVisible();
    await page.locator('#quick-play-back').click();
    await expect(page.locator('#menu-home')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
