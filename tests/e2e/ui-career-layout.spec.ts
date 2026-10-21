import { expect, test, type Page } from '@playwright/test';
import { rideFirstCareerRace } from './career-start';
import { fastForwardDone } from './lockstep';
import {
  BIKE,
  CAREER_PROMPTS,
  LANDING_LINES,
  LONGEST_LINE,
  type Box,
  type Piece,
  type Measured,
  type TestWindow,
  LONGEST_BARK,
  WIDE_CHIP,
  NAME,
  LONGEST_ASK,
  LONGEST_LANDING,
  overlaps,
  layoutFindings,
  expectLayout,
  roundBox,
  logPieces,
  watchErrors,
  CAREER_SEED,
  startRace,
  tickerAndMeasure,
  expectClear,
  momentFindings,
  gaugeMoment,
  expectCompact,
  shot,
} from './ui-layout-helpers';

/**
 * Rides on (fast-forward) until the heat badge is up, then measures the HUD with it, a bark held
 * on the ticker, the slow-frames toast and the rival's health bar shown. The race then crawls a
 * tick a frame, so the heat cannot cool off while the badge's lazy chunk arrives.
 */
async function heatMoment(page: Page, where: string): Promise<string[]> {
  await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    const from = g?.snapshot()?.tick ?? 0;
    // 3 minutes of race is a hang guard only; the check below fails if no heat came.
    g?.fastForward(
      (s) => s.tick > from + 3 * 60 * 60 || (s.law?.heat ?? 0) > 0.05 || (s.law?.tier ?? 0) > 0,
      {
        then: 1,
      },
    );
  });
  await fastForwardDone(page, `${where}: the heat badge`);
  await expect(page.locator('#hud-heat'), `${where}: the heat badge came up`).toBeVisible({
    timeout: 15_000,
  });
  const m = await tickerAndMeasure(page, [LONGEST_BARK], {
    show: ['look-offer', 'hud-target'],
    prompts: CAREER_PROMPTS,
  });
  const names = new Set(m.layout.map((p) => p.name));
  for (const must of ['hud-heat', 'hud-objective', 'look-offer', 'hud-target'])
    expect(names.has(must), `${where}: the layout probe measured ${must} with the heat up`).toBe(true);
  await shot(
    page,
    `${where.replace(/\s+/g, '-')}-heat`,
    m.layout.filter((p) => p.name === BIKE).map((p) => p.box),
    ['look-offer'],
  );
  const found = momentFindings(m, `${where}, heat`, true);
  found.push(...(await gaugeMoment(page, `${where}, heat`)));
  await page.evaluate(() => (window as TestWindow).__game?.lockstep(null));
  return found;
}

/**
 * Seeds the landing moment tries, CAREER_SEED first, before a paid landing counts as never coming
 * (a bound, as firstSeed's). Whether the bot lands a jump clean is a property of the seed, and any
 * sim change moves it (P4-6's combat timing took seed 4's only one away), so the moment searches. [default]
 */
const LANDING_SEEDS = 6;

/**
 * Rides on to the player's next clean landing after real air. When the race ends first, the career's
 * first race starts again, as on a new device (the storage cleared; the init scripts set the look and
 * the probe again), on the next seed, and rides to its first one.
 */
async function rideToPaidLanding(page: Page, where: string): Promise<void> {
  for (let i = 0; i < LANDING_SEEDS; i++) {
    const seed = CAREER_SEED + i;
    if (i > 0) {
      await page.evaluate(() => localStorage.clear());
      await page.goto('./');
      await page.evaluate((s) => {
        const g = (window as TestWindow).__game;
        g?.setSeed(s);
        g?.setBot(true);
      }, seed);
      await rideFirstCareerRace(page);
    }
    await page.evaluate(() => {
      const g = (window as TestWindow).__game;
      if (!g) return;
      const from = g.snapshot()?.tick ?? 0;
      const me = g.playerId();
      g.fastForward(
        (s) =>
          s.tick > from + 4 * 60 * 60 ||
          g
            .events()
            .some((e) => e.type === 'land' && e.data?.['surge'] === true && e.actor === me && e.tick > from),
        // 1200 ticks a drawn frame (seed 4 rides about 8,700 ticks to it): the run still stops on the
        // step the landing lands on, then hands back to 4 ticks a frame for the measured settle.
        { perFrame: 1200 },
      );
    });
    await fastForwardDone(page, `${where}: a landing that pays (seed ${seed})`);
    if ((await page.evaluate(() => (window as TestWindow).__game?.state())) === 'race') return;
  }
  throw new Error(
    `${where}: no paid landing before the race's end on seeds ${CAREER_SEED} to ${CAREER_SEED + LANDING_SEEDS - 1}`,
  );
}

