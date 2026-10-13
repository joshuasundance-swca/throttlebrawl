import { expect, test, type Page } from '@playwright/test';
import { rideFirstCareerRace } from './career-start';
import { fastForwardDone } from './lockstep';
import { openQuickPlay } from './menu-navigation';
import type { TestHandle } from '../../src/dev/handle';

type GameWindow = Window & { __GAME_TEST__?: boolean; __game?: TestHandle };

async function ride(page: Page, career: boolean) {
  await page.goto('./');
  if (career) await rideFirstCareerRace(page);
  else {
    await page.locator('#start-screen').click();
    await openQuickPlay(page);
    await page.locator('#menu-race').click();
    await page.waitForFunction(() => (window as GameWindow).__game?.state() === 'race');
  }
  await page.evaluate(() =>
    (window as GameWindow).__game!.fastForward((snap) => snap.tick >= 360, { perFrame: 60, then: 0 }),
  );
  await fastForwardDone(page, 'recovery saved boundary');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as GameWindow).__GAME_TEST__ = true;
  });
});

for (const career of [false, true]) {
  test(`${career ? 'career' : 'Quick Play'} reload offers the original attempt and resumes it paused`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await ride(page, career);
    const before = await page.evaluate(() => ({
      tick: (window as GameWindow).__game!.snapshot()!.tick,
      race: localStorage.getItem('mbrawl:race'),
      profile: localStorage.getItem('mbrawl:profile'),
    }));
    expect(before.race).not.toBeNull();
    const saved = JSON.parse(before.race!) as {
      phase: string;
      recording: { inputs: { ticks: number } };
      context: { kind: string };
    };
    expect(saved.phase).toBe('riding');
    expect(saved.recording.inputs.ticks).toBe(before.tick);
    expect(saved.context.kind).toBe(career ? 'career' : 'quick');
    await page.reload();
    await expect(page.locator('#resume-card')).toBeVisible();
    await expect(page.locator('#resume-race')).toHaveText('Resume race');
    // Ordinary keyboard Start cannot dismiss or bypass the recovery choice.
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as GameWindow).__game!.state())).toBe('tapToStart');
    await expect(page.locator('#resume-card')).toBeVisible();
    await page.locator('#resume-race').click();
    await expect(page.locator('#pause-screen')).toBeVisible();
    expect(await page.evaluate(() => (window as GameWindow).__game!.snapshot()!.tick)).toBe(before.tick);
    expect(await page.evaluate(() => localStorage.getItem('mbrawl:profile'))).toBe(before.profile);
    await expect(page.locator('#hud-objective')).toBeVisible();
  });
}

test('Start over clears the classified attempt and leaves a usable menu', async ({ page }) => {
  test.setTimeout(90_000);
  await ride(page, false);
  await page.reload();
  await expect(page.locator('#resume-card')).toBeVisible();
  await page.locator('#resume-start-over').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBeNull();
  await openQuickPlay(page);
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => (window as GameWindow).__game?.state() === 'race');
});

test('incompatible text is retained with no Resume and can be explicitly discarded', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mbrawl:race', '{broken-attempt');
  });
  await page.goto('./');
  await expect(page.locator('#resume-card')).toBeVisible();
  await expect(page.locator('#resume-race')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBe('{broken-attempt');
  await page.locator('#resume-start-over').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBeNull();
});

test('a failed career award stays frozen, survives reload and pays once when recovered', async ({ page }) => {
  test.setTimeout(180_000);
  await ride(page, true);
  const original = await page.evaluate(() => localStorage.getItem('mbrawl:profile')!);
  await page.evaluate(() => {
    const set = Reflect.get<Storage, 'setItem'>(Storage.prototype, 'setItem');
    Storage.prototype.setItem = function (key, value) {
      if (key === 'mbrawl:profile') throw new DOMException('Quota fixture', 'QuotaExceededError');
      set.call(this, key, value);
    };
    (window as GameWindow).__game!.setBot(true);
  });
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    (window as GameWindow).__game!.fastForward((snap) => snap.race.over, { perFrame: 240, then: 120 }),
  );
  await fastForwardDone(page, 'waiting career award');
  await expect(page.locator('#resume-card')).toBeVisible();
  await expect(page.locator('#resume-race')).toHaveText('Retry saving result');
  const pendingRaw = await page.evaluate(() => localStorage.getItem('mbrawl:race')!);
  const pending = JSON.parse(pendingRaw) as {
    phase: string;
    result: { build: string; at: string };
    recording: { inputs: { ticks: number } };
  };
  expect(pending.phase).toBe('pending-result');
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:profile'))).toBe(original);
  await page.locator('#resume-race').click();
  await expect(page.locator('#resume-race')).toHaveText('Retry saving result');
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:profile'))).toBe(original);
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBe(pendingRaw);
  // Reload restores healthy storage, rather than trusting the poisoned ProfileStore's memory.
  await page.reload();
  await expect(page.locator('#resume-race')).toHaveText('Recover results');
  await page.locator('#resume-race').click();
  await expect(page.locator('#career-results')).toBeVisible();
  const after = await page.evaluate(() => ({
    profile: localStorage.getItem('mbrawl:profile')!,
    race: localStorage.getItem('mbrawl:race'),
    tick: (window as GameWindow).__game!.snapshot()!.tick,
  }));
  expect(after.tick).toBe(pending.recording.inputs.ticks);
  expect(after.race).toBeNull();
  const starting = JSON.parse(original) as { data: { history: unknown[] } };
  const saved = JSON.parse(after.profile) as { data: { history: { build: string; at: string }[] } };
  expect(saved.data.history.length).toBe(starting.data.history.length + 1);
  expect(saved.data.history.at(-1)).toMatchObject(pending.result);
});

test('failed removal keeps a usable discard choice and never silently starts another race', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await ride(page, false);
  const saved = await page.evaluate(() => localStorage.getItem('mbrawl:race'));
  await page.addInitScript(() => {
    const w = window as Window & { __allowRaceRemoval?: boolean };
    const remove = Reflect.get<Storage, 'removeItem'>(Storage.prototype, 'removeItem');
    Storage.prototype.removeItem = function (key) {
      if (key === 'mbrawl:race' && !w.__allowRaceRemoval) return;
      remove.call(this, key);
    };
  });
  await page.reload();
  await expect(page.locator('#resume-card')).toBeVisible();
  await page.locator('#resume-start-over').click();
  await expect(page.locator('#resume-card')).toBeVisible();
  await expect(page.locator('#resume-race')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBe(saved);
  await page.evaluate(() => {
    (window as Window & { __allowRaceRemoval?: boolean }).__allowRaceRemoval = true;
  });
  await page.locator('#resume-start-over').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBeNull();
});

test('blocked race storage still allows playing and quitting without deleting unknown data', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const get = Reflect.get<Storage, 'getItem'>(Storage.prototype, 'getItem');
    localStorage.setItem('mbrawl:race', 'unknown-existing-attempt');
    const w = window as Window & { __allowRaceRead?: boolean };
    Storage.prototype.getItem = function (key) {
      if (key === 'mbrawl:race' && !w.__allowRaceRead) throw new Error('Blocked race storage fixture');
      return get.call(this, key);
    };
  });
  await ride(page, false);
  await page.locator('#pause-quit').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(
    await page.evaluate(() => {
      (window as Window & { __allowRaceRead?: boolean }).__allowRaceRead = true;
      return localStorage.getItem('mbrawl:race');
    }),
  ).toBe('unknown-existing-attempt');
});
