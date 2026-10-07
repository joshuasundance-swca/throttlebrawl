// Unchanged transient-card checks split by workload; shared paint and setup live beside this spec.
import { expect, test } from '@playwright/test';
import { frames } from './lockstep';
import {
  installTransientCards,
  SIZES,
  TEXT_SIZES,
  paint,
  scrollRoom,
  scrollTo,
  expectReachable,
  leaveFullscreen,
  checkFit,
  checkBuildId,
  setTextSize,
  regionChip,
  SF_MAPS,
  KEYS_MAPS,
  linesSaying,
  toMenu,
  buildIdFindings,
  inViewFindings,
} from './ui-transient-cards-helpers';

installTransientCards();

test('the build id remains findable when a normal-text menu starts scrolling after a resize', async ({
  page,
}) => {
  await toMenu(page);
  await expect(page.locator('#route-own')).toBeVisible({ timeout: 30_000 });
  await setTextSize(page, 'normal');
  await page.locator('#menu-options').click();
  await page.locator('#race-options-back').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await leaveFullscreen(page);
  await page.setViewportSize({ width: 915, height: 412 });
  const before = await paint(page, '#menu', []);
  expect(await scrollRoom(page, '#menu'), 'the first size fits without a fallback line').toBeLessThanOrEqual(
    1,
  );
  await expect(page.locator('#menu-build-line')).toBeHidden();
  expect(
    buildIdFindings(
      before.buildIds,
      before.things.filter((t) => !t.inFooter),
      SIZES[0],
    ),
  ).toEqual([]);

  // The first normal-text transition from a fitting menu to an overflowing one: the resize queues
  // keepFooterClear, which can show the fallback after the check has started (the full-suite failure
  // at 854x480). The same check must find the actual painted id after scrolling that fallback to view.
  await checkBuildId(page, 'normal menu starting to scroll', [SIZES[1]]);
  expect(await scrollRoom(page, '#menu'), 'the resized menu needs the fallback').toBeGreaterThan(1);
  await expect(page.locator('#menu-build-line')).toBeVisible();
});

test('the did-not-load card says what failed, goes with its screen and a busy line, and the menu still says why', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await toMenu(page);
  const sf = regionChip(page, 'San Francisco');
  const keys = regionChip(page, 'Keys');
  const card = page.locator('#load-retry');
  const words = page.locator('#load-retry .reload-offer-text');
  const retry = page.locator('#load-retry-button');
  const note = page.locator('#route-note');

  // A dropped connection says to check the connection, and Retry is on. While the roads load, the
  // route row's place says so.
  await page.route(SF_MAPS, (route) => route.abort('internetdisconnected'));
  await sf.click();
  await expect(note).toHaveText('Loading San Francisco…');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(words).toHaveText('San Francisco did not load. Check the connection, then tap Retry.');
  await expect(retry).toBeEnabled();
  await expect(retry).toHaveText('Retry');
  // It sits first in the menu's column, above the title, not over it; the card says it, so the
  // route row's word steps aside.
  const first = await page.evaluate(
    () => document.querySelector('#menu .menu-main')?.firstElementChild?.id ?? '',
  );
  expect(first).toBe('load-retry');
  await expect(note).toBeHidden();

  // Race runs the load again under a busy "Loading San Francisco" line: the card is not left beside it,
  // and comes back when the load fails again.
  await page.locator('#menu-race').click();
  await expect(page.locator('#busy')).toBeVisible();
  await expect(card).toBeHidden();
  // One place says it, once (polish batch I's check, note-915: the route row's dimmed word drew through
  // the busy line, so "Loading San Francisco" showed doubled): the word steps aside under the line.
  await expect(note).toBeHidden();
  expect(await linesSaying(page, /Loading San Francisco/), 'the busy line says it once').toBe(1);
  // Negative control 7: the doubled state as it was, planted (the busy line and the word under it, both
  // saying it); the same count says twice. Planted, not waited for: the load may end at any moment.
  expect(
    await linesSaying(page, /Loading San Francisco/, 'Loading San Francisco…'),
    'control: the word drawn too',
  ).toBe(2);
  await expect(page.locator('#busy')).toBeHidden({ timeout: 60_000 });
  await expect(card).toBeVisible();
  // The control does not lean on the busy line still being up (the CI flake), and puts everything back.
  expect(
    await linesSaying(page, /Loading San Francisco/, 'Loading San Francisco…'),
    'control: planted after the load ended',
  ).toBe(2);
  expect(await linesSaying(page, /Loading San Francisco/), 'the planting was put back').toBe(0);

  // The card belongs to the menu: the career does not carry it, and coming back does not bring it
  // back. The menu still says why there is no route row (polish batch E's check, punch item 1).
  await page.locator('#menu-career').click();
  await expect(page.locator('#career')).toBeVisible();
  await expect(card).toBeHidden();
  await expect(page.locator('#career-tab-map')).toBeVisible();
  await page.locator('#career-back').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await expect(card).toBeHidden();
  await expect(sf).toHaveAttribute('aria-checked', 'true');
  await expect(note).toBeVisible();
  await expect(note).toHaveText(
    'San Francisco did not load. Check the connection, then tap Race to try again.',
  );
  // The same after the settings and the race options.
  for (const [open, back] of [
    ['#menu-settings', '#settings-back'],
    ['#menu-options', '#race-options-back'],
  ] as const) {
    await page.locator(open).click();
    await page.locator(back).click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await expect(note, `back from ${open}`).toBeVisible();
  }
  // Control: a region whose roads are in has its route row and no word.
  await keys.click();
  await expect(note).toBeHidden();
  await expect(card, 'a new pick takes the card down').toBeHidden();
  await page.unroute(SF_MAPS);
});

