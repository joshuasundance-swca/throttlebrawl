import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FAST_FORWARD_GUARD_MS, frames } from './lockstep';

// ui-1's browser tests (docs/milestones/M1.md, ui-1): menu, race and results show a placing; the
// pause screen opens and closes; the HUD elements are present; the settings page works (the mirror
// moves the touch buttons); the rotate screen wears the ui look; and no text overflows or leaves
// the screen at the phone-landscape viewport. Pause freezing the race and the volume reaching the
// master gain need app/'s wiring and live in ui-pause.spec.ts.

interface Handle {
  state(): string;
  snapshot(): {
    tick: number;
    entities: { id: number; kind: string; targetId: number; health: number; healthMax: number }[];
  } | null;
  playerId(): number;
  setBot(on: boolean): void;
  setSeed(seed: number): void;
  lockstep(steps: number | null): void;
}
interface TargetProbe {
  samples: number;
  targeted: number;
  shownWhileTargeted: number;
  shownWithoutTarget: number;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle; __targetProbe?: TargetProbe };

/** Every visible element with its own text must sit inside the viewport and not overflow its box. */
async function expectNoOverflow(page: Page, where: string) {
  const problems = await findOverflow(page);
  console.log(
    `${where}: ${problems.examined} text elements checked for overflow (${problems.scrolledAway} scrolled out of an on-screen scroller)`,
  );
  expect(problems.examined, `${where}: something was examined`).toBeGreaterThan(0);
  expect(problems.out, `${where}: no text overflows`).toEqual([]);
}

function findOverflow(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nodes = document.querySelectorAll<HTMLElement>('#ui *, #build-stamp');
    const onScreen = (r: DOMRect) =>
      r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
    // The nearest ancestor that scrolls up and down and has more than it shows (the pause screen's
    // cards scroll on a short phone, playtest 1c item 8; the "recently seen" list fills with signs
    // since the visibleContent poll, T8.2), or side to side (the menu's route chips, a row that
    // scrolls sideways on a narrow phone, ui/routes.ts).
    // A whole screen only scrolls sideways as a side effect of its up-and-down scrolling (CSS makes
    // the other axis auto too), so text past a screen's side is lost, not a row to swipe: only a row
    // inside a screen counts as a sideways scroller.
    const scrollerOf = (e: HTMLElement, axis: 'x' | 'y') => {
      for (let p = e.parentElement; p; p = p.parentElement) {
        if (axis === 'x' && p.classList.contains('screen')) continue;
        const style = getComputedStyle(p);
        const o = axis === 'y' ? style.overflowY : style.overflowX;
        const more = axis === 'y' ? p.scrollHeight > p.clientHeight + 1 : p.scrollWidth > p.clientWidth + 1;
        if ((o === 'auto' || o === 'scroll') && more) return p;
      }
      return null;
    };
    let examined = 0;
    let scrolledAway = 0;
    for (const e of nodes) {
      if (e.closest('#tuning-panel')) continue; // the tuning lane's panel
      if (!e.checkVisibility()) continue;
      const ownText = [...e.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim() !== '');
      if (!ownText) continue;
      examined++;
      const r = e.getBoundingClientRect();
      const name = `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''} "${(e.textContent ?? '').trim().slice(0, 30)}"`;
      if (!onScreen(r)) {
        // Text scrolled out of an on-screen scroller, and inside it across the scrolling, is reachable.
        const sb = scrollerOf(e, 'y')?.getBoundingClientRect();
        const sx = scrollerOf(e, 'x')?.getBoundingClientRect();
        if (sb && onScreen(sb) && r.left >= sb.left - 0.5 && r.right <= sb.right + 0.5) scrolledAway++;
        else if (sx && onScreen(sx) && r.top >= sx.top - 0.5 && r.bottom <= sx.bottom + 0.5) scrolledAway++;
        else out.push(`${name} leaves the screen: ${JSON.stringify(r)}`);
      }
      if (getComputedStyle(e).display !== 'inline') {
        if (e.scrollWidth > e.clientWidth + 1) out.push(`${name} overflows sideways`);
        if (e.scrollHeight > e.clientHeight + 1) out.push(`${name} overflows downwards`);
      }
    }
    return { out, examined, scrolledAway };
  });
}

