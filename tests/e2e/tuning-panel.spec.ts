import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tuningPresetSchema } from '../../src/content/schema';
import { parseDebugFile } from '../../src/dev/report/summary';
import { decodeReplay, HASH_EVERY_TICKS } from '../../src/replay';
import type { SimEvent } from '../../src/sim/api';

// tuning-1 browser acceptance (docs/milestones/M1.md): the backquote opens the panel; the panel
// has one control per declaration; a mid-race change reaches the seeded race (compared with two
// control runs); changing knockback changes a seeded fight (active once combat-1 declares it and a
// hit lands); "Copy preset" gives JSON that packs:check accepts as a tuning-preset. Every change
// goes through the real panel controls, not a test hook.

interface Handle {
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
  setSeed(seed: number): void;
  debugFileText(): string;
  events(): readonly SimEvent[];
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

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

/** Starts a seeded race ridden by the stub bot (one driver call per tick, so a run repeats exactly). */
async function startSeededRace(page: Page): Promise<void> {
  await page.evaluate((seed) => {
    const w = window as TestWindow;
    w.__game?.setSeed(seed);
    w.__game?.setBot(true);
  }, SEED);
  await page.locator('#menu-race').click();
  await expect(page.locator('#hud-position')).toBeVisible();
}

const tickOf = (page: Page) => page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? 0);
/** Waits for a race tick. The race runs at the renderer's speed; the timeout is a hang guard. */
const waitTick = (page: Page, tick: number) =>
  page.waitForFunction((t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) >= t, tick, {
    timeout: 120_000,
  });

/**
 * The race as the sim stepped it, read after the run: the recording from the debug file that "save
 * debug file" writes (src/replay: the seed, the tuning at race start, the panel's mid-race changes
 * {tick, id, value}, the player slot's input on every tick, here the bot's, and the state hash after
 * every 60th tick), plus the race's events (the page keeps its latest 300). The sim steps the same
 * ticks whatever the renderer's speed, so all of it is the same on any runner: no sampling, no
 * count left to luck. The state hash covers the tuning values too (src/sim/world/hash.ts), so a
 * changed value alone makes later hashes differ; the bot's inputs and the events are the race
 * itself (the bot drives each tick from what it sees).
 */
interface RaceRun {
  seed: number;
  tuning: Readonly<Record<string, number>>;
  params: { tick: number; id: string; value: number }[];
  hashes: Map<number, number>;
  /** The player slot's input per tick, as `steer,throttle,brake,flags`. */
  inputs: string[];
  /** The page's latest events, each also as `tick type actor>target data`. */
  events: { tick: number; type: string; text: string }[];
}
async function raceRun(page: Page): Promise<RaceRun> {
  const text = await page.evaluate(() => (window as TestWindow).__game?.debugFileText() ?? '');
  const rec = decodeReplay(parseDebugFile(text).replay);
  const events = await page.evaluate(() =>
    ((window as TestWindow).__game?.events() ?? []).map((e) => ({
      tick: e.tick,
      type: e.type,
      text: `${e.tick} ${e.type} ${e.actor}>${e.target ?? ''} ${JSON.stringify(e.data)}`,
    })),
  );
  return {
    seed: rec.header.seed,
    tuning: rec.header.tuning,
    params: rec.params,
    hashes: new Map(rec.hashes.map((h) => [h.tick, h.hash])),
    inputs: rec.inputs.map((slots) => {
      const i = slots[0];
      return i ? `${i.steer},${i.throttle},${i.brake},${i.flags}` : '';
    }),
    events,
  };
}

/**
 * Two runs to tick `end`: the checkpoint ticks (0, 60, ... `end`, every one in both recordings),
 * those whose hashes differ, and the ticks whose bot inputs differ (every tick from 0 to `end`).
 */
function compareRuns(a: RaceRun, b: RaceRun, end: number) {
  const ticks: number[] = [];
  for (let t = 0; t <= end; t += HASH_EVERY_TICKS) {
    for (const r of [a, b])
      if (!r.hashes.has(t)) throw new Error(`a recording has no state hash at tick ${t}`);
    ticks.push(t);
  }
  for (const r of [a, b])
    if (r.inputs.length <= end) throw new Error(`a recording stops at tick ${r.inputs.length - 1}`);
  const inputsDiffer: number[] = [];
  for (let t = 0; t <= end; t++) if (a.inputs[t] !== b.inputs[t]) inputsDiffer.push(t);
  return { ticks, hashesDiffer: ticks.filter((t) => a.hashes.get(t) !== b.hashes.get(t)), inputsDiffer };
}