test('the host asked for a wait: every load path waits it out, with the same countdown, and never asks', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await toMenu(page);
  const sf = regionChip(page, 'San Francisco');
  const keys = regionChip(page, 'Keys');
  const card = page.locator('#load-retry');
  const words = page.locator('#load-retry .reload-offer-text');
  const retry = page.locator('#load-retry-button');

  // The host answers 429 and asks for 30 s, over the loader's 8 s cap: the loader gives up at once,
  // and the card says the game server had a problem, with Retry off and showing the wait.
  let asked = 0;
  await page.route(SF_MAPS, (route) => {
    asked++;
    return route.fulfill({ status: 429, headers: { 'Retry-After': '30' }, body: 'busy' });
  });
  await sf.click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(words).toHaveText(
    'San Francisco did not load: the game server had a problem. Try again shortly.',
  );
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveText(/^Retry in (30|29|28|27|26|25) s$/);
  const askedAtCard = asked;
  expect(askedAtCard, 'the pick asked the host').toBeGreaterThan(0);
  await retry.click({ force: true });
  await frames(page, 4);
  expect(asked, 'a tap on Retry during the wait asks the host nothing').toBe(askedAtCard);

  // Polish batch I's check, punch 4: off the menu and back, the card has gone with its screen and the
  // route row's word says the time left, the card's own seconds (read in one step, so one tick).
  await page.locator('#menu-settings').click();
  await page.locator('#settings-back').click();
  const word = page.locator('#route-note');
  await expect(word).toBeVisible();
  await expect(word).toHaveText(
    /^San Francisco did not load: the game server had a problem\. Tap Race to try again in \d+ s\.$/,
  );
  const seconds = await page.evaluate(() => ({
    word: /in (\d+) s/.exec(document.getElementById('route-note')?.textContent ?? '')?.[1] ?? 'none',
    button: /in (\d+) s/.exec(document.getElementById('load-retry-button')?.textContent ?? '')?.[1] ?? 'none',
  }));
  expect(seconds.word, 'the word counts the same seconds as the card').toBe(seconds.button);
  expect(Number(seconds.word)).toBeGreaterThan(0);
  expect(Number(seconds.word)).toBeLessThanOrEqual(30);

  // Polish batch E's check, punch item 2: a new pick and a Race tap asked for every file at once. Now
  // the wait is the loader's: each says the same wait at once, and the host is not asked.
  await keys.click();
  await expect(card, 'a new pick takes the card down').toBeHidden();
  await sf.click();
  await expect(card).toBeVisible();
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveText(/^Retry in (30|29|28|27|26|25|24|23|22|21|20) s$/);
  expect(asked, 'a new pick during the wait asks the host nothing').toBe(askedAtCard);
  await page.locator('#menu-race').click();
  await expect(page.locator('#busy')).toBeHidden({ timeout: 30_000 });
  await expect(card).toBeVisible();
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveText(/^Retry in \d+ s$/);
  expect(asked, 'a Race tap during the wait asks the host nothing').toBe(askedAtCard);
  await page.unroute(SF_MAPS);
});