/**
 * Rides on until the player's next clean landing after real air (the one that puts a line on the
 * ticker), then measures the strip as a landing line, every frame for a stretch of the settle (the
 * live check found the bike sinking 30 to 64 px as the camera eased back after touchdown): the strip
 * must stay out of the road ahead and off every piece drawn in its frame, the player's bike
 * included. The slow-frames toast is held up beside it where the layout puts the two side by side
 * (stacked, the strip steps aside while the toast shows, so there is no line to measure then). The
 * prompt (the in-air one comes with every first jump) is checked against everything in those frames
 * too. Pairs of the other pieces (the ticker, moving on its own clock) are judged at the frozen
 * moments instead.
 *
 * The real path (the landing's event reaching the strip) can be displaced by a bark that is up at
 * that moment (a lower class waits or is dropped), so the strip is given the regions' widest
 * landing line through the seam, held, and the real path is checked where nothing displaces it: the
 * veto's "recently seen" list, which app/ notes the line in as it puts it on the strip.
 */
async function landingMoment(page: Page, where: string): Promise<string[]> {
  await rideToPaidLanding(page, where);
  const samples = await page.evaluate(async (line) => {
    const w = window as TestWindow;
    const out: { strip: Box; pieces: Piece[]; vw: number; vh: number }[] = [];
    // The strip carries the landing line, held up so the live race cannot displace it.
    w.__uiTicker?.([line], true);
    // The toast held up beside the strip, where ui/ places the two side by side (hidden again after).
    const toast = document.getElementById('look-offer');
    const toastWasHidden = toast?.hidden ?? false;
    const stacked = document.getElementById('ui')?.dataset['top'] === 'stacked';
    if (toast && !stacked) toast.hidden = false;
    // replace() draws synchronously, but its fade-in starts at zero opacity: the painted-piece
    // oracle correctly excludes that initial invisible line. Retain the first visible sample,
    // then require 89 consecutive visible samples; never skip a later disappearance.
    // These are 90 visible post-landing samples. The enclosing test timeout guards readiness
    // hangs; elapsed wall time never truncates coverage. Remount is observed in this seeded run.
    while (out.length < 90) {
      await new Promise((r) => requestAnimationFrame(r));
      const pieces = w.__layoutPieces?.() ?? [];
      const strip = pieces.find((p) => p.name === 'hud-ticker');
      const el = document.getElementById('hud-ticker');
      if (!strip || el?.dataset['cls'] !== 'line' || !el.classList.contains('held')) {
        if (out.length > 0) throw new Error('held landing line disappeared after sampling began');
        continue;
      }
      out.push({
        strip: strip.box,
        pieces: pieces.filter((p) => p !== strip),
        vw: innerWidth,
        vh: innerHeight,
      });
    }
    if (toast) toast.hidden = toastWasHidden;
    return out;
  }, LONGEST_LANDING);
  console.log(
    `${where}: the strip as a landing line in ${samples.length} frames: ${JSON.stringify(samples.slice(0, 3).map((s) => roundBox(s.strip)))} ...`,
  );
  expect(samples.length, `${where}: all 90 consecutive visible post-landing samples measured`).toBe(90);
  const checked = new Set(['career-prompt', 'look-offer', BIKE]);
  const found = new Set<string>();
  const bikes: Box[] = [];
  for (const s of samples) {
    const line: Piece = { name: 'landing-line', box: s.strip };
    const pieces = s.pieces.filter((p) => !p.name.startsWith('div.card'));
    const against = [line, ...pieces.filter((p) => checked.has(p.name))];
    for (const f of layoutFindings(pieces, s.vw, s.vh, against)) found.add(f);
    const bike = pieces.find((p) => p.name === BIKE);
    if (bike) bikes.push(bike.box);
  }
  console.log(`${where}: the player's bike in those frames: ${JSON.stringify(bikes.map(roundBox))}`);
  expect(bikes.length, `${where}: the bike was measured in every landing frame`).toBe(samples.length);
  // The strip never covers the bike, on any frame: the check the HUD run's live check asked for.
  const covering = samples.filter((s) => {
    return s.pieces.some((p) => p.name === BIKE && overlaps(s.strip, p.box));
  });
  expect(covering.length, `${where}: frames where the landing line covers the bike`).toBe(0);
  const first = samples[0];
  if (first) logPieces(`${where}, landing`, first.pieces);
  await recentlySeenHasLanding(page, where);
  return [...found];
}

