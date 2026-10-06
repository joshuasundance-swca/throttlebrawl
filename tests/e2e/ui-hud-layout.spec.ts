import { expect, test, type Page } from '@playwright/test';
import { rideFirstCareerRace } from './career-start';

// The HUD's top layout (playtest 3, the maintainer: "The race objective sits over the heat meter";
// design spec "HUD layout: nothing overlaps"; ui/hud-layout.ts). hud-layout.test.ts checks the slots
// the rules give each screen; this measures the real widgets in a career race and holds each inside
// its slot, with the objective and the ticker's longest line up and the slow-frames offer and the
// rival's bar shown beside them. ui-style-popups.spec.ts is the whole-HUD check (the heat badge, the
// prompts, the landing line, the road ahead); this one is about the top layout's own contract: the
// mode it picks, the slots it reserves, the objective's two-line clamp.

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface Measured {
  mode: string;
  /** The text factor the page draws with (its root size over 16 px). */
  scale: number;
  w: number;
  h: number;
  vars: Record<string, string>;
  pieces: { name: string; box: Box }[];
  tickerText: string;
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: {
    setBot(on: boolean): void;
    setSeed(seed: number): void;
    state(): string;
    snapshot(): { tick: number } | null;
  };
  __uiTicker?: (
    items: { cls: string; text: string; tag?: string; contentRef?: string; dwellMs?: number }[],
  ) => void;
};

/** A career race's long objective line (the longest the career writes is about this wide). */
const LONG_OBJECTIVE = 'TIMBER 1/3: INTO TRAFFIC OR SCENERY · FINISH TOP 3 · NO SIREN PUNCHES';
const LONG_BARK =
  'You took the long way round and I respect that, said the man in the lane you were not in at all';

async function startRace(
  page: Page,
  opts: { career: boolean; mirror?: boolean; textSize?: 'large' | 'largest' },
) {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  if (opts.career) {
    // The bot rides from the first tick, so every case rides the same race.
    await page.evaluate(() => {
      const g = (window as TestWindow).__game;
      g?.setSeed(4);
      g?.setBot(true);
    });
  }
  if (opts.career) {
    await rideFirstCareerRace(page);
    await expect(page.locator('#hud-objective')).toBeVisible();
  } else {
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    if (opts.mirror) {
      await page.locator('#menu-settings').click();
      await page.locator('#settings-tab-controls').click();
      await page.locator('#settings-mirror').check();
      await page.keyboard.press('Escape');
      await expect(page.locator('#menu-race')).toBeVisible();
    }
    if (opts.textSize) {
      await page.locator('#menu-settings').click();
      await page.locator('#settings-tab-access').click();
      await page.locator(`#settings-textSize [data-value="${opts.textSize}"]`).click();
      await page.keyboard.press('Escape');
      await expect(page.locator('#menu-race')).toBeVisible();
    }
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await page.locator('#menu-race').click();
    await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
  }
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 20);
}

