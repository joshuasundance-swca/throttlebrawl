import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tiltAngleFromEuler } from '../../src/input/devices/tilt.ts';
import { inputDefaults } from '../../src/input/tuning.ts';
import type { SimEvent, SimInput } from '../../src/sim/types.ts';
import { grainShare } from './pixels';

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
  snapshot(): { tick: number; entities: { speed: number }[] } | null;
  setBot(on: boolean): void;
  inputs(from?: number): SimInput[];
  events(): readonly SimEvent[];
  playerId(): number;
  /** The debug file's text: its replay line carries the race's SimConfig header. */
  debugFileText(): string;
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: Handle;
  /** navigator.vibrate's calls, recorded by the stub below. */
  __buzzes?: unknown[];
  /** ui's style pop-up feed (ui-style-popups.spec.ts). */
  __uiStyleFeed?: (pops: { kind: string; points?: number }[]) => void;
  /** The length of every audio buffer started, recorded by the stub below. */
  __plucks?: number[];
  /** app's presentation view, under the test flag (camera shake, the frame divisor). */
  __app?: {
    presentation(): {
      camera: { shake: number };
      display: { frameDivisor: number };
      audio: { busTargets: { voices: number } };
    };
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
    // Record the length of every buffer the page plays, so the radio setting's effect can be heard
    // (audio-radio.spec.ts: a station's plucked strings are 0.6, 0.8, 0.9 or 1.1 s buffers; the
    // score plays only 1 s noise).
    const proto = AudioBufferSourceNode.prototype;
    const start = Object.getOwnPropertyDescriptor(proto, 'start')?.value as (
      this: AudioBufferSourceNode,
      ...args: number[]
    ) => void;
    proto.start = function (this: AudioBufferSourceNode, ...args: number[]) {
      if (this.buffer)
        ((window as TestWindow).__plucks ??= []).push(Math.round(this.buffer.duration * 100) / 100);
      start.apply(this, args);
    };
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

/**
 * The settings that feed SimConfig (the integration round): a race started after the change
 * carries the value in its recording's header (the debug file's replay line), which is what the
 * sim raced with. `region` races in that region first (the Keys have only the standard length).
 */
// Each "into a race" wait checks the app's state too: until the new race starts (a region's road
// files load first), the snapshot is still the quit race's, past tick 60 already (skeptic-pol F4).
async function raceHeaderHas(page: Page, needle: string, region?: string) {
  await page.locator('#settings-back').click();
  if (region) await page.locator(region).click();
  await page.evaluate(() => (window as TestWindow).__game?.setBot(false));
  await page.locator('#menu-race').click();
  await page.waitForFunction(
    () =>
      (window as TestWindow).__game?.state() === 'race' &&
      ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 60,
    undefined,
    {
      timeout: 60_000,
    },
  );
  const text = await page.evaluate(() => (window as TestWindow).__game?.debugFileText() ?? '');
  expect(text, `the race's header carries ${needle}`).toContain(needle);
  await quitRace(page);
}
const raceProbe = (tab: string, id: string, value: string, needle: string, region?: string) => ({
  set: (page: Page) => choose(page, tab, id, value),
  effect: (page: Page) => raceHeaderHas(page, needle, region),
  persisted: (page: Page) => chosen(page, tab, id, value),
});

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

/**
 * From the settings screen into a race the player rides alone: no bot, no touches, no keys, and
 * the phone held level as the race starts (a real sensor keeps reporting; this one reports once, so
 * the race-start tilt calibration sees level and not the previous race's last angle).
 */
async function raceAlone(page: Page) {
  await page.locator('#settings-back').click();
  await page.evaluate(() => {
    (window as TestWindow).__game?.setBot(false);
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 0, gamma: 0 }));
  });
  await page.locator('#menu-race').click();
  await page.waitForFunction(
    () =>
      (window as TestWindow).__game?.state() === 'race' &&
      ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 60,
  );
}
/**
 * The mean luminance change between two canvas screenshots over the rider's own box in the chase
 * framing (47% to 53% of the width, 56% to 78% of the height: the rider's back and the bike, on a
 * 915x412 phone screen), decoded in the page.
 */
