import { openMainMenu, openMenuMore, openQuickPlay } from './menu-navigation';
import { expect, test, type Page } from '@playwright/test';
import {
  BIKE,
  type Box,
  type Piece,
  type TestWindow,
  LONGEST_BARK,
  KNOWN_LAYOUT_FINDINGS,
  KNOWN_LAYOUT_CAP,
  overlaps,
  layoutFindings,
  expectLayout,
  roundBox,
  logPieces,
  watchErrors,
  startRace,
  tickerAndMeasure,
  expectClear,
  momentFindings,
  expectCompact,
  shot,
  toastAndPrompts,
} from './ui-layout-helpers';

test('the known layout list only shrinks', () => {
  const entries = Object.values(KNOWN_LAYOUT_FINDINGS).flat();
  // The cap follows the list down (lower it with each fix), so any growth shows as a raised cap.
  expect(entries.length, 'KNOWN_LAYOUT_CAP must equal the list: lower it when you fix one').toBe(
    KNOWN_LAYOUT_CAP,
  );
});

test('phone landscape, left-handed mirror: the ticker stays clear with the rival bar beside it', async ({
  page,
}) => {
  // Three rendered layout moments plus screenshots can exceed the default 30 s on shared CI
  // even after every layout finding is clear. This is a harness deadline; game perf stays separate.
  test.setTimeout(60_000);
  const problems = watchErrors(page);
  await startRace(page, { mirror: true });
  // The rival's bar is shown beside the ticker: sideways they share the top row.
  const m = await tickerAndMeasure(page, [LONGEST_BARK], { show: ['hud-target'] });
  expectClear(m, 'mirrored');
  expectCompact(m, 'mirrored');
  await shot(
    page,
    'mirrored',
    m.layout.filter((p) => p.name === BIKE).map((p) => p.box),
  );
  const found = momentFindings(m, 'mirrored, start');
  found.push(...(await toastAndPrompts(page, 'mirrored')));
  expectLayout(found, 'mirrored');
  expect(problems).toEqual([]);
});

// The small phones: the rival's bar beside the ticker (on these screens the top row is tightest),
// the slow-frames toast and every prompt. 568x320 is a small older phone held sideways: its menu's
// Race button sat under the build stamp, so the case was left out of the first version of this
// check; the stamp keeps clear of controls now (ui/stamp.ts), and this case races from the menu
// like the others, with the same empty known list.
for (const [where, width, height] of [
  ['small phone', 740, 360],
  ['tiny phone', 568, 320],
] as const) {
  test.describe(`${where} landscape`, () => {
    test.use({ viewport: { width, height } });
    test('the ticker sits clear of the road ahead', async ({ page }) => {
      const problems = watchErrors(page);
      await startRace(page);
      // The rival's bar beside the ticker: on this screen the top row is tightest.
      const m = await tickerAndMeasure(page, [LONGEST_BARK], { show: ['hud-target'] });
      expectClear(m, where);
      expectCompact(m, where);
      await shot(
        page,
        where.replace(/\s+/g, '-'),
        m.layout.filter((p) => p.name === BIKE).map((p) => p.box),
      );
      const found = momentFindings(m, `${where}, start`);
      // The HUD run's lane report inferred that the toast could reach the BRAKE button on a small
      // phone: measured here, with every prompt.
      found.push(...(await toastAndPrompts(page, where)));
      expectLayout(found, where);
      expect(problems).toEqual([]);
    });
  });
}