/** Puts the longest objective and bark up, shows the offer and the rival's bar, and measures every piece. */
function measure(page: Page): Promise<Measured> {
  return page.evaluate(
    ({ objective, bark }) => {
      const w = window as TestWindow;
      const objectiveEl = document.getElementById('hud-objective');
      if (objectiveEl) objectiveEl.textContent = objective;
      w.__uiTicker?.([
        { cls: 'bark', tag: 'Deacon Vane', text: bark, contentRef: 'base:bark-set/test#1', dwellMs: 600_000 },
      ]);
      const root = document.getElementById('ui');
      for (const a of document.getAnimations()) a.finish();
      // The strip as it rests before the offer comes up (a stacked layout hides the strip while it shows).
      const tickerEl = document.getElementById('hud-ticker');
      const tickerRect = tickerEl && tickerEl.checkVisibility() ? tickerEl.getBoundingClientRect() : null;
      const shown = ['look-offer', 'hud-target', 'hud-objective']
        .map((id) => document.getElementById(id))
        .filter((e): e is HTMLElement => !!e && e.hidden === true);
      for (const e of shown) e.hidden = false;
      const pieces: { name: string; box: Box }[] = [];
      const sel = ['#hud > *', '#career-overlays > *', '#touch-surface > .touch-button', '#look-offer'].join(
        ', ',
      );
      for (const e of new Set(document.querySelectorAll<HTMLElement>(sel))) {
        if (e.id === 'career-overlays' || e.id === 'career-prompt') continue;
        if (!e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        pieces.push({
          name: e.id || e.className,
          box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        });
      }
      if (tickerRect && !pieces.some((p) => p.name === 'hud-ticker'))
        pieces.push({
          name: 'hud-ticker',
          box: {
            left: tickerRect.left,
            top: tickerRect.top,
            right: tickerRect.right,
            bottom: tickerRect.bottom,
          },
        });
      const vars: Record<string, string> = {};
      for (const n of [
        '--hl-ticker-x',
        '--hl-ticker-y',
        '--hl-ticker-w',
        '--hl-toast-x',
        '--hl-toast-y',
        '--hl-toast-mw',
        '--hl-obj-y',
        '--hl-obj-w',
        '--hl-heat-y',
      ])
        vars[n] = root?.style.getPropertyValue(n) ?? '';
      const tickerText = document.getElementById('hud-ticker')?.textContent ?? '';
      for (const e of shown) e.hidden = true;
      return {
        mode: root?.dataset['top'] ?? '',
        scale: parseFloat(getComputedStyle(document.documentElement).fontSize) / 16,
        w: window.innerWidth,
        h: window.innerHeight,
        vars,
        pieces,
        tickerText,
      };
    },
    { objective: LONG_OBJECTIVE, bark: LONG_BARK },
  );
}

const overlap = (a: Box, b: Box) =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
const px = (v: string | undefined) => parseFloat(v ?? '');

/** `mode` null: the layout may pick either (a text size makes the choice itself, by the room it has). */
function expectTopLayout(m: Measured, where: string, expected: string | null) {
  const mode = expected ?? m.mode;
  console.log(
    `${where}: mode ${m.mode}; ${m.pieces.map((p) => `${p.name} [${[p.box.left, p.box.top, p.box.right, p.box.bottom].map(Math.round).join(',')}]`).join('; ')}`,
  );
  if (expected !== null) expect(m.mode, `${where}: the layout's mode`).toBe(mode);
  const byName = new Map(m.pieces.map((p) => [p.name, p.box]));
  for (const must of ['hud-position', 'hud-ticker', 'hud-objective', 'hud-target', 'look-offer', 'hud-pause'])
    expect(byName.has(must), `${where}: measured ${must}`).toBe(true);
  // The slot the plan reserved holds the widget it was reserved for.
  const ticker = byName.get('hud-ticker') as Box;
  const slotL = px(m.vars['--hl-ticker-x']) - px(m.vars['--hl-ticker-w']) / 2;
  const slotR = px(m.vars['--hl-ticker-x']) + px(m.vars['--hl-ticker-w']) / 2;
  expect(ticker.left, `${where}: the ticker inside its slot`).toBeGreaterThanOrEqual(slotL - 1);
  expect(ticker.right, `${where}: the ticker inside its slot`).toBeLessThanOrEqual(slotR + 1);
  expect(ticker.top, `${where}: the ticker at its slot's top`).toBeGreaterThanOrEqual(
    px(m.vars['--hl-ticker-y']) - 1,
  );
  expect(ticker.bottom - ticker.top, `${where}: the ticker is one slot high`).toBeLessThanOrEqual(
    44 * m.scale + 0.5,
  );
  const objective = byName.get('hud-objective') as Box;
  expect(objective.top, `${where}: the objective at its slot's top`).toBeGreaterThanOrEqual(
    px(m.vars['--hl-obj-y']) - 1,
  );
  expect(objective.right - objective.left, `${where}: the objective inside its slot`).toBeLessThanOrEqual(
    px(m.vars['--hl-obj-w']) + 1,
  );
  // Lines of 16 px and 2 px of padding each side: the clamp holds the long line to its slot (three
  // lines in the inline layout's narrow far column, two in the stacked row).
  const lines = mode === 'stacked' ? 2 : 3;
  expect(
    objective.bottom - objective.top,
    `${where}: the objective clamps to ${lines} lines`,
  ).toBeLessThanOrEqual(lines * 16 * m.scale + 4.5);
  // The slow-frames offer shares the ticker's slot only where the layout is stacked.
  const toast = byName.get('look-offer') as Box;
  const toastX = px(m.vars['--hl-toast-x']);
  const toastW = px(m.vars['--hl-toast-mw']);
  expect(toast.left, `${where}: the offer inside its slot`).toBeGreaterThanOrEqual(
    (mode === 'stacked' ? toastX - toastW / 2 : toastX) - 1,
  );
  expect(toast.right, `${where}: the offer inside its slot`).toBeLessThanOrEqual(
    (mode === 'stacked' ? toastX + toastW / 2 : toastX + toastW) + 1,
  );
  // No two pieces overlap (the offer and the strip share a slot when stacked: the strip steps aside).
  const found: string[] = [];
  for (const [i, a] of m.pieces.entries())
    for (const b of m.pieces.slice(i + 1)) {
      const pair = [a.name, b.name].sort().join(' × ');
      if (mode === 'stacked' && pair === 'hud-ticker × look-offer') continue;
      if (overlap(a.box, b.box)) found.push(pair);
    }
  expect(found, `${where}: overlapping pieces`).toEqual([]);
}

test('phone landscape: inline ticker, the objective in the far column, nothing overlapping', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await startRace(page, { career: true });
  expectTopLayout(await measure(page), 'phone landscape', 'inline');
});