function regionDiff(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([a64, b64]) => {
      const read = async (b: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        const x = Math.round(img.width * 0.47);
        const y = Math.round(img.height * 0.56);
        return ctx.getImageData(x, y, Math.round(img.width * 0.06), Math.round(img.height * 0.22)).data;
      };
      const [pa, pb] = [await read(a64 ?? ''), await read(b64 ?? '')];
      const lum = (d: Uint8ClampedArray, i: number) =>
        0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0);
      let sum = 0;
      for (let i = 0; i < pa.length; i += 4) sum += Math.abs(lum(pa, i) - lum(pb, i));
      return sum / (pa.length / 4);
    },
    [a.toString('base64'), b.toString('base64')],
  );
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
      await page.waitForFunction(
        () =>
          (window as TestWindow).__game?.state() === 'race' &&
          ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 60,
      );
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
  look: {
    // Ink + 60s film is the default since run W-O (maintainer, 2026-10-01), so the non-default value
    // is Classic: its flat shading has no film grain in the drawn pixels (ink + 60s film's grain
    // share is over 0.4; render-looks.spec.ts checks every look).
    set: async (page) => {
      await page.locator('#settings-tab-display').click();
      await page.locator('#settings-look [data-value="classic"]').click();
    },
    effect: async (page) => {
      await raceAlone(page);
      const png = await page.locator('canvas#game').screenshot();
      const grain = await grainShare(page, png);
      console.log(`look classic: grain share ${grain.toFixed(3)} (ink + 60s film's is over 0.4)`);
      expect(grain).toBeLessThan(0.15);
      await quitRace(page);
    },
    persisted: async (page) => {
      await page.locator('#settings-tab-display').click();
      await expect(page.locator('#settings-look [data-value="classic"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    },
  },
  stylePopups: {
    // Playtest 1c: off, a style pop-up raised mid-race draws no chip (ui-style-meter.spec.ts has the
    // control: on, the same feed draws one).
    set: async (page) => {
      await page.locator('#settings-tab-display').click();
      await page.locator('#settings-stylePopups').uncheck();
    },
    effect: async (page) => {
      await raceAlone(page);
      const chips = await page.evaluate(async () => {
        (window as TestWindow).__uiStyleFeed?.([{ kind: 'nearMiss', points: 25 }]);
        for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
        return document.querySelectorAll('#style-popups .style-pop').length;
      });
      expect(chips).toBe(0);
      await quitRace(page);
    },
    persisted: async (page) => {
      await page.locator('#settings-tab-display').click();
      await expect(page.locator('#settings-stylePopups')).not.toBeChecked();
    },
  },
  // The race settings (the integration round): each reaches the next race's SimConfig.
  difficulty: raceProbe('race', 'difficulty', 'hard', '"presetId":"hard"'),
  // The Keys have one length, so the probe races the Pacific Northwest's long run.
  raceLength: raceProbe(
    'race',
    'raceLength',
    'long',
    '"lengthId":"long"',
    '#region-region-pnw-pacific-northwest',
  ),
  speedMultiplier: raceProbe('race', 'speedMultiplier', '0.8', '"speedMultiplier":0.8'),
  'assists.steer': raceProbe('race', 'assists-steer', 'light', '"steer":"light"'),
  slowMo: {
    set: async (page) => {
      await page.locator('#settings-tab-race').click();
      await page.locator('#settings-slowMo').uncheck();
    },
    effect: (page) => raceHeaderHas(page, '"slowMo":false'),
    persisted: async (page) => {
      await page.locator('#settings-tab-race').click();
      await expect(page.locator('#settings-slowMo')).not.toBeChecked();
    },
  },
  reduceShake: {
    // The camera is handed no shake at all (camera-2's setShakeAmount 0 has its own unit test).
    set: async (page) => {
      await page.locator('#settings-tab-display').click();
      await page.locator('#settings-reduceShake').check();
    },
    effect: async (page) => {
      await raceAlone(page);
      expect(await page.evaluate(() => (window as TestWindow).__app?.presentation().camera.shake)).toBe(0);
      await quitRace(page);
    },
    persisted: async (page) => {
      await page.locator('#settings-tab-display').click();
      await expect(page.locator('#settings-reduceShake')).toBeChecked();
    },
  },
  frameRateCap: {
    // A third: the loop draws one frame in three.
    set: (page) => choose(page, 'display', 'frameRateCap', 'third'),
    effect: async (page) => {
      await raceAlone(page);
      expect(
        await page.evaluate(() => (window as TestWindow).__app?.presentation().display.frameDivisor),
      ).toBe(3);
      await quitRace(page);
    },
    persisted: (page) => chosen(page, 'display', 'frameRateCap', 'third'),
  },
  view: {
    // The helmet cam: the camera rides at the rider's head, so the rider's own bike and back, at
    // the bottom middle of the chase framing, are gone. Seen in the drawn pixels against the chase
    // view, with the rider standing still on the grid; two helmet frames are the control.
    set: async (page) => {
      await page.locator('#settings-tab-display').click();
      await page.locator('#settings-view [data-value="helmet"]').click();
    },
    effect: async (page) => {
      await raceAlone(page);
      // Hold the brake until the rider stands still (an earlier probe may have left auto-throttle
      // on), so the scene stops moving and only the camera differs between the shots.
      await page.keyboard.down('KeyS');
      await page.waitForFunction(() => {
        const g = (window as TestWindow).__game;
        const me = g?.snapshot()?.entities[g.playerId()];
        return !!me && me.speed < 0.3;
      });
      await page.waitForTimeout(500);
      const helmet = await page.locator('canvas#game').screenshot();
      await page.waitForTimeout(300);
      const helmetAgain = await page.locator('canvas#game').screenshot();
      await page.keyboard.press('Escape');
      await page.locator('#pause-controls').click();
      await page.locator('#settings-tab-display').click();
      await page.locator('#settings-view [data-value="chase"]').click();
      await page.locator('#settings-back').click();
      await page.locator('#pause-resume').click();
      await page.waitForTimeout(600); // the springs settle on the chase framing
      const chase = await page.locator('canvas#game').screenshot();
      mkdirSync('test-results/screenshots', { recursive: true });
      writeFileSync('test-results/screenshots/settings-view-helmet.png', helmetAgain);
      writeFileSync('test-results/screenshots/settings-view-chase.png', chase);
      const control = await regionDiff(page, helmet, helmetAgain);
      const changed = await regionDiff(page, helmetAgain, chase);
      console.log(
        `view helmet: rider-area change ${changed.toFixed(1)} levels (helmet to helmet ${control.toFixed(1)})`,
      );
      expect(changed).toBeGreaterThan(18);
      expect(changed).toBeGreaterThan(control * 2);
      await page.keyboard.up('KeyS');
      // Back to the helmet, so the reload below finds it kept.
      await page.keyboard.press('Escape');
      await page.locator('#pause-controls').click();
      await page.locator('#settings-tab-display').click();
      await page.locator('#settings-view [data-value="helmet"]').click();
      await page.locator('#settings-back').click();
      await page.locator('#pause-quit').click();
      await expect(page.locator('#menu')).toBeVisible();
    },
    persisted: async (page) => {
      await page.locator('#settings-tab-display').click();
      await expect(page.locator('#settings-view [data-value="helmet"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    },
  },
  radio: {
    // A station: the race plays a band's plucked strings, which the score never does.
    set: async (page) => {
      await page.locator('#settings-tab-sound').click();
      await page.locator('#settings-radio [data-value="station"]').click();
    },
    effect: async (page) => {
      await raceAlone(page);
      await page.waitForTimeout(500); // the stations load on first use
      await page.evaluate(() => ((window as TestWindow).__plucks = []));
      await page.waitForTimeout(2000);
      const d = await page.evaluate(() => (window as TestWindow).__plucks ?? []);
      const strings = d.filter((v) => v === 0.6 || v === 0.8 || v === 0.9 || v === 1.1).length;
      console.log(`radio station: ${strings} plucked strings in 2 s (${d.length} buffers in all)`);
      expect(strings).toBeGreaterThan(0);
      await quitRace(page);
    },
    persisted: async (page) => {
      await page.locator('#settings-tab-sound').click();
      await expect(page.locator('#settings-radio [data-value="station"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    },
  },
  voicesOn: {
    // Run W-O: voices off silences the voices bus (audio's own bus target), whatever the slider says.
    set: async (page) => {
      await page.locator('#settings-tab-sound').click();
      await page.locator('#settings-voicesOn').uncheck();
    },
    effect: async (page) => {
      await raceAlone(page);
      const app = () => (window as TestWindow).__app?.presentation().audio.busTargets.voices;
      expect(await page.evaluate(app)).toBe(0);
      await quitRace(page);
    },
    persisted: async (page) => {
      await page.locator('#settings-tab-sound').click();
      await expect(page.locator('#settings-voicesOn')).not.toBeChecked();
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
