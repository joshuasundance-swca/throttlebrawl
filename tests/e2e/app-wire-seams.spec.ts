import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { pixelStats } from './pixels';

// The integration round (2026-10-01): seams built last run, now reachable in the real game.
// - The camera views (camera-3): C and gamepad d-pad up step low chase, far chase, helmet, and the
//   rendered frame changes with them.
// - The radio per region (radio-1 head start): the Keys offer their own stations; a region with
//   none of its own yet offers the base pack's rather than silence, and R tunes one.
// - Region barks: a Pacific Northwest race's locals talk, with lines from the region pack.
// Each check reads the app's own presentation view (window.__app under the test flag) and the
// rendered page, never a hand-built context.

interface Presentation {
  camera: { view: string; mode: string };
  radio: { region: string | null; stations: string[]; tunedTo: string };
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
  __game?: { setBot(on: boolean): void; state(): string; snapshot(): { tick: number } | null };
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
    // The Classic look, through the saved record: these tests time key and pad presses against
    // frames, and the default Ink + 60s film look (run W-O) slowed a software-rendered CI runner
    // past the d-pad test's 10 s wait (PR #232's third CI run).
    localStorage.setItem(
      'mbrawl:settings',
      JSON.stringify({
        format: 'settings',
        version: 1,
        build: 'e2e',
        savedAt: '2026-10-01T00:00:00.000Z',
        data: { look: 'classic' },
      }),
    );
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
}

async function race(page: Page, chip?: string, bot = true) {
  if (chip) await page.locator(chip).click();
  await page.evaluate((on) => (window as TestWindow).__game?.setBot(on), bot);
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
}

const view = (page: Page) => page.evaluate(() => (window as TestWindow).__app!.presentation());

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

/** Mean absolute luminance difference between two screenshots, per pixel (0..255). */
async function frameDiff(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const load = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const [p, q] = [await load(x), await load(y)];
      let sum = 0;
      for (let i = 0; i < p.length; i += 4) {
        const l = (d: Uint8ClampedArray) =>
          0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0);
        sum += Math.abs(l(p) - l(q));
      }
      return sum / (p.length / 4);
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

test('C steps the camera through low chase, far chase and helmet, and the frame changes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await boot(page);
  // Nobody rides the player's bike: it waits on the grid, so the frame holds still between shots
  // once the field has left (the control below measures what still moves).
  await race(page, undefined, false);
  expect((await view(page)).camera.view).toBe('lowChase');
  // 4 s of race (it was 4 s of wall time: about 100 to 160 ticks on a software-rendered runner).
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) >= 240);
  const canvas = page.locator('canvas#game');
  const GAP_MS = 800;
  // The control: traffic and the field still move, so two frames GAP_MS apart in one view differ a little.
  const before = await canvas.screenshot();
  // eslint-disable-next-line no-restricted-syntax -- the camera's springs settle in drawn-frame time (the render's dt is wall time); the same-view control takes the same gap
  await page.waitForTimeout(GAP_MS);
  let last = await canvas.screenshot();
  const baseline = await frameDiff(page, before, last);
  const steps: { view: string; diff: number }[] = [];
  let helmetShot: Buffer | null = null;
  for (const want of ['farChase', 'helmet', 'lowChase']) {
    await page.keyboard.press('c');
    await untilView(page, want);
    // eslint-disable-next-line no-restricted-syntax -- the camera's springs settle in drawn-frame time (the render's dt is wall time); the same-view control takes the same gap
    await page.waitForTimeout(GAP_MS);
    const shot = await canvas.screenshot();
    steps.push({ view: want, diff: await frameDiff(page, last, shot) });
    if (want === 'helmet') helmetShot = shot;
    last = shot;
  }
  const stats = await pixelStats(page, helmetShot!);
  console.log(
    `views: same-view control ${baseline.toFixed(1)} luminance levels per pixel; ` +
      steps.map((s) => `to ${s.view} ${s.diff.toFixed(1)}`).join(', ') +
      `; helmet frame variance ${stats.variance.toFixed(0)}`,
  );
  // Each view change moves the frame clearly more than waiting on in one view does.
  for (const s of steps) expect(s.diff, s.view).toBeGreaterThan(Math.max(4, baseline * 3));
  expect(stats.variance).toBeGreaterThan(100);
  expect(problems).toEqual([]);
});

/** Waits until the sim's own tick reaches `tick`. */
async function untilTick(page: Page, tick: number) {
  await page.waitForFunction((t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) >= t, tick, {
    timeout: 10_000,
  });
}

