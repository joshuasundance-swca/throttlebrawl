import { expect, test, type Page } from '@playwright/test';
import { rideFirstCareerRace } from './career-start';
import { fastForwardDone } from './lockstep';
import { openMenuMore, openQuickPlay } from './menu-navigation';
import type { TestHandle } from '../../src/dev/handle';
import type { SavedRaceEnvelope } from '../../src/app/saved-race';
import type { ReplayFile } from '../../src/replay';

// Each recovery scenario owns its page, storage and API patches. Use the existing two
// CI workers rather than serializing all fourteen cases on one worker.
test.describe.configure({ mode: 'parallel' });

type GameWindow = Window & { __GAME_TEST__?: boolean; __game?: TestHandle };

async function ride(page: Page, career: boolean) {
  await page.goto('./');
  if (career) await rideFirstCareerRace(page);
  else {
    await page.locator('#start-screen').click();
    await openQuickPlay(page);
    await page.locator('#menu-race').click();
    await page.waitForFunction(() => (window as GameWindow).__game?.state() === 'race');
  }
  await page.evaluate(() =>
    (window as GameWindow).__game!.fastForward(
      (snap) => {
        if (snap.tick < 360) return false;
        document.getElementById('hud-pause')!.click();
        return true;
      },
      { perFrame: 60, then: null },
    ),
  );
  await fastForwardDone(page, 'recovery saved boundary');
  await expect(page.locator('#pause-screen')).toBeVisible();
}

async function attempt(page: Page): Promise<SavedRaceEnvelope> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('mbrawl:race')!) as SavedRaceEnvelope);
}

async function replayConfig(page: Page) {
  return page.evaluate(() => {
    const lines = (window as GameWindow).__game!.debugFileText().split('\n');
    const replay = JSON.parse(
      lines[lines.indexOf('===== replay (one line of JSON) =====') + 1]!,
    ) as ReplayFile;
    const c = replay.header.config!;
    return {
      event: c.event,
      bikes: c.riders.map((r) => r.bike.contentId),
      difficulty: c.difficulty,
      tuning: c.tuning,
      options: replay.header.raceOptions,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as GameWindow).__GAME_TEST__ = true;
  });
});

test('missing regional road content offers Retry, retains the attempt and recovers when available', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const roadUrls = new Set<string>();
  page.on('request', (request) => {
    if (request.resourceType() === 'fetch' && new URL(request.url()).pathname.endsWith('.json'))
      roadUrls.add(request.url());
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await openQuickPlay(page);
  await page.locator('#region-region-sf-san-francisco').click();
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => (window as GameWindow).__game?.state() === 'race');
  await page.evaluate(() =>
    (window as GameWindow).__game!.fastForward(
      (s) => {
        if (s.tick < 360) return false;
        document.getElementById('hud-pause')!.click();
        return true;
      },
      { perFrame: 60, then: null },
    ),
  );
  await fastForwardDone(page, 'regional recovery fixture');
  const raw = await page.evaluate(() => localStorage.getItem('mbrawl:race'));
  expect(roadUrls.size).toBeGreaterThan(0);
  let blocked = true;
  let failures = 0;
  await page.route(
    (url) => roadUrls.has(url.href),
    async (route) => {
      if (blocked) {
        failures++;
        await route.abort('failed');
      } else await route.continue();
    },
  );
  await page.reload();
  await page.locator('#resume-race').click();
  // The real loader exhausts its 500/1500/4000 ms backoff before returning the failure.
  // This is a hang guard for the observable choice, not an assertion about elapsed time.
  await expect(page.locator('#resume-race')).toHaveText('Retry', { timeout: 30_000 });
  expect(failures).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBe(raw);
  blocked = false;
  await page.locator('#resume-race').click();
  // Retry must fetch the uncached regional closure before exposing the paused race.
  // Guard the completed recovery outcome rather than assuming a five-second load.
  await expect(page.locator('#pause-screen')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => (window as GameWindow).__game!.snapshot()!.tick)).toBe(360);
});

