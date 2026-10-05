import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { InputFlag, type SimInput } from '../../src/sim/types.ts';

// Settings, Keys (the maintainer, 2026-10-05: "can we customize keyboard settings and stuff? I want
// to be sure it's a joy to play and use all functions"). The layout check: the Keys tab, both device
// lists, at phone-landscape and laptop sizes, keeps every row's text inside its box and on the
// screen once scrolled to, every slot finger-sized and uncovered. The flow: on a laptop a key is
// remapped, flagged when it clashes, shown in the pause legend, drives the race, survives a reload,
// and Reset puts the defaults back. On a touch-only phone the tab never shows.

interface Handle {
  inputs(from?: number): SimInput[];
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
});

async function startRace(page: Page, query = '') {
  await page.goto(`./${query}`);
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 30);
}

/** Every Keys row on screen in turn: its text inside its box and the viewport, its slots big and on top. */
async function checkKeysList(page: Page, label: string) {
  const list = page.locator('#settings-keys-list');
  await expect(list).toBeVisible();
  const view = page.viewportSize()!;
  const box = (await list.boundingBox())!;
  expect(box.y, `${label}: the list starts on screen`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${label}: the list ends on screen`).toBeLessThanOrEqual(view.height + 0.5);
  expect(box.x + box.width, `${label}: the list fits sideways`).toBeLessThanOrEqual(view.width + 0.5);
  const rows = await page.locator('#settings-keys-list .bind-row').count();
  expect(rows).toBeGreaterThan(10);
  const problems: string[] = [];
  let slots = 0;
  for (let i = 0; i < rows; i++) {
    const row = page.locator('#settings-keys-list .bind-row').nth(i);
    await row.scrollIntoViewIfNeeded();
    const found = await row.evaluate((r) => {
      const out: string[] = [];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const name = (r as HTMLElement).dataset['bind'] ?? '?';
      const rr = r.getBoundingClientRect();
      if (rr.left < -0.5 || rr.top < -0.5 || rr.right > vw + 0.5 || rr.bottom > vh + 0.5)
        out.push(`${name}: the row leaves the screen`);
      for (const e of r.querySelectorAll<HTMLElement>('*')) {
        if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline')
          out.push(`${name}: "${(e.textContent ?? '').slice(0, 20)}" overflows sideways`);
        const b = e.getBoundingClientRect();
        if (b.right > rr.right + 0.5 || b.left < rr.left - 0.5)
          out.push(`${name}: a part sticks out of the row`);
      }
      let n = 0;
      for (const b of r.querySelectorAll<HTMLButtonElement>('button')) {
        n++;
        const bb = b.getBoundingClientRect();
        if (bb.height < 36 || bb.width < 44) out.push(`${name}: slot "${b.textContent}" is too small to hit`);
        const top = document.elementFromPoint(bb.left + bb.width / 2, bb.top + bb.height / 2);
        if (!top || !(top === b || b.contains(top))) out.push(`${name}: slot "${b.textContent}" is covered`);
      }
      return { out, n };
    });
    slots += found.n;
    problems.push(...found.out);
  }
  console.log(`${label}: ${rows} rows, ${slots} slots checked`);
  expect(problems, label).toEqual([]);
}

async function shot(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: `test-results/screenshots/keys-${name}.png` });
}

test('phone landscape: the Keys tab over the paused race fits, both devices (preview)', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await startRace(page, '?settings=all');
  await page.locator('#hud-pause').click();
  await page.locator('#pause-controls').click();
  await page.locator('#settings-tab-keys').click();
  for (const device of ['keyboard', 'gamepad'] as const) {
    await page.locator(`#settings-keys-${device}`).click();
    await expect(page.locator(`#settings-keys-${device}`)).toHaveAttribute('aria-pressed', 'true');
    for (const id of [
      '#settings-keys-keyboard',
      '#settings-keys-gamepad',
      '#settings-keys-reset',
      '#settings-back',
    ]) {
      const b = (await page.locator(id).boundingBox())!;
      expect(b.height, `${id} is big enough`).toBeGreaterThanOrEqual(36);
      expect(b.y + b.height, `${id} is on screen`).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
    await checkKeysList(page, `phone ${device}`);
    await shot(page, `phone-${device}`);
  }
  expect(problems).toEqual([]);
});

test('phone, touch only: no Keys tab (the touch controls never change)', async ({ page }) => {
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-settings').click();
  await expect(page.locator('#settings-tab-controls')).toBeVisible();
  await expect(page.locator('#settings-tab-keys')).toBeHidden();
});