/**
 * The real path, end to end: app/ put the landing's line on the strip (and noted it as seen), so
 * the pause screen's "recently seen" list names one of the regions' landing lines. The pause ends
 * the case's measuring, so this runs last.
 */
async function recentlySeenHasLanding(page: Page, where: string) {
  await page.keyboard.press('Escape');
  const list = page.locator('#pause-screen #recently-seen');
  await expect(list, `${where}: the pause screen's recently-seen list`).toBeVisible();
  const rows = await list
    .locator('.rs-item')
    .evaluateAll((els) =>
      els.map((e) => ({ ref: e.getAttribute('data-content-ref') ?? '', text: e.textContent ?? '' })),
    );
  console.log(`${where}: recently seen: ${JSON.stringify(rows.map((r) => r.ref))}`);
  const landing = rows.filter((r) => LANDING_LINES.some((l) => r.text.includes(l)));
  expect(
    landing.map((r) => r.ref),
    `${where}: the landing line is in "recently seen" (app/ noted it as it put it on the strip)`,
  ).not.toEqual([]);
  for (const r of landing)
    expect(r.ref, `${where}: a landing line's reference`).toMatch(/^[\w-]+:region\/[\w-]+#[\w-]+$/);
}

/** A whole case's HUD layout: the start, the heat badge and the landing line, against its list. */
async function expectWholeLayout(page: Page, start: Measured, where: string) {
  const found = [...momentFindings(start, `${where}, start`)];
  found.push(...(await heatMoment(page, where)));
  found.push(...(await landingMoment(page, where)));
  expectLayout(found, where);
}

async function offBikeCoverControl(page: Page) {
  const crashFrom = await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    if (!g) throw new Error('race seam missing');
    g.lockstep(1);
    g.setBot(false);
    return g.snapshot()?.tick ?? 0;
  });
  const identity = await page.evaluate(() => (window as TestWindow).__playerIdentityControl?.());
  expect(identity?.planted, 'a real rival rig was planted at the followed player').toBe(true);
  expect(identity?.unchanged, 'nearby rival geometry never replaces followed-player geometry').toBe(true);
  expect(identity?.maskBound, 'actual mask assigns followed-player white and rival materials black').toBe(
    true,
  );
  for (const mode of ['Tumble', 'OnFoot']) {
    if (mode === 'Tumble') {
      // A deliberately overheld wheelie causes a real crash. The bot's incidental next collision
      // is not a layout contract: better riding must not make these physical controls disappear.
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyH');
    }
    const result = await page.evaluate(
      ({ mode, crashFrom }) => {
        const w = window as TestWindow;
        const g = w.__game;
        if (!g) throw new Error('race seam missing');
        const self = () =>
          g.snapshot()?.entities?.find((e) => e.id === g.playerId()) as { mode?: string } | undefined;
        const measure = () => {
          const parts = w.__playerParts?.() ?? [];
          const covers = ['bike', 'rider'].map((kind) => {
            const part = parts
              .filter((p) => p.kind === kind)
              .sort(
                (a, b) =>
                  (b.box.right - b.box.left) * (b.box.bottom - b.box.top) -
                  (a.box.right - a.box.left) * (a.box.bottom - a.box.top),
              )[0];
            if (!part) return null;
            const d = document.createElement('div');
            d.id = `planted-${kind}-cover`;
            Object.assign(d.style, {
              position: 'fixed',
              left: `${part.box.left}px`,
              top: `${part.box.top}px`,
              width: `${part.box.right - part.box.left}px`,
              height: `${part.box.bottom - part.box.top}px`,
              background: '#f0f',
              zIndex: '99',
            });
            document.getElementById('hud')?.append(d);
            return d.id;
          });
          return {
            mode: self()?.mode,
            tick: g.snapshot()?.tick,
            loopOut: g
              .events()
              .some(
                (e) =>
                  e.type === 'crash' &&
                  e.actor === g.playerId() &&
                  e.tick > crashFrom &&
                  e.data?.['cause'] === 'wheelie' &&
                  e.data?.['loopOut'] === true,
              ),
            kinds: [...new Set(parts.map((p) => p.kind))],
            covers,
            pieces: w.__layoutPieces?.() ?? [],
            w: innerWidth,
            h: innerHeight,
          };
        };
        const from = g.snapshot()?.tick ?? 0;
        return new Promise<ReturnType<typeof measure>>((resolve) => {
          g.fastForward(
            (s) => {
              if (self()?.mode !== mode && s.tick <= from + 1200) return false;
              // The loop draws this actual sim state after its step listeners, then schedules its
              // next frame. This callback was queued first, so it measures that draw before another
              // tick can remount a rider whose bike is already nearby. Zero lockstep means real time,
              // not a freeze; use the valid one-tick hand-back and keep observation in this task.
              requestAnimationFrame(() => resolve(measure()));
              return true;
            },
            { then: 1 },
          );
        });
      },
      { mode, crashFrom },
    );
    await fastForwardDone(page, `off-bike cover control: ${mode} measured at tick ${result.tick}`);
    if (mode === 'Tumble') {
      await page.keyboard.up('KeyH');
      await page.keyboard.up('KeyW');
      expect(result.loopOut, 'the held wheelie caused the real player crash').toBe(true);
    }
    expect(result.mode, 'the real race reached the detached state').toBe(mode);
    expect(result.kinds.sort(), `${mode}: both actual bodies measured`).toEqual(['bike', 'rider']);
    const found = layoutFindings(result.pieces, result.w, result.h);
    for (const kind of ['bike', 'rider'])
      expect(found, `${mode}: visible ${kind} cover detected`).toContain(`planted-${kind}-cover × ${BIKE}`);
    await page.evaluate(() =>
      document.querySelectorAll('[id^="planted-"][id$="-cover"]').forEach((e) => e.remove()),
    );
  }
}

