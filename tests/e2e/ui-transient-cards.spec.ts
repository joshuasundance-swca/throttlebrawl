// Unchanged transient-card checks split by workload; shared paint and setup live beside this spec.
import { expect, test } from '@playwright/test';
import {
  installTransientCards,
  type TestWindow,
  TEXT_SIZES,
  flowCardsOn,
  paint,
  judge,
  fit,
  scrollRoom,
  scrollTo,
  leaveFullscreen,
  raise,
  checkFit,
  checkBuildId,
  checkScreen,
  checkRace,
  setTextSize,
  rideToTheEnd,
  buildIdFindings,
  inViewFindings,
} from './ui-transient-cards-helpers';

installTransientCards();

for (const textSize of TEXT_SIZES) {
  test(`no transient card covers anything on any screen it can appear on, at Text size ${textSize}`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    // The Text size is saved first, so the start screen after a reload draws at it.
    await page.goto('./?settings=all');
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await setTextSize(page, textSize);
    await page.reload();

    // The start screen: a notice (a save that could not be read) sits in its flow.
    await expect(page.locator('#start-screen')).toBeVisible();
    await raise(page, flowCardsOn('start'));
    await checkScreen(page, '#start-screen', flowCardsOn('start'), [], `start, ${textSize}`);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#start-screen .title').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    // A notice on the start screen is carried to the menu the tap opens (polish batch E, punch 4), and
    // sits first in the menu's column.
    await expect(page.locator('#ui-notice'), 'the notice is carried to the menu').toBeVisible();
    expect(
      await page.evaluate(() =>
        document.querySelector('#menu .menu-main')?.contains(document.getElementById('ui-notice')),
      ),
    ).toBe(true);

    // The menu: what's new, the did-not-load card and a notice together.
    await raise(page, flowCardsOn('menu'));
    const menuControls = [
      '#menu-career',
      '#menu-race',
      '#menu-options',
      '#menu-settings',
      '#region-picker button.region',
    ];
    await checkScreen(page, '#menu', flowCardsOn('menu'), menuControls, `menu, ${textSize}`);
    if (textSize === 'normal') {
      // Negative control 1: the did-not-load card where #614 put it (a layer at the top centre). At
      // 568x320 it lies over the title and the region buttons again (polish batch D, mustFix 1), and
      // the same judge says so.
      await leaveFullscreen(page);
      await page.setViewportSize({ width: 568, height: 320 });
      await scrollTo(page, '#menu', 0);
      expect(
        judge(await paint(page, '#menu', ['load-retry']), { width: 568, height: 320 }),
        'the control starts clean',
      ).toEqual([]);
      // As #614 drew it: a layer at the top centre, its width what is left right of the middle, and
      // the menu laid out as the live check saw it (the notice raised above is set aside).
      const oldPlace = await page.addStyleTag({
        content:
          '#ui #load-retry { position: fixed !important; top: 10px; left: 50%; transform: translateX(-50%); ' +
          'z-index: 2; width: auto !important; max-width: 92vw !important; margin: 0 !important; } ' +
          '#ui #ui-notice { display: none !important; }',
      });
      const old = judge(await paint(page, '#menu', ['load-retry']), { width: 568, height: 320 });
      console.log(`negative control 1: ${JSON.stringify(old)}`);
      expect(old).toContain('load-retry is fixed, so it can stay over content that scrolls');
      expect(old.filter((f) => f.startsWith('load-retry covers'))).not.toEqual([]);
      await oldPlace.evaluate((e) => (e as HTMLElement).remove());

      // Negative control 3: a menu column wider than the screen (as the did-not-load card's one-line
      // width made it at 568x320 and the largest Text size): the fit check names what it cuts off.
      expect(fit(await paint(page, '#menu', []), { width: 568, height: 320 }), 'the menu fits').toEqual([]);
      const wideMenu = await page.addStyleTag({
        // Its rows as wide as the column, their buttons out at the row's ends (a wider column alone
        // keeps its centred rows on the screen, and the check rightly finds nothing).
        content:
          '#ui #menu .menu-main { min-width: 130vw !important; max-width: none !important; } ' +
          '#ui #menu .menu-main > .row { align-self: stretch !important; justify-content: space-between !important; }',
      });
      const cut = fit(await paint(page, '#menu', []), { width: 568, height: 320 });
      console.log(`negative control 3: ${JSON.stringify(cut)}`);
      expect(cut.filter((f) => f.endsWith('leaves the screen sideways'))).not.toEqual([]);
      await wideMenu.evaluate((e) => (e as HTMLElement).remove());

      // Negative control 4: the footer drawn over Race, as the scrolled menu drew it over Start career
      // and Race: the fit check names it.
      const raceAt = await page.evaluate(() => {
        const menu = document.getElementById('menu')!;
        const m = menu.getBoundingClientRect();
        const race = document.getElementById('menu-race')!.getBoundingClientRect();
        return {
          top: race.top - m.top + menu.scrollTop + race.height / 2 - 8,
          left: race.left - m.left + menu.scrollLeft,
          width: race.width,
        };
      });
      const overRace = await page.addStyleTag({
        content:
          `#ui #menu #menu-build { display: block !important; visibility: visible !important; ` +
          `top: ${raceAt.top}px !important; bottom: auto !important; left: ${raceAt.left}px !important; ` +
          `right: auto !important; width: ${raceAt.width}px !important; }`,
      });
      const covered = fit(await paint(page, '#menu', []), { width: 568, height: 320 });
      console.log(`negative control 4: ${JSON.stringify(covered)}`);
      expect(
        covered.filter((f) => f.startsWith('the footer covers the control button#menu-race')),
      ).not.toEqual([]);
      await overRace.evaluate((e) => (e as HTMLElement).remove());
    }

    // The race options: the cards raised there sit in its flow; Back takes them down.
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#menu-options').click();
    await expect(page.locator('#race-options')).toBeVisible();
    await expect(page.locator('#load-retry'), 'the menu card went with the menu').toBeHidden();
    await raise(page, flowCardsOn('raceOptions'));
    await checkScreen(
      page,
      '#race-options',
      flowCardsOn('raceOptions'),
      ['#race-options-back'],
      `race options, ${textSize}`,
    );
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#race-options-back').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await expect(page.locator('#load-retry')).toBeHidden();
    await expect(page.locator('#ui-notice')).toBeHidden();
    // The menu as the player comes back to it fits every phone size: no row off its sides, and the
    // footer over nothing, at every scroll.
    await checkFit(page, '#menu', `menu, ${textSize}`);
    await checkBuildId(page, `menu, ${textSize}`);
    if (textSize === 'largest') {
      // Negative control 6: no footer, no stamp and no line (as the largest Text size left the menu
      // before the line): the same judge says the menu shows no build id.
      await leaveFullscreen(page);
      await page.setViewportSize({ width: 568, height: 320 });
      const none = await page.addStyleTag({
        content:
          '#ui #menu #menu-build, #ui #menu .menu-build-line, #build-stamp { display: none !important; }',
      });
      const bare = await paint(page, '#menu', []);
      const missing = buildIdFindings(
        bare.buildIds,
        bare.things.filter((t) => !t.inFooter),
        { width: 568, height: 320 },
      );
      console.log(`negative control 6: ${JSON.stringify(missing)}`);
      expect(missing).toEqual(['the menu shows no build id']);
      await none.evaluate((e) => (e as HTMLElement).remove());
    }
    await page.setViewportSize({ width: 915, height: 412 });

    // The career: the K2 card hid its Map and Garage tabs.
    await page.locator('#menu-career').click();
    await expect(page.locator('#career')).toBeVisible();
    await raise(page, flowCardsOn('career'));
    await checkScreen(
      page,
      '#career',
      flowCardsOn('career'),
      ['#career-back', '#career-tab-map', '#career-tab-garage'],
      `career, ${textSize}`,
    );
    if (textSize === 'normal') {
      // Negative control 5: a raised card scrolled out of view. Raised, it is in view; with the career
      // scrolled away from it, the same judge says it is not.
      await leaveFullscreen(page);
      await page.setViewportSize({ width: 915, height: 412 });
      // The suggested event's card under the map gives the career its scroll room (the live check's case).
      await page.locator('.career-node.suggested').click();
      await expect(page.locator('#career-ride')).toBeVisible();
      await raise(page, ['load-retry']);
      const view = { width: 915, height: 412 };
      const shown = (await paint(page, '#career', ['load-retry'])).cards[0];
      expect(shown && inViewFindings('load-retry', shown.box, view), 'raised: in view').toEqual([]);
      const room = await scrollRoom(page, '#career');
      expect(room, 'the career scrolls at 915x412 (the control needs room)').toBeGreaterThan(100);
      await scrollTo(page, '#career', room);
      const away = (await paint(page, '#career', ['load-retry'])).cards[0];
      const found = away ? inViewFindings('load-retry', away.box, view) : [];
      console.log(`negative control 5: ${JSON.stringify(found)}`);
      expect(found.filter((f) => f.startsWith('load-retry is out of view'))).not.toEqual([]);
      await scrollTo(page, '#career', 0);
    }
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#career-back').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    await expect(page.locator('#load-retry'), 'the career card went with the career').toBeHidden();

    // A race: the slow-frames offer in its slot, then the race's result with every card it can carry.
    await page.locator('#menu-race').click();
    await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
    await raise(page, ['look-offer']);
    await checkRace(page, `race, ${textSize}`);
    await page.setViewportSize({ width: 915, height: 412 });
    await rideToTheEnd(page, 'the quick race, to its end');
    await expect(page.locator('#results')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#reload-offer')).toBeVisible();
    await expect(page.locator('#reload-offer .reload-offer-text')).toHaveText(
      'The game was updated while you raced. It reloads when you go back to the menu.',
    );
    await raise(page, ['load-retry', 'ui-notice']);
    await checkScreen(
      page,
      '#results',
      flowCardsOn('results'),
      ['#results-place', '#results-menu', '#results-race'],
      `race result, ${textSize}`,
    );
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#results-menu').click();
    await expect(page.locator('#menu-career')).toBeVisible();
    await expect(page.locator('#reload-offer')).toBeHidden();
    await expect(page.locator('#load-retry')).toBeHidden();

    // The career's result (the first event, ridden by the bot).
    await page.locator('#menu-career').click();
    await page.locator('.career-node.suggested').click();
    await page.locator('#career-ride').click();
    await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
    await rideToTheEnd(page, 'the first career race, to its end');
    await expect(page.locator('#career-results')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#reload-offer')).toBeVisible();
    await expect(page.locator('#reload-offer .reload-offer-text')).toHaveText(
      'The game was updated while you raced. It reloads when you go to the map.',
    );
    await raise(page, ['load-retry', 'ui-notice']);
    await checkScreen(
      page,
      '#career-results',
      flowCardsOn('careerResults'),
      ['#career-results-title', '#career-results-map', '#career-results-retry'],
      `career result, ${textSize}`,
    );

    if (textSize === 'normal') {
      // Negative control 2: the update card where it was before #613 (fixed at the top centre). At
      // 915x412 it lies over the career result's title again, and the same judge says so.
      await leaveFullscreen(page);
      await page.setViewportSize({ width: 915, height: 412 });
      await scrollTo(page, '#career-results', 0);
      expect(
        judge(await paint(page, '#career-results', ['reload-offer']), { width: 915, height: 412 }),
      ).toEqual([]);
      const oldPlace = await page.addStyleTag({
        content:
          '#ui #reload-offer { position: fixed !important; top: 10px; left: 50%; transform: translateX(-50%); z-index: 2; }',
      });
      const old = judge(await paint(page, '#career-results', ['reload-offer']), { width: 915, height: 412 });
      console.log(`negative control 2: ${JSON.stringify(old)}`);
      expect(old).toContain('reload-offer is fixed, so it can stay over content that scrolls');
      expect(old.filter((f) => f.startsWith('reload-offer covers'))).not.toEqual([]);
      await oldPlace.evaluate((e) => (e as HTMLElement).remove());
    }

    // Leaving by the Map is the way out that reloads; with no deploy it only opens the map.
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('#career-results-map').click();
    await expect(page.locator('#career')).toBeVisible();
    await expect(page.locator('#reload-offer')).toBeHidden();
    await expect(page.locator('#load-retry')).toBeHidden();
  });
}