/**
 * The events both runs still hold, up to tick `end`: from the later of their first ticks (the page
 * keeps only its latest 300). Returns that first tick and whether the two lists are the same.
 */
function compareEvents(a: RaceRun, b: RaceRun, end: number) {
  // A list that no longer starts at the race start may have lost part of its first tick.
  const start = (r: RaceRun) => (r.events[0]?.type === 'raceStart' ? 0 : (r.events[0]?.tick ?? 0) + 1);
  const from = Math.max(start(a), start(b));
  const pick = (r: RaceRun) => r.events.filter((e) => e.tick >= from && e.tick <= end).map((e) => e.text);
  const ea = pick(a);
  const eb = pick(b);
  return { from, count: ea.length, same: ea.length === eb.length && ea.every((t, i) => t === eb[i]) };
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
  // Judged by the race recording, not by a trace sampled once per drawn frame: two runs used to
  // share only the ticks they both happened to sample, and the floors on those counts failed on
  // slow runners (inventory R2, 2026-10-02). Every count below is fixed by the code: each run is
  // compared on every tick's bot input and every 60th tick's state hash.
  const STEER = 'riders.steerScale';
  const run = async (opts: { change: boolean; end: (page: Page) => Promise<number> }) => {
    const page = await browser.newPage();
    const problems = await boot(page);
    await startSeededRace(page);
    if (opts.change) {
      await waitTick(page, 90);
      await page.keyboard.press('Backquote');
      await page.locator(`#tuning-panel input[data-param="${STEER}"]`).fill('2');
      await expect(page.locator(`#tuning-panel output[data-param-value="${STEER}"]`)).toHaveText('2.00×');
      // The panel stays open over the running race.
      await waitTick(page, (await tickOf(page)) + 60);
      await expect(page.locator('#tuning-panel')).toBeVisible();
    }
    const end = await opts.end(page);
    await waitTick(page, end + 1);
    const race = await raceRun(page);
    await page.close();
    expect(problems).toEqual([]);
    return { race, end };
  };
  // The changed run first: it sets how far every run is compared, at least 300 ticks past the
  // change (so 5 or more checkpoints after it), rounded up to a checkpoint.
  const c = await run({
    change: true,
    end: async (page) => Math.max(720, Math.ceil(((await tickOf(page)) + 300) / 60) * 60),
  });
  const END = c.end;
  const a = await run({ change: false, end: () => Promise.resolve(END) });
  const b = await run({ change: false, end: () => Promise.resolve(END) });

  for (const r of [a, b, c]) expect(r.race.seed, 'the seeded race').toBe(SEED);
  expect(a.race.params, 'a control run has no mid-race change').toEqual([]);
  expect(b.race.params, 'a control run has no mid-race change').toEqual([]);
  // The panel's change is in the recording, at the tick the sim applied it.
  expect(c.race.params.length, "the panel's change is recorded").toBeGreaterThan(0);
  for (const p of c.race.params) expect([p.id, p.value]).toEqual([STEER, 2]);
  const changedAt = Math.min(...c.race.params.map((p) => p.tick));

  const controls = compareRuns(a.race, b.race, END);
  const changed = compareRuns(a.race, c.race, END);
  const before = changed.ticks.filter((t) => t < changedAt);
  const after = changed.ticks.filter((t) => t >= changedAt);
  console.log(
    `steering change recorded at tick ${changedAt}; ticks 0-${END}, ${controls.ticks.length} checkpoints: ` +
      `control vs control: ${controls.inputsDiffer.length} inputs and ${controls.hashesDiffer.length} hashes differ; ` +
      `control vs changed: inputs first differ at ${changed.inputsDiffer[0] ?? 'none'} (${changed.inputsDiffer.length} ticks), ` +
      `hashes differ at ${JSON.stringify(changed.hashesDiffer)} (${before.length} checkpoints before the change, ${after.length} after)`,
  );
  expect(controls.ticks.length, 'every checkpoint to the end').toBe(END / HASH_EVERY_TICKS + 1);
  expect(controls.inputsDiffer, 'two control runs ride the same, tick for tick').toEqual([]);
  expect(controls.hashesDiffer, 'two control runs are identical').toEqual([]);
  expect(before.length, 'checkpoints before the change (ticks 0 and 60 at least)').toBeGreaterThanOrEqual(2);
  expect(after.length, 'checkpoints after the change').toBeGreaterThanOrEqual(5);
  expect(
    changed.hashesDiffer.filter((t) => t < changedAt),
    'identical before the change',
  ).toEqual([]);
  expect(
    changed.inputsDiffer.filter((t) => t < changedAt),
    'the bot rides the same until the change',
  ).toEqual([]);
  // The bot steers each tick from where it is: once the steering scale moves it, its inputs change.
  expect(changed.inputsDiffer.length, 'the change reached the ride').toBeGreaterThan(0);
  expect(changed.hashesDiffer.length, 'the change reached the sim state').toBeGreaterThan(0);
});

