import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tuningPresetSchema } from '../../src/content/schema';

// tuning-1 browser acceptance (docs/milestones/M1.md): the backquote opens the panel; the panel
// has one control per declaration; a mid-race change reaches the seeded race (compared with two
// control runs); changing knockback changes a seeded fight (active once combat-1 declares it and a
// hit lands); "Copy preset" gives JSON that packs:check accepts as a tuning-preset. Every change
// goes through the real panel controls, not a test hook.

interface Snap {
  tick: number;
  entities: { road: { d: number; s: number }; speed: number }[];
}
interface Handle {
  state(): string;
  snapshot(): Snap | null;
  playerId(): number;
  setBot(on: boolean): void;
  setSeed(seed: number): void;
  checks(): { events: Record<string, number> };
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle; __trace?: Record<number, string> };

const SEED = 5;

async function boot(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  return problems;
}

async function paramIds(page: Page): Promise<string[]> {
  return page
    .locator('#tuning-panel [data-param]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['param'] ?? ''));
}

/**
 * Starts a seeded race and records every mover's state at every race tick the page sees (only in
 * the race state: the menu's attract scene is also tick 0, from another seed). With `bot`, the
 * stub bot rides; without it, whatever keys the test holds down ride.
 */
async function startTracedRace(page: Page, bot = true): Promise<void> {
  await page.evaluate(
    ([seed, withBot]) => {
      const w = window as TestWindow;
      w.__game?.setSeed(seed);
      w.__game?.setBot(withBot);
      w.__trace = {};
      const loop = () => {
        const s = w.__game?.state() === 'race' ? w.__game.snapshot() : null;
        if (s && w.__trace)
          w.__trace[s.tick] = s.entities.map((e) => `${e.road.s},${e.road.d},${e.speed}`).join('|');
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    [SEED, bot] as const,
  );
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible();
}

const tickOf = (page: Page) => page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? 0);
const waitTick = (page: Page, tick: number) =>
  page.waitForFunction((t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) >= t, tick, {
    timeout: 120_000,
  });
const traceOf = (page: Page) => page.evaluate(() => (window as TestWindow).__trace ?? {});

/** Ticks both traces saw, and the ones where the states differ. */
function compare(a: Record<number, string>, b: Record<number, string>, from = 0) {
  const common = Object.keys(a)
    .map(Number)
    .filter((t) => t >= from && t in b);
  return { common: common.length, differ: common.filter((t) => a[t] !== b[t]) };
}

test('backquote opens the see-through panel with one control per declaration; the marked long-press and three-finger tap open it too', async ({
  page,
}) => {
  const problems = await boot(page);
  const panel = page.locator('#tuning-panel');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(panel).toBeVisible();

  const ids = await paramIds(page);
  console.log(`tuning panel controls: ${ids.length} (${ids.join(', ')})`);
  expect(new Set(ids).size, 'one control per declaration').toBe(ids.length);
  for (const id of ['riders.steerScale', 'camera.chaseDistanceM', 'display.frameDivisor'])
    expect(ids).toContain(id);
  const groups = await page
    .locator('#tuning-panel [data-group]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['group']));
  expect(groups.slice(0, 4)).toEqual(['hit-stop', 'knockback', 'steering', 'shake']);
  // Each declared decided slider sits under its decided heading, whatever group its module used.
  for (const [group, id] of [
    ['hit-stop', 'combat.hitStopScale'],
    ['knockback', 'combat.knockbackScale'],
    ['steering', 'riders.steerScale'],
  ] as const) {
    if (!ids.includes(id)) continue;
    await expect(page.locator(`#tuning-panel [data-group="${group}"] [data-param="${id}"]`)).toHaveCount(1);
  }

  // It fits the phone-landscape viewport, scrolls rather than overflowing, and is see-through.
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(915);
    expect(box.y + box.height).toBeLessThanOrEqual(412);
  }
  const overflowX = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflowX, 'no sideways overflow').toBeLessThanOrEqual(0);
  const alpha = await panel.evaluate((el) => {
    const m = /rgba?\([^)]*?([\d.]+)\)$/.exec(getComputedStyle(el).backgroundColor.replace(/ \/ /, ', '));
    return m ? Number(m[1]) : 1;
  });
  expect(alpha, 'see-through background').toBeLessThan(0.6);

  // The frame-rate cap is labelled with the measured refresh rate once the panel has opened.
  await expect(panel).toHaveAttribute('data-refresh-hz', /^\d+$/, { timeout: 10_000 });
  const hz = Number(await panel.getAttribute('data-refresh-hz'));
  const caps = await page.locator('[data-divisor]').allTextContents();
  console.log(`measured refresh ${hz} Hz; caps: ${caps.join(' / ')}`);
  expect(caps).toEqual(
    [1, 2, 3].map(
      (d, i) => `${['every frame', 'every 2nd frame', 'every 3rd frame'][i]} · ${Math.round(hz / d)} fps`,
    ),
  );

  await page.keyboard.press('Backquote');
  await expect(panel).toBeHidden();

  // A long-press on an element marked data-tuning-long-press (ui-1 marks the build id).
  await page.evaluate(() => {
    const zone = (id: string, attr: string, left: number) => {
      const el = document.createElement('div');
      el.id = id;
      el.setAttribute(attr, '');
      el.style.cssText = `position:fixed;left:${left}px;top:120px;width:160px;height:120px;z-index:50;pointer-events:auto;background:#0000`;
      document.body.append(el);
    };
    zone('probe-long-press', 'data-tuning-long-press', 20);
    zone('probe-three-finger', 'data-tuning-three-finger', 300);
  });
  await page.mouse.move(60, 160);
  // A short press, with real mouse input. The page stamps when it handled the down and the up:
  // on a loaded machine the up can be handled long after it was sent, and then the press was not
  // short as far as the page is concerned. So the check counts only presses the page saw as short
  // (under the panel's 600 ms LONG_PRESS_MS), and tries up to three times to get one.
  await page.evaluate(() => {
    const w = window as unknown as { __press: number[] };
    w.__press = [];
    for (const type of ['pointerdown', 'pointerup'])
      document.addEventListener(type, () => w.__press.push(performance.now()), { capture: true });
  });
  const shortGaps: number[] = [];
  for (let attempt = 0; attempt < 3 && shortGaps.length === 0; attempt++) {
    await page.evaluate(() => ((window as unknown as { __press: number[] }).__press = []));
    await page.mouse.down();
    // eslint-disable-next-line no-restricted-syntax -- a short mouse press, under the long-press threshold: wall time by design
    await page.waitForTimeout(200);
    await page.mouse.up();
    const [down = 0, up = 0] = await page.evaluate(
      () => (window as unknown as { __press: number[] }).__press,
    );
    const gap = up - down;
    console.log(`short press ${attempt + 1}: the page saw ${gap.toFixed(0)} ms between down and up`);
    if (gap < 600 - 50) {
      shortGaps.push(gap);
      await expect(panel, 'a short press does not open it').toBeHidden();
    } else if (await panel.isVisible()) {
      await page.locator('#tuning-close').click(); // a long press after all: close and retry
    }
  }
  expect(shortGaps.length, 'the page saw at least one short press').toBe(1);
  // A long-press: hold until the panel opens (the hold is the page's own 600 ms timer), then let go.
  await page.mouse.down();
  await expect(panel, 'a long-press opens it').toBeVisible({ timeout: 10_000 });
  await page.mouse.up();
  await page.locator('#tuning-close').click();
  await expect(panel).toBeHidden();

  // A real three-finger touch (CDP touch points) inside an element marked data-tuning-three-finger.
  const cdp = await page.context().newCDPSession(page);
  const two = [
    { x: 320, y: 150, id: 1 },
    { x: 360, y: 160, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: two });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(panel, 'two fingers do not open it').toBeHidden();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [...two, { x: 400, y: 170, id: 3 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(panel, 'three fingers open it').toBeVisible();

  expect(problems).toEqual([]);
});

test('a mid-race steering change through the panel reaches the seeded race, compared with two control runs', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  // Long enough that a slow runner still shares enough sampled ticks between runs: at 420 ticks,
  // CI runs at peak load shared as few as 18 ticks between the controls and 6 after the change
  // (PR runs on 2026-10-02 failed "ticks sampled after the change", 6 < 10).
  const END = 1200;
  const run = async (change: boolean) => {
    const page = await browser.newPage();
    const problems = await boot(page);
    await startTracedRace(page);
    let changedAt = -1;
    let before = -1;
    if (change) {
      await waitTick(page, 90);
      await page.keyboard.press('Backquote');
      before = await tickOf(page);
      await page.locator('#tuning-panel input[data-param="riders.steerScale"]').fill('2');
      changedAt = await tickOf(page);
      await expect(page.locator('#tuning-panel output[data-param-value="riders.steerScale"]')).toHaveText(
        '2.00×',
      );
      // The panel stays open over the running race.
      await waitTick(page, changedAt + 60);
      await expect(page.locator('#tuning-panel')).toBeVisible();
    }
    await waitTick(page, END);
    const trace = await traceOf(page);
    await page.close();
    expect(problems).toEqual([]);
    return { trace, changedAt, before };
  };
  const a = await run(false);
  const b = await run(false);
  const c = await run(true);
  const controls = compare(a.trace, b.trace);
  const before = compare(a.trace, c.trace);
  const after = compare(a.trace, c.trace, c.changedAt + 2);
  console.log(
    `steering change at tick ${c.changedAt}: control vs control ${controls.common} ticks compared, ${controls.differ.length} differ; ` +
      `control vs changed after the change ${after.common} ticks compared, ${after.differ.length} differ`,
  );
  // The trace samples one tick per animation frame; a slow software renderer runs several sim
  // steps per frame, so only a fraction of ticks is sampled. The floors are what the proof needs.
  expect(controls.common, 'the controls share ticks').toBeGreaterThanOrEqual(30);
  expect(controls.differ, 'two control runs are identical').toEqual([]);
  const earlyDiffer = before.differ.filter((t) => t <= c.before);
  expect(earlyDiffer, 'identical before the change').toEqual([]);
  expect(after.common, 'ticks sampled after the change').toBeGreaterThanOrEqual(10);
  expect(after.differ.length, 'the change reached the sim').toBeGreaterThan(0);
});

test('changing knockback changes the outcome of a seeded fight, compared with a control run', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const END = 900;
  // A seeded fight ridden by the bot (one driver call per tick, so a run repeats exactly).
  // Knockback is set on the panel before the race; the mid-race path is the steering test's. Two
  // control runs prove the fight itself repeats. The hits come from the rivals (ai-1) or an
  // attacking bot; with none, it skips, and tests/sim/tuning-knockback.test.ts still covers it.
  const run = async (knockbackMax: boolean) => {
    const page = await browser.newPage();
    const problems = await boot(page);
    await page.keyboard.press('Backquote');
    const slider = page.locator('#tuning-panel input[data-param="combat.knockbackScale"]');
    if ((await slider.count()) === 0) {
      await page.close();
      return null;
    }
    if (knockbackMax) {
      await slider.fill(await slider.evaluate((el) => (el as HTMLInputElement).max));
    }
    const value = await page
      .locator('#tuning-panel output[data-param-value="combat.knockbackScale"]')
      .textContent();
    await page.keyboard.press('Backquote');
    await expect(page.locator('#tuning-panel')).toBeHidden();
    await startTracedRace(page, true);
    await waitTick(page, END);
    const trace = await traceOf(page);
    const events = await page.evaluate(() => (window as TestWindow).__game?.checks().events ?? {});
    await page.close();
    expect(problems).toEqual([]);
    return { trace, events, value };
  };
  const control = await run(false);
  test.skip(control === null, 'NOT ACTIVE: no module declares combat.knockbackScale');
  if (!control) return;
  const hits = control.events['hit'] ?? 0;
  console.log(`knockback fight: control events ${JSON.stringify(control.events)}`);
  test.skip(hits === 0, 'NOT ACTIVE: no hit landed in the seeded control fight');
  const again = await run(false);
  const strong = await run(true);
  if (!again || !strong) throw new Error('the knockback slider vanished between runs');
  const repeat = compare(control.trace, again.trace);
  const diff = compare(control.trace, strong.trace);
  console.log(
    `knockback ${control.value} vs ${strong.value}: ${hits} hits in the control fight; ` +
      `control vs control ${repeat.common} ticks compared, ${repeat.differ.length} differ; ` +
      `control vs strong ${diff.common} ticks compared, ${diff.differ.length} differ`,
  );
  expect(repeat.common, 'the controls share ticks').toBeGreaterThanOrEqual(30);
  expect(repeat.differ, 'the seeded fight repeats').toEqual([]);
  expect(diff.differ.length, 'knockback changed the fight').toBeGreaterThan(0);
});

