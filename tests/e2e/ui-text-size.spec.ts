import { openMainMenu, openQuickPlay } from './menu-navigation';
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

/** The stamp must yield to every painted start-screen word, including keyboard instructions. */
async function startStampFindings(
  page: Page,
  forced?: { left: number; right: number; top: number; bottom: number },
) {
  return page.evaluate((replacement) => {
    const stamp = document.getElementById('build-stamp');
    const box = replacement ?? (stamp?.checkVisibility() ? stamp.getBoundingClientRect() : null);
    if (!box) return [];
    const findings: string[] = [];
    for (const e of document.querySelectorAll<HTMLElement>('#start-screen *')) {
      if (!e.checkVisibility()) continue;
      for (const n of e.childNodes) {
        if (n.nodeType !== Node.TEXT_NODE || !(n.textContent ?? '').trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (r.width < 0.5 || r.height < 0.5 || r.bottom <= 0 || r.top >= innerHeight) continue;
          if (box.left < r.right && r.left < box.right && box.top < r.bottom && r.top < box.bottom)
            findings.push(`stamp covers ${(n.textContent ?? '').trim()}`);
        }
      }
    }
    return findings;
  }, forced ?? null);
}

/** The start card's actual words stay reachable before its one-tap entry at either saved size. */
async function checkStartHelp(page: Page, label: string) {
  const help = page.locator('#start-controls');
  await expect(help).toBeVisible();
  await expect(help).toContainText(/finish your swing/i);
  await expect(help).toContainText(/alongside/i);
  await expect(help).toContainText(/weapon glints/i);
  await expect(help).toContainText(/fresh press/i);
  await expect(help).toContainText(/not a hold/i);
  await expect(help).toContainText(/replaces your carried weapon/i);
  const measured = await findOverflow(page);
  expect(measured.examined, `${label}: start words examined`).toBeGreaterThan(0);
  expect(measured.out, `${label}: start words fit or scroll`).toEqual([]);
  await expect
    .poll(() => startStampFindings(page), { message: `${label}: no start word under the stamp` })
    .toEqual([]);
  // The same judge must name a known word when a stamp is planted over it, even if the real stamp hides.
  const knownWord = await help
    .locator('b')
    .first()
    .evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
  expect(await startStampFindings(page, knownWord), `${label}: planted stamp is detected`).toContain(
    'stamp covers Keys',
  );
  const lines = await page.locator('#start-controls .snatch-help').all();
  expect(lines.length, `${label}: snatch help rows found`).toBeGreaterThan(0);
  for (const line of lines) {
    await line.scrollIntoViewIfNeeded();
    const painted = await line.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return {
        inside:
          r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5,
        opacity: Number(getComputedStyle(node).opacity),
      };
    });
    expect(painted.inside, `${label}: snatch help can be scrolled onto the screen`).toBe(true);
    expect(painted.opacity, `${label}: snatch help is painted`).toBeGreaterThan(0.5);
    await expect
      .poll(() => startStampFindings(page), { message: `${label}: scrolled help stays clear of the stamp` })
      .toEqual([]);
  }
  const startTap = page.locator('#start-screen > .big');
  await startTap.scrollIntoViewIfNeeded();
  await expect
    .poll(() => startStampFindings(page), { message: `${label}: returning to Start keeps words clear` })
    .toEqual([]);
  const reachable = await startTap.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      inside: r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5,
      lands: hit === node || node.contains(hit),
    };
  });
  expect(reachable.inside, `${label}: start tap is reachable`).toBe(true);
  expect(reachable.lands, `${label}: the start tap is uncovered`).toBe(true);
  await startTap.click();
  await expect(page.locator('#menu-quick-play')).toBeVisible();
}

async function bootToMenu(page: Page) {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./?settings=all');
  await checkStartHelp(page, 'normal text');
  await expect(page.locator('#menu-quick-play')).toBeVisible();
}