test.describe('laptop', () => {
  test.use({ isMobile: false, hasTouch: false, viewport: { width: 1280, height: 720 } });

  test('the Keys tab fits, and a remap is flagged, shown in the legend, drives the race, persists and resets', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const problems = watchErrors(page);
    await page.goto('./');
    await page.locator('#start-screen').click();
    await page.locator('#menu-settings').click();
    await page.locator('#settings-tab-keys').click();
    for (const device of ['gamepad', 'keyboard'] as const) {
      await page.locator(`#settings-keys-${device}`).click();
      await checkKeysList(page, `laptop ${device}`);
      await shot(page, `laptop-${device}`);
    }

    // The defaults: Space is the third brake key, Q the U-turn, Esc fixed on pause.
    await expect(page.locator('#settings-bind-keyboard-brake-2')).toHaveText('Space');
    await expect(page.locator('#settings-bind-keyboard-uturn-0')).toHaveText('Q');
    await expect(page.locator('#settings-bind-keyboard-pause-0')).toBeDisabled();

    // Punch moves from J to F: tap the slot, press F.
    await page.locator('#settings-bind-keyboard-attack-0').click();
    await expect(page.locator('#settings-keys-hint')).toContainText('Press a key for Punch');
    await page.keyboard.press('KeyF');
    await expect(page.locator('#settings-bind-keyboard-attack-0')).toHaveText('F');
    // Esc while a slot waits only cancels: the settings stay open, the binding unchanged.
    await page.locator('#settings-bind-keyboard-kick-0').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings')).toBeVisible();
    await expect(page.locator('#settings-bind-keyboard-kick-0')).toHaveText('K');

    // A clash: the kick on F too. Both rows say so, in words.
    await page.locator('#settings-bind-keyboard-kick-0').click();
    await page.keyboard.press('KeyF');
    await expect(page.locator('.bind-row[data-bind=kick] .bind-warn')).toHaveText('Also: Punch');
    await expect(page.locator('.bind-row[data-bind=attack] .bind-warn')).toHaveText('Also: Kick');
    // The kick back on K: the clash is gone.
    await page.locator('#settings-bind-keyboard-kick-0').click();
    await page.keyboard.press('KeyK');
    await expect(page.locator('.bind-warn')).toHaveCount(0);

    // A reload keeps it.
    await page.reload();
    await page.locator('#start-screen').click();
    await page.locator('#menu-settings').click();
    await page.locator('#settings-tab-keys').click();
    await expect(page.locator('#settings-bind-keyboard-attack-0')).toHaveText('F');
    await page.locator('#settings-back').click();

    // The race: F punches, J no longer does; the pause legend shows F.
    await page.locator('#menu-race').click();
    await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 30);
    const punched = async (key: string) => {
      const from = await page.evaluate(() => (window as TestWindow).__game?.inputs().length ?? 0);
      await page.keyboard.press(key);
      await page.waitForFunction(
        (f) => ((window as TestWindow).__game?.inputs().length ?? 0) >= f + 10,
        from,
      );
      const got = await page.evaluate((f) => (window as TestWindow).__game?.inputs(f) ?? [], from);
      return got.some((s) => (s.flags & InputFlag.attack) !== 0);
    };
    expect(await punched('KeyF'), 'F punches').toBe(true);
    expect(await punched('KeyJ'), 'J no longer punches').toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-keys')).toContainText('F punch');
    await expect(page.locator('#pause-keys')).toContainText('S / ↓ / Space brake');

    // Reset from the pause menu's settings: J again, in the legend too.
    await page.locator('#pause-controls').click();
    await page.locator('#settings-tab-keys').click();
    await page.locator('#settings-keys-reset').click();
    await expect(page.locator('#settings-bind-keyboard-attack-0')).toHaveText('J');
    await page.locator('#settings-back').click();
    await expect(page.locator('#pause-keys')).toContainText('J punch');
    expect(problems).toEqual([]);
  });

  test('a pad slot learns the next button pressed', async ({ page }) => {
    await page.addInitScript(() => {
      // A stand-in pad: button 4 (L1) goes down once the page asks for it.
      const w = window as unknown as { __padButton: number };
      w.__padButton = -1;
      Object.defineProperty(Navigator.prototype, 'getGamepads', {
        configurable: true,
        value: () => [
          {
            connected: true,
            mapping: 'standard',
            axes: [0, 0, 0, 0],
            buttons: Array.from({ length: 17 }, (_, i) => ({
              pressed: i === w.__padButton,
              value: i === w.__padButton ? 1 : 0,
            })),
          },
        ],
      });
    });
    await page.goto('./');
    await page.locator('#start-screen').click();
    await page.locator('#menu-settings').click();
    await page.locator('#settings-tab-keys').click();
    await page.locator('#settings-keys-gamepad').click();
    await expect(page.locator('#settings-bind-gamepad-uturn-0')).toHaveText('D-pad down');
    await page.locator('#settings-bind-gamepad-uturn-0').click();
    await page.evaluate(() => ((window as unknown as { __padButton: number }).__padButton = 4));
    await expect(page.locator('#settings-bind-gamepad-uturn-0')).toHaveText('L1');
    // L1 is the straight kick's too: flagged.
    await expect(page.locator('.bind-row[data-bind=uturn] .bind-warn')).toHaveText('Also: Straight kick');
  });
});
