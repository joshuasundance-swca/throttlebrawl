import { expect, test, type Page } from '@playwright/test';

// The start tap's biggest cost was `new AudioContext()` (about 400 of the tap's 408 ms of click
// handling on the dev machine, polish K), so the game now makes the context before the tap,
// suspended (audio/index.ts `prepare`, called from app/index.ts once the start screen has painted),
// and the tap only resumes it. A browser behaviour is the point: a context may be made without a
// gesture, but only runs from one.
//
// A spy replaces `AudioContext` before the page's scripts run. It records, for each context made,
// its state at birth and whether it was made inside a click's dispatch, and for each `resume()`
// whether the page's user activation was live. The waits are on state (a context made, a menu
// shown), never on time. A negative control makes a context inside a click on purpose and must be
// seen doing so.

interface SpyLog {
  made: { state: string; inClick: boolean }[];
  resumes: { inClick: boolean; active: boolean; state: string }[];
  states: () => string[];
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __audioSpy?: SpyLog };

async function installSpy(page: Page) {
  await page.addInitScript(() => {
    const w = window as TestWindow;
    w.__GAME_TEST__ = true;
    const Native = window.AudioContext;
    const contexts: AudioContext[] = [];
    const log: SpyLog = { made: [], resumes: [], states: () => contexts.map((c) => c.state) };
    w.__audioSpy = log;
    // A click's dispatch: from the capture phase on the window to the bubble phase on the window.
    let inClick = false;
    window.addEventListener('click', () => (inClick = true), { capture: true });
    window.addEventListener('click', () => (inClick = false));
    class Spy extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.push(this);
        log.made.push({ state: this.state, inClick });
      }
      override resume(): Promise<void> {
        log.resumes.push({ inClick, active: navigator.userActivation.isActive, state: this.state });
        return super.resume();
      }
    }
    window.AudioContext = Spy;
  });
}

const logOf = (page: Page) =>
  page.evaluate(() => {
    const s = (window as TestWindow).__audioSpy;
    return s ? { made: s.made, resumes: s.resumes, states: s.states() } : null;
  });

test('the context is made before the start tap, suspended, and the tap only resumes it', async ({ page }) => {
  await installSpy(page);
  await page.goto('./');
  await expect(page.locator('#start-screen')).toBeVisible();
  // Made by the page itself, with nobody having touched it: one context, outside a click, that
  // nothing has resumed. (Its state at birth is the browser's autoplay policy, so it is logged,
  // not judged; the unit tests hold the suspended-then-running order on a fake context.)
  await page.waitForFunction(() => ((window as TestWindow).__audioSpy?.made.length ?? 0) > 0);
  const before = await logOf(page);
  console.log(`context before the tap: ${JSON.stringify(before?.made)}`);
  expect(before?.made.length).toBe(1);
  expect(before?.made[0]?.inClick).toBe(false);
  expect(before?.resumes, 'nothing resumed it before the tap').toEqual([]);

  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  // The sound starts from the gesture: the context was resumed inside the click, with the page's
  // user activation live, and the tap made no context of its own.
  const after = await logOf(page);
  expect(after?.made.length, 'the tap made no context of its own').toBe(1);
  expect(after?.made.filter((m) => m.inClick)).toEqual([]);
  const inTap = after?.resumes.filter((r) => r.inClick) ?? [];
  expect(inTap.length, 'the context was resumed inside the click').toBeGreaterThan(0);
  expect(
    inTap.every((r) => r.active),
    'with the click as its user activation',
  ).toBe(true);
  console.log(`context after the tap: ${JSON.stringify(after?.states)}`);
});

test('control: the spy sees a context made inside a click', async ({ page }) => {
  await installSpy(page);
  await page.goto('./');
  await page.waitForFunction(() => ((window as TestWindow).__audioSpy?.made.length ?? 0) > 0);
  // A context made by a click handler is recorded as made in the click (the way main made it).
  await page.evaluate(() => {
    window.addEventListener('click', () => void new AudioContext(), { once: true });
    document.body.click();
  });
  const log = await logOf(page);
  expect(log?.made.at(-1)?.inClick).toBe(true);
  expect(log?.made.length).toBe(2);
});
