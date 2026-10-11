import { expect, test, type Page } from '@playwright/test';
import { openQuickPlay } from './menu-navigation';
import { fastForwardDone } from './lockstep';
import type { TestHandle } from '../../src/dev/handle';

interface WakeProbe {
  active: number;
  events: string[];
  requests: { type: string; state: string; tick: number }[];
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: TestHandle;
  __wake: WakeProbe;
  __wakeContext?: WEBGL_lose_context;
};
// The required probe exists only after this spec's init script; the global Window does not declare it.
const probe = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__wake);
const active = (page: Page, count: number) => expect.poll(async () => (await probe(page)).active).toBe(count);

async function hidden(page: Page, value: boolean) {
  await page.evaluate((hide) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hide });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hide ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}

test('real race start, pause, holds, restart, quit and results synchronize the screen wake lock', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as TestWindow;
    w.__GAME_TEST__ = true;
    w.__wake = { active: 0, events: [], requests: [] };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: (type: string) => {
          w.__wake.events.push('request');
          w.__wake.requests.push({
            type,
            state: w.__game?.state() ?? '',
            tick: w.__game?.snapshot()?.tick ?? -1,
          });
          w.__wake.active++;
          const sentinel = new EventTarget();
          let released = false;
          return Promise.resolve(
            Object.assign(sentinel, {
              release: () => {
                if (!released) {
                  released = true;
                  w.__wake.active--;
                  w.__wake.events.push('release');
                  sentinel.dispatchEvent(new Event('release'));
                }
                return Promise.resolve();
              },
            }),
          );
        },
      },
    });
  });
  await page.goto('./');
  await expect(page.locator('#start-screen')).toBeVisible();
  expect(
    await page.locator('canvas#game').evaluate((c) => Boolean((c as HTMLCanvasElement).getContext('webgl2'))),
  ).toBe(true);
  expect((await probe(page)).events).toEqual([]);
  // A working mock is a positive control; these calls never exercise the app integration.
  await page.evaluate(async () => {
    const sentinel = await navigator.wakeLock.request('screen');
    await sentinel.release();
  });
  expect((await probe(page)).events).toEqual(['request', 'release']);
  await page.evaluate(() => {
    (window as unknown as TestWindow).__wake.events = [];
    (window as unknown as TestWindow).__wake.requests = [];
  });
  await page.locator('#start-screen').click();
  await openQuickPlay(page);
  expect((await probe(page)).events).toEqual([]);
  await page.locator('#menu-race').click();
  await active(page, 1);
  expect((await probe(page)).requests.map((r) => [r.type, r.state])).toEqual([['screen', 'race']]);
  await page.evaluate(() => {
    const g = (window as unknown as TestWindow).__game!;
    g.setBot(true);
    g.fastForward((snap) => snap.tick > 120, { perFrame: 240 });
  });
  await fastForwardDone(page, 'wake lock remains stable through sim ticks');
  expect((await probe(page)).events).toEqual(['request']);

  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  await active(page, 0);
  await page.locator('#pause-resume').click();
  await active(page, 1);
  expect((await probe(page)).events).toEqual(['request', 'release', 'request']);

  // Real renderer context events, rather than calling the lifecycle helper ourselves.
  await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>('canvas#game')?.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context is unavailable');
    (window as unknown as TestWindow).__wakeContext = ext;
    ext.loseContext();
  });
  await active(page, 0);
  await page.evaluate(() => (window as unknown as TestWindow).__wakeContext!.restoreContext());
  await active(page, 1);
  const afterContext = await probe(page);
  expect(afterContext.events).toEqual(['request', 'release', 'request', 'release', 'request']);

  await hidden(page, true);
  await active(page, 0);
  await expect(page.locator('#pause-screen')).toBeVisible();
  await hidden(page, false);
  await expect(page.locator('#pause-screen')).toBeVisible();
  expect((await probe(page)).events).toEqual([...afterContext.events, 'release']);
  await page.locator('#pause-resume').click();
  await active(page, 1);

  await page.keyboard.press('Escape');
  await active(page, 0);
  const beforeRestart = await probe(page);
  await page.locator('#pause-restart').click();
  await active(page, 1);
  const restarted = await probe(page);
  expect(restarted.events).toEqual([...beforeRestart.events, 'request']);
  // The request belongs to the replacement race's initial snapshot, not the old paused race.
  expect(restarted.requests.at(-1)?.tick).toBe(0);
  await page.keyboard.press('Escape');
  await active(page, 0);
  const beforeQuit = await probe(page);
  await page.locator('#pause-quit').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect((await probe(page)).events).toEqual(beforeQuit.events);

  await openQuickPlay(page);
  await page.locator('#menu-race').click();
  await active(page, 1);
  const beforeFinish = await probe(page);
  await page.evaluate(() => {
    const g = (window as unknown as TestWindow).__game!;
    g.setBot(true);
    g.fastForward(() => false, { perFrame: 1200 });
  });
  await fastForwardDone(page, 'wake lock released at race results');
  await expect(page.locator('#results')).toBeVisible();
  await active(page, 0);
  expect((await probe(page)).events).toEqual([...beforeFinish.events, 'release']);
  await page.locator('#results-menu').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect((await probe(page)).events).toEqual([...beforeFinish.events, 'release']);
  expect(problems).toEqual([]);
});
