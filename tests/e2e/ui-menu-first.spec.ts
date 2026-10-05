import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Playtest 4: "Menu first" (P4-5) and the race-start countdown (P4-11), and the layout checks the
// wave C live check asked for on both.
//
// - Menu first: a brand-new player (nothing stored) lands on the main menu after the start tap, with
//   "Start career" the obvious first tap, and no race is running. Start career opens the career map
//   without a race; once the career has started the same button reads "Career".
// - The menu's layout, measured from painted boxes at the short phone sizes: the first tap is on the
//   screen and takes a tap at its centre, and the build stamp is not over any word of the menu, the
//   what's-new card's included (wave C: at 568x320 the stamp sat over the card's first line). A
//   negative control plants words under the stamp and must find them.
// - The countdown: the sim holds at tick 0 through 3, 2, 1 with nothing recorded, a press made then
//   is dropped, GO shows and the race runs, GO comes down; and its number sits inside the road-ahead
//   box, on the screen and off every other HUD piece, at the short phone sizes and a laptop.
//   The countdown is off under the test flag unless a spec asks (`window.__countdown = true`).
// The waits are on state (a label, a tick), never on time; the countdown is driven faster through
// the loop's lockstep once its first beats have been watched.

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface GameHandle {
  state(): string;
  snapshot(): { tick: number } | null;
  inputs(from?: number): { throttle: number; flags: number }[];
  lockstep(steps: number | null): void;
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __countdown?: boolean;
  __game?: GameHandle;
  __wordsUnderStamp?: () => { words: number; shown: boolean; under: string[] };
  __cd?: { labels: string[]; counting: number[]; recorded: number[] };
};

const ATTACK_FLAG = 1; // sim/types.ts InputFlag.attack

async function shot(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: `test-results/screenshots/ui-${name}.png` });
}

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

/** Plants the words-under-the-stamp measure in the page, so a case can run it in one synchronous step. */
async function installWordsMeasure(page: Page) {
  await page.addInitScript(() => {
    (window as TestWindow).__wordsUnderStamp = () => {
      const hit = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      const stamp = document.getElementById('build-stamp');
      const shown = !!stamp && stamp.checkVisibility();
      const sb = shown && stamp ? stamp.getBoundingClientRect() : null;
      const menu = document.getElementById('menu');
      const under: string[] = [];
      let words = 0;
      if (menu) {
        const walker = document.createTreeWalker(menu, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = (n.textContent ?? '').trim();
          const parent = n.parentElement;
          if (!text || !parent || !parent.checkVisibility()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) {
            if (r.width < 1 || r.height < 1) continue;
            words++;
            if (sb && hit(sb, r))
              under.push(
                `"${text.slice(0, 30)}" [${[r.left, r.top, r.right, r.bottom].map(Math.round).join(',')}]`,
              );
          }
        }
      }
      return { words, shown, under };
    };
  });
}