test('the real recovery choice requests native fullscreen and audio from the user gesture', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await ride(page, false);
  await page.addInitScript(() => {
    const w = window as Window & { __recoveryGestures?: { fullscreen: boolean[]; audio: boolean[] } };
    const calls: NonNullable<typeof w.__recoveryGestures> = { fullscreen: [], audio: [] };
    w.__recoveryGestures = calls;
    let delivering = false;
    const add = Reflect.get<EventTarget, 'addEventListener'>(EventTarget.prototype, 'addEventListener');
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (
        type === 'click' &&
        this instanceof HTMLElement &&
        this.id === 'resume-race' &&
        typeof listener === 'function'
      ) {
        add.call(
          this,
          type,
          function (this: EventTarget, event: Event) {
            delivering = event.isTrusted;
            try {
              listener.call(this, event);
            } finally {
              delivering = false;
            }
          },
          options,
        );
      } else add.call(this, type, listener, options);
    };
    const fullscreen = Reflect.get<Element, 'requestFullscreen'>(Element.prototype, 'requestFullscreen');
    Element.prototype.requestFullscreen = function (options) {
      calls.fullscreen.push(delivering && navigator.userActivation.isActive);
      return fullscreen.call(this, options);
    };
    const resume = Reflect.get<AudioContext, 'resume'>(AudioContext.prototype, 'resume');
    AudioContext.prototype.resume = function () {
      // Fullscreen can consume transient activation. The listener wrapper closes in finally,
      // so an awaited continuation cannot pass by observing sticky hasBeenActive.
      calls.audio.push(delivering);
      return resume.call(this);
    };
  });
  await page.reload();
  await expect(page.locator('#resume-card')).toBeVisible();
  await page.locator('#resume-race').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (window as Window & { __recoveryGestures?: { fullscreen: boolean[]; audio: boolean[] } })
        .__recoveryGestures!,
  );
  expect(calls.fullscreen).toContain(true);
  expect(calls.audio).toContain(true);
});

for (const career of [false, true]) {
  test(`${career ? 'career' : 'Quick Play'} reload offers the original attempt and resumes it paused`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await ride(page, career);
    const before = await page.evaluate(() => ({
      tick: (window as GameWindow).__game!.snapshot()!.tick,
      race: localStorage.getItem('mbrawl:race'),
      profile: localStorage.getItem('mbrawl:profile'),
    }));
    expect(before.race).not.toBeNull();
    const saved = JSON.parse(before.race!) as {
      phase: string;
      recording: { inputs: { ticks: number } };
      context: { kind: string };
    };
    expect(saved.phase).toBe('riding');
    expect(saved.recording.inputs.ticks).toBe(before.tick);
    expect(saved.context.kind).toBe(career ? 'career' : 'quick');
    await page.reload();
    await expect(page.locator('#resume-card')).toBeVisible();
    await expect(page.locator('#resume-race')).toHaveText('Resume race');
    // Keyboard input and the ordinary Start handler cannot dismiss the recovery choice.
    await page.keyboard.press('Enter');
    await page.evaluate(() => (window as GameWindow).__game!.tap());
    // The ordinary pointer Start handler is guarded too; dispatch does not force through an overlay.
    await page.locator('#start-screen').dispatchEvent('click');
    expect(await page.evaluate(() => (window as GameWindow).__game!.state())).toBe('tapToStart');
    await expect(page.locator('#resume-card')).toBeVisible();
    await page.locator('#resume-race').click();
    await expect(page.locator('#pause-screen')).toBeVisible();
    expect(await page.evaluate(() => (window as GameWindow).__game!.snapshot()!.tick)).toBe(before.tick);
    expect(await page.evaluate(() => localStorage.getItem('mbrawl:profile'))).toBe(before.profile);
    await expect(page.locator('#hud-objective')).toBeVisible();
  });
}

test('periodic and pagehide saves continue with hashes verified against a fresh replay control', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('./');
  await page.locator('#start-screen').click();
  await openQuickPlay(page);
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => (window as GameWindow).__game?.state() === 'race');
  await page.evaluate(() =>
    (window as GameWindow).__game!.fastForward(
      (snap) => {
        if (snap.tick < 360) return false;
        const saved = JSON.parse(localStorage.getItem('mbrawl:race')!) as SavedRaceEnvelope;
        if (saved.recording.inputs.ticks !== 300)
          throw new Error('Periodic save must precede lifecycle flush');
        // Dispatch inside the exact sim-step callback: zero lockstep means real time, not a freeze.
        window.dispatchEvent(new PageTransitionEvent('pagehide'));
        return true;
      },
      { perFrame: 60, then: null },
    ),
  );
  await fastForwardDone(page, 'periodic then pagehide boundary');
  expect(await page.evaluate(() => (window as GameWindow).__game!.snapshot()!.tick)).toBe(360);
  await expect(page.locator('#pause-screen')).toBeVisible();
  const hidden = await attempt(page);
  expect(hidden.recording.inputs.ticks).toBe(360);
  await page.reload();
  await page.locator('#resume-race').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.down('w');
  await page.evaluate(() =>
    (window as GameWindow).__game!.fastForward(
      (snap) => {
        if (snap.tick < 480) return false;
        document.getElementById('hud-pause')!.click();
        return true;
      },
      { perFrame: 60, then: null },
    ),
  );
  await fastForwardDone(page, 'continued recovered race');
  await page.keyboard.up('w');
  const continued = await attempt(page);
  expect(continued.recording.inputs.ticks).toBe(480);
  expect(continued.recording.header).toEqual(hidden.recording.header);
  expect(continued.recording.hashes.slice(0, hidden.recording.hashes.length)).toEqual(
    hidden.recording.hashes,
  );
  const controls = await page.evaluate((saved) => {
    const g = (window as GameWindow).__game!;
    const lines = g.debugFileText().split('\n');
    const at = lines.indexOf('===== replay (one line of JSON) =====') + 1;
    const check = (hash: number) => {
      lines[at] = JSON.stringify({
        ...saved.recording,
        end: { tick: saved.recording.inputs.ticks - 1, hash },
      });
      return g.checkDebugFile(lines.join('\n'));
    };
    return { matching: check(saved.savedHash), tampered: check((saved.savedHash ^ 1) >>> 0) };
  }, continued);
  expect(controls.matching.keyMatches).toBe(true);
  expect(controls.matching.desync).toBeNull();
  expect(controls.matching.ticks).toBe(480);
  expect(controls.tampered.desync).not.toBeNull();
});