/** The HUD pieces, the pause button and the touch buttons must not cover each other. */
async function expectNoHudOverlap(page: Page, where: string) {
  const found = await page.evaluate(() => {
    const ids = [
      'hud-speed',
      'hud-position',
      'hud-health',
      'hud-target',
      'hud-pause',
      'touch-attack',
      'touch-brake',
      'touch-wheelie',
    ];
    const boxes = ids
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => !!e && e.checkVisibility())
      .map((e) => ({ id: e.id, r: e.getBoundingClientRect() }));
    const out: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const overlap =
          a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom;
        if (overlap) out.push(`${a.id} overlaps ${b.id}`);
      }
    }
    return { out, examined: boxes.length };
  });
  console.log(`${where}: ${found.examined} HUD pieces checked for overlap`);
  expect(found.examined, `${where}: HUD pieces examined`).toBeGreaterThanOrEqual(5);
  expect(found.out, `${where}: no HUD overlap`).toEqual([]);
}

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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
});

// The start, menu and settings screens, and the mirror's two races, were one test until 2026-10-06:
// it took 25.4 s of its 30 s limit on main (run 37427759843) and ran out twice on a PR run
// (37430031610), both times in its last screenshot, taken mid-race in a software renderer. Its CI
// log's timestamps put the screens at about 12 s from the page load and the two races at about
// 13 s more, so they are two tests now, each asserting what it did, and the races get their own
// hang guard like every other race spec. [default]
test('start, menu and settings: controls card, build id and sliders', async ({ page }) => {
  const problems = watchErrors(page);
  await page.goto('./');
  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('#start-controls')).toContainText('Esc pause');
  await expectNoOverflow(page, 'start');
  await shot(page, 'start');

  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await expect(page.locator('#menu-settings')).toBeVisible();
  await expect(page.locator('#menu-build')).toHaveText(/^build [0-9a-f]{7}$/);
  await expectNoOverflow(page, 'menu');
  await shot(page, 'menu');

  await page.locator('#menu-settings').click();
  for (const bus of ['master', 'music', 'effects', 'voices']) {
    await expect(page.locator(`#settings-volume-${bus}`)).toBeVisible();
  }
  await expect(page.locator('#settings-volume-master-value')).toHaveText('80%');
  await expect(page.locator('#settings-mute')).toBeVisible();
  await expect(page.locator('#settings-mirror')).not.toBeChecked();
  await expectNoOverflow(page, 'settings');
  await shot(page, 'settings');
  await page.locator('#settings-back').click();
  await expect(page.locator('#menu-race')).toBeVisible();

  expect(problems).toEqual([]);
});

test('the mirror moves the buttons: the attack button and your health bar change sides, and the HUD never overlaps', async ({
  page,
}) => {
  // A hang guard, not a measurement: two race starts and a mid-race screenshot took about 13 s of
  // the old test's 25.4 s, and the screenshot alone was still waiting after 8.6 s on a busy runner.
  test.setTimeout(90_000);
  const problems = watchErrors(page);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();

  // Without the mirror the attack button sits on the right; with it, on the left.
  await page.locator('#menu-race').click();
  await expect(page.locator('#touch-attack')).toBeVisible();
  const vw = page.viewportSize()?.width ?? 0;
  const plain = await page.locator('#touch-attack').boundingBox();
  expect(plain && plain.x > vw / 2, 'attack button on the right').toBe(true);
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 10);
  await expectNoHudOverlap(page, 'race');
  await page.keyboard.press('Escape');
  await page.locator('#pause-quit').click();
  await expect(page.locator('#menu')).toBeVisible();
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-controls').click(); // the mirror lives on the Controls tab (ui-2)
  await page.locator('#settings-mirror').check();
  await page.keyboard.press('Escape'); // back to the menu
  await page.locator('#menu-race').click();
  const mirrored = await page.locator('#touch-attack').boundingBox();
  expect(mirrored && mirrored.x + mirrored.width < vw / 2, 'attack button on the left').toBe(true);
  const health = await page.locator('#hud-health').boundingBox();
  expect(health && health.x > vw / 2, 'your health bar follows the mirror').toBe(true);
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 10);
  await expectNoHudOverlap(page, 'race, mirrored');
  await shot(page, 'race-mirrored');

  expect(problems).toEqual([]);
});

/**
 * Ticks per drawn frame from the HUD checks to the results (app/loop.ts's lockstep, the determinism
 * run's R4): the race no longer runs at the speed the runner draws, and the target bar is still
 * examined on every drawn frame, about 160 of them for this seed. [default]
 */