// The overlap checks must fire: a widget planted in the middle of the screen is caught, so is one
// moved over another (here the heat badge's spot, where playtest 3 saw the objective), and so is
// one laid over the ticker.
test('the look-ahead and layout checks catch a centred widget and overlapped widgets (negative control)', async ({
  page,
}) => {
  await startRace(page);
  const depth = await page.evaluate(() => (window as TestWindow).__playerDepthControl?.());
  expect(depth, 'actual controlled depth fixture measured').toBeDefined();
  if (depth) {
    expect(layoutFindings(depth.negative, depth.w, depth.h)).not.toContain(`planted-depth-hidden × ${BIKE}`);
    expect(layoutFindings(depth.positive, depth.w, depth.h)).toContain(`planted-depth-visible × ${BIKE}`);
  }
  const empty = await page.evaluate(() => {
    try {
      (window as TestWindow).__playerMaskEmptyControl?.();
      return 'empty mask incorrectly accepted';
    } catch (error) {
      return String(error);
    }
  });
  expect(empty, 'an actual scene without its player cannot pass as a clean mask').toContain(
    'no painted player pixels',
  );
  for (const mode of ['straight', 'premultiplied'] as const) {
    const faded = await page.evaluate((mode) => {
      try {
        (window as TestWindow).__playerMaskEmptyControl?.(mode);
        return 'faded mask incorrectly accepted';
      } catch (error) {
        return String(error);
      }
    }, mode);
    expect(faded, `a primed ${mode} player mask follows current zero opacity`).toContain(
      'no painted player pixels',
    );
  }
  const first = await tickerAndMeasure(page, [LONGEST_BARK]);
  const strip = first.ticker?.box;
  expect(strip, 'the ticker was up to plant against').toBeDefined();
  await page.evaluate((strip) => {
    const hud = document.getElementById('hud');
    const planted = (id: string, text: string, style: Record<string, string>) => {
      const d = document.createElement('div');
      d.id = id;
      d.textContent = text;
      Object.assign(d.style, style);
      hud?.append(d);
    };
    // A widget in the middle of the road ahead.
    planted('planted-pop', 'PLANTED', { position: 'fixed', left: '45%', top: '40%', background: '#000a' });
    // One laid exactly over the ticker.
    if (strip)
      planted('planted-over-ticker', 'OVER', {
        position: 'fixed',
        left: `${strip.left}px`,
        top: `${strip.top}px`,
        width: `${strip.right - strip.left}px`,
        height: `${strip.bottom - strip.top}px`,
        background: '#000a',
      });
    // The speed readout dropped onto the position badge, and a widget at the heat badge's spot
    // under one at the objective's: both pairs overlap by construction.
    const speed = document.getElementById('hud-speed');
    const position = document.getElementById('hud-position');
    if (speed && position) {
      const p = position.getBoundingClientRect();
      Object.assign(speed.style, { left: `${p.left}px`, top: `${p.top}px`, right: 'auto', bottom: 'auto' });
    }
    for (const id of ['planted-heat', 'planted-objective'])
      planted(id, id === 'planted-heat' ? 'HEAT' : 'FINISH', {
        position: 'absolute',
        top: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '4px 10px',
        background: '#000a',
      });
  }, strip);
  const m = await tickerAndMeasure(page, [LONGEST_BARK]);
  const { w, h } = m.viewport;
  const found = layoutFindings(m.layout, w, h);
  console.log(`negative control: layout findings ${JSON.stringify(found)}`);
  expect(found).toContain('hud-position × hud-speed');
  expect(found).toContain('planted-heat × planted-objective');
  expect(found).toContain('planted-pop in the road ahead');
  expect(found).toContain('hud-ticker × planted-over-ticker');
  // A ticker laid over the middle of the road is caught against the road ahead as well.
  const plate: Piece = {
    name: 'landing-line',
    box: { left: w * 0.2, right: w * 0.8, top: h * 0.3, bottom: h * 0.4 },
  };
  expect(layoutFindings(m.layout, w, h, [plate])).toContain('landing-line in the road ahead');
  // A landing line laid over the bike is caught, the way the landing moment measures it.
  const bikeBox = m.layout.find((p) => p.name === BIKE)?.box;
  expect(bikeBox, 'the probe measured the player bike').toBeDefined();
  if (bikeBox)
    expect(layoutFindings(m.layout, w, h, [{ name: 'landing-line', box: bikeBox }])).toContain(
      `landing-line × ${BIKE}`,
    );

  // The player's bike is measured where the chase camera puts it (low in the middle, a rider-sized
  // box), and it may sit in the road ahead.
  const bike = await page.evaluate(() => (window as TestWindow).__playerBike?.() ?? null);
  console.log(`negative control: the player's bike ${JSON.stringify(bike && roundBox(bike))}`);
  expect(bike, 'the probe measured the player bike').toBeDefined();
  if (!bike) return;
  const [cx, cy] = [(bike.left + bike.right) / 2, (bike.top + bike.bottom) / 2];
  expect(cx / w, 'the bike is in the middle across').toBeGreaterThan(0.3);
  expect(cx / w, 'the bike is in the middle across').toBeLessThan(0.7);
  expect(cy / h, 'the bike is in the lower half').toBeGreaterThan(0.45);
  expect(bike.bottom - bike.top, 'the bike is rider-sized').toBeGreaterThan(20);
  expect(found.filter((f) => f.includes(BIKE))).toEqual([]);
  // A card laid over the bike is caught against it, and so is a prompt laid over the BRAKE button.
  await page.evaluate((b) => {
    const cover = document.createElement('div');
    cover.id = 'planted-cover';
    cover.textContent = 'COVER';
    Object.assign(cover.style, {
      position: 'fixed',
      left: `${b.left - 10}px`,
      top: `${b.top - 10}px`,
      width: `${b.right - b.left + 20}px`,
      height: `${b.bottom - b.top + 20}px`,
      background: '#000a',
    });
    document.getElementById('hud')?.append(cover);
    const brake = document.getElementById('touch-brake')?.getBoundingClientRect();
    const prompt = document.getElementById('career-prompt');
    if (brake && prompt)
      Object.assign(prompt.style, {
        position: 'fixed',
        left: `${brake.left}px`,
        top: `${brake.top}px`,
        bottom: 'auto',
      });
  }, bike);
  const covered = await tickerAndMeasure(page, [], { prompts: ['PLANTED PROMPT'] });
  const coverFound = layoutFindings(covered.layout, w, h);
  console.log(`negative control: covered findings ${JSON.stringify(coverFound)}`);
  expect(coverFound).toContain(`planted-cover × ${BIKE}`);
  const promptBox = covered.prompts[0]?.box;
  expect(promptBox, 'the planted prompt was measured').toBeDefined();
  if (promptBox)
    expect(layoutFindings(covered.layout, w, h, [{ name: 'career-prompt', box: promptBox }])).toContain(
      'career-prompt × touch-brake',
    );
});

