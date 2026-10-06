import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Playtest 1c ([decided] 2026-09-30, the maintainer: "I'd like to also watch oncoming go up and up
// as you ride"). In a real race with the real sim, the player rides in the oncoming lane: while the
// stretch lasts, a live line on the top ticker ticks up ("ONCOMING 2.4s +$24"); when the stretch
// ends it pays, and the line lands exactly on the awarded cash and becomes that run's pop-up. It
// keeps the pop-ups' placement rules: out of the central look-ahead (the rectangle
// ui-style-popups.spec.ts measured), on screen.
//
// The ticker shows one thing at a time and the live meter is its quietest item (a bark or a near
// miss takes the strip from it, playtest 3), so this spec mutes everything but the meter and a paid
// run's landing (`__uiTickerQuiet`, ui's test seam): it is about the meter, not about what else the
// race says.
//
// A small driver inside the page steers the rider with keyboard events every frame, toward the
// oncoming lane's centre (−2 m times the travel direction, as tests/sim/riders-style-run.test.ts
// does), and back to its own lane once a stretch has lasted 4 s. It records what the meter showed
// and the sim's own run in the same frame, so the test compares the two. The page is a phone held
// sideways, with touch.

const LOOK_AHEAD = { left: 0.25, right: 0.75, top: 0.25, bottom: 0.65 };

type Box = { left: number; top: number; right: number; bottom: number };
type Run = { kind: string; seconds: number; cash: number; qualifies: boolean };
interface Sample {
  label: string;
  cash: string;
  pending: boolean;
  box: Box;
  /** The sim's own run, read in the same frame. */
  run: Run | null;
  /** Which stretch this is, counting from 0: a new one starts whenever the seconds fall. */
  stretch: number;
}
interface RideState {
  samples: Sample[];
  /** The player's oncoming awards, with the stretch they paid and its world seconds. */
  awards: { points: number; stretch: number; seconds: number }[];
  /** The line the meter became, a few frames after the first award. */
  landed: { text: string; landedClass: boolean; cls: string } | null;
  /** Every pop-up line seen, for the placement check. */
  chips: { text: string; box: Box }[];
  log: string[];
  done: boolean;
}

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __uiTickerQuiet?: boolean;
  __meterRide?: RideState;
  __game?: {
    setSeed(seed: number): void;
    playerId(): number;
    snapshot(): {
      tick: number;
      entities: { speed: number; road: { d: number; dir: number; yaw: number }; styleRun?: Run | null }[];
    } | null;
    events(): readonly { tick: number; type: string; actor: number; data: Record<string, unknown> }[];
  };
};

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