test('detached bike and get-up body stay measured through real mode transitions (negative control)', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await startRace(page, { career: true });
  await heatMoment(page, 'off-bike control');
  await rideToPaidLanding(page, 'off-bike control');
  await offBikeCoverControl(page);
});

test('phone landscape: the ticker sits clear of the road ahead, stays small and fades quickly', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const problems = watchErrors(page);
  await startRace(page, { career: true });
  const bark = await tickerAndMeasure(page, [LONGEST_BARK]);
  expectClear(bark, 'phone landscape, bark');
  expectCompact(bark, 'phone landscape, bark');
  expect(bark.ticker?.text).toBe(`Deacon Vane ${LONGEST_LINE}`);
  await shot(page, 'phone');

  const chip = await tickerAndMeasure(page, [WIDE_CHIP]);
  expectClear(chip, 'phone landscape, chip');
  expectCompact(chip, 'phone landscape, chip');
  expect(chip.ticker?.text).toBe('NEAR MISS ×12 +$12,345');

  // A takedown name flashes small.
  const name = await tickerAndMeasure(page, [NAME]);
  expectClear(name, 'phone landscape, name');
  expect(name.ticker?.fontPx, 'a takedown name is small').toBeLessThanOrEqual(12);

  // The producer's longest ask and the widest landing line (T8.2: both are ticker items now).
  const ask = await tickerAndMeasure(page, [LONGEST_ASK]);
  expectClear(ask, 'phone landscape, ask');
  expectCompact(ask, 'phone landscape, ask');
  expect(ask.ticker?.text, 'the ask is tagged PRODUCER and shows its cash').toMatch(/^PRODUCER .+ \+\$\d+$/);
  const landing = await tickerAndMeasure(page, [LONGEST_LANDING]);
  expectClear(landing, 'phone landscape, landing line');
  expectCompact(landing, 'phone landscape, landing line');
  expect(landing.ticker?.cls).toBe('line');

  // A quick fade: a chip left to itself is gone well inside a few seconds (1.1 s of the strip's clock).
  await page.evaluate(() =>
    (window as TestWindow).__uiTicker?.(
      [{ cls: 'style', text: 'NEAR MISS', kind: 'nearMiss', cash: 25 }],
      false,
    ),
  );
  const before = Date.now();
  await page.waitForFunction(
    () => {
      const root = document.getElementById('hud-ticker');
      return !root || root.hidden || !(root.textContent ?? '').includes('NEAR MISS');
    },
    null,
    { timeout: 6_000 },
  );
  console.log(`chip gone ${Date.now() - before} ms after it was shown`);

  await expectWholeLayout(page, bark, 'phone landscape');
  expect(problems).toEqual([]);
});