for (const changed of ['route', 'settings', 'hash'] as const) {
  test(`changed saved ${changed} retains evidence and renders an unavailable choice`, async ({ page }) => {
    test.setTimeout(90_000);
    await ride(page, false);
    const raw = await page.evaluate((field) => {
      const saved = JSON.parse(localStorage.getItem('mbrawl:race')!) as SavedRaceEnvelope;
      if (saved.context.kind !== 'quick') throw new Error('Expected Quick Play context');
      if (field === 'route') saved.context.route = 'base:unavailable-route';
      else if (field === 'settings') saved.context.settings.difficulty = 'hard';
      else saved.savedHash = (saved.savedHash ^ 1) >>> 0;
      const text = JSON.stringify(saved);
      localStorage.setItem('mbrawl:race', text);
      return text;
    }, changed);
    await page.reload();
    await page.locator('#resume-race').click();
    await expect(page.locator('#resume-card')).toContainText('Saved race unavailable');
    await expect(page.locator('#resume-race')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBe(raw);
    await page.locator('#resume-start-over').click();
    await expect(page.locator('#menu')).toBeVisible();
  });
}

test('recovered nondefault Quick Play options survive Retry and measurement cannot flush its old recorder', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    // Headless Chromium refuses a physical wake request. Supply the observable public API
    // capability for this ownership/isolation test; this does not certify native phone wake.
    const w = window as Window & { __measurementWakeRequests?: number; __measurementWakeRefuse?: boolean };
    w.__measurementWakeRequests = 0;
    class Sentinel extends EventTarget {
      released = false;
      release() {
        if (!this.released) {
          this.released = true;
          this.dispatchEvent(new Event('release'));
        }
        return Promise.resolve();
      }
    }
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: (type: string) => {
          if (type !== 'screen') throw new Error('Expected screen wake request');
          w.__measurementWakeRequests = (w.__measurementWakeRequests ?? 0) + 1;
          if (w.__measurementWakeRefuse)
            return Promise.reject(new DOMException('Wake refusal fixture', 'NotAllowedError'));
          return Promise.resolve(new Sentinel());
        },
      },
    });
    if (!localStorage.getItem('mbrawl:settings'))
      localStorage.setItem(
        'mbrawl:settings',
        JSON.stringify({
          format: 'settings',
          version: 1,
          data: { throttle: 'auto', assists: { steer: 'strong' }, difficulty: 'easy' },
        }),
      );
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await openQuickPlay(page);
  await page.locator('#region-region-sf-san-francisco').click();
  await page.locator('#route-region-sf-osm-sf-twin-peaks-run').click();
  await expect(page.locator('#route-region-sf-osm-sf-twin-peaks-run')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.locator('#menu-options').click();
  // Race permits a selected road; Hunt and Grudge deliberately stay on their own roads.
  await expect(page.locator('#race-option-kind')).toHaveAttribute('data-value', 'race');
  await page.locator('#race-option-cops-next').click();
  await page.locator('#race-option-bike-next').click();
  await page.locator('#race-option-field-next').click();
  await page.locator('#race-options-race').click();
  await page.waitForFunction(() => (window as GameWindow).__game?.state() === 'race');
  await page.evaluate(() =>
    (window as GameWindow).__game!.fastForward((s) => s.tick >= 360, { perFrame: 60, then: 0 }),
  );
  await fastForwardDone(page, 'nondefault Quick Play');
  await page.keyboard.press('Escape');
  const first = await replayConfig(page);
  expect(first.event.routeId).toBe('region-sf:osm-sf-twin-peaks-run');
  expect((await attempt(page)).context).toMatchObject({
    kind: 'quick',
    route: 'region-sf:osm-sf-twin-peaks-run',
  });
  const profile = await page.evaluate(() => localStorage.getItem('mbrawl:profile'));
  await page.reload();
  await page.locator('#resume-race').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  expect(await replayConfig(page)).toEqual(first);
  await expect(page.locator('#region-region-sf-san-francisco')).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => (window as GameWindow).__game!.setBot(true));
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    (window as GameWindow).__game!.fastForward((s) => s.race.over, { perFrame: 240, then: 120 }),
  );
  await fastForwardDone(page, 'recovered Quick Play finish');
  await expect(page.locator('#results')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:profile'))).toBe(profile);
  await page.locator('#results-race').click();
  await page.waitForFunction(() => (window as GameWindow).__game?.state() === 'race');
  expect(await replayConfig(page)).toEqual(first);
  await page.evaluate(() =>
    (window as GameWindow).__game!.fastForward((s) => s.race.over, { perFrame: 240, then: 120 }),
  );
  await fastForwardDone(page, 'retried Quick Play finish');
  await expect(page.locator('#results')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:profile'))).toBe(profile);
  await page.locator('#results-menu').click();
  await expect(page.locator('#region-region-sf-san-francisco')).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => (window as GameWindow).__game!.lockstep(null));
  const before = await page.evaluate(() => ({
    race: localStorage.getItem('mbrawl:race'),
    profile: localStorage.getItem('mbrawl:profile'),
    settings: localStorage.getItem('mbrawl:settings'),
    recording: (window as GameWindow)
      .__game!.debugFileText()
      .split('\n')
      .find((_line, i, lines) => lines[i - 1] === '===== replay (one line of JSON) ====='),
  }));
  expect(before.race).toBeNull();
  await openMenuMore(page);
  await page.locator('#menu-measure-frames').click();
  const wakeRequests = await page.evaluate(
    () => (window as Window & { __measurementWakeRequests?: number }).__measurementWakeRequests!,
  );
  await page.locator('#measurement-start').click();
  await expect(page.locator('#measurement-status')).toContainText('Partial/running');
  expect(
    await page.evaluate(
      () => (window as Window & { __measurementWakeRequests?: number }).__measurementWakeRequests!,
    ),
  ).toBeGreaterThan(wakeRequests);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.locator('#measurement-status')).toContainText('Ended:');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  const after = await page.evaluate(() => ({
    race: localStorage.getItem('mbrawl:race'),
    profile: localStorage.getItem('mbrawl:profile'),
    settings: localStorage.getItem('mbrawl:settings'),
    recording: (window as GameWindow)
      .__game!.debugFileText()
      .split('\n')
      .find((_line, i, lines) => lines[i - 1] === '===== replay (one line of JSON) ====='),
  }));
  expect(after).toEqual(before);
  await expect(page.locator('#resume-card')).toBeHidden();
  await page.locator('#measurement-close').click();
  await expect(page.locator('#menu')).toBeVisible();
  // A refused native capability must leave the same ordinary recording and storage intact too.
  await page.evaluate(() => {
    (window as Window & { __measurementWakeRefuse?: boolean }).__measurementWakeRefuse = true;
  });
  await page.locator('#menu-measure-frames').click();
  await page.locator('#measurement-start').click();
  await expect(page.locator('#measurement-status')).toContainText('wake-refused');
  const refused = await page.evaluate(() => ({
    race: localStorage.getItem('mbrawl:race'),
    profile: localStorage.getItem('mbrawl:profile'),
    settings: localStorage.getItem('mbrawl:settings'),
    recording: (window as GameWindow)
      .__game!.debugFileText()
      .split('\n')
      .find((_line, i, lines) => lines[i - 1] === '===== replay (one line of JSON) ====='),
  }));
  expect(refused).toEqual(before);
  expect(await page.evaluate(() => (window as GameWindow).__game!.state())).toBe('menu');
  await page.locator('#measurement-close').click();
});

