import { expect, test, type Page } from '@playwright/test';

// The View and Radio rows follow the keys and the pad (the integration skeptic's mustFix 1,
// 2026-10-01): C, gamepad d-pad up and R change the camera or the radio outside the rows. The row
// must then show the live choice, and picking another choice must take effect. Before the fix the
// row kept showing Chase (or Score) and tapping it did nothing. Each check reads the app's own
// presentation view (window.__app under the test flag) and the rendered row.

interface Presentation {
  camera: { view: string; mode: string };
  radio: { tunedTo: string };
}
interface FakePad {
  connected: boolean;
  mapping: string;
  id: string;
  index: number;
  timestamp: number;
  axes: number[];
  buttons: { pressed: boolean; touched: boolean; value: number }[];
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { setBot(on: boolean): void; state(): string };
  __app?: { presentation(): Presentation };
  __pad?: FakePad;
};

const DPAD_UP = 12;

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

async function boot(page: Page, withPad = false) {
  await page.addInitScript((pad: boolean) => {
    const w = window as TestWindow;
    w.__GAME_TEST__ = true;
    if (!pad) return;
    w.__pad = {
      connected: true,
      mapping: 'standard',
      id: 'test pad (STANDARD GAMEPAD)',
      index: 0,
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => [w.__pad, null, null, null],
      configurable: true,
    });
  }, withPad);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
}

const presentation = (page: Page) => page.evaluate(() => (window as TestWindow).__app!.presentation());

/** Waits until the camera's chosen view and its drawn framing are both `want`. */
async function untilView(page: Page, want: string) {
  await page.waitForFunction(
    (w) => {
      const c = (window as TestWindow).__app?.presentation().camera;
      return c?.view === w && c.mode === w;
    },
    want,
    { timeout: 10_000 },
  );
}

/** Pause, then the settings tab `tab` over the paused race. */
async function openTab(page: Page, tab: string) {
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  await page.locator('#pause-controls').click();
  await page.locator(`#settings-tab-${tab}`).click();
}

/** The row's highlighted choice. */
const rowShows = (page: Page, id: string) =>
  page.locator(`#settings-${id} [aria-pressed="true"]`).getAttribute('data-value');

/** Picks `value` in the row, then back to the race. */
async function pickAndResume(page: Page, id: string, value: string) {
  await page.locator(`#settings-${id} [data-value="${value}"]`).click();
  await page.locator('#settings-back').click();
  await page.locator('#pause-resume').click();
  await expect(page.locator('#pause-screen')).toBeHidden();
}

test('after C, the View row shows Far, and picking Chase brings the chase camera back', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await boot(page);
  expect((await presentation(page)).camera.view).toBe('lowChase');
  await page.keyboard.press('c');
  await untilView(page, 'farChase');
  await openTab(page, 'display');
  const shown = await rowShows(page, 'view');
  console.log(`after C: camera farChase, View row shows ${shown}`);
  expect(shown).toBe('far');
  await pickAndResume(page, 'view', 'chase');
  await untilView(page, 'lowChase');
  console.log(`after picking Chase: camera ${JSON.stringify((await presentation(page)).camera)}`);
  // The pick sticks: a few frames later the camera is still on chase.
  await page.waitForTimeout(500);
  expect((await presentation(page)).camera.view).toBe('lowChase');
  expect(problems).toEqual([]);
});

test('after gamepad d-pad up, the View row shows Far, and picking Chase brings it back', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await boot(page, true);
  const press = (v: number) =>
    page.evaluate(
      ([i, value]) => {
        const pad = (window as TestWindow).__pad!;
        pad.buttons[i] = { pressed: value >= 0.5, touched: value > 0, value };
        pad.timestamp = performance.now();
      },
      [DPAD_UP, v] as const,
    );
  await press(1);
  await untilView(page, 'farChase');
  await press(0);
  await page.waitForTimeout(200);
  await openTab(page, 'display');
  const shown = await rowShows(page, 'view');
  console.log(`after d-pad up: camera farChase, View row shows ${shown}`);
  expect(shown).toBe('far');
  await pickAndResume(page, 'view', 'chase');
  await untilView(page, 'lowChase');
  expect(problems).toEqual([]);
});

test('after R, the Radio row shows Station, and picking Score brings the score back', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await boot(page);
  // Playtest 2 (2026-10-02): a race starts on its region's own station, the Keys' first.
  await page.waitForFunction(
    () => (window as TestWindow).__app?.presentation().radio.tunedTo === 'keys-rockabilly',
    undefined,
    { timeout: 10_000 },
  );
  await page.keyboard.press('r');
  await page.waitForFunction(
    () => (window as TestWindow).__app?.presentation().radio.tunedTo === 'keys-surf',
    undefined,
    { timeout: 10_000 },
  );
  await openTab(page, 'sound');
  const shown = await rowShows(page, 'radio');
  console.log(`after R: radio keys-surf, Radio row shows ${shown}`);
  expect(shown).toBe('station');
  await pickAndResume(page, 'radio', 'score');
  await page.waitForFunction(
    () => (window as TestWindow).__app?.presentation().radio.tunedTo === 'score',
    undefined,
    {
      timeout: 10_000,
    },
  );
  console.log(`after picking Score: radio ${(await presentation(page)).radio.tunedTo}`);
  expect(problems).toEqual([]);
});

test("the style meter's two feel numbers are sliders in the rendered tuning panel", async ({ page }) => {
  // The integration skeptic's mustFix 2: the rendered panel listed 169 sliders without them.
  test.setTimeout(120_000);
  const problems = watch(page);
  await boot(page);
  await openTab(page, 'display');
  await page.locator('#settings-showTuningPanel').check();
  await page.locator('#settings-back').click();
  await page.locator('#pause-tuning').click();
  await expect(page.locator('#tuning-panel')).toBeVisible();
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#tuning-panel [data-param]')].map(
      (e) => e.dataset['param'] ?? '',
    ),
  );
  console.log(`tuning panel: ${ids.length} controls`);
  expect(ids).toContain('hud.meterShowAfterS');
  expect(ids).toContain('hud.meterLandS');
  expect(problems).toEqual([]);
});
