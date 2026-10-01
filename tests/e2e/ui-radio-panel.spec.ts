import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';

// The pause menu's radio panel (radio-1's follow-up, M4 ui-4), on a phone held sideways with touch:
// what plays, "Next station", "Next song" and "Cut song" (two taps), in the zine style, without
// pushing the menu, the keyboard legend or the "recently seen" list off the screen (playtest 1c
// item 8).
//
// app/ hands ui the radio (`UiCallbacks.radio`). Until it does, the panel is hidden, and the first
// test drives it through ui's stand-in seam (`window.__uiRadioSource`, test flag only), whose
// stations are the base pack's. The last test is the real path: it arms itself once app/ passes the
// radio, and then listens for a band's plucked strings after "Next station".

interface Station {
  id: string;
  name: string;
  tracks: { id: string; title: string }[];
}
const STATIONS: Station[] = readdirSync('packs/base/stations')
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(`packs/base/stations/${f}`, 'utf8')) as Station)
  .map((s) => ({ id: s.id, name: s.name, tracks: s.tracks.map((t) => ({ id: t.id, title: t.title })) }));

const appWired = readdirSync('src/app')
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .some((f) => /\bradio:\s*\{/.test(readFileSync(`src/app/${f}`, 'utf8')));

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { snapshot(): { tick: number } | null; setBot(on: boolean): void };
  __uiRadioSource?: unknown;
  __radioLog?: string[];
  __plucks?: number[];
};

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

type Box = { left: number; top: number; right: number; bottom: number };

/** Whether the element is fully on screen with nothing drawn over its centre. */
function onScreen(page: Page, selector: string): Promise<{ box: Box; inView: boolean; uncovered: boolean }> {
  return page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) throw new Error(`missing ${sel}`);
    const r = e.getBoundingClientRect();
    const inView =
      r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      inView,
      uncovered: !!hit && (hit === e || e.contains(hit)),
    };
  }, selector);
}

test('the pause radio panel names what plays, switches stations and songs, and cuts a song', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await page.addInitScript((stations: Station[]) => {
    const w = window as TestWindow;
    w.__GAME_TEST__ = true;
    w.__radioLog = [];
    let choice = 1;
    let track = 0;
    const station = () => (choice >= 2 ? stations[choice - 2] : undefined);
    const song = () => {
      const s = station();
      return s ? s.tracks[track % s.tracks.length] : undefined;
    };
    w.__uiRadioSource = {
      state() {
        const s = station();
        const t = song();
        return {
          choice,
          tunedTo: choice <= 0 ? 'off' : choice === 1 ? 'score' : (s?.id ?? 'off'),
          stations: stations.map((x) => x.id),
          nowPlaying:
            s && t
              ? { stationId: s.id, stationName: s.name, title: t.title, ref: `base:station/${s.id}#${t.id}` }
              : null,
        };
      },
      tune(c: number) {
        w.__radioLog?.push(`tune ${c}`);
        choice = c;
        track = 0;
      },
      skip() {
        w.__radioLog?.push('skip');
        track++;
      },
      cut() {
        const s = station();
        const t = song();
        if (!s || !t) return null;
        w.__radioLog?.push(`cut ${t.id}`);
        track++;
        return { contentRef: `base:station/${s.id}#${t.id}`, raceId: 'race-test', tick: 120 };
      },
    };
  }, STATIONS);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 30);
  await page.locator('#hud-pause').click();

  const panel = page.locator('#pause-radio');
  await expect(panel).toBeVisible();
  await expect(page.locator('#radio-station')).toHaveText('The score');
  await expect(page.locator('#radio-skip')).toBeHidden();
  await expect(page.locator('#radio-cut')).toBeHidden();

  // Next station: the first station, its name and its first song.
  const first = STATIONS[0] as Station;
  const second = STATIONS[1] as Station;
  await page.locator('#radio-next').click();
  await expect(page.locator('#radio-station')).toHaveText(first.name);
  await expect(page.locator('#radio-song')).toHaveText(first.tracks[0]?.title ?? '');
  // Next song.
  await page.locator('#radio-skip').click();
  await expect(page.locator('#radio-song')).toHaveText(first.tracks[1]?.title ?? '');

  // The layout on the phone, with the panel up: the menu, the panel and the cards all reachable.
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/ui-radio-panel-phone.png' });
  const checks: [string, Awaited<ReturnType<typeof onScreen>>][] = [];
  for (const sel of [
    '#pause-resume',
    '#pause-quit',
    '#pause-copy-report',
    '#pause-radio',
    '#radio-next',
    '#pause-keys summary',
  ]) {
    checks.push([sel, await onScreen(page, sel)]);
  }
  for (const [sel, c] of checks) {
    console.log(`${sel}: ${JSON.stringify(c.box)} in view ${c.inView}, uncovered ${c.uncovered}`);
    expect(c.inView, `${sel} on screen`).toBe(true);
    expect(c.uncovered, `${sel} not drawn over`).toBe(true);
  }
  // The "recently seen" list is still reachable: scrolled to, it is on screen and uncovered.
  await page.locator('#recently-seen').scrollIntoViewIfNeeded();
  const seen = await onScreen(page, '#recently-seen .rs-title');
  expect(seen.inView && seen.uncovered, 'the recently-seen list is reachable').toBe(true);
  await page.locator('#pause-radio').scrollIntoViewIfNeeded();

  // Cut song: two taps. Keep backs out; Cut it cuts, and the flag reaches the saved settings.
  const cutTitle = first.tracks[1]?.title ?? '';
  await page.locator('#radio-cut').click();
  await page.locator('#radio-cut-keep').click();
  await expect(page.locator('#radio-song')).toHaveText(cutTitle);
  await page.locator('#radio-cut').click();
  await page.locator('#radio-cut-yes').click();
  await expect(page.locator('#radio-song')).toContainText('Cut');
  const saved = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? '';
      if (k.endsWith(':settings')) return JSON.parse(localStorage.getItem(k) ?? 'null') as { data: unknown };
    }
    return null;
  });
  const data = saved?.data as { vetoes: { contentRef: string }[]; radio: string } | undefined;
  expect(data?.vetoes.map((v) => v.contentRef)).toContain(`base:station/${first.id}#${first.tracks[1]?.id}`);
  // A station picked here is the saved radio choice.
  expect(data?.radio).toBe('station');

  // On round: the second station, then off (the R key's order), then the score.
  await page.locator('#radio-next').click();
  await expect(page.locator('#radio-station')).toHaveText(second.name);
  await page.locator('#radio-next').click();
  await expect(page.locator('#radio-station')).toHaveText('Radio off');
  await page.locator('#radio-next').click();
  await expect(page.locator('#radio-station')).toHaveText('The score');
  const log = await page.evaluate(() => (window as TestWindow).__radioLog ?? []);
  console.log(`radio source calls: ${log.join(', ')}`);
  expect(log).toEqual(['tune 2', 'skip', `cut ${first.tracks[1]?.id}`, 'tune 3', 'tune 0', 'tune 1']);
  expect(problems).toEqual([]);
});

