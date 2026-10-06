import { expect, test, type Page } from '@playwright/test';

// The Text size setting at its largest (M5's a11y-1; playtest 4 run B, B13; docs/product-spec.md,
// "Accessibility"): the menus, the settings screen and the pause menu keep every word on the screen,
// or inside a screen that scrolls, and every button reachable. The HUD's own layout at the largest
// size is measured in ui-hud-layout.spec.ts. Phone landscape, then the small phone.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { setBot(on: boolean): void; state(): string };
};

/**
 * Text that leaves the screen, or overflows its box sideways or downwards, outside a screen that
 * scrolls (the same rule as ui-screens.spec.ts: text scrolled out of an on-screen scroller, and
 * inside it side to side, is reachable).
 */
function findOverflow(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const onScreen = (r: DOMRect) =>
      r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
    // The nearest ancestor that scrolls on an axis and has more than it shows.
    const scrollerOf = (e: HTMLElement, axis: 'x' | 'y') => {
      for (let p = e.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        const mode = axis === 'y' ? style.overflowY : style.overflowX;
        const more = axis === 'y' ? p.scrollHeight > p.clientHeight + 1 : p.scrollWidth > p.clientWidth + 1;
        if ((mode === 'auto' || mode === 'scroll') && more) return p;
      }
      return null;
    };
    let examined = 0;
    for (const e of document.querySelectorAll<HTMLElement>('#ui *, #build-stamp')) {
      if (e.closest('#tuning-panel')) continue;
      if (!e.checkVisibility()) continue;
      const ownText = [...e.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim() !== '');
      if (!ownText) continue;
      examined++;
      const r = e.getBoundingClientRect();
      const name = `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''} "${(e.textContent ?? '').trim().slice(0, 30)}"`;
      if (!onScreen(r)) {
        // Scrolled out of an on-screen scroller: up and down (and inside it side to side), or along a
        // row that scrolls sideways (the route picker's chips).
        const sy = scrollerOf(e, 'y');
        const by = sy?.getBoundingClientRect();
        const sx = scrollerOf(e, 'x');
        const bx = sx?.getBoundingClientRect();
        const viaY = !!by && onScreen(by) && r.left >= by.left - 0.5 && r.right <= by.right + 0.5;
        const viaX = !!bx && onScreen(bx) && r.top >= bx.top - 0.5 && r.bottom <= bx.bottom + 0.5;
        if (!viaY && !viaX) out.push(`${name} leaves the screen: ${JSON.stringify(r)}`);
      }
      const style = getComputedStyle(e);
      if (style.display !== 'inline') {
        // A clamped blurb and an ellipsised name cut their words on purpose.
        const clamped = style.getPropertyValue('-webkit-line-clamp') !== 'none';
        const ellipsis = style.textOverflow === 'ellipsis';
        if (!ellipsis && e.scrollWidth > e.clientWidth + 1) out.push(`${name} overflows sideways`);
        if (!clamped && !ellipsis && e.scrollHeight > e.clientHeight + 1)
          out.push(`${name} overflows downwards`);
      }
    }
    return { out, examined };
  });
}

/** Every visible button on the screen can be scrolled onto it and then hit: nothing covers it. */
async function expectButtonsReachable(page: Page, where: string, scope: string) {
  const ids = await page.evaluate((s) => {
    // A probe left on a button of the last tab (now hidden) would match twice: clear them first.
    for (const old of document.querySelectorAll<HTMLElement>('[data-ts-probe]'))
      delete old.dataset['tsProbe'];
    return [...document.querySelectorAll<HTMLElement>(`${s} button`)]
      .filter((b) => b.checkVisibility())
      .map((b, i) => {
        b.dataset['tsProbe'] = String(i);
        return b.dataset['tsProbe'];
      });
  }, scope);
  expect(ids.length, `${where}: buttons found`).toBeGreaterThan(0);
  const unreachable: string[] = [];
  for (const id of ids) {
    const button = page.locator(`${scope} button[data-ts-probe="${id}"]`);
    await button.scrollIntoViewIfNeeded();
    const hit = await button.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const inside =
        r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        inside,
        covered: !top || !(top === b || b.contains(top) || top.contains(b)),
        name: b.id || b.textContent,
      };
    });
    if (!hit.inside || hit.covered)
      unreachable.push(`${hit.name}${hit.inside ? ' (covered)' : ' (off screen)'}`);
  }
  expect(unreachable, `${where}: every button can be reached`).toEqual([]);
}

async function bootToMenu(page: Page) {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./?settings=all');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
}

async function setLargest(page: Page) {
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-access').click();
  await page.locator('#settings-textSize [data-value="largest"]').click();
  await expect(page.locator('#settings-textSize [data-value="largest"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('#settings-back').click();
  await expect(page.locator('#menu-race')).toBeVisible();
}

async function checkScreens(page: Page, label: string) {
  await bootToMenu(page);
  // Normal first: the control that the largest size changes the root size at all.
  const normalPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await setLargest(page);
  const largestPx = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  expect(largestPx / normalPx, `${label}: the root size grows to the largest factor`).toBeCloseTo(1.4, 2);

  let found = await findOverflow(page);
  expect(found.examined, `${label}: menu text examined`).toBeGreaterThan(0);
  expect(found.out, `${label}: the menu`).toEqual([]);
  await expectButtonsReachable(page, `${label}: the menu`, '#menu');

  await page.locator('#menu-settings').click();
  const tabs = await page.locator('[id^="settings-tab-"]:visible').evaluateAll((els) => els.map((e) => e.id));
  expect(tabs, `${label}: the Access tab is there`).toContain('settings-tab-access');
  for (const id of tabs) {
    await page.locator(`#${id}`).click();
    found = await findOverflow(page);
    expect(found.out, `${label}: settings, ${id}`).toEqual([]);
    await expectButtonsReachable(page, `${label}: settings, ${id}`, '#settings');
  }
  await page.locator('#settings-back').click();

  // The pause menu over a race.
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  found = await findOverflow(page);
  expect(found.out, `${label}: the pause menu`).toEqual([]);
  await expectButtonsReachable(page, `${label}: the pause menu`, '#pause-screen');
}

test('phone landscape: the menu, every settings tab and the pause menu fit the largest text', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await checkScreens(page, 'phone landscape');
});

test.describe('small phone landscape', () => {
  test.use({ viewport: { width: 640, height: 360 } });
  test('the same screens scroll or fit, and every button can be reached', async ({ page }) => {
    test.setTimeout(180_000);
    await checkScreens(page, 'small phone');
  });
});
