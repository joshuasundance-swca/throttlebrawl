import { expect, test, type Page } from '@playwright/test';
import { frames } from './lockstep';

// ui-1's browser tests that need app/'s wiring (docs/milestones/M1.md, ui-1): pause really stops
// the race and resume starts it again; restart and quit work from the pause screen; a volume
// slider changes the master gain (and mute silences it); and the settings survive a reload.

interface Handle {
  state(): string;
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
}
interface GainLog {
  entries: { id: number; v: number }[];
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle; __gainLog?: GainLog };

const tick = (page: Page) => page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? -1);
const state = (page: Page) => page.evaluate(() => (window as TestWindow).__game?.state() ?? '');

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

test('pause stops the race, resume restarts it, and restart and quit work', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 60);

  // Esc pauses: no sim ticks while the pause screen is up.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  const pausedAt = await tick(page);
  await frames(page, 30); // drawn frames, the loop's unit (it was 750 ms of wall time)
  const later = await tick(page);
  console.log(`paused: tick ${pausedAt} -> ${later} after 30 drawn frames`);
  expect(later, 'no sim ticks while paused').toBe(pausedAt);
  expect(await state(page)).toBe('race');

  // Resume: the race carries on from where it stopped.
  await page.locator('#pause-resume').click();
  await page.waitForFunction(
    (t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > t + 30,
    pausedAt,
  );
  console.log(`resumed: tick ${await tick(page)}`);

  // Restart: a fresh race from the grid, running.
  await page.locator('#hud-pause').click();
  await expect(page.locator('#pause-restart')).toBeVisible();
  const beforeRestart = await tick(page);
  await page.locator('#pause-restart').click();
  await expect(page.locator('#pause-screen')).toBeHidden();
  const afterRestart = await tick(page);
  console.log(`restart: tick ${beforeRestart} -> ${afterRestart}`);
  expect(afterRestart).toBeLessThan(beforeRestart);
  await page.waitForFunction(
    (t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > t + 30,
    afterRestart,
  );
  expect(await state(page)).toBe('race');

  // Quit: back to the menu, and the next race runs.
  await page.keyboard.press('Escape');
  await page.locator('#pause-quit').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await state(page)).toBe('menu');
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 30);
  expect(await state(page)).toBe('race');

  expect(problems).toEqual([]);
});

test('the master slider changes the master gain, mute silences it, and settings survive a reload', async ({
  page,
}) => {
  const problems = watchErrors(page);
  // Record every value any GainNode's gain is set to, by param identity.
  await page.addInitScript(() => {
    const log: GainLog = { entries: [] };
    (window as TestWindow).__gainLog = log;
    const gains = new WeakMap<AudioParam, number>();
    let next = 0;
    // Function-typed properties (not method signatures), so re-binding `this` below is explicit.
    type Fn<T> = (this: T, ...args: number[]) => unknown;
    const ctxProto = BaseAudioContext.prototype as unknown as Record<string, Fn<BaseAudioContext>>;
    const createGain = ctxProto['createGain'];
    if (createGain) {
      ctxProto['createGain'] = function (this: BaseAudioContext) {
        const node = createGain.call(this) as GainNode;
        gains.set(node.gain, next++);
        return node;
      };
    }
    const note = (p: AudioParam, v: number) => {
      const id = gains.get(p);
      if (id !== undefined) log.entries.push({ id, v });
    };
    const paramProto = AudioParam.prototype as unknown as Record<string, Fn<AudioParam>>;
    for (const name of ['setTargetAtTime', 'setValueAtTime', 'linearRampToValueAtTime']) {
      const orig = paramProto[name];
      if (!orig) continue;
      paramProto[name] = function (this: AudioParam, v: number, ...rest: number[]) {
        note(this, v);
        return orig.call(this, v, ...rest);
      };
    }
    const desc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value') as
      | { get?: Fn<AudioParam>; set?: Fn<AudioParam>; configurable?: boolean; enumerable?: boolean }
      | undefined;
    const set = desc?.set;
    if (desc && set) {
      Object.defineProperty(AudioParam.prototype, 'value', {
        ...desc,
        set(this: AudioParam, v: number) {
          note(this, v);
          set.call(this, v);
        },
      });
    }
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-settings').click();
  await page.waitForFunction(() => ((window as TestWindow).__gainLog?.entries.length ?? 0) > 0);

  /** Does one action, waits a moment, and returns the last value each gain param got meanwhile. */
  const during = async (act: () => Promise<void>) => {
    const from = await page.evaluate(() => (window as TestWindow).__gainLog?.entries.length ?? 0);
    await act();
    // eslint-disable-next-line no-restricted-syntax -- the mix's gain ramps run on the audio clock, which is wall time
    await page.waitForTimeout(150);
    return page.evaluate((f) => {
      const last: Record<number, number> = {};
      for (const e of (window as TestWindow).__gainLog?.entries.slice(f) ?? []) last[e.id] = e.v;
      return last;
    }, from);
  };
  const master = page.locator('#settings-volume-master');
  const full = await during(() => master.fill('100'));
  const half = await during(() => master.fill('50'));
  const muted = await during(() => page.locator('#settings-mute').check());
  const unmuted = await during(() => page.locator('#settings-mute').uncheck());
  // The master gain is the param that follows the master slider down and goes to 0 on mute.
  const candidates = Object.keys(half)
    .map(Number)
    .filter((id) => {
      const [a, b, c, d] = [full[id], half[id], muted[id], unmuted[id]];
      return a !== undefined && b !== undefined && b < a && b > 0 && c === 0 && d === b;
    });
  console.log(
    `gain params set: full ${JSON.stringify(full)}, half ${JSON.stringify(half)}, muted ${JSON.stringify(
      muted,
    )}; master candidates ${JSON.stringify(candidates)}`,
  );
  expect(candidates.length, 'one gain follows the master slider and mute').toBeGreaterThanOrEqual(1);

  // The settings are saved: after a reload the slider still says 50%.
  await page.reload();
  await page.locator('#start-screen').click();
  await page.locator('#menu-settings').click();
  await expect(page.locator('#settings-volume-master-value')).toHaveText('50%');
  await expect(page.locator('#settings-mute')).not.toBeChecked();
  expect(problems).toEqual([]);
});