test('Start over clears the classified attempt and leaves a usable menu', async ({ page }) => {
  test.setTimeout(90_000);
  await ride(page, false);
  await page.reload();
  await expect(page.locator('#resume-card')).toBeVisible();
  await page.locator('#resume-start-over').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBeNull();
  await openQuickPlay(page);
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => (window as GameWindow).__game?.state() === 'race');
});

test('incompatible text is retained with no Resume and can be explicitly discarded', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mbrawl:race', '{broken-attempt');
  });
  await page.goto('./');
  await expect(page.locator('#resume-card')).toBeVisible();
  await expect(page.locator('#resume-race')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBe('{broken-attempt');
  await page.locator('#resume-start-over').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBeNull();
});

test('a failed career award stays frozen, survives reload and pays once when recovered', async ({ page }) => {
  test.setTimeout(180_000);
  await ride(page, true);
  const original = await page.evaluate(() => localStorage.getItem('mbrawl:profile')!);
  await page.evaluate(() => {
    const set = Reflect.get<Storage, 'setItem'>(Storage.prototype, 'setItem');
    Storage.prototype.setItem = function (key, value) {
      if (key === 'mbrawl:profile') throw new DOMException('Quota fixture', 'QuotaExceededError');
      set.call(this, key, value);
    };
    (window as GameWindow).__game!.setBot(true);
  });
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    (window as GameWindow).__game!.fastForward((snap) => snap.race.over, { perFrame: 240, then: 120 }),
  );
  await fastForwardDone(page, 'waiting career award');
  await expect(page.locator('#resume-card')).toBeVisible();
  await expect(page.locator('#resume-race')).toHaveText('Retry saving result');
  const pendingRaw = await page.evaluate(() => localStorage.getItem('mbrawl:race')!);
  const pending = JSON.parse(pendingRaw) as {
    phase: string;
    result: { build: string; at: string };
    recording: { inputs: { ticks: number } };
  };
  expect(pending.phase).toBe('pending-result');
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:profile'))).toBe(original);
  await page.locator('#resume-race').click();
  await expect(page.locator('#resume-race')).toHaveText('Retry saving result');
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:profile'))).toBe(original);
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBe(pendingRaw);
  // Reload restores healthy storage, rather than trusting the poisoned ProfileStore's memory.
  await page.reload();
  await expect(page.locator('#resume-race')).toHaveText('Recover results');
  await page.locator('#resume-race').click();
  await expect(page.locator('#career-results')).toBeVisible();
  const after = await page.evaluate(() => ({
    profile: localStorage.getItem('mbrawl:profile')!,
    race: localStorage.getItem('mbrawl:race'),
    tick: (window as GameWindow).__game!.snapshot()!.tick,
  }));
  expect(after.tick).toBe(pending.recording.inputs.ticks);
  expect(after.race).toBeNull();
  const starting = JSON.parse(original) as { data: { history: unknown[] } };
  const saved = JSON.parse(after.profile) as { data: { history: { build: string; at: string }[] } };
  expect(saved.data.history.length).toBe(starting.data.history.length + 1);
  expect(saved.data.history.at(-1)).toMatchObject(pending.result);
});

