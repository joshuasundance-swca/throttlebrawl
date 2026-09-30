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

/** Starts a seeded bot race and records every rider's state at every tick the page sees. */
async function startTracedRace(page: Page): Promise<void> {
  await page.evaluate((seed) => {
    const w = window as TestWindow;
    w.__game?.setSeed(seed);
    w.__game?.setBot(true);
    w.__trace = {};
    const loop = () => {
      const s = w.__game?.snapshot();
      if (s && w.__trace)
        w.__trace[s.tick] = s.entities.map((e) => `${e.road.s},${e.road.d},${e.speed}`).join('|');
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, SEED);
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
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(panel, 'a short press does not open it').toBeHidden();
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(panel, 'a long-press opens it').toBeVisible();
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
  test.setTimeout(180_000);
  const END = 420;
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
  expect(controls.common, 'the controls share ticks').toBeGreaterThan(100);
  expect(controls.differ, 'two control runs are identical').toEqual([]);
  const earlyDiffer = before.differ.filter((t) => t <= c.before);
  expect(earlyDiffer, 'identical before the change').toEqual([]);
  expect(after.differ.length, 'the change reached the sim').toBeGreaterThan(0);
});

test('changing knockback changes the outcome of a seeded fight, compared with a control run', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const END = 1500;
  const run = async (knockbackMax: boolean) => {
    const page = await browser.newPage();
    await boot(page);
    await page.keyboard.press('Backquote');
    const slider = page.locator('#tuning-panel input[data-param="combat.knockbackScale"]');
    if ((await slider.count()) === 0) {
      await page.close();
      return null;
    }
    await page.keyboard.press('Backquote');
    await startTracedRace(page);
    if (knockbackMax) {
      await waitTick(page, 30);
      await page.keyboard.press('Backquote');
      await slider.fill(await slider.evaluate((el) => (el as HTMLInputElement).max));
    }
    await waitTick(page, END);
    const trace = await traceOf(page);
    const events = await page.evaluate(() => (window as TestWindow).__game?.checks().events ?? {});
    await page.close();
    return { trace, events };
  };
  const control = await run(false);
  test.skip(control === null, 'NOT ACTIVE: no module declares combat.knockbackScale yet (combat-1)');
  const hits = control?.events['hit'] ?? 0;
  test.skip(
    hits === 0,
    'NOT ACTIVE: no hit landed in the seeded control run (needs an attacking bot, dev-1)',
  );
  const strong = await run(true);
  if (!control || !strong) throw new Error('unreachable');
  const diff = compare(control.trace, strong.trace);
  console.log(
    `knockback: ${hits} hits in the control run; ${diff.common} ticks compared, ${diff.differ.length} differ`,
  );
  expect(diff.differ.length).toBeGreaterThan(0);
});

test('"Copy preset as JSON" gives a tuning-preset that packs:check accepts', async ({ page, context }) => {
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
    console.log(
      `packs:check with ${file}: exit ${withPreset.status}; ${withPreset.out.trim().split('\n').pop()}`,
    );
    expect(withPreset.status, withPreset.out).toBe(0);
    expect(withPreset.examined).toBe(baseline.examined + 1);
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