// A quick race has no objective of its own: the measure puts one in its slot, as a career race shows it.
test('phone landscape, left-handed mirror: the columns flip and nothing overlaps', async ({ page }) => {
  test.setTimeout(120_000);
  await startRace(page, { career: false, mirror: true });
  const m = await measure(page);
  expectTopLayout(m, 'mirrored', 'inline');
  const byName = new Map(m.pieces.map((p) => [p.name, p.box]));
  const objective = byName.get('hud-objective') as Box;
  expect(objective.right, 'the objective is on the left, with the pause button').toBeLessThan(m.w / 2);
});

test.describe('small phone landscape', () => {
  test.use({ viewport: { width: 640, height: 360 } });
  test('the ticker, the objective and the offer still fit', async ({ page }) => {
    test.setTimeout(120_000);
    await startRace(page, { career: true });
    expectTopLayout(await measure(page), 'small phone', 'inline');
  });
});

// An upright screen races only as a narrow window with a fine pointer (a touch device shows the
// rotate screen instead): the ticker takes its own row and the objective and heat share the next.
test.describe('narrow upright window', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: false, hasTouch: false });
  test('the ticker stacks under the top row and nothing overlaps', async ({ page }) => {
    test.setTimeout(120_000);
    await startRace(page, { career: true });
    const m = await measure(page);
    expectTopLayout(m, 'narrow upright', 'stacked');
    const byName = new Map(m.pieces.map((p) => [p.name, p.box]));
    expect((byName.get('hud-ticker') as Box).top, 'the strip is under the pause button').toBeGreaterThan(
      (byName.get('hud-pause') as Box).bottom,
    );
  });
});

test.describe('laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false });
  test('the strip sits inline and the columns stay out of the road ahead', async ({ page }) => {
    test.setTimeout(120_000);
    await startRace(page, { career: true });
    const m = await measure(page);
    expectTopLayout(m, 'laptop', 'inline');
    const objective = m.pieces.find((p) => p.name === 'hud-objective')?.box as Box;
    expect(objective.left, 'the objective is past the road ahead').toBeGreaterThanOrEqual(m.w * 0.75 - 0.5);
  });
});

// M5's a11y-1 (playtest 4 run B, B13): the same contract at the larger text sizes. The slots grow with
// the text (ui/hud-layout.ts rule 7), and on a short screen the factor is capped by its height, so the
// pieces still fit: hud-layout.test.ts holds the plan, this measures the real widgets.
test.describe('the largest text size', () => {
  test('phone landscape: the ticker, the objective and the offer keep to their larger slots', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await startRace(page, { career: false, textSize: 'largest' });
    const m = await measure(page);
    expect(m.scale, 'the whole of the largest factor fits a 412 px high phone').toBeCloseTo(1.4, 2);
    expectTopLayout(m, 'largest, phone landscape', 'inline');
  });

  test.describe('small phone landscape', () => {
    test.use({ viewport: { width: 640, height: 360 } });
    test('a short screen takes a smaller factor, and the pieces still fit', async ({ page }) => {
      test.setTimeout(120_000);
      await startRace(page, { career: false, textSize: 'largest' });
      const m = await measure(page);
      expect(m.scale, 'capped by the 360 px height').toBeLessThan(1.4);
      expect(m.scale).toBeGreaterThan(1);
      expectTopLayout(m, 'largest, small phone', null);
    });
  });
});