test('failed removal keeps a usable discard choice and never silently starts another race', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await ride(page, false);
  const saved = await page.evaluate(() => localStorage.getItem('mbrawl:race'));
  await page.addInitScript(() => {
    const w = window as Window & { __allowRaceRemoval?: boolean };
    const remove = Reflect.get<Storage, 'removeItem'>(Storage.prototype, 'removeItem');
    Storage.prototype.removeItem = function (key) {
      if (key === 'mbrawl:race' && !w.__allowRaceRemoval) return;
      remove.call(this, key);
    };
  });
  await page.reload();
  await expect(page.locator('#resume-card')).toBeVisible();
  await page.locator('#resume-start-over').click();
  await expect(page.locator('#resume-card')).toBeVisible();
  await expect(page.locator('#resume-race')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBe(saved);
  await page.evaluate(() => {
    (window as Window & { __allowRaceRemoval?: boolean }).__allowRaceRemoval = true;
  });
  await page.locator('#resume-start-over').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mbrawl:race'))).toBeNull();
});

test('blocked race storage still allows playing and quitting without deleting unknown data', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const get = Reflect.get<Storage, 'getItem'>(Storage.prototype, 'getItem');
    localStorage.setItem('mbrawl:race', 'unknown-existing-attempt');
    const w = window as Window & { __allowRaceRead?: boolean };
    Storage.prototype.getItem = function (key) {
      if (key === 'mbrawl:race' && !w.__allowRaceRead) throw new Error('Blocked race storage fixture');
      return get.call(this, key);
    };
  });
  await ride(page, false);
  await page.locator('#pause-quit').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(
    await page.evaluate(() => {
      (window as Window & { __allowRaceRead?: boolean }).__allowRaceRead = true;
      return localStorage.getItem('mbrawl:race');
    }),
  ).toBe('unknown-existing-attempt');
});