test('"Copy preset as JSON" gives a tuning-preset that packs:check accepts', async ({ page, context }) => {
  // packs:check runs twice (it becomes the full validator when content-1 lands): room for both.
  test.setTimeout(120_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const problems = await boot(page);
  await page.keyboard.press('Backquote');
  await page.locator('input[data-param="riders.steerScale"]').fill('1.5');
  await page.locator('input[data-param="camera.chaseDistanceM"]').fill('8');
  await page.locator('[data-divisor="2"]').click();
  await expect(page.locator('[data-divisor="2"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#tuning-copy').click();
  await expect(page.locator('#tuning-json')).toBeVisible();
  await expect(page.locator('#tuning-status')).toHaveText('Copied. Paste it in chat.');
  const text = await page.locator('#tuning-json').inputValue();
  // The system clipboard may turn LF into CRLF (Windows); the text is otherwise the same.
  const clipped = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipped.split('\r\n').join('\n')).toBe(text);

  const preset = JSON.parse(text) as { id: string; values: Record<string, number> };
  expect(preset.values).toEqual({
    'camera.chaseDistanceM': 8,
    'display.frameDivisor': 2,
    'riders.steerScale': 1.5,
  });
  const parsed = tuningPresetSchema.safeParse(preset);
  expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true);

  // The real consumer: packs:check over the tree with the copied preset committed where an agent
  // would put it. The examined count must go up by one, so the file was really checked.
  const packsCheck = () => {
    const res = spawnSync(process.execPath, ['scripts/packs-check.mjs'], { encoding: 'utf8' });
    const out = `${res.stdout}${res.stderr}`;
    const examined = /\[examined\] (\d+)/.exec(out);
    return { status: res.status, out, examined: examined ? Number(examined[1]) : -1 };
  };
  const baseline = packsCheck();
  expect(baseline.status, baseline.out).toBe(0);
  const dir = 'packs/base/tuning';
  const madeDir = !existsSync(dir);
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${preset.id}.json`;
  writeFileSync(file, text);
  try {
    const withPreset = packsCheck();
    const summary = /\[examined\].*/.exec(withPreset.out)?.[0] ?? '';
    console.log(`packs:check with ${file}: exit ${withPreset.status}; ${summary}`);
    expect(withPreset.status, withPreset.out).toBe(0);
    expect(withPreset.examined).toBe(baseline.examined + 1);
    // content-1's validator: the schema, public-safety and tuning-key rules ran over the preset.
    for (const rule of ['schema', 'public-safety', 'tuning-keys']) expect(summary).toContain(rule);
  } finally {
    unlinkSync(file);
    if (madeDir && readdirSync(dir).length === 0) rmdirSync(dir);
  }

  // Save preset: on the device when app/ hands the registry a store, otherwise it says so plainly.
  await page.locator('#tuning-save').click();
  await expect(page.locator('#tuning-status')).toHaveText(
    /^(Saved on this device\. It loads next time\.|This build cannot save presets on the device yet\. Copy it instead\.)$/,
  );
  console.log(`save preset: ${await page.locator('#tuning-status').textContent()}`);
  await page.locator('#tuning-reset').click();
  await expect(page.locator('output[data-param-value="riders.steerScale"]')).toHaveText('1.00×');
  await expect(page.locator('[data-divisor="1"]')).toHaveAttribute('aria-pressed', 'true');
  expect(problems).toEqual([]);
});