/** Starts the driver: it runs on its own frames until the first award has landed, or the limit. */
function startDriver(page: Page, holdS: number, limitMs: number): Promise<void> {
  return page.evaluate(
    ({ holdS, limitMs }) => {
      const w = window as TestWindow;
      const game = w.__game;
      const state: RideState = { samples: [], awards: [], landed: null, chips: [], log: [], done: false };
      w.__meterRide = state;
      const held = new Set<string>();
      const hold = (code: string, on: boolean) => {
        if (on === held.has(code)) return;
        if (on) held.add(code);
        else held.delete(code);
        window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, bubbles: true }));
      };
      const box = (e: Element): Box => {
        const r = e.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const t0 = performance.now();
      let back = false;
      let paidAt = -1;
      let lastTick = -1;
      let stretch = -1;
      let lastSeconds = Infinity;
      let lastRun: Run | null = null;
      const finish = () => {
        for (const c of [...held]) hold(c, false);
        state.done = true;
      };
      hold('KeyW', true);
      const tick = () => {
        if (performance.now() - t0 > limitMs) return finish();
        const snap = game?.snapshot();
        const me = snap?.entities[game?.playerId() ?? 0];
        if (!snap || !me) return void requestAnimationFrame(tick);
        // The handle keeps the last 300 events: count each once, by its tick.
        let newest = lastTick;
        for (const e of game?.events() ?? []) {
          if (e.tick <= lastTick) continue;
          newest = Math.max(newest, e.tick);
          if (e.type === 'style' && e.actor === game?.playerId() && e.data['kind'] === 'oncoming') {
            state.awards.push({
              points: Number(e.data['points']),
              stretch,
              seconds: Number(e.data['seconds']),
            });
          }
        }
        lastTick = newest;
        const run = me.styleRun?.kind === 'oncoming' ? { ...me.styleRun } : null;
        if (run && run.seconds < lastSeconds) stretch++;
        lastSeconds = run ? run.seconds : Infinity;
        if (lastRun && !run) {
          state.log.push(
            `stretch ${stretch} ended at ${lastRun.seconds.toFixed(2)} s, $${lastRun.cash}, ` +
              `d ${me.road.d.toFixed(2)}, ${me.speed.toFixed(1)} m/s`,
          );
        }
        lastRun = run;
        if (!back && run && run.seconds >= holdS) {
          back = true;
          state.log.push(`back to our own lane at ${run.seconds.toFixed(2)} s, $${run.cash}`);
        }
        // Steer toward a lane's centre: the oncoming lane at −2 m × dir, our own at +2 m × dir.
        const { d, dir, yaw } = me.road;
        const u = 0.35 * ((back ? 2 : -2) * dir - d) * dir - 2.5 * yaw;
        hold('KeyD', u > 0.08);
        hold('KeyA', u < -0.08);
        const strip = document.querySelector<HTMLElement>('#hud-ticker');
        const up = !!strip && !strip.hidden && strip.checkVisibility();
        const words = strip?.querySelector('.ticker-text')?.textContent ?? '';
        const money = strip?.querySelector('.ticker-cash')?.textContent ?? '';
        if (strip && up && strip.dataset['cls'] === 'meter') {
          state.samples.push({
            label: words,
            cash: money,
            pending: strip.classList.contains('pending'),
            box: box(strip),
            run,
            stretch,
          });
        } else if (strip && up) {
          state.chips.push({ text: `${words} ${money}`.trim(), box: box(strip) });
        }
        if (state.awards.length > 0 && paidAt < 0) paidAt = performance.now();
        // A few frames after the award: the line it landed on, once the handover is done.
        if (paidAt >= 0 && performance.now() - paidAt > 100) {
          const landed = strip && up && words.startsWith('ONCOMING') && strip.dataset['cls'] === 'style';
          state.landed = {
            text: landed ? `${words} ${money}`.trim() : '(none)',
            landedClass: !!landed && strip.classList.contains('landed'),
            cls: strip?.dataset['cls'] ?? '',
          };
          return finish();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { holdS, limitMs },
  );
}

test('the live oncoming meter ticks up, then lands on the award and becomes its chip', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    (window as TestWindow).__uiTickerQuiet = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await page.evaluate(() => (window as TestWindow).__game?.setSeed(1));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 5);

  await startDriver(page, 4, 60_000);
  mkdirSync('test-results/screenshots', { recursive: true });
  // Mid-stretch, once the run has passed the time it needs to pay: the meter, ticking.
  await page.waitForFunction(
    () => {
      const s = (window as TestWindow).__meterRide;
      const last = s?.samples[s.samples.length - 1];
      return !!s && (s.done || (!!last?.run && last.run.seconds >= 2.2));
    },
    null,
    { timeout: 60_000 },
  );
  await page.screenshot({ path: 'test-results/screenshots/ui-style-meter-phone-ticking.png' });
  await page.waitForFunction(() => (window as TestWindow).__meterRide?.done === true, null, {
    timeout: 65_000,
  });
  await page.screenshot({ path: 'test-results/screenshots/ui-style-meter-phone-landed.png' });
  const r = await page.evaluate(() => (window as TestWindow).__meterRide as RideState);
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  for (const line of r.log) console.log(line);

  // The first stretch that paid, and every meter frame of it.
  expect(r.awards.length, 'an oncoming award').toBeGreaterThan(0);
  const paid = r.awards[0] ?? { points: -1, stretch: -1, seconds: -1 };
  const shown = r.samples.filter((s) => s.stretch === paid.stretch && s.run);
  const first = shown[0];
  const last = shown[shown.length - 1];
  console.log(
    `meter: ${r.samples.length} frames in all, ${shown.length} in the paid stretch ${paid.stretch}; ` +
      `first "${first?.label} ${first?.cash}", last "${last?.label} ${last?.cash}"; ` +
      `award $${paid.points}; landed on "${r.landed?.text}" (${r.landed?.cls}, landed class: ${r.landed?.landedClass})`,
  );

  // It showed and it climbed: within the stretch, seconds and cash only go up. It is judged in the
  // stretch's own world seconds, because how many frames a stretch draws depends on the runner: on
  // main's software-rendered CI runner (about 19 frames a second here) a stretch a rival cut short
  // at 2.1 s drew 30 frames (CI run 36965896101), one short of the old "more than 30" floor. The
  // loop steps at most 4 ticks a drawn frame, so the meter must be up within one such frame of
  // 0.5 s (hud.meterShowAfterS) and stay up to within one such frame of the pay; a stretch pays
  // from 2 s (race.styleOncomingMinS), so that is at least about 1.4 s of meter.
  const FRAME_S = 4 / 60;
  expect(shown.length, 'frames with the meter up in the paid stretch').toBeGreaterThan(15);
  expect(first?.run?.seconds ?? 99, 'the meter is up from 0.5 s').toBeLessThanOrEqual(0.5 + FRAME_S + 1e-9);
  const unshownS = paid.seconds - (last?.run?.seconds ?? -99);
  expect(unshownS, 'the last frame shown is no later than the pay').toBeGreaterThanOrEqual(-1e-9);
  expect(unshownS, 'the meter stays up until the pay').toBeLessThanOrEqual(FRAME_S + 1e-9);
  const secs = shown.map((s) => parseFloat(/(\d+\.\d)s/.exec(s.label)?.[1] ?? 'NaN'));
  const cash = shown.map((s) => Number(s.cash.replace(/[^0-9]/g, '')));
  for (let i = 1; i < shown.length; i++) {
    expect(secs[i], `seconds at frame ${i}`).toBeGreaterThanOrEqual(secs[i - 1] ?? 0);
    expect(cash[i], `cash at frame ${i}`).toBeGreaterThanOrEqual(cash[i - 1] ?? 0);
  }
  expect(new Set(secs).size, 'distinct seconds readings').toBeGreaterThan(10);
  expect(Math.max(...cash), 'the cash climbed').toBeGreaterThan(Math.min(...cash));
  // The words are the sim's own numbers, read in the same frame; dim until the run would pay.
  for (const s of shown) {
    expect(s.label).toBe(`ONCOMING ${s.run?.seconds.toFixed(1)}s`);
    expect(s.cash).toBe(`+$${s.run?.cash.toLocaleString('en-US')}`);
    expect(s.pending).toBe(!s.run?.qualifies);
  }
  expect(shown.some((s) => s.pending) && shown.some((s) => !s.pending), 'dim, then bright').toBe(true);
  // It landed exactly on the award and became the run's own line on the strip. The last meter
  // frame is the sim's run in that frame (checked above), up to a drawn frame before the pay: a
  // stretch that ends between two drawn frames pays its last ticks' cash on the landing (seen with
  // forced 40-50 ms frames: the meter's last frame read $33, the award and the chip $34).
  expect(cash[cash.length - 1] ?? Infinity, 'the meter never shows more than the award').toBeLessThanOrEqual(
    paid.points,
  );
  expect(r.landed?.text).toBe(`ONCOMING +$${paid.points.toLocaleString('en-US')}`);
  expect(r.landed?.cls, 'the meter became a pop-up line').toBe('style');
  expect(r.landed?.landedClass, 'it is marked as the landed award').toBe(true);

  // Placement: every line and every meter frame stays on screen and out of the look-ahead.
  const { width: w, height: h } = viewport;
  const ahead = {
    left: w * LOOK_AHEAD.left,
    right: w * LOOK_AHEAD.right,
    top: h * LOOK_AHEAD.top,
    bottom: h * LOOK_AHEAD.bottom,
  };
  const boxes = [...r.chips, ...r.samples.map((s) => ({ text: s.label, box: s.box }))];
  expect(boxes.length).toBeGreaterThan(30);
  for (const c of boxes) {
    const hit =
      c.box.left < ahead.right &&
      ahead.left < c.box.right &&
      c.box.top < ahead.bottom &&
      ahead.top < c.box.bottom;
    expect(hit, `${c.text} at ${JSON.stringify(c.box)} reaches the look-ahead`).toBe(false);
    expect(c.box.left).toBeGreaterThanOrEqual(0);
    expect(c.box.right).toBeLessThanOrEqual(w);
    expect(c.box.top).toBeGreaterThanOrEqual(0);
  }
  console.log(`placement: ${boxes.length} boxes checked against the look-ahead ${JSON.stringify(ahead)}`);
  expect(problems).toEqual([]);
});