// ---- The build stamp keeps clear of every control (F1) -----------------------------------------
// The HUD run's 568x320 case could not start: the menu's Race button sat under #build-stamp, which
// took the tap. The stamp now never takes a tap, takes the other bottom corner when a control is
// under it, and hides when a control is under both (ui/stamp.ts). This measures it on every screen
// with controls, at phone sizes sideways and upright and at a laptop's.

/**
 * What the stamp covers on this screen, from painted boxes (the UI ignores the pointer outside its controls).
 * `forced` first puts the stamp back in its left corner, shown, in the same task as the measuring: the UI's own
 * check (a class change queues it for the next frame) could otherwise move it again in between.
 */
async function stampCover(page: Page, forced = false) {
  return page.evaluate((force) => {
    const stamp = document.getElementById('build-stamp');
    if (force && stamp) {
      stamp.classList.remove('at-right', 'yield');
      stamp.style.display = 'block';
      // The negative control's planted button goes exactly where the forced stamp is now. Forced back to
      // its corner the stamp need not sit where it was measured before the planting: on main 310db5f
      // (ci run 37606017903) it covered the debug report button and not the planted one.
      const planted = document.getElementById('planted-under-stamp');
      if (planted) {
        const r = stamp.getBoundingClientRect();
        Object.assign(planted.style, {
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
      }
    }
    const shown = !!stamp && stamp.checkVisibility();
    const sb = stamp?.getBoundingClientRect();
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        '#ui button, #ui input, #ui select, #ui textarea, #ui label, #ui summary, #ui a, #ui .setting-label, #ui output',
      ),
    ].filter((e) => e.checkVisibility() && getComputedStyle(e).visibility !== 'hidden');
    const under: string[] = [];
    // Footers span the screen: only their words count. A footer that gave way (the menu's, hidden while
    // the menu scrolls or something lies under it) is not painted.
    for (const f of document.querySelectorAll<HTMLElement>('#ui .footer')) {
      if (!f.checkVisibility() || getComputedStyle(f).visibility === 'hidden' || !sb || !shown) continue;
      const range = document.createRange();
      range.selectNodeContents(f);
      if (hit(sb, range.getBoundingClientRect())) under.push(`#${f.id} (words)`);
    }
    // The Race button's centre must hit the button itself, never the stamp or anything else.
    const blocked: string[] = [];
    for (const e of controls) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (sb && shown && hit(sb, r))
        under.push(`${e.id || e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 20)}"`);
      if (e.id !== 'menu-race' && e.id !== 'menu-quick-play') continue;
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      if (top !== e && !e.contains(top))
        blocked.push(`#${e.id}: the tap lands on ${top?.id || top?.tagName}`);
    }
    return {
      shown,
      at: stamp?.className ?? '',
      box: sb ? [sb.left, sb.top, sb.right, sb.bottom].map(Math.round) : null,
      examined: controls.length,
      under,
      blocked,
    };
  }, forced);
}