// An upright screen races only as a narrow window with a fine pointer: a phone or tablet held
// upright shows platform/'s rotate screen and pauses (any touch device, `updateRotate`), so there
// are no touch buttons on it (until 2026-10-04 this case raced with touch and the portrait shim, a
// screen no player sees).
test.describe('phone portrait', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: false, hasTouch: false });
  for (const textSize of ['normal', 'large', 'largest'])
    test(`mirrored prompts stay clear with ${textSize} text`, async ({ page }) => {
      await page.addInitScript((size) => {
        localStorage.setItem(
          'mbrawl:settings',
          JSON.stringify({
            format: 'settings',
            version: 1,
            build: 'test',
            savedAt: '2026-10-10T00:00:00.000Z',
            data: { mirror: true, textSize: size },
          }),
        );
      }, textSize);
      await startRace(page, { career: true });
      const m = await tickerAndMeasure(page, [LONGEST_BARK], { prompts: CAREER_PROMPTS });
      expect(momentFindings(m, `portrait mirrored ${textSize}`, true)).toEqual([]);
      for (const p of m.prompts) {
        expect(p.hidden, 'the tutorial remains visible').toBe(false);
        expect(p.box.top, 'the prompt stays below the reserved rider area').toBeGreaterThan(
          m.viewport.h * 0.82,
        );
      }
    });
  test('the ticker sits clear of the road ahead', async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watchErrors(page);
    await startRace(page, { career: true });
    const m = await tickerAndMeasure(page, [LONGEST_BARK], { prompts: CAREER_PROMPTS });
    expectClear(m, 'phone portrait');
    expectCompact(m, 'phone portrait');
    expect(momentFindings(m, 'phone portrait, every prompt', true)).toEqual([]);
    await shot(page, 'portrait');
    await expectWholeLayout(page, m, 'phone portrait');
    expect(problems).toEqual([]);
  });
});

test.describe('laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false });
  test('the ticker sits clear of the road ahead', async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watchErrors(page);
    await startRace(page, { classic: true, career: true });
    const m = await tickerAndMeasure(page, [LONGEST_BARK]);
    expectClear(m, 'laptop');
    expectCompact(m, 'laptop');
    await shot(page, 'laptop');
    await expectWholeLayout(page, m, 'laptop');
    expect(problems).toEqual([]);
  });
});