// The "Style pop-ups" setting (playtest 1c, on by default): off hides the chips and the meter at
// once, mid-race too, and the choice survives a reload. Pop-ups come from ui's test feed
// (`window.__uiStyleFeed`), through the same tally the sim's events use, on the top ticker.
test('the style pop-ups setting turns the chips off mid-race and is kept after a reload', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = watchErrors(page);
  type FeedWindow = TestWindow & { __uiStyleFeed?: (pops: { kind: string; points?: number }[]) => void };
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 5);
  type SeamWindow = FeedWindow & { __uiTicker?: (items: unknown[]) => void };
  const feed = () =>
    page.evaluate(async () => {
      // The strip cleared first: the race's own bark at its start would otherwise hold it.
      (window as SeamWindow).__uiTicker?.([]);
      const game = (window as TestWindow).__game;
      const before = game?.snapshot()?.tick ?? 0;
      (window as FeedWindow).__uiStyleFeed?.([{ kind: 'nearMiss', points: 25 }]);
      // The chip goes up (or is dropped) in the next frame that draws the HUD. Waited on by a sim
      // step, which the loop follows with that frame's HUD update in the same callback, not by a
      // count of frames or a deadline.
      while ((game?.snapshot()?.tick ?? 0) <= before) await new Promise((r) => requestAnimationFrame(r));
      // `up` is the strip's own "an item is showing", set and cleared in the same update. `hidden`
      // and `data-cls` are not: the strip leaves its box in the layout, with the last item's class,
      // for a 160 ms fade-out timer after the strip is cleared, so reading them saw a ghost chip
      // whenever frames came fast (this spec went red once, "chips with the setting off", on that).
      const root = document.getElementById('hud-ticker');
      return root?.classList.contains('up') && root.dataset['cls'] === 'style' ? 1 : 0;
    });
  // On (the default): the chip shows. This is the control for the "off" check below.
  expect(await feed(), 'chips with the setting on').toBe(1);

  // Off, from the pause menu's settings, mid-race.
  await page.locator('#hud-pause').click();
  await page.locator('#pause-controls').click();
  await page.locator('#settings-tab-display').click();
  await expect(page.locator('#settings-stylePopups')).toBeChecked();
  await page.locator('#settings-stylePopups').uncheck();
  await page.locator('#settings-back').click();
  await page.locator('#pause-resume').click();
  expect(await feed(), 'chips with the setting off').toBe(0);

  // Kept after a reload.
  await page.reload();
  await page.locator('#start-screen').click();
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-display').click();
  await expect(page.locator('#settings-stylePopups')).not.toBeChecked();
  expect(problems).toEqual([]);
});