/** Lets the stamp's own check run (it re-checks a frame after a screen or its content changes). */
async function settleStamp(page: Page) {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/**
 * A tap on a control to get to the next screen. A control that is off the screen is clicked by
 * dispatch instead, and the case says so in the log. (The menu's controls are on the screen at
 * every size now: the menu fit check below holds them there, so this is for the settings tabs.)
 */
async function press(page: Page, selector: string, where: string) {
  const target = page.locator(selector);
  const onScreen = await target.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
  if (onScreen) await target.click();
  else {
    console.log(`${where}: ${selector} is off the screen; clicking it by dispatch`);
    await target.dispatchEvent('click');
  }
}

async function expectStampClear(page: Page, where: string) {
  await settleStamp(page);
  const c = await stampCover(page);
  console.log(
    `${where}: stamp ${JSON.stringify({ shown: c.shown, at: c.at, box: c.box })}, ${c.examined} controls`,
  );
  expect(c.examined, `${where}: controls were examined`).toBeGreaterThan(0);
  expect(c.under, `${where}: controls and words under the stamp`).toEqual([]);
  expect(c.blocked, `${where}: taps that do not land on their control`).toEqual([]);
}

for (const [where, width, height, finePointer] of [
  ['568x320', 568, 320, false],
  ['640x360', 640, 360, false],
  ['740x360', 740, 360, false],
  ['915x412', 915, 412, false],
  ['360x640 upright', 360, 640, true],
  ['412x915 upright', 412, 915, true],
  ['1366x768', 1366, 768, true],
] as const) {
  test.describe(`build stamp at ${where}`, () => {
    // A touch device held upright gets the rotate screen, so the upright sizes (and the laptop) use a fine pointer.
    test.use({ viewport: { width, height }, ...(finePointer ? { isMobile: false, hasTouch: false } : {}) });
    test('never covers a control on the start screen, menu, settings tabs or changelog', async ({ page }) => {
      // This rendered tour visits startup, every settings tab, changelog, credits and a race.
      // CI reached the default 30 s at the final race wait and passed the retry in 29.4 s.
      // This is a harness hang guard; gameplay performance remains in the perf tier.
      test.setTimeout(60_000);
      const problems = watchErrors(page);
      await page.addInitScript(() => {
        (window as TestWindow).__GAME_TEST__ = true;
      });
      await page.goto('./');
      await expect(page.locator('#start-screen')).toBeVisible();
      // The stamp names the build wherever there is room. Available space depends on the actual
      // startup words and build label, not a particular viewport: hiding needs two blocked corners.
      await settleStamp(page);
      const start = await stampCover(page);
      {
        const blockedCorners = await page.evaluate(() => {
          const stamp = document.getElementById('build-stamp')!;
          const oldClass = stamp.className;
          const oldStyle = stamp.getAttribute('style');
          stamp.classList.remove('yield', 'at-right');
          stamp.style.display = 'block';
          const left = stamp.getBoundingClientRect();
          stamp.classList.add('at-right');
          const right = stamp.getBoundingClientRect();
          const lines: DOMRect[] = [];
          for (const e of document.querySelectorAll<HTMLElement>('#start-screen *')) {
            if (!e.checkVisibility()) continue;
            for (const n of e.childNodes) {
              if (n.nodeType !== Node.TEXT_NODE || !(n.textContent ?? '').trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(n);
              lines.push(...range.getClientRects());
            }
          }
          stamp.className = oldClass;
          if (oldStyle === null) stamp.removeAttribute('style');
          else stamp.setAttribute('style', oldStyle);
          return [left, right].map((box) =>
            lines.some(
              (r) =>
                r.width > 0.5 &&
                r.height > 0.5 &&
                box.left < r.right &&
                r.left < box.right &&
                box.top < r.bottom &&
                r.top < box.bottom,
            ),
          );
        });
        if (!start.shown)
          expect(blockedCorners, `${where}: both stamp corners would cover actual startup words`).toEqual([
            true,
            true,
          ]);
        else
          expect(
            blockedCorners[start.at.includes('at-right') ? 1 : 0],
            `${where}: the shown stamp stays clear of actual startup words`,
          ).toBe(false);
      }
      expect(start.under, `${where}: startup controls stay clear`).toEqual([]);

      await page.locator('#start-screen').click();
      await expect(page.locator('#menu-quick-play')).toBeVisible();
      await expectStampClear(page, `${where}, menu`);

      await press(page, '#menu-settings', where);
      // Only the tabs this device shows (Keys hides on a touch-only screen).
      const tabs = await page
        .locator('[id^="settings-tab-"]:visible')
        .evaluateAll((els) => els.map((e) => e.id));
      expect(tabs.length, `${where}: the settings tabs were found`).toBeGreaterThan(0);
      for (const id of tabs) {
        await press(page, `#${id}`, where);
        await expectStampClear(page, `${where}, settings ${id}`);
      }
      await press(page, '#settings-back', where);

      await openMenuMore(page);
      await press(page, '#menu-changelog', where);
      await expect(page.locator('#changelog')).toBeVisible();
      // The changelog and the credits fetch their words after the screen shows, and the stamp checks again
      // a frame after they land: measure once they are in (on main and train 439 the credits' first
      // entries were measured under the stamp in that gap).
      await expect(page.locator('#changelog-list h3').first()).toBeAttached();
      await expectStampClear(page, `${where}, changelog`);
      await press(page, '#changelog-back', where);
      await expect(page.locator('#menu-quick-play')).toBeVisible();

      await openMenuMore(page);
      await press(page, '#menu-credits', where);
      await expect(page.locator('#credits')).toBeVisible();
      await expect(page.locator('#credits-list .credit-entry').first()).toBeAttached();
      await expectStampClear(page, `${where}, credits`);
      await press(page, '#credits-back', where);
      await expect(page.locator('#menu-quick-play')).toBeVisible();

      // The tap on Race lands: the race starts, and the stamp is out of the race.
      await openQuickPlay(page);
      await page.locator('#menu-race').click();
      await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
      await expect(page.locator('#build-stamp')).toBeHidden();
      expect(problems).toEqual([]);
    });
  });
}

// ---- The menu fits a short phone (wave B's check, F1) --------------------------------------------
// The main menu was taller than a 568x320 phone, so its Settings row sat below the screen and the
// F1 check above had to tap it by dispatch. Every control of the menu, the region chips and the
// menu's own block must now lie on the screen, with the what's-new card up (a first launch shows it)
// and after it is dismissed, on the short sizes and the default phone. (The route chips scroll
// sideways inside their own row by design, so they are not measured here: ui-route-picker.spec.ts
// holds the picker itself on the screen.)

/** The menu's controls that stick out of the screen, by name. */
async function menuOffScreen(page: Page) {
  return page.evaluate(() => {
    const picks =
      '#menu-career, #menu-quick-play, #menu-more > summary, #menu-race, #menu-settings, #menu-changelog, #menu-credits, #menu-copy-report, #region-picker .region, #menu .menu-main, #menu .title';
    const off: string[] = [];
    let examined = 0;
    for (const e of document.querySelectorAll<HTMLElement>(picks)) {
      if (!e.checkVisibility()) continue;
      examined++;
      const r = e.getBoundingClientRect();
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5)
        off.push(
          `${e.id || e.className || e.tagName.toLowerCase()} [${[r.left, r.top, r.right, r.bottom].map(Math.round).join(',')}]`,
        );
    }
    return { off, examined, view: [innerWidth, innerHeight] };
  });
}

for (const [where, width, height] of [
  ['568x320', 568, 320],
  ['640x360', 640, 360],
  ['740x360', 740, 360],
  ['915x412', 915, 412],
] as const) {
  test.describe(`menu fit at ${where}`, () => {
    test.use({ viewport: { width, height } });
    test('every menu control is on the screen, with the what-is-new card up and after it is dismissed', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as TestWindow).__GAME_TEST__ = true;
      });
      await page.goto('./');
      await page.locator('#start-screen').click();
      await expect(page.locator('#menu-quick-play')).toBeVisible();
      await settleStamp(page);
      const card = page.locator('#whats-new');
      const cardUp = await card.isVisible();
      const first = await menuOffScreen(page);
      console.log(
        `${where}: card ${cardUp ? 'up' : 'not shown'}, ${first.examined} menu pieces, off ${JSON.stringify(first.off)}`,
      );
      expect(first.examined, `${where}: menu pieces were examined`).toBeGreaterThan(5);
      expect(first.off, `${where}: menu pieces off the screen (card ${cardUp ? 'up' : 'not shown'})`).toEqual(
        [],
      );
      if (cardUp) {
        await page.locator('#whats-new-ok').click();
        await expect(card).toBeHidden();
        await settleStamp(page);
        const after = await menuOffScreen(page);
        console.log(
          `${where}: card dismissed, ${after.examined} menu pieces, off ${JSON.stringify(after.off)}`,
        );
        expect(after.off, `${where}: menu pieces off the screen (card dismissed)`).toEqual([]);
      }
      await openQuickPlay(page);
      const setup = await menuOffScreen(page);
      expect(setup.off, `${where}: Quick Play controls stay on screen`).toEqual([]);
      await expectStampClear(page, `${where}, Quick Play`);
      // Settings takes a real tap here, not a dispatch.
      await openMainMenu(page);
      await page.locator('#menu-settings').click();
      await expect(page.locator('#settings-back')).toBeVisible();
    });
  });
}