test('changing knockback changes the outcome of a seeded fight, compared with a control run', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const END = 900;
  const KNOCKBACK = 'combat.knockbackScale';
  // A seeded fight ridden by the bot (one driver call per tick, so a run repeats exactly).
  // Knockback is set on the panel before the race; the mid-race path is the steering test's. Two
  // control runs prove the fight itself repeats. The hits come from the rivals (ai-1) or an
  // attacking bot; with none, it skips, and tests/sim/tuning-knockback.test.ts still covers it.
  // Judged by the race recording and its events, as the steering test is: every count is fixed.
  const run = async (knockbackMax: boolean) => {
    const page = await browser.newPage();
    const problems = await boot(page);
    await page.keyboard.press('Backquote');
    const slider = page.locator(`#tuning-panel input[data-param="${KNOCKBACK}"]`);
    if ((await slider.count()) === 0) {
      await page.close();
      return null;
    }
    if (knockbackMax) {
      await slider.fill(await slider.evaluate((el) => (el as HTMLInputElement).max));
    }
    const value = await page.locator(`#tuning-panel output[data-param-value="${KNOCKBACK}"]`).textContent();
    await page.keyboard.press('Backquote');
    await expect(page.locator('#tuning-panel')).toBeHidden();
    await startSeededRace(page);
    await waitTick(page, END + 1);
    const race = await raceRun(page);
    await page.close();
    expect(problems).toEqual([]);
    // Hits up to END, from the race's events (the page keeps its latest 300; this race has fewer).
    const hits = race.events.filter((e) => e.tick <= END && e.type === 'hit').length;
    return { race, hits, value };
  };
  const control = await run(false);
  test.skip(control === null, 'NOT ACTIVE: no module declares combat.knockbackScale');
  if (!control) return;
  console.log(
    `knockback fight: ${control.hits} hits to tick ${END}; events held from tick ${control.race.events[0]?.tick}`,
  );
  test.skip(control.hits === 0, 'NOT ACTIVE: no hit landed in the seeded control fight');
  const again = await run(false);
  const strong = await run(true);
  if (!again || !strong) throw new Error('the knockback slider vanished between runs');
  const repeat = compareRuns(control.race, again.race, END);
  const diff = compareRuns(control.race, strong.race, END);
  const repeatEvents = compareEvents(control.race, again.race, END);
  const diffEvents = compareEvents(control.race, strong.race, END);
  console.log(
    `knockback ${control.value} vs ${strong.value} (race start ${control.race.tuning[KNOCKBACK]} vs ` +
      `${strong.race.tuning[KNOCKBACK]}): ${control.hits} hits in the control fight; ticks 0-${END}: ` +
      `control vs control: ${repeat.inputsDiffer.length} inputs and ${repeat.hashesDiffer.length} hashes differ, ` +
      `${repeatEvents.count} events from tick ${repeatEvents.from} the same: ${repeatEvents.same}; ` +
      `control vs strong: inputs first differ at ${diff.inputsDiffer[0] ?? 'none'} (${diff.inputsDiffer.length} ticks), ` +
      `events from tick ${diffEvents.from} the same: ${diffEvents.same}`,
  );
  for (const r of [control, again, strong]) expect(r.race.seed, 'the seeded race').toBe(SEED);
  // The panel's value reached the race: the recording's starting tuning carries it.
  expect(again.race.tuning[KNOCKBACK]).toBe(control.race.tuning[KNOCKBACK]);
  expect(strong.race.tuning[KNOCKBACK], 'the strong run starts with the panel value').not.toBe(
    control.race.tuning[KNOCKBACK],
  );
  expect(repeat.ticks.length, 'every checkpoint to the end').toBe(END / HASH_EVERY_TICKS + 1);
  expect(repeat.inputsDiffer, 'the bot rides the same, tick for tick').toEqual([]);
  expect(repeat.hashesDiffer, 'the seeded fight repeats').toEqual([]);
  expect(repeatEvents.same, 'the same events').toBe(true);
  // The race itself, not just the stored value (the state hash covers the tuning values, so it
  // differs from tick 0): the bot rode differently, or the race's events differ.
  expect(
    diff.inputsDiffer.length > 0 || !diffEvents.same,
    "knockback changed the fight (the bot's inputs or the race's events)",
  ).toBe(true);
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