/** A frame or two, so the stamp's own check (it re-runs a frame after a screen changes) has settled. */
async function settleStamp(page: Page) {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

// ---- Menu first ---------------------------------------------------------------------------------

for (const [where, width, height] of [
  ['568x320', 568, 320],
  ['640x360', 640, 360],
  ['740x360', 740, 360],
  ['915x412', 915, 412],
] as const) {
  test.describe(`menu first at ${where}`, () => {
    test.use({ viewport: { width, height } });

    test('a new player lands on the menu with Start career as the first tap, and the stamp covers no word', async ({
      page,
    }) => {
      const problems = watchErrors(page);
      await page.addInitScript(() => {
        (window as TestWindow).__GAME_TEST__ = true;
      });
      await installWordsMeasure(page);
      await page.goto('./');
      await page.locator('#start-screen').click();
      await expect(page.locator('#menu')).toBeVisible();
      // No race: the first tap goes to the menu, and the career has not started.
      expect(await page.evaluate(() => (window as TestWindow).__game?.state())).toBe('menu');
      const career = page.locator('#menu-career');
      await expect(career).toHaveText('Start career');
      await expect(career).toHaveClass(/start-here/);
      await settleStamp(page);

      const m = await page.evaluate(() => {
        const box = (e: Element): Box => {
          const r = e.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        const start = document.getElementById('menu-career');
        const race = document.getElementById('menu-race');
        if (!start || !race) throw new Error('the menu has no career or race button');
        const big = [...document.querySelectorAll<HTMLElement>('#menu .big')]
          .filter((e) => e.checkVisibility())
          .sort(
            (a, b) =>
              a.getBoundingClientRect().top - b.getBoundingClientRect().top ||
              a.getBoundingClientRect().left - b.getBoundingClientRect().left,
          );
        const r = start.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          view: [innerWidth, innerHeight],
          startBox: box(start),
          raceBox: box(race),
          firstBig: big[0]?.id ?? '',
          tapLands: at === start || start.contains(at),
          startBg: getComputedStyle(start).backgroundColor,
          raceBg: getComputedStyle(race).backgroundColor,
        };
      });
      const [vw = 0, vh = 0] = m.view;
      const onScreen = (b: Box) =>
        b.left >= -0.5 && b.top >= -0.5 && b.right <= vw + 0.5 && b.bottom <= vh + 0.5;
      console.log(`${where}: ${JSON.stringify(m)}`);
      expect(onScreen(m.startBox), `${where}: Start career is on the screen`).toBe(true);
      expect(onScreen(m.raceBox), `${where}: Race is on the screen`).toBe(true);
      expect(m.tapLands, `${where}: a tap at the centre of Start career lands on it`).toBe(true);
      expect(
        m.firstBig,
        `${where}: Start career is the first of the big buttons, top to bottom, left to right`,
      ).toBe('menu-career');
      expect(m.startBg, `${where}: Start career is drawn apart from Race`).not.toBe(m.raceBg);

      // The what's-new card is up on a first launch; the stamp is over none of its words, nor any
      // other word of the menu.
      await expect(page.locator('#whats-new')).toBeVisible();
      const words = await page.evaluate(() => (window as TestWindow).__wordsUnderStamp?.());
      console.log(
        `${where}: ${words?.words} words measured, stamp ${words?.shown ? 'shown' : 'hidden'}, under ${JSON.stringify(words?.under)}`,
      );
      expect(words?.words ?? 0, `${where}: words were measured`).toBeGreaterThan(5);
      expect(words?.under, `${where}: words under the stamp`).toEqual([]);
      await shot(page, `menu-first-${where}`);

      // The check can fire: words planted exactly under the stamp, with the stamp forced shown at its
      // home corner, are named (all in one step, so the stamp's own check cannot step away between).
      const planted = await page.evaluate(() => {
        const stamp = document.getElementById('build-stamp');
        const menu = document.getElementById('menu');
        if (!stamp || !menu) throw new Error('no stamp or menu');
        stamp.classList.remove('at-right', 'yield');
        stamp.style.display = 'block';
        const r = stamp.getBoundingClientRect();
        const words = document.createElement('span');
        words.textContent = 'PLANTED WORDS';
        Object.assign(words.style, {
          position: 'fixed',
          left: `${r.left}px`,
          top: `${r.top}px`,
          zIndex: '3',
        });
        menu.append(words);
        const found = (window as TestWindow).__wordsUnderStamp?.();
        words.remove();
        stamp.style.display = '';
        return found;
      });
      expect(
        planted?.under.some((u) => u.includes('PLANTED WORDS')),
        `${where}: the measure names words planted under the stamp`,
      ).toBe(true);

      // Start career opens the career map, not a race; back on the menu it is the plain Career button.
      await career.click();
      await expect(page.locator('#career')).toBeVisible();
      expect(await page.evaluate(() => (window as TestWindow).__game?.state())).toBe('menu');
      await page.locator('#career-back').click();
      await expect(page.locator('#menu')).toBeVisible();
      await expect(career).toHaveText('Career');
      await expect(career).not.toHaveClass(/start-here/);
      expect(problems).toEqual([]);
    });
  });
}

// ---- The countdown --------------------------------------------------------------------------------

async function startFreePlayRace(page: Page) {
  await page.addInitScript(() => {
    const w = window as TestWindow;
    w.__GAME_TEST__ = true;
    w.__countdown = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-race').click();
}

test('the race holds at tick 0 through 3, 2, 1 with nothing recorded and a press dropped, then GO and the race runs', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await startFreePlayRace(page);
  // Watches every drawn frame: the labels in order, and the tick and the recorded inputs while one of
  // 3, 2, 1 is up. The loop sets the label and steps the sim in the same frame, so a frame's pair agrees.
  await page.evaluate(() => {
    const w = window as TestWindow;
    const cd = { labels: [] as string[], counting: [] as number[], recorded: [] as number[] };
    w.__cd = cd;
    const watch = () => {
      const g = w.__game;
      const label = document.querySelector('#countdown .count')?.textContent ?? '';
      if (label && cd.labels[cd.labels.length - 1] !== label) cd.labels.push(label);
      if (g && (label === '3' || label === '2' || label === '1')) {
        cd.counting.push(g.snapshot()?.tick ?? -1);
        cd.recorded.push(g.inputs().length);
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
  await expect(page.locator('#countdown .count')).toHaveText('3');
  // A press made on the grid (the attack key) is read and dropped: it must not reach the first tick.
  await page.waitForFunction(() => document.querySelector('#countdown .count')?.textContent === '2');
  await page.keyboard.press('KeyJ');
  // The rest of the count at 5 ticks a drawn frame, so it takes frames and not seconds.
  await page.evaluate(() => (window as TestWindow).__game?.lockstep(5));
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) >= 60);
  const seen = await page.evaluate(() => (window as TestWindow).__cd);
  console.log(`countdown labels ${JSON.stringify(seen?.labels)}, ${seen?.counting.length} frames counted`);
  expect(seen?.labels, 'the count, in order, ending on GO').toEqual(['3', '2', '1', 'GO']);
  expect(seen?.counting.length, 'frames were watched while counting').toBeGreaterThan(3);
  expect(
    seen?.counting.every((t) => t === 0),
    'the sim stays at tick 0 while 3, 2, 1 are up',
  ).toBe(true);
  expect(
    seen?.recorded.every((n) => n === 0),
    'nothing is recorded while 3, 2, 1 are up',
  ).toBe(true);
  // The race runs from tick 0, and the press made on the grid never reached it.
  const inputs = await page.evaluate(() => (window as TestWindow).__game?.inputs(0) ?? []);
  expect(inputs.length).toBeGreaterThan(0);
  expect(
    inputs[0] ? inputs[0].flags & ATTACK_FLAG : -1,
    'the first recorded tick carries no attack press',
  ).toBe(0);
  // GO has come down by now (it shows for under a second of race).
  await expect(page.locator('#countdown')).toBeHidden();
  expect(problems).toEqual([]);
});

/** Waits for the countdown to show `label`, then measures it and every other HUD piece in that frame. */
async function measureCountdown(page: Page, label: string, plantOverNumber = false) {
  const handle = await page.waitForFunction(
    ({ want, plant }) => {
      const count = document.querySelector<HTMLElement>('#countdown .count');
      if (!count || count.textContent !== want) return null;
      // The pop's end: measured at rest.
      for (const a of count.getAnimations()) a.finish();
      const box = (e: Element) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      // The negative control's piece, laid over the number in the same step as the measure.
      if (plant) {
        const c = box(count);
        const cover = document.createElement('div');
        cover.id = 'planted-cover';
        Object.assign(cover.style, {
          position: 'absolute',
          left: `${c.left}px`,
          top: `${c.top}px`,
          width: `${c.right - c.left}px`,
          height: `${c.bottom - c.top}px`,
          background: '#0008',
        });
        document.getElementById('hud')?.append(cover);
      }
      const others: { name: string; box: ReturnType<typeof box> }[] = [];
      const sel = '#hud > *, #touch-surface > .touch-button';
      for (const e of document.querySelectorAll<HTMLElement>(sel)) {
        if (e.id === 'countdown' || !e.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
          continue;
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        others.push({ name: e.id || e.className, box: box(e) });
      }
      return { w: innerWidth, h: innerHeight, count: box(count), others };
    },
    { want: label, plant: plantOverNumber },
  );
  return (await handle.jsonValue()) as {
    w: number;
    h: number;
    count: Box;
    others: { name: string; box: Box }[];
  };
}

const overlap = (a: Box, b: Box) =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

/** The HUD layout's road-ahead box (ui/hud-layout.ts LOOK_AHEAD): the middle half across, 25 to 65 % down. The countdown stays out of it. */
const roadAhead = (w: number, h: number): Box => ({
  left: 0.25 * w,
  right: 0.75 * w,
  top: 0.25 * h,
  bottom: 0.65 * h,
});

for (const [where, width, height, finePointer] of [
  ['568x320', 568, 320, false],
  ['640x360', 640, 360, false],
  ['915x412', 915, 412, false],
  // Tall and narrow with a fine pointer: a touch phone held upright gets the rotate screen, not a race.
  ['412x915', 412, 915, true],
  ['1366x768', 1366, 768, true],
] as const) {
  test.describe(`countdown at ${where}`, () => {
    test.use({ viewport: { width, height }, ...(finePointer ? { isMobile: false, hasTouch: false } : {}) });

    test('the number is on the screen, clear of the road ahead and off every other HUD piece, at 3 and at GO', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const problems = watchErrors(page);
      await startFreePlayRace(page);
      await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
      const three = await measureCountdown(page, '3');
      // To GO at 5 ticks a drawn frame (frames, not seconds).
      await page.evaluate(() => (window as TestWindow).__game?.lockstep(5));
      const go = await measureCountdown(page, 'GO');
      for (const [label, m] of [
        ['3', three],
        ['GO', go],
      ] as const) {
        const at = `${where}, ${label}`;
        console.log(
          `${at}: number [${[m.count.left, m.count.top, m.count.right, m.count.bottom].map(Math.round).join(',')}], ${m.others.length} other pieces: ${m.others.map((o) => o.name).join(', ')}`,
        );
        expect(m.others.length, `${at}: the other HUD pieces were measured`).toBeGreaterThan(2);
        const c = m.count;
        expect(c.left, `${at}: number inside the screen`).toBeGreaterThanOrEqual(-0.5);
        expect(c.top, `${at}: number inside the screen`).toBeGreaterThanOrEqual(-0.5);
        expect(c.right, `${at}: number inside the screen`).toBeLessThanOrEqual(m.w + 0.5);
        expect(c.bottom, `${at}: number inside the screen`).toBeLessThanOrEqual(m.h + 0.5);
        // The maintainer's veto (2026-10-05): the number never covers what is directly ahead.
        expect(overlap(c, roadAhead(m.w, m.h)), `${at}: number over the road ahead`).toBe(false);
        // Small: no more than 60 px tall and a quarter of the screen's width.
        expect(c.bottom - c.top, `${at}: number is small`).toBeLessThanOrEqual(64);
        expect(c.right - c.left, `${at}: number is small`).toBeLessThanOrEqual(0.25 * m.w + 0.5);
        expect(
          m.others.filter((o) => overlap(c, o.box)).map((o) => o.name),
          `${at}: HUD pieces under the number`,
        ).toEqual([]);
      }
      await shot(page, `countdown-${where}`);
      expect(problems).toEqual([]);
    });
  });
}

// The check can fire: a piece laid over the number's box is found by the same test.
test('the countdown overlap check names a piece planted under the number (negative control)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await startFreePlayRace(page);
  await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
  const again = await measureCountdown(page, '3', true);
  expect(again.others.filter((o) => overlap(again.count, o.box)).map((o) => o.name)).toContain(
    'planted-cover',
  );
});

// The road-ahead check can fire too: a number laid in the middle of the screen is found over the box.
test('the road-ahead check finds a number in the middle of the screen (negative control)', () => {
  const road = roadAhead(915, 412);
  const middle: Box = { left: 440, top: 150, right: 475, bottom: 190 };
  const beside: Box = { left: 40, top: 150, right: 90, bottom: 190 };
  expect(overlap(middle, road)).toBe(true);
  expect(overlap(beside, road)).toBe(false);
});