// The check must fire: the same menu on a screen too short for it names what sticks out.
test('the menu fit check names a control that is off the screen (negative control)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-quick-play')).toBeVisible();
  // The start tap may take the page fullscreen, and a fullscreen window cannot be resized.
  await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
  await page.setViewportSize({ width: 568, height: 120 });
  await settleStamp(page);
  const squeezed = await menuOffScreen(page);
  expect(squeezed.off.length, 'a 120 px tall screen cannot hold the menu').toBeGreaterThan(0);
});

// The check must fire: a control planted under the stamp is named while the stamp is forced to
// show, and the stamp itself steps away from it (to the other corner, or hides) when it is not.
test('the stamp check catches a control under the stamp, and the stamp steps away from one (negative control)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-quick-play')).toBeVisible();
  await settleStamp(page);
  // The stamp at its home corner (left), shown, wherever the menu had put it.
  await page.evaluate(() => {
    const s = document.getElementById('build-stamp');
    s?.classList.remove('at-right', 'yield');
  });
  const before = await stampCover(page);
  expect(before.shown, 'the stamp was put back in its left corner').toBe(true);
  expect(before.box, 'the stamp was measured').not.toBeNull();
  // A button laid exactly over the stamp where it sits now.
  await page.evaluate((box) => {
    const [left = 0, top = 0, right = 0, bottom = 0] = box ?? [];
    const b = document.createElement('button');
    b.id = 'planted-under-stamp';
    b.textContent = 'PLANTED';
    Object.assign(b.style, {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
      zIndex: '3',
    });
    document.getElementById('menu')?.append(b);
  }, before.box);
  await settleStamp(page);
  const moved = await stampCover(page);
  console.log(
    `negative control: after planting ${JSON.stringify({ shown: moved.shown, at: moved.at, under: moved.under })}`,
  );
  expect(moved.under, 'the stamp stepped away from the planted button').toEqual([]);
  expect(moved.at !== before.at || !moved.shown, 'the stamp moved or hid').toBe(true);
  // Forced back to its corner with the planted button laid under it, the check names it (forced, laid and
  // measured in one task: the class change queues the UI's own check for the next frame, which can step the
  // stamp away before a later measure; in train 432 and on main 310db5f the forced stamp covered the debug
  // report button and not the planted one, which was still where the stamp had been before the planting).
  const forced = await stampCover(page, true);
  console.log(`negative control: forced ${JSON.stringify(forced.under)}`);
  expect(forced.under.some((u) => u.includes('planted-under-stamp'))).toBe(true);
});

