import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tiltAngleFromEuler } from '../../src/input/devices/tilt.ts';
import { inputDefaults } from '../../src/input/tuning.ts';
import type { SimEvent, SimInput } from '../../src/sim/types.ts';

// ui-2's browser tests (docs/milestones/M2.md, ui-2): the pause menu lists exactly the decided
// entries, the tuning entry is hidden by default and shown when enabled, "Controls and HUD" opens
// the controls settings over the paused race, Race settings say "applies next race" there, every
// setting the screen shows persists across a reload and changes something observable, every tab
// fits a phone-landscape screen.
//
// `?settings=all` previews every setting, wired or not; the persistence test runs without it, so
// it covers exactly what a player sees.

interface Handle {
  state(): string;
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
  inputs(from?: number): SimInput[];
  events(): readonly SimEvent[];
  playerId(): number;
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: Handle;
  /** navigator.vibrate's calls, recorded by the stub below. */
  __buzzes?: unknown[];
};

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

async function shot(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: `test-results/screenshots/ui-${name}.png` });
}

async function startRace(page: Page, query = '') {
  await page.goto(`./${query}`);
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 30);
}

/**
 * A stand-in for a bark bubble, which appears only when a rival talks: appended last to #ui,
 * absolutely placed across the top of the screen with no z-index, as ui/narrative's bubble is.
 * Menus must stack above it.
 */
async function plantBubble(page: Page) {
  await page.evaluate(() => {
    const b = document.createElement('div');
    b.id = 'planted-bubble';
    b.textContent = 'a rival says something';
    Object.assign(b.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      top: '40px',
      height: '120px',
      background: '#fff',
      color: '#000',
      // The real bubble ignores the pointer; this one takes it, so hit-testing shows paint order.
      pointerEvents: 'auto',
    });
    document.getElementById('ui')?.append(b);
  });
}

/** The pause menu's visible entries, in order. */
const pauseEntries = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#pause-screen [data-entry]')]
      .filter((e) => e.checkVisibility())
      .map((e) => e.dataset['entry'] ?? ''),
  );

/** Visible text inside the viewport and inside its own box (as in ui-screens.spec.ts). */
function findOverflow(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let examined = 0;
    for (const e of document.querySelectorAll<HTMLElement>('#ui *')) {
      if (e.closest('#tuning-panel')) continue;
      if (!e.checkVisibility()) continue;
      const ownText = [...e.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim() !== '');
      if (!ownText) continue;
      examined++;
      const r = e.getBoundingClientRect();
      const name = `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''} "${(e.textContent ?? '').trim().slice(0, 30)}"`;
      if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) {
        out.push(`${name} leaves the screen`);
      }
      if (getComputedStyle(e).display !== 'inline') {
        if (e.scrollWidth > e.clientWidth + 1) out.push(`${name} overflows sideways`);
        if (e.scrollHeight > e.clientHeight + 1) out.push(`${name} overflows downwards`);
      }
    }
    return { out, examined };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    // Record vibrations instead of making them, so the vibration setting's effect can be seen.
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      configurable: true,
      value(pattern: unknown) {
        ((window as TestWindow).__buzzes ??= []).push(pattern);
        return true;
      },
    });
  });
});

test('the pause menu lists exactly the decided entries, and the tuning entry appears when enabled', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await startRace(page, '?settings=all');
  await plantBubble(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  const entries = await pauseEntries(page);
  console.log(`pause entries: ${entries.join(', ')}`);
  expect(entries).toEqual(['resume', 'restart', 'quit', 'controls', 'report']);
  await expect(page.locator('#pause-tuning')).toBeHidden();
  // Menus sit above the bark bubble: the pause title is the top element at its centre.
  const titleOnTop = await page.evaluate(() => {
    const t = document.querySelector<HTMLElement>('#pause-screen .title');
    const r = t?.getBoundingClientRect();
    const top = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return !!t && !!top && (top === t || t.contains(top));
  });
  expect(titleOnTop, 'nothing covers the pause title').toBe(true);
  await shot(page, 'pause-m2');

  // Controls and HUD: the Controls tab over the paused race; Back returns to the pause menu.
  await page.locator('#pause-controls').click();
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#settings-tab-controls')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#settings-mirror')).toBeVisible();
  expect(await page.evaluate(() => (window as TestWindow).__game?.state())).toBe('race');
  const tick = await page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? -1);
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => (window as TestWindow).__game?.snapshot()?.tick ?? -1),
    'the race stays paused behind the settings',
  ).toBe(tick);

  // From the pause menu, the Race settings say "applies next race".
  await page.locator('#settings-tab-race').click();
  const tags = page.locator('#settings-pane-race .next-race');
  const tagCount = await tags.count();
  expect(tagCount).toBe(5);
  for (let i = 0; i < tagCount; i++) await expect(tags.nth(i)).toBeVisible();
  await shot(page, 'settings-race-from-pause');

  // Enable the tuning entry on the Display tab, then go back: the entry shows and opens the panel.
  await page.locator('#settings-tab-display').click();
  await page.locator('#settings-showTuningPanel').check();
  await page.locator('#settings-back').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  expect(await pauseEntries(page)).toEqual(['resume', 'restart', 'quit', 'controls', 'tuning', 'report']);
  await expect(page.locator('#tuning-panel')).toBeHidden();
  await page.locator('#pause-tuning').click();
  await expect(page.locator('#tuning-panel')).toBeVisible();
  await page.keyboard.press('Backquote');

  // Esc from settings over the pause menu goes back to the pause menu, not into the race.
  await page.locator('#pause-controls').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  await expect(page.locator('#settings')).toBeHidden();
  await page.locator('#pause-resume').click();
  await expect(page.locator('#pause-screen')).toBeHidden();

  // From the main menu, the same rows carry no "applies next race" tag.
  await page.keyboard.press('Escape');
  await page.locator('#pause-quit').click();
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-race').click();
  for (let i = 0; i < tagCount; i++) await expect(tags.nth(i)).toBeHidden();
  expect(problems).toEqual([]);
});