async function setLargest(page: Page) {
  await openMainMenu(page);
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-access').click();
  await page.locator('#settings-textSize [data-value="largest"]').click();
  await expect(page.locator('#settings-textSize [data-value="largest"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('#settings-back').click();
  await expect(page.locator('#menu-quick-play')).toBeVisible();
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

  // The setting persists into the start card too; exercise its scrolling words and actual entry.
  await page.reload();
  await checkStartHelp(page, `${label}, saved largest text`);
  expect(
    await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
    `${label}: the largest size survived reload`,
  ).toBeCloseTo(largestPx, 2);

  let found = await findOverflow(page);
  expect(found.examined, `${label}: menu text examined`).toBeGreaterThan(0);
  expect(found.out, `${label}: the menu`).toEqual([]);
  await expectButtonsReachable(page, `${label}: the menu`, '#menu');

  await openMainMenu(page);

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
  await openQuickPlay(page);
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

for (const viewport of [
  { width: 640, height: 360 },
  { width: 568, height: 320 },
]) {
  test.describe(`small phone landscape ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });
    test('the same screens scroll or fit, and every button can be reached', async ({ page }) => {
      test.setTimeout(180_000);
      await checkScreens(page, 'small phone');
    });
  });
}

for (const viewport of [
  { width: 915, height: 412 },
  { width: 568, height: 320 },
]) {
  test(`live touch labels grow where height permits, without changing circles, at ${viewport.width}x${viewport.height}`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error('Touch layout check requires the configured game URL');
    const captures = [];
    for (const size of ['normal', 'largest']) {
      const context = await browser.newContext({
        baseURL,
        viewport,
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'block',
      });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => {
          (window as TestWindow).__GAME_TEST__ = true;
        });
        await page.goto('./');
        await page.locator('#start-action').click();
        if (size === 'largest') await setLargest(page);
        await openQuickPlay(page);
        await page.locator('#menu-race').click();
        await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
        const capture = await page.evaluate(() => {
          const controls = ['touch-attack', 'touch-brake', 'touch-wheelie'].map((id) => {
            const button = document.getElementById(id)!;
            const box = button.getBoundingClientRect();
            const text = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!;
            const range = document.createRange();
            range.selectNodeContents(text);
            const hint = button.querySelector<HTMLElement>('.touch-hint');
            const rects = [...range.getClientRects(), ...(hint ? [hint.getBoundingClientRect()] : [])];
            return {
              id,
              geometry: [box.x, box.y, box.width, box.height],
              font: parseFloat(getComputedStyle(button).fontSize),
              hintFont: hint ? parseFloat(getComputedStyle(hint).fontSize) : null,
              hint: hint?.textContent ?? null,
              fits:
                rects.every(
                  (r) =>
                    r.left >= box.left && r.top >= box.top && r.right <= box.right && r.bottom <= box.bottom,
                ) &&
                button.scrollWidth <= button.clientWidth + 1 &&
                button.scrollHeight <= button.clientHeight + 1,
              visible: button.checkVisibility(),
            };
          });
          return { root: parseFloat(getComputedStyle(document.documentElement).fontSize), controls };
        });
        for (const control of capture.controls) {
          expect(control.visible, `${size}: ${control.id} visible`).toBe(true);
          expect(control.fits, `${size}: ${control.id} painted words fit`).toBe(true);
        }
        expect(capture.controls[0]!.hint).toBe('▼ kick');
        expect(capture.controls[2]!.hint).toBe(viewport.height > 320 ? 'wheelie' : null);
        captures.push(capture);
      } finally {
        await context.close();
      }
    }
    const [normal, largest] = captures;
    const factor = viewport.height > 320 ? 1.4 : 1;
    expect(largest!.root / normal!.root, 'the live race height cap applies').toBeCloseTo(factor, 2);
    for (let i = 0; i < normal!.controls.length; i++) {
      const a = normal!.controls[i]!,
        b = largest!.controls[i]!;
      expect(b.geometry, 'text size preserves each touch circle').toEqual(a.geometry);
      expect(b.font / a.font, `${a.id}: primary word follows the live text factor`).toBeCloseTo(factor, 2);
      if (a.hintFont !== null) {
        expect(b.hintFont).not.toBeNull();
        if (a.id === 'touch-attack' || factor === 1)
          expect(b.hintFont! / a.hintFont, `${a.id}: hint follows the live text factor`).toBeCloseTo(
            factor,
            2,
          );
        else {
          expect(b.hintFont!, `${a.id}: instructional words grow`).toBeGreaterThan(a.hintFont);
          expect(b.hintFont!, 'wheelie word retains its smaller fit limit').toBeLessThanOrEqual(10);
        }
      }
    }
  });
}