// ---- The tuning panel keeps off the pause button and the touch buttons (playtest 4, P4-1) -----------
// The maintainer: "Tuning on mobile blocks pause button and it seems you can't get it to minimize once
// it's up so you have to refresh the whole page/game". The panel used to stand 8 px in from the top-right
// corner, over the pause button and the touch buttons, and its Close button scrolled away with the
// sliders. Now it docks under the pause button (on the mirror's side too), stops above the touch
// buttons, and its header (Minimise, Close) is outside the part that scrolls (ui/tuning/place.ts, which
// src/ui/tuning/place.test.ts holds in numbers). Measured here from the painted boxes in a real race: the
// panel open over the running race, at the default phone, the mirror, the small phone and an upright
// screen (a touch device held upright shows the rotate screen, so that one races with a fine pointer,
// as the other upright cases do), with the same empty known list as the HUD. Its two header controls
// must be on the screen and hit by a tap at their centres, before and after the sliders are scrolled to
// the end; the pause button must still take a tap with the panel up (and the way back from the pause
// screen, Resume, must not sit under the panel); Minimise must leave only the header, and Close must
// close it.

interface TuningMeasured {
  viewport: { w: number; h: number };
  /** The panel, the pause button and the touch buttons that are up, as painted. */
  pieces: Piece[];
  /** Whether a tap at the pause button's centre lands on the pause button. */
  pauseHit: boolean;
  /** The header's two controls: where they are, whether they are on the screen, and whether a tap at their centre lands on them. */
  controls: { id: string; box: Box; onScreen: boolean; hit: boolean }[];
  /** The scrolling part: whether it shows less than it holds, and how far it is scrolled. */
  scroll: { scrollable: boolean; top: number };
  side: string;
}