test("a 404 says this build's files are gone and offers Reload, not Retry", async ({ page }) => {
  test.setTimeout(120_000);
  await toMenu(page);
  const card = page.locator('#load-retry');
  const button = page.locator('#load-retry-button');
  let asked = 0;
  await page.route(SF_MAPS, (route) => {
    asked++;
    return route.fulfill({ status: 404, body: 'gone' });
  });
  await regionChip(page, 'San Francisco').click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#load-retry .reload-offer-text')).toHaveText(
    "San Francisco did not load: this build's files are gone, most likely because a newer build replaced them. Reload for the newest build.",
  );
  await expect(button).toHaveText('Reload');
  await expect(button).toBeEnabled();
  // Off the menu and back, the route row's place says the same.
  await page.locator('#menu-settings').click();
  await page.locator('#settings-back').click();
  await expect(page.locator('#route-note')).toHaveText(
    "San Francisco did not load: this build's files are gone. Reload the game for the newest build.",
  );
  // The word has the Reload action beside it (polish batch I's check, punch 4), not only advice.
  await expect(page.locator('#route-note-action')).toBeVisible();
  await expect(page.locator('#route-note-action')).toHaveText('Reload');
  // Race asks again and brings the card back; its Reload reloads the page.
  await page.locator('#menu-race').click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  expect(asked, 'the host was asked (the pick, then Race)').toBeGreaterThan(0);
  await Promise.all([page.waitForEvent('load'), button.click()]);
  await expect(page.locator('#start-screen')).toBeVisible();
  await page.unroute(SF_MAPS);
});

test('a failed career ride raises the did-not-load card in view, on a career scrolled down to the event', async ({
  page,
}) => {
  test.setTimeout(180_000);
  // Polish batch E's check, mustFix 1, step for step: the Keys' real roads fail from the first load,
  // Start career, the suggested event, Ride. The card came up 420 to 590 px above the screen's top.
  await page.route(KEYS_MAPS, (route) => route.fulfill({ status: 503, body: 'down' }));
  await toMenu(page);
  const card = page.locator('#load-retry');
  // The boot load's card is on the menu first (it waits for the menu); the career does not carry it.
  await expect(card).toBeVisible({ timeout: 60_000 });
  await page.locator('#menu-career').click();
  await expect(page.locator('#career')).toBeVisible();
  await expect(card).toBeHidden();
  for (const size of [
    { width: 915, height: 412 },
    { width: 568, height: 320 },
  ]) {
    await leaveFullscreen(page);
    await page.setViewportSize(size);
    await page.locator('.career-node.suggested').click();
    await expect(page.locator('#career-ride')).toBeEnabled();
    const room = await scrollRoom(page, '#career');
    await scrollTo(page, '#career', room);
    const scrolled = await page.evaluate(() => document.getElementById('career')?.scrollTop ?? 0);
    // The precondition the check needs: the screen is scrolled down when the ride fails.
    expect(
      scrolled,
      `${size.width}x${size.height}: the career is scrolled down to the event`,
    ).toBeGreaterThan(100);
    await page.locator('#career-ride').click();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#load-retry .reload-offer-text')).toHaveText(
      'The Keys did not load: the game server had a problem. Try again shortly.',
    );
    const p = await paint(page, '#career', ['load-retry']);
    const box = p.cards[0]?.box ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const found = inViewFindings('load-retry', box, size);
    console.log(
      `career ride at ${size.width}x${size.height}: from scrollTop ${scrolled}, card ${JSON.stringify(box)}; findings ${JSON.stringify(found)}`,
    );
    expect(found, `${size.width}x${size.height}: the card is in view`).toEqual([]);
    // Retry is there to tap, where it is drawn.
    await expectReachable(page, [], ['#load-retry button'], `career ride at ${size.width}x${size.height}`);
  }
  await page.unroute(KEYS_MAPS);
});

test('the boot notice (settings from a newer build) is carried to the menu a quick start tap opens', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const record = {
      format: 'settings',
      version: 99,
      build: 'later',
      savedAt: '2026-10-06T00:00:00.000Z',
      data: {},
    };
    localStorage.setItem('mbrawl:settings', JSON.stringify(record));
  });
  await page.goto('./');
  const notice = page.locator('#ui-notice');
  const words = 'Settings come from a newer build; using defaults and keeping them untouched.';
  await expect(notice).toHaveText(words);
  // The tap at once, well inside the notice's 4 s: the menu says it (polish batch E's check, punch
  // item 4: it went with the start screen and was never said again).
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(words);
  expect(
    await page.evaluate(() =>
      document.querySelector('#menu .menu-main')?.contains(document.getElementById('ui-notice')),
    ),
    'first in the menu column',
  ).toBe(true);
});