test('gamepad d-pad up steps the camera view too', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await boot(page, true);
  await race(page);
  // Sets the d-pad and returns the sim's tick at that moment. The pad is polled at the start of
  // each sim step, so every tick after this one has seen the new state. The hold and the release
  // are counted in ticks, not wall-clock time: CI draws about 10 frames a second, with longer
  // stalls, and a 200 ms release once fell between two polls, so the re-press was no new edge
  // (the first attempts of #335's and #303's CI runs).
  const press = (v: number) =>
    page.evaluate(
      ([i, value]) => {
        const w = window as TestWindow;
        w.__pad!.buttons[i] = { pressed: value >= 0.5, touched: value > 0, value };
        w.__pad!.timestamp = performance.now();
        return w.__game!.snapshot()!.tick;
      },
      [DPAD_UP, v] as const,
    );
  const down = await press(1);
  await untilView(page, 'farChase');
  // Held for 18 more polls (300 ms at 60 Hz): one press, one step.
  await untilTick(page, down + 1 + 18);
  expect((await view(page)).camera.view).toBe('farChase');
  const up = await press(0);
  await untilTick(page, up + 1); // a poll has seen the release
  await press(1);
  await untilView(page, 'helmet');
  expect(problems).toEqual([]);
});

test("the radio follows the region: the Keys stations, then the Pacific Northwest's own station first", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = watch(page);
  await boot(page);
  await race(page);
  const keys = (await view(page)).radio;
  console.log(`Keys radio: ${JSON.stringify(keys)}`);
  expect(keys.region).toBe('base:florida-keys');
  expect(keys.stations).toEqual(['keys-rockabilly', 'keys-surf', 'keys-tradewinds']);
  // Back to the menu, pick the Pacific Northwest, race there.
  await page.keyboard.press('Escape');
  await page.locator('#pause-quit').click();
  await race(page, '#region-region-pnw-pacific-northwest');
  const pnw = (await view(page)).radio;
  // Playtest 2 (2026-10-02, "different stations and music in different regions"): the region's
  // own stations (three since run W-Q), and the race starts on the first of them.
  expect(pnw.region).toBe('region-pnw:pacific-northwest');
  expect(pnw.stations).toEqual(['pnw-drizzle', 'pnw-salal', 'pnw-stump']);
  await page.waitForFunction(
    () => (window as TestWindow).__app?.presentation().radio.tunedTo === 'pnw-drizzle',
  );
  // R tunes the region's second station.
  await page.keyboard.press('r');
  await page.waitForFunction(
    () => (window as TestWindow).__app?.presentation().radio.tunedTo === 'pnw-salal',
  );
  console.log(`Pacific Northwest radio after R: ${JSON.stringify((await view(page)).radio)}`);
  expect(problems).toEqual([]);
});

/** Every line text in a pack's bark files. */
function barkLines(pack: string): Set<string> {
  const dir = `packs/${pack}/barks`;
  const out = new Set<string>();
  for (const f of readdirSync(dir)) {
    const json = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { lines: { text: string }[] };
    for (const l of json.lines) out.add(l.text);
  }
  return out;
}

test("a Pacific Northwest race's locals talk, with the region pack's lines", async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  const pnwLines = barkLines('region-pnw');
  await boot(page);
  await race(page, '#region-region-pnw-pacific-northwest');
  const heard: { speaker: string; text: string }[] = [];
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline && !heard.some((h) => pnwLines.has(h.text))) {
    const bark = await page.evaluate(() => {
      const b = document.querySelector<HTMLElement>('#bark-bubble');
      if (!b || b.hidden) return null;
      return {
        speaker: b.querySelector('.bark-speaker')?.textContent ?? '',
        text: b.querySelector('.bark-text')?.textContent ?? '',
      };
    });
    if (bark && !heard.some((h) => h.text === bark.text)) heard.push(bark);
    // eslint-disable-next-line no-restricted-syntax -- the poll interval of a bark listener, bounded by its own deadline
    await page.waitForTimeout(250);
  }
  console.log(`barks heard: ${heard.map((h) => `${h.speaker}: "${h.text}"`).join(' | ')}`);
  const local = heard.filter((h) => pnwLines.has(h.text));
  expect(local.length, 'a Pacific Northwest local spoke a region-pack line').toBeGreaterThan(0);
  expect(problems).toEqual([]);
});