function measureTuning(page: Page): Promise<TuningMeasured> {
  return page.evaluate(() => {
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const hits = (e: Element) => {
      const r = e.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (top === e || e.contains(top));
    };
    const panel = document.getElementById('tuning-panel');
    const pieces: { name: string; box: ReturnType<typeof box> }[] = [];
    if (panel?.checkVisibility()) pieces.push({ name: 'tuning-panel', box: box(panel) });
    for (const id of ['hud-pause', 'touch-attack', 'touch-brake', 'touch-wheelie']) {
      const e = document.getElementById(id);
      if (e?.checkVisibility()) pieces.push({ name: id, box: box(e) });
    }
    const pause = document.getElementById('hud-pause');
    const controls = ['tuning-min', 'tuning-close'].flatMap((id) => {
      const e = document.getElementById(id);
      if (!e?.checkVisibility()) return [];
      const b = box(e);
      const onScreen = b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight;
      return [{ id, box: b, onScreen, hit: hits(e) }];
    });
    const scroll = panel?.querySelector<HTMLElement>('.tp-scroll');
    return {
      viewport: { w: innerWidth, h: innerHeight },
      pieces,
      pauseHit: !!pause && pause.checkVisibility() && hits(pause),
      controls,
      scroll: {
        scrollable: !!scroll && scroll.scrollHeight > scroll.clientHeight + 1,
        top: scroll?.scrollTop ?? 0,
      },
      side: panel?.dataset['side'] ?? '',
    };
  });
}

/** What is wrong with one measured moment of the open panel (empty when all is well). */
function tuningFindings(m: TuningMeasured): string[] {
  const out = new Set<string>();
  const panel = m.pieces.find((p) => p.name === 'tuning-panel');
  if (!panel) return ['the panel was not up'];
  for (const p of m.pieces)
    if (p !== panel && overlaps(panel.box, p.box)) out.add(`tuning-panel × ${p.name}`);
  const b = panel.box;
  if (b.left < 0 || b.top < 0 || b.right > m.viewport.w || b.bottom > m.viewport.h)
    out.add('tuning-panel off the screen');
  if (!m.pauseHit) out.add('hud-pause covered');
  for (const c of m.controls) {
    if (!c.onScreen) out.add(`${c.id} off the screen`);
    if (!c.hit) out.add(`${c.id} covered`);
  }
  return [...out].sort();
}