const RIDE_LOCKSTEP = 32;

test('a race: HUD, pause screen, tuning long-press, and results with a placing', async ({ page }) => {
  // A hang guard: the ride to the results is about (its ticks / RIDE_LOCKSTEP) drawn frames.
  test.setTimeout(420_000);
  const problems = watchErrors(page);
  await page.goto('./');
  await page.locator('#start-screen').click();
  // A seed whose bot race ends quickly (about 85 s of sim headless, drafts in): a fresh random seed
  // ran to 140 s, and in CI's software renderer that crowded the 200 s wait for the results (since
  // W-P's road events and roadside density, the race no longer always fit).
  await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    g?.setSeed(110);
    g?.setBot(true);
  });
  await page.locator('#menu-race').click();

  // The target bar follows the player's auto-target all race: sampled on every drawn frame (it was
  // every 100 ms of wall time, which made the sample count the runner's speed).
  await page.evaluate(() => {
    const w = window as TestWindow;
    const probe: TargetProbe = { samples: 0, targeted: 0, shownWhileTargeted: 0, shownWithoutTarget: 0 };
    w.__targetProbe = probe;
    const sample = () => {
      requestAnimationFrame(sample);
      const g = w.__game;
      const s = g?.snapshot();
      if (!g || !s || g.state() !== 'race') return;
      const me = s.entities[g.playerId()];
      const target =
        me && me.targetId >= 0 && me.targetId !== me.id
          ? s.entities.find((e) => e.id === me.targetId && e.kind === 'rider')
          : undefined;
      const bar = document.getElementById('hud-target');
      const shown = !!bar && bar.checkVisibility();
      probe.samples++;
      if (target) {
        probe.targeted++;
        if (shown) probe.shownWhileTargeted++;
      } else if (shown) probe.shownWithoutTarget++;
    };
    requestAnimationFrame(sample);
  });

  // The HUD.
  await expect(page.locator('#hud-speed')).toBeVisible();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 120);
  await expect(page.locator('#hud-speed')).toHaveText(/^\d+ mph$/);
  await expect(page.locator('#hud-position')).toHaveText(/^\d+(st|nd|rd|th) \/ \d+$/);
  await expect(page.locator('#hud-health')).toBeVisible();
  await expect(page.locator('#hud-health .hud-bar > div')).toHaveAttribute('style', /width: \d+(\.\d+)?%/);
  await expect(page.locator('#hud-target')).toBeAttached(); // shown while you have a target
  await expect(page.locator('#hud-pause')).toBeVisible();
  await expect(page.locator('#touch-attack')).toBeVisible();
  await expect(page.locator('#touch-brake')).toBeVisible();
  await expect(page.locator('#build-stamp')).toBeHidden();
  await expectNoOverflow(page, 'race');
  await shot(page, 'race');

  // The pause screen: Esc opens it, the build id's long-press opens the tuning panel.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  await expect(page.locator('#pause-resume')).toBeVisible();
  await expect(page.locator('#pause-quit')).toBeVisible();
  await expect(page.locator('#pause-copy-report')).toBeVisible();
  await expect(page.locator('#touch-surface')).toBeHidden();
  // Paused, the sim stands still: your health bar must match your health in the snapshot.
  await frames(page, 2); // the HUD catches the last step on the next drawn frame
  const health = await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    const me = g?.snapshot()?.entities[g.playerId()];
    const fill = document.querySelector<HTMLElement>('#hud-health .hud-bar > div');
    return { health: me?.health ?? -1, max: me?.healthMax ?? -1, width: fill?.style.width ?? '' };
  });
  console.log(`health bar: ${JSON.stringify(health)}`);
  expect(health.max).toBeGreaterThan(0);
  expect(parseFloat(health.width)).toBeCloseTo((100 * health.health) / health.max, 0);
  await expectNoOverflow(page, 'pause');
  await shot(page, 'pause');
  await expect(page.locator('#tuning-panel')).toBeHidden();
  const build = await page.locator('#pause-build').boundingBox();
  expect(build).not.toBeNull();
  if (build) {
    await page.mouse.move(build.x + build.width / 2, build.y + build.height / 2);
    await page.mouse.down();
    // eslint-disable-next-line no-restricted-syntax -- a long-press: the build id's threshold is wall time by design
    await page.waitForTimeout(700);
    await page.mouse.up();
  }
  await expect(page.locator('#tuning-panel')).toBeVisible();
  await page.keyboard.press('Backquote'); // close it again
  await page.locator('#pause-resume').click();
  await expect(page.locator('#pause-screen')).toBeHidden();
  await expect(page.locator('#touch-surface')).toBeVisible();

  // The pause button does the same as Esc.
  await page.locator('#hud-pause').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeHidden();

  // Results. The race used to play in real time to the line, and a software-rendered CI runner ran
  // it at 25 to 40 ticks a second, so each content change walked the results wait (200 s, then
  // 330 s) into its limit. Now it rides in lockstep, RIDE_LOCKSTEP ticks a drawn frame, still drawn.
  // The start tick and the probe's count are read in the same task as the switch, so no drawn frame
  // can fall between them (a frame there was counted in the ticks but not in the samples).
  const { rideFrom, samplesBefore } = await page.evaluate((n) => {
    const w = window as TestWindow;
    w.__game?.lockstep(n);
    return { rideFrom: w.__game?.snapshot()?.tick ?? 0, samplesBefore: w.__targetProbe?.samples ?? 0 };
  }, RIDE_LOCKSTEP);
  await expect(page.locator('#results')).toBeVisible({ timeout: FAST_FORWARD_GUARD_MS }); // a hang guard
  const rideTo = await page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? 0);
  // A placing and its prize, or Busted and the fine (the batch rule: the seeded race's outcome
  // shifts whenever the sim changes, and both are results screens).
  await expect(page.locator('#results-place')).toHaveText(/^(\d+(st|nd|rd|th) of \d+|Busted)$/);
  const busted = (await page.locator('#results-place').textContent()) === 'Busted';
  await expect(page.locator('#results-prize')).toContainText(busted ? 'Fine: $' : 'Prize: $');
  // ui-3: the takedowns and style tally, on both kinds of results screen.
  await expect(page.locator('#results-tally')).toHaveText(/^Takedowns: \d+\. Style: \$[\d,]+\.$/);
  console.log(`results tally: ${await page.locator('#results-tally').textContent()}`);
  await expect(page.locator('#results-race')).toBeVisible();
  console.log(`results: ${await page.locator('#results-place').textContent()}`);

  // The target bar: shown while there is a target, hidden otherwise (a frame of lag allowed).
  const probe = (await page.evaluate(() => (window as TestWindow).__targetProbe)) as TargetProbe;
  // Every drawn frame of the ride that left the race running was examined. The ride's frames each
  // step RIDE_LOCKSTEP ticks, the last one fewer if the race ends inside it, so there are
  // ceil(ticks / RIDE_LOCKSTEP) of them. The last one ends the race, and the probe (which only
  // samples during a race) may not see it: when the race ended on that frame's final tick, the
  // old floor() counted it, and seed 110 did exactly that on CI (ticks 215 to 6935, 210 x 32: 209
  // samples). The count is still the race's, not the runner's.
  const rideFrames = Math.ceil((rideTo - rideFrom) / RIDE_LOCKSTEP) - 1;
  console.log(
    `target bar probe: ${JSON.stringify(probe)}; the ride: ticks ${rideFrom} to ${rideTo}, ${rideFrames} frames at ${RIDE_LOCKSTEP} ticks`,
  );
  expect(rideFrames, 'the ride to the results is a real race').toBeGreaterThan(30);
  expect(
    probe.samples - samplesBefore,
    'the bar examined on every drawn frame of the ride',
  ).toBeGreaterThanOrEqual(rideFrames);
  expect(probe.shownWhileTargeted).toBeGreaterThanOrEqual(Math.floor(probe.targeted * 0.9));
  expect(probe.shownWithoutTarget).toBeLessThanOrEqual(Math.ceil(probe.samples * 0.02));
  if (probe.targeted === 0) console.log('target bar probe: the player never had a target; bar unexamined');
  await expectNoOverflow(page, 'results');
  await shot(page, 'results');
  await page.locator('#results-menu').click();
  await expect(page.locator('#menu')).toBeVisible();

  expect(problems).toEqual([]);
});