// Each visible setting needs a probe here: set its non-default value, show its effect. A setting
// on screen without a probe fails the test, so a new one cannot ship without its non-default test
// (M2's cross-lane rules). The M1 volumes, mute and mirror have theirs in ui-pause and ui-screens.
type Probe = (page: Page) => Promise<void>;

const choose = async (page: Page, tab: string, id: string, value: string) => {
  await page.locator(`#settings-tab-${tab}`).click();
  await page.locator(`#settings-${id} [data-value="${value}"]`).click();
};
const chosen = async (page: Page, tab: string, id: string, value: string) => {
  await page.locator(`#settings-tab-${tab}`).click();
  await expect(page.locator(`#settings-${id} [data-value="${value}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
};

/** From the settings screen into a race the player rides alone: no bot, no touches, no keys. */
async function raceAlone(page: Page) {
  await page.locator('#settings-back').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(false));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 60);
}
async function quitRace(page: Page) {
  await page.keyboard.press('Escape');
  await page.locator('#pause-quit').click();
  await expect(page.locator('#menu')).toBeVisible();
}

/**
 * One phone-angle reading, as the browser's orientation sensor would send it, then 10 sim ticks so
 * the input samples it (the first sampled reading is the rest angle, so two readings sent between
 * the same two ticks would leave the rest angle at the tilt and steer nothing).
 */
async function tiltTo(page: Page, beta: number, gamma: number) {
  const tick = await page.evaluate(
    ([b, g]) => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: g }));
      return (window as TestWindow).__game?.snapshot()?.tick ?? 0;
    },
    [beta, gamma] as const,
  );
  await page.waitForFunction((t) => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > t + 10, tick);
}

/** Waits until the latest recorded SimInput passes `ok`, and returns it. */
async function waitLast(page: Page, ok: (s: SimInput) => boolean): Promise<SimInput> {
  let last: SimInput | undefined;
  await expect
    .poll(
      async () => {
        last = await page.evaluate(() => (window as TestWindow).__game?.inputs().at(-1));
        return !!last && ok(last);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return last!;
}

/**
 * From the settings screen into a bot race, until the player has had at least one event that
 * buzzes (a hit landed or taken, a takedown or a crash); returns how many, and the vibrate calls
 * made since the race began (the Start tap's own first buzz is left out).
 */
async function raceUntilHapticEvent(page: Page) {
  await page.locator('#settings-back').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 5);
  const from = await page.evaluate(() => {
    (window as TestWindow).__buzzes = [];
    return (window as TestWindow).__game?.snapshot()?.tick ?? 0;
  });
  const count = () =>
    page.evaluate((t) => {
      const g = (window as TestWindow).__game!;
      const me = g.playerId();
      return g
        .events()
        .filter((e) => e.tick > t)
        .filter(
          (e) =>
            (e.type === 'hit' && (e.actor === me || e.target === me)) ||
            ((e.type === 'takedown' || e.type === 'crash') && e.actor === me),
        ).length;
    }, from);
  await expect.poll(count, { timeout: 120_000, intervals: [500] }).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  return {
    events: await count(),
    buzzes: await page.evaluate(() => (window as TestWindow).__buzzes ?? []),
  };
}
const PROBES: Record<string, { set: Probe; effect: Probe; persisted: Probe }> = {
  units: {
    set: async (page) => {
      await page.locator('#settings-tab-display').click();
      await page.locator('#settings-units [data-value="kmh"]').click();
    },
    effect: async (page) => {
      await page.locator('#settings-back').click();
      await page.locator('#menu-race').click();
      await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 60);
      await expect(page.locator('#hud-speed')).toHaveText(/^\d+ km\/h$/);
      await page.keyboard.press('Escape');
      await page.locator('#pause-quit').click();
    },
    persisted: async (page) => {
      await page.locator('#settings-tab-display').click();
      await expect(page.locator('#settings-units [data-value="kmh"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    },
  },
  // The input-2 control settings (app/ lists them in liveSettings; tilt ones on a touch device with
  // motion sensors, vibration where the browser can vibrate). The probes run in the table's order
  // without resetting, so the tilt sensitivity probe rides on the steering probe's "Tilt".
  steering: {
    set: (page) => choose(page, 'controls', 'steering', 'tilt'),
    effect: async (page) => {
      // Thumb steering never listens to the sensors: a tilt steers only when tilt is chosen.
      await raceAlone(page);
      await tiltTo(page, 0, 0);
      await tiltTo(page, 20, 20);
      const steer = await waitLast(page, (s) => s.steer !== 0);
      console.log(`steering tilt: a 20° tilt steers ${steer.steer}`);
      await quitRace(page);
    },
    persisted: (page) => chosen(page, 'controls', 'steering', 'tilt'),
  },
  tiltSensitivity: {
    set: (page) => choose(page, 'controls', 'tiltSensitivity', '2'),
    effect: async (page) => {
      // "Max" (2) halves the full-lock angle: an 8° tilt steers about twice as far as at "Normal".
      await raceAlone(page);
      const angle = await page.evaluate(() => screen.orientation?.angle ?? 90);
      const a = Math.abs(tiltAngleFromEuler(8, 8, angle) ?? 0);
      const t = inputDefaults();
      const at = (sens: number) =>
        Math.round((127 * (a - t.tiltDeadZoneDeg)) / (t.tiltFullLockDeg / sens - t.tiltDeadZoneDeg));
      await tiltTo(page, 0, 0);
      await tiltTo(page, 8, 8);
      await page.waitForTimeout(800); // the tilt filter (0.1 s) settles
      const last = await waitLast(page, (s) => s.steer !== 0);
      console.log(
        `tilt sensitivity 2: ${a.toFixed(1)}° steers ${last.steer}; expected ${at(2)}, Normal ${at(1)}`,
      );
      expect(Math.abs(Math.abs(last.steer) - at(2))).toBeLessThanOrEqual(4);
      expect(Math.abs(Math.abs(last.steer) - at(1))).toBeGreaterThan(20);
      await quitRace(page);
    },
    persisted: (page) => chosen(page, 'controls', 'tiltSensitivity', '2'),
  },
  throttle: {
    set: (page) => choose(page, 'controls', 'throttle', 'auto'),
    effect: async (page) => {
      // No finger on the screen and no key: auto-throttle rides at full throttle anyway.
      await raceAlone(page);
      const last = await waitLast(page, (s) => s.throttle === 255);
      expect(last.brake).toBe(0);
      await quitRace(page);
    },
    persisted: (page) => chosen(page, 'controls', 'throttle', 'auto'),
  },
  pullBackBrake: {
    set: async (page) => {
      await page.locator('#settings-tab-controls').click();
      await page.locator('#settings-pullBackBrake').check();
    },
    effect: async (page) => {
      // Pulling the stick down brakes (off, it only lets go of the throttle).
      await raceAlone(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 150, y: 200, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 150, y: 235, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 150, y: 270, id: 1 }],
      });
      const last = await waitLast(page, (s) => s.brake === 255);
      console.log(`pull-back brake: ${JSON.stringify(last)}`);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
      await quitRace(page);
    },
    persisted: async (page) => {
      await page.locator('#settings-tab-controls').click();
      await expect(page.locator('#settings-pullBackBrake')).toBeChecked();
    },
  },
  haptics: {
    set: async (page) => {
      await page.locator('#settings-tab-controls').click();
      await page.locator('#settings-haptics').uncheck();
    },
    effect: async (page) => {
      // Vibration off: the player's hits, takedowns and crashes buzz nothing (the positive control,
      // vibration on, is its own test below).
      const { events, buzzes } = await raceUntilHapticEvent(page);
      console.log(`vibration off: ${events} haptic events for the player, ${buzzes.length} buzzes`);
      expect(events).toBeGreaterThan(0);
      expect(buzzes).toEqual([]);
      await quitRace(page);
    },
    persisted: async (page) => {
      await page.locator('#settings-tab-controls').click();
      await expect(page.locator('#settings-haptics')).not.toBeChecked();
    },
  },
  showTuningPanel: {
    set: async (page) => {
      await page.locator('#settings-tab-display').click();
      await page.locator('#settings-showTuningPanel').check();
    },
    effect: async (page) => {
      await page.locator('#settings-back').click();
      await page.locator('#menu-race').click();
      await page.keyboard.press('Escape');
      await expect(page.locator('#pause-tuning')).toBeVisible();
      await page.locator('#pause-quit').click();
    },
    persisted: async (page) => {
      await page.locator('#settings-tab-display').click();
      await expect(page.locator('#settings-showTuningPanel')).toBeChecked();
    },
  },
};

test('every setting on screen persists across a reload and changes something observable', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const problems = watchErrors(page);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-settings').click();
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#settings [data-setting]')]
      .filter((e) => !e.hidden)
      .map((e) => e.dataset['setting'] ?? ''),
  );
  console.log(`settings on screen: ${shown.join(', ')}`);
  expect(shown.length, 'at least units is on screen').toBeGreaterThan(0);
  // The phone profile (touch, motion sensors, vibration) shows every control setting input-2 wired.
  expect(shown).toEqual(
    expect.arrayContaining(['steering', 'tiltSensitivity', 'throttle', 'pullBackBrake', 'haptics']),
  );
  const missing = shown.filter((id) => !(id in PROBES));
  expect(missing, 'every setting on screen has a non-default probe in ui-settings.spec.ts').toEqual([]);

  for (const id of shown) {
    const probe = PROBES[id];
    if (!probe) continue;
    await probe.set(page);
    await probe.effect(page);
    console.log(`${id}: non-default value set and its effect seen`);
    await page.reload();
    await page.locator('#start-screen').click();
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await page.locator('#menu-settings').click();
    await probe.persisted(page);
    console.log(`${id}: still set after a reload`);
    await probe.effect(page);
    await page.locator('#menu-settings').click();
  }
  expect(problems).toEqual([]);
});

test('vibration on (the default): the player\'s hits buzz (the control for the "off" probe)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-controls').click();
  await expect(page.locator('#settings-haptics')).toBeChecked();
  const { events, buzzes } = await raceUntilHapticEvent(page);
  console.log(`vibration on: ${events} haptic events for the player, ${buzzes.length} buzzes`);
  expect(buzzes.length).toBeGreaterThan(0);
});

test('where tilt and vibration cannot work, their settings stay hidden', async ({ browser }) => {
  // A laptop: no touch, a fine pointer, and a browser without navigator.vibrate.
  const context = await browser.newContext({
    isMobile: false,
    hasTouch: false,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
    delete (Navigator.prototype as { vibrate?: unknown }).vibrate;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-settings').click();
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#settings [data-setting]')]
      .filter((e) => !e.hidden)
      .map((e) => e.dataset['setting'] ?? ''),
  );
  console.log(`laptop settings on screen: ${shown.join(', ')}`);
  expect(shown).toEqual(expect.arrayContaining(['throttle', 'pullBackBrake']));
  for (const id of ['steering', 'tiltSensitivity', 'haptics']) expect(shown).not.toContain(id);
  await context.close();
});

test('every settings tab fits a phone-landscape screen over the paused race, uncovered', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await startRace(page, '?settings=all');
  await plantBubble(page);
  await page.keyboard.press('Escape');
  await page.locator('#pause-controls').click();
  let examined = 0;
  for (const tab of ['sound', 'race', 'controls', 'display']) {
    await page.locator(`#settings-tab-${tab}`).click();
    await expect(page.locator(`#settings-pane-${tab}`)).toBeVisible();
    const found = await findOverflow(page);
    examined += found.examined;
    console.log(`settings ${tab} (over pause): ${found.examined} text elements checked`);
    expect(found.examined).toBeGreaterThan(0);
    expect(found.out, `${tab}: no text overflows`).toEqual([]);
    // Every control is a finger-sized target.
    const small = await page.evaluate(
      (t) =>
        [...document.querySelectorAll<HTMLElement>(`#settings-pane-${t} button, #settings-pane-${t} input`)]
          .filter((e) => e.checkVisibility())
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return e instanceof HTMLInputElement && e.type === 'checkbox' ? r.width < 20 : r.height < 36;
          })
          .map((e) => e.id || e.textContent),
      tab,
    );
    expect(small, `${tab}: controls are big enough to hit`).toEqual([]);
    // Nothing (a bark bubble, the HUD) sits on top of a control: the top element at its centre is it.
    const covered = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#settings button, #settings input')]
        .filter((e) => e.checkVisibility())
        .filter((e) => {
          const r = e.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !top || !(top === e || e.contains(top) || top.contains(e));
        })
        .map((e) => e.id || e.textContent),
    );
    expect(covered, `${tab}: no control is covered`).toEqual([]);
    await shot(page, `settings-${tab}`);
  }
  console.log(`settings tabs: ${examined} text elements checked in all`);
  expect(problems).toEqual([]);
});