for (const [where, width, height, touch, mirror] of [
  ['915x412', 915, 412, true, false],
  ['915x412 left-handed', 915, 412, true, true],
  ['568x320', 568, 320, true, false],
  ['412x915 upright', 412, 915, false, false],
] as const) {
  test.describe(`tuning panel at ${where}`, () => {
    test.use({ viewport: { width, height }, ...(touch ? {} : { isMobile: false, hasTouch: false }) });
    test('stays off the pause button and the touch buttons; one tap minimises or closes it', async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const problems = watchErrors(page);
      await startRace(page, { mirror });
      // A tap as a player makes it: a real touch where the screen has one (Playwright checks the tap
      // would land on the control itself, not on something over it), a click on the upright case.
      const tap = (selector: string) =>
        touch ? page.locator(selector).tap() : page.locator(selector).click();
      const panel = page.locator('#tuning-panel');

      await page.keyboard.press('Backquote');
      await expect(panel).toBeVisible();
      const open = await measureTuning(page);
      logPieces(`${where}, panel open`, open.pieces);
      const names = new Set(open.pieces.map((p) => p.name));
      for (const must of [
        'tuning-panel',
        'hud-pause',
        ...(touch ? ['touch-attack', 'touch-brake', 'touch-wheelie'] : []),
      ])
        expect(names.has(must), `${where}: the check measured ${must}`).toBe(true);
      expect(
        open.controls.map((c) => c.id),
        `${where}: the header's two controls were measured`,
      ).toEqual(['tuning-min', 'tuning-close']);
      expect(open.side, `${where}: the panel docks on the pause button's side`).toBe(
        mirror ? 'left' : 'right',
      );
      const found = [...tuningFindings(open)];
      await shot(page, `tuning-${where.replace(/\s+/g, '-')}`);

      // The sliders scrolled to the end: the header does not go with them.
      await page.locator('#tuning-panel .tp-scroll').evaluate((e) => {
        e.scrollTop = e.scrollHeight;
      });
      const scrolled = await measureTuning(page);
      console.log(
        `${where}: sliders ${scrolled.scroll.scrollable ? 'scroll' : 'fit'}, scrolled to ${Math.round(scrolled.scroll.top)} px; header controls ${JSON.stringify(scrolled.controls.map((c) => [c.id, roundBox(c.box), c.onScreen, c.hit]))}`,
      );
      if (touch)
        expect(scrolled.scroll.scrollable, `${where}: the sliders hold more than the panel shows`).toBe(true);
      if (scrolled.scroll.scrollable)
        expect(scrolled.scroll.top, `${where}: the sliders were scrolled`).toBeGreaterThan(0);
      found.push(...tuningFindings(scrolled));
      expectLayout(found, `tuning panel at ${where}`);

      // The pause button takes a tap with the panel up, and Resume is not under the panel.
      await tap('#hud-pause');
      await expect(page.locator('#pause-screen')).toBeVisible();
      await expect(panel, 'the panel stays up over the pause screen').toBeVisible();
      const resumeHit = await page.evaluate(() => {
        const e = document.getElementById('pause-resume');
        if (!e) return false;
        const r = e.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && (top === e || e.contains(top));
      });
      expect(resumeHit, `${where}: Resume is not under the panel`).toBe(true);
      await tap('#pause-resume');
      await expect(page.locator('#pause-screen')).toBeHidden();

      // One tap minimises it: only the header is left, still clear, and one tap brings it back.
      await tap('#tuning-min');
      await expect(page.locator('#tuning-panel .tp-scroll')).toBeHidden();
      const minimised = await measureTuning(page);
      const chip = minimised.pieces.find((p) => p.name === 'tuning-panel');
      console.log(`${where}: minimised ${JSON.stringify(chip && roundBox(chip.box))}`);
      expect(
        (chip?.box.bottom ?? 1e6) - (chip?.box.top ?? 0),
        `${where}: only the header is left`,
      ).toBeLessThanOrEqual(64);
      expectLayout(tuningFindings(minimised), `tuning panel at ${where}`);
      await tap('#tuning-min');
      await expect(page.locator('#tuning-panel .tp-scroll')).toBeVisible();

      // One tap closes it, and the key opens it again, fully open.
      await tap('#tuning-close');
      await expect(panel).toBeHidden();
      await page.keyboard.press('Backquote');
      await expect(panel).toBeVisible();
      await expect(page.locator('#tuning-panel .tp-scroll')).toBeVisible();

      // The check fires: the panel put back where it used to stand (8 px in from the top corner, the
      // screen's height) sits on the pause button, and the check names it.
      await page.evaluate(
        ({ side, h }) => {
          const p = document.getElementById('tuning-panel');
          if (!p) return;
          Object.assign(p.style, { top: '8px', maxHeight: `${h - 16}px`, left: 'auto', right: 'auto' });
          p.style[side === 'left' ? 'left' : 'right'] = '8px';
        },
        { side: mirror ? 'left' : 'right', h: height },
      );
      const planted = tuningFindings(await measureTuning(page));
      console.log(`${where}: negative control: the old stand ${JSON.stringify(planted)}`);
      expect(planted).toContain('tuning-panel × hud-pause');
      expect(planted).toContain('hud-pause covered');
      expect(problems).toEqual([]);
    });
  });
}