test('the overflow check fires on planted overflowing text (negative control)', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#start-screen')).toBeVisible();
  await page.evaluate(() => {
    const clipped = document.createElement('div');
    clipped.textContent = 'a label far too long for its little box';
    Object.assign(clipped.style, { width: '40px', overflow: 'hidden', whiteSpace: 'nowrap' });
    const offscreen = document.createElement('div');
    offscreen.textContent = 'off the edge';
    Object.assign(offscreen.style, {
      position: 'absolute',
      left: '900px',
      top: '20px',
      whiteSpace: 'nowrap',
    });
    document.getElementById('start-screen')?.append(clipped, offscreen);
  });
  const found = await findOverflow(page);
  console.log(`negative control: ${JSON.stringify(found.out)}`);
  expect(found.out.some((p) => p.includes('overflows sideways'))).toBe(true);
  expect(found.out.some((p) => p.includes('leaves the screen'))).toBe(true);
});

// platform/ creates and toggles #rotate-screen (its own spec covers when); ui gives it the look.
test('the rotate screen wears the ui style and its text fits a portrait phone', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.addInitScript(() => {
    Object.defineProperty(screen.orientation, 'lock', {
      configurable: true,
      value: () => Promise.reject(new DOMException('lock refused by the test', 'NotSupportedError')),
    });
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  const rotate = page.locator('#rotate-screen');
  await expect(rotate).toBeVisible();
  const look = await rotate.evaluate((e) => ({
    background: getComputedStyle(e).backgroundColor,
    transform: getComputedStyle(e).textTransform,
    icon: getComputedStyle(e, '::before').content,
    box: e.getBoundingClientRect().toJSON() as DOMRect,
    fits: e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1,
  }));
  console.log(`rotate screen: ${JSON.stringify(look)}`);
  expect(look.background).toBe('rgb(20, 10, 40)');
  expect(look.transform).toBe('uppercase');
  expect(look.icon).not.toBe('none'); // the phone outline
  expect(look.fits).toBe(true);
  expect(look.box.width).toBeLessThanOrEqual(412);
  await shot(page, 'rotate');
});

// Roadmap M5, credits-1 ("check the credits"): the credits page lists every row of the ledger
// (dist/credits.json, which the build writes from THIRD_PARTY_ASSETS.md and the packs), labels the
// AI-made ones, shows the map-data credit and the licence text, and fits the shortest phone held
// sideways. The file is the oracle for the counts, so a new ledger row needs no edit here; the rule
// that every logged asset reaches the file is scripts/credits.test.ts.
test('credits: every ledger entry is listed, AI-made ones are labelled, the licence text opens, and it fits a short phone', async ({
  page,
}) => {
  const problems = watchErrors(page);
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-credits')).toBeVisible();
  await expectNoOverflow(page, 'menu with the Credits button');

  const file = (await (await page.request.get('./credits.json')).json()) as {
    entries: { ai: boolean }[];
    licences: { id: string; name: string; text: string }[];
  };
  const ai = file.entries.filter((e) => e.ai).length;
  console.log(
    `dist/credits.json: ${file.entries.length} entries (${ai} AI-made), ${file.licences.length} licence texts`,
  );
  expect(file.entries.length).toBeGreaterThan(0);

  await page.locator('#menu-credits').click();
  const list = page.locator('#credits-list');
  await expect(list.locator('.credit-entry')).toHaveCount(file.entries.length);
  await expect(list.locator('.credit-ai')).toHaveCount(ai);
  await expect(list.locator('a[href^="https://www.openstreetmap.org/"]').first()).toBeVisible();
  await expectNoOverflow(page, 'credits');
  await shot(page, 'credits');

  // The licence text the licences require opens in place, and the page still fits.
  for (const licence of file.licences) {
    const row = list.locator('.credit-licence', { hasText: licence.name });
    await row.locator('summary').click();
    await expect(row.locator('pre')).toBeVisible();
    expect((await row.locator('pre').textContent()) ?? '').toContain(licence.text.slice(0, 40));
  }
  await list.locator('.credit-entry').first().locator('summary').click();
  await expectNoOverflow(page, 'credits with the licence texts open');

  await page.locator('#credits-back').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  expect(problems).toEqual([]);
});

// Playtest 4 run C's live check (punch item 11): at 915x412 the build stamp, a label in the bottom-left
// corner, sat over the credits list's last line. The page's own bottom padding (the room that keeps
// the list above the stamp) was written as "#credits", which "#ui .screen" out-ranks, so it never
// applied. This measures the painted words of the list, as far as the list shows them, against the
// stamp's painted box at the top, the middle and the end of the list (the end with a licence text
// open, the longest block), at the phone sizes. The negative control puts the padding back to 0 and
// the stamp at home, which is how it looked, and must find the last line under the stamp.
const CREDITS_SIZES = [
  { name: '915x412', width: 915, height: 412 },
  { name: '740x360', width: 740, height: 360 },
  { name: '640x360', width: 640, height: 360 },
  { name: '568x320', width: 568, height: 320 },
] as const;

/** The words of the credits list that are painted inside it, and those the stamp is over. */
function creditsUnderStamp(page: Page, forceStampHome: boolean) {
  return page.evaluate((force) => {
    const stamp = document.getElementById('build-stamp');
    const list = document.getElementById('credits-list');
    if (!stamp || !list) throw new Error('no stamp or credits list');
    if (force) {
      stamp.classList.remove('at-right', 'yield');
      stamp.style.display = 'block';
    }
    const shown = stamp.checkVisibility();
    const sb = shown ? stamp.getBoundingClientRect() : null;
    const lr = list.getBoundingClientRect();
    const under: string[] = [];
    let words = 0;
    const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      const parent = n.parentElement;
      if (!text || !parent || !parent.checkVisibility()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        // Only the part of the line the list shows: the rest is scrolled out of it.
        const box = {
          left: Math.max(r.left, lr.left),
          top: Math.max(r.top, lr.top),
          right: Math.min(r.right, lr.right),
          bottom: Math.min(r.bottom, lr.bottom),
        };
        if (box.right - box.left < 1 || box.bottom - box.top < 1) continue;
        words++;
        if (
          sb &&
          sb.left < box.right - 0.5 &&
          box.left < sb.right - 0.5 &&
          sb.top < box.bottom - 0.5 &&
          box.top < sb.bottom - 0.5
        )
          under.push(
            `"${text.slice(0, 30)}" [${[box.left, box.top, box.right, box.bottom].map(Math.round).join(',')}]`,
          );
      }
    }
    return {
      words,
      shown,
      under,
      listBottom: Math.round(lr.bottom),
      stampTop: sb ? Math.round(sb.top) : null,
    };
  }, forceStampHome);
}

