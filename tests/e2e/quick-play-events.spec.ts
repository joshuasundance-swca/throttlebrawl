import { expect, test, type Page } from '@playwright/test';
import { openQuickPlay } from './menu-navigation';
import type { TestHandle } from '../../src/dev/handle';
import { readFileSync } from 'node:fs';

const profileFixture: unknown = JSON.parse(
  readFileSync(new URL('../fixtures/save/profile-v1.json', import.meta.url), 'utf8'),
);

type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: TestHandle };
interface Config {
  event: { contentId: string; kind: string; routeId: string; cops?: { mode: string } };
  riders: { role: string; faction: string; contentId: string; bike: { contentId: string } }[];
  difficulty: { copFrequency: number };
}
const profile = (page: Page) => page.evaluate(() => localStorage.getItem('mbrawl:profile'));
// Keep reload failures observable without changing any readiness assertion or timeout.
test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => console.log(`Quick Play page error: ${error.message}`));
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const diagnostic = await page
    .evaluate(() => ({
      state: (window as TestWindow).__game?.state() ?? 'no test handle',
      tick: (window as TestWindow).__game?.snapshot()?.tick ?? null,
      screens: ['start-screen', 'menu', 'race-options', 'hud', 'pause-screen'].map((id) => ({
        id,
        visible: document.getElementById(id)?.checkVisibility() ?? false,
      })),
      text: document.body.innerText.slice(0, 1600),
    }))
    .catch((error: unknown) => ({ unavailable: String(error) }));
  console.log(`Quick Play failure state: ${JSON.stringify(diagnostic)}`);
});
async function config(page: Page): Promise<Config> {
  return page.evaluate(() => {
    const text = (window as TestWindow).__game!.debugFileText();
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const replay = JSON.parse(lines[lines.indexOf('===== replay (one line of JSON) =====') + 1]!) as {
      header: { config: Config };
    };
    return replay.header.config;
  });
}
async function options(page: Page) {
  await page.locator('#start-screen').click();
  await openQuickPlay(page);
  await page.locator('#menu-options').click();
  await expect(page.locator('#race-option-kind')).toBeVisible();
}
async function kind(page: Page, value: string) {
  for (let n = 0; n < 4; n++) {
    if ((await page.locator('#race-option-kind').getAttribute('data-value')) === value) return;
    await page.locator('#race-option-kind-next').click();
  }
  await expect(page.locator('#race-option-kind')).toHaveAttribute('data-value', value);
}

for (const family of ['race', 'hunt', 'escape', 'grudge'])
  test(`${family} reaches the config and HUD, survives reload, and keeps the career untouched`, async ({
    page,
  }) => {
    await page.addInitScript((fixture) => {
      (window as TestWindow).__GAME_TEST__ = true;
      if (!localStorage.getItem('mbrawl:profile'))
        localStorage.setItem('mbrawl:profile', JSON.stringify(fixture));
    }, profileFixture);
    await page.goto('./');
    await options(page);
    const before = await profile(page);
    await kind(page, family);
    await expect(page.locator('#quick-play-objective')).toBeVisible();
    if (family === 'escape') {
      await expect(page.locator('#race-option-cops')).toHaveCount(0);
      await expect(page.locator('#quick-play-objective')).toContainText('Law stays on');
    }
    await page.locator('#race-options-race').click();
    await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
    const c = await config(page);
    const kinds = {
      race: 'classic-race',
      hunt: 'takedown-hunt',
      escape: 'cop-escape',
      grudge: 'grudge-match',
    };
    expect(c.event.kind).toBe(kinds[family as keyof typeof kinds]);
    await expect(page.locator('#hud-objective')).toBeVisible();
    if (family === 'hunt') expect(c.riders.filter((r) => r.role === 'rival').length).toBeGreaterThan(0);
    if (family === 'escape') {
      expect(c.riders.some((r) => r.faction === 'law')).toBe(true);
      expect(c.difficulty.copFrequency).toBeGreaterThan(0);
    }
    expect(await profile(page)).toBe(before);
    console.log(`Quick Play ${family}: launch/config/HUD/profile checked; reloading`);
    await page.reload();
    console.log(`Quick Play ${family}: reload returned; opening options`);
    await options(page);
    await expect(page.locator('#race-option-kind')).toHaveAttribute('data-value', family);
  });

test('a clean Hunt finish misses the objective, and Retry preserves the event, bike, road and competition', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    if (!localStorage.getItem('mbrawl:settings'))
      localStorage.setItem(
        'mbrawl:settings',
        JSON.stringify({
          format: 'settings',
          version: 1,
          build: 'test',
          savedAt: '2026-10-10T00:00:00.000Z',
          data: { throttle: 'auto', assists: { steer: 'strong' }, difficulty: 'easy' },
        }),
      );
  });
  await page.goto('./');
  await options(page);
  await kind(page, 'hunt');
  await page.locator('#race-option-cops-next').click();
  await page.locator('#race-option-bike-next').click();
  await page.locator('#race-option-field-next').click();
  const before = await profile(page);
  await page.locator('#race-options-race').click();
  await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
  const first = await config(page);
  await page.evaluate(() =>
    (window as TestWindow).__game!.fastForward((snap) => snap.race.over, { perFrame: 240, then: 120 }),
  );
  await expect(page.locator('#results')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#results-place')).toHaveText('Objective missed');
  expect(await profile(page)).toBe(before);
  await page.locator('#results-race').click();
  await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
  const again = await config(page);
  expect(again.event).toEqual(first.event);
  expect(again.riders.map((r) => r.bike.contentId)).toEqual(first.riders.map((r) => r.bike.contentId));
  await expect(page.locator('#hud-objective')).toContainText('TAKEDOWNS');
  expect(await profile(page)).toBe(before);
});

for (const textSize of ['normal', 'large', 'largest'])
  test(`event and objective stay reachable with ${textSize} text at short landscape`, async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await page.addInitScript((size) => {
      (window as TestWindow).__GAME_TEST__ = true;
      localStorage.setItem(
        'mbrawl:settings',
        JSON.stringify({
          format: 'settings',
          version: 1,
          build: 'test',
          savedAt: '2026-10-10T00:00:00.000Z',
          data: { textSize: size },
        }),
      );
    }, textSize);
    await page.goto('./');
    await options(page);
    await page.locator('#race-option-kind-value').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#race-option-kind')).toHaveAttribute('data-value', 'hunt');
    await expect(page.locator('#race-option-kind-value')).toBeFocused();
    const measured = await page.evaluate(() => {
      const ids = ['quick-play-objective', 'race-options-back', 'race-options-race'];
      return ids.map((id) => {
        const element = document.getElementById(id)!;
        const box = element.getBoundingClientRect();
        return {
          id,
          visible: element.checkVisibility(),
          onScreen:
            box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
        };
      });
    });
    expect(
      measured.every((m) => m.visible && m.onScreen),
      JSON.stringify(measured),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu-options')).toBeFocused();
  });