test("the route row's Reload and its wait fit every size and Text size, and a tap on Reload reloads", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await toMenu(page);
  const card = page.locator('#load-retry');
  await page.route(SF_MAPS, (route) => route.fulfill({ status: 404, body: 'gone' }));
  await regionChip(page, 'San Francisco').click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  for (const textSize of TEXT_SIZES) {
    await leaveFullscreen(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#menu-settings').click();
    await page.locator('#settings-tab-access').click();
    const pick = page.locator(`#settings-textSize [data-value="${textSize}"]`);
    await pick.click();
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#settings-back').click();
    const action = page.locator('#route-note-action');
    await expect(action, `the Reload beside the word, ${textSize}`).toBeVisible();
    // The word and its button fit every phone size at every scroll, are hit where drawn, and the
    // build id is on the menu with them there.
    await checkFit(page, '#menu', `menu with the route Reload, ${textSize}`);
    await checkBuildId(page, `menu with the route Reload, ${textSize}`);
    for (const size of SIZES) {
      await leaveFullscreen(page);
      await page.setViewportSize({ width: size.width, height: size.height });
      await expectReachable(
        page,
        ['#route-note-action', '#menu-race'],
        [],
        `menu with the route Reload, ${textSize} at ${size.name}`,
      );
      const across = await page.evaluate(() => {
        const r = document.getElementById('route-note-action')?.getBoundingClientRect();
        return !!r && r.left >= -0.5 && r.right <= window.innerWidth + 0.5;
      });
      expect.soft(across, `${textSize}, ${size.name}: the button is across the screen`).toBe(true);
    }
  }
  // A tap on the word's Reload reloads the page, for the newest build. It comes before the wait below: in
  // the host's wait the loader asks the host nothing (platform/retry-fetch.ts, its hold), so a 404 sent
  // inside the wait never reaches the page and no Reload can come up (trains 426 to 435 ran the test out
  // here). The reload ends the hold, so the wait is checked on the fresh page, with no wait for the clock.
  const action = page.locator('#route-note-action');
  await leaveFullscreen(page);
  await page.setViewportSize({ width: 915, height: 412 });
  await expect(action, 'the Reload beside the word, before the tap').toBeVisible();
  // A plain DOM scroll, as in checkBuildId: train 406 printed this test's last build-id line and then ran
  // the slice out of its job here (the keeper, 2026-10-07; not reproduced locally). The click below still
  // waits for the button to be actionable, with a bound, as does the wait for the load.
  await action.evaluate((e) => e.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  // The wait's answer is set before the reload, so the fresh page's own load of San Francisco (if the
  // pick is kept) meets it too.
  await page.unroute(SF_MAPS);
  await page.route(SF_MAPS, (route) =>
    route.fulfill({ status: 429, headers: { 'Retry-After': '30' }, body: 'busy' }),
  );
  await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), action.click({ timeout: 10_000 })]);
  await expect(page.locator('#start-screen')).toBeVisible();

  // The wait too, at the largest Text size (the last of the loop, kept by the reload): the longest word
  // the row says.
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await regionChip(page, 'Keys').click();
  await regionChip(page, 'San Francisco').click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await page.locator('#menu-settings').click();
  await page.locator('#settings-back').click();
  await expect(page.locator('#route-note')).toHaveText(/ Tap Race to try again in \d+ s\.$/);
  await expect(action, 'a 429 offers no Reload').toBeHidden();
  expect(
    await page.evaluate(() => document.getElementById('ui')?.dataset['text'] ?? ''),
    'the reload kept the largest Text size',
  ).toBe('largest');
  // Control: the old order. A 404 sent inside the wait never reaches the page, so the row offers no
  // Reload; that is why the tap above comes first. The product is right not to: the hold is the host's
  // own ask not to be asked, and only an answer can say the files are gone.
  let asked = 0;
  await page.unroute(SF_MAPS);
  await page.route(SF_MAPS, (route) => {
    asked++;
    return route.fulfill({ status: 404, body: 'gone' });
  });
  await regionChip(page, 'Keys').click();
  await regionChip(page, 'San Francisco').click();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#load-retry .reload-offer-text')).toHaveText(/the game server had a problem/);
  await page.locator('#menu-settings').click();
  await page.locator('#settings-back').click();
  await expect(page.locator('#route-note')).toHaveText(/ Tap Race to try again in \d+ s\.$/);
  await expect(action, 'control: a 404 inside the wait offers no Reload').toBeHidden();
  expect(asked, 'control: inside the wait the host is not asked').toBe(0);
  await checkFit(page, '#menu', 'menu with the route wait, largest');
  await checkBuildId(page, 'menu with the route wait, largest');
  await page.unroute(SF_MAPS);
});