for (const size of CREDITS_SIZES) {
  test.describe(`credits and the build stamp at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('the build stamp covers no word of the credits list, scrolled to the top, the middle and the end', async ({
      page,
    }) => {
      const problems = watchErrors(page);
      await page.goto('./');
      await page.locator('#start-screen').click();
      await page.locator('#menu-credits').click();
      const list = page.locator('#credits-list');
      await expect(list.locator('.credit-entry').first()).toBeVisible();
      const settle = () =>
        page.evaluate(
          () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );
      // The last row (a package's licence text, a long block) is open for the end of the list.
      await list.locator('details > summary').last().click();

      let words = 0;
      for (const at of [0, 0.5, 1]) {
        await page.evaluate((frac) => {
          const l = document.getElementById('credits-list');
          if (l) l.scrollTop = (l.scrollHeight - l.clientHeight) * frac;
        }, at);
        await settle();
        const found = await creditsUnderStamp(page, false);
        words += found.words;
        console.log(
          `${size.name}, scrolled ${at * 100}%: ${found.words} words, list ends at ${found.listBottom}, stamp ${found.shown ? `from ${found.stampTop}` : 'hidden'}, under ${JSON.stringify(found.under)}`,
        );
        expect(found.words, `${size.name} ${at}: words were measured`).toBeGreaterThan(5);
        expect(found.under, `${size.name} ${at}: words under the stamp`).toEqual([]);
      }
      expect(words).toBeGreaterThan(0);
      await shot(page, `credits-stamp-${size.name}`);

      // The check can fire: with the room under the list taken away and the stamp at home, the end of
      // the list is under it (what the live check saw).
      await page.evaluate(() => {
        const c = document.getElementById('credits');
        if (c) c.style.paddingBottom = '0px';
        const l = document.getElementById('credits-list');
        if (l) l.scrollTop = l.scrollHeight;
      });
      await settle();
      const control = await creditsUnderStamp(page, true);
      expect(
        control.under.length,
        `${size.name}: the check names words under the stamp (control)`,
      ).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    });
  });
}