test('without a radio from app/, the pause menu shows no radio panel', async ({ page }) => {
  test.skip(appWired, 'app/ passes the radio now: the real-path test below covers it');
  const problems = watchErrors(page);
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 10);
  await page.locator('#hud-pause').click();
  await expect(page.locator('#pause-resume')).toBeVisible();
  await expect(page.locator('#pause-radio')).toBeHidden();
  expect(problems).toEqual([]);
});

test('the real radio: Next station in the pause panel tunes the race to a band', async ({ page }) => {
  test.skip(!appWired, 'waits for app/ to pass the radio (UiCallbacks.radio)');
  test.setTimeout(90_000);
  const problems = watchErrors(page);
  await page.addInitScript(() => {
    const w = window as TestWindow;
    w.__GAME_TEST__ = true;
    w.__plucks = [];
    const proto = AudioBufferSourceNode.prototype;
    const start = Object.getOwnPropertyDescriptor(proto, 'start')?.value as (
      this: AudioBufferSourceNode,
      ...args: number[]
    ) => void;
    proto.start = function (this: AudioBufferSourceNode, ...args: number[]) {
      if (this.buffer) w.__plucks?.push(Math.round(this.buffer.duration * 100) / 100);
      start.apply(this, args);
    };
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 30);
  await page.locator('#hud-pause').click();
  await expect(page.locator('#radio-station')).toHaveText('The score');
  await page.locator('#radio-next').click();
  await page.locator('#pause-resume').click();
  await page.waitForTimeout(800);
  await page.evaluate(() => ((window as TestWindow).__plucks = []));
  await page.waitForTimeout(2000);
  const d = await page.evaluate(() => (window as TestWindow).__plucks ?? []);
  const strings = d.filter((v) => v === 0.6 || v === 0.8 || v === 0.9 || v === 1.1).length;
  console.log(`after Next station: ${strings} plucked strings in 2 s`);
  expect(strings).toBeGreaterThan(0);
  await page.locator('#hud-pause').click();
  await expect(page.locator('#radio-song')).not.toBeEmpty();
  expect(problems).toEqual([]);
});
