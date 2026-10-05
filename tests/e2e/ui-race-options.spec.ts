import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Playtest 4 (P4-12, P4-13): the menu race's options screen.
//
// - Layout, from painted boxes at the short phone sizes and the default phone: the screen's Back and
//   Race are on the screen as it opens, and every option row, scrolled into its list, lies on the
//   screen with arrows and value at least 44 px tall, and a tap at an arrow's centre lands on it;
//   the build stamp covers no word of the screen. A negative control plants a row off the screen and
//   words under the stamp, and the same measures must name them.
// - The picks reach the race and are remembered: cops off, no rivals and another bike, then Race;
//   the race fields no law and no rival, the player rides the picked bike, and the replay header
//   carries the picks beside the config. After a reload the screen shows the same picks.
// The waits are on state (a screen shown, a tick), never on time.

interface Entity {
  kind: string;
  faction?: string;
  contentId: string;
}
interface Handle {
  state(): string;
  snapshot(): { tick: number; entities: Entity[] } | null;
  debugFileText(): string;
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

const REPLAY_MARKER = '===== replay (one line of JSON) =====';

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

async function openOptions(page: Page) {
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-options')).toBeVisible();
  await page.locator('#menu-options').click();
  await expect(page.locator('#race-options')).toBeVisible();
  await expect(page.locator('#race-options .ro-row').first()).toBeVisible();
}

/** A frame or two, so the stamp's own check (it re-runs a frame after a screen changes) has settled. */
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/** What the screen's measure returns. */
interface Measure {
  rows: string[];
  controls: number;
  off: string[];
  small: string[];
  missed: string[];
  words: number;
  under: string[];
}
type MeasureWindow = TestWindow & { __measureRaceOptions?: () => Measure };

/**
 * Plants the screen's measure in the page, so a case can plant a piece and measure in one step (the
 * stamp steps away from words a frame after they appear). It returns the controls that are not fully
 * on the screen (each row scrolled into its list first), the controls under 44 px, the arrows a tap
 * at the centre misses, and the words under the build stamp.
 */
async function installMeasure(page: Page) {
  await page.addInitScript(() => {
    (window as MeasureWindow).__measureRaceOptions = () => {
      const onScreen = (r: DOMRect) =>
        r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
      const name = (e: Element) => e.id || e.className || e.tagName.toLowerCase();
      const off: string[] = [];
      const small: string[] = [];
      const missed: string[] = [];
      let controls = 0;
      // Back and Race, as the screen opens.
      for (const id of ['race-options-back', 'race-options-race']) {
        const e = document.getElementById(id);
        if (!e || !e.checkVisibility()) off.push(`${id} (not shown)`);
        else if (!onScreen(e.getBoundingClientRect())) off.push(id);
      }
      const rows = [...document.querySelectorAll<HTMLElement>('#race-options .ro-row')].filter((r) =>
        r.checkVisibility(),
      );
      for (const row of rows) {
        row.scrollIntoView({ block: 'nearest' });
        for (const b of row.querySelectorAll<HTMLElement>('button')) {
          controls++;
          const r = b.getBoundingClientRect();
          if (!onScreen(r))
            off.push(`${name(b)} [${[r.left, r.top, r.right, r.bottom].map(Math.round).join(',')}]`);
          if (r.height < 43.5 || r.width < 43.5)
            small.push(`${name(b)} ${Math.round(r.width)}x${Math.round(r.height)}`);
          if (b.classList.contains('ro-step')) {
            const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (at !== b && !b.contains(at)) missed.push(`${name(b)} hit ${at ? name(at) : 'nothing'}`);
          }
        }
      }
      // The words under the stamp, line by line.
      const stamp = document.getElementById('build-stamp');
      const sb = stamp && stamp.checkVisibility() ? stamp.getBoundingClientRect() : null;
      const under: string[] = [];
      const screen = document.getElementById('race-options');
      let words = 0;
      if (screen) {
        const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = (n.textContent ?? '').trim();
          if (!text || !n.parentElement?.checkVisibility()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) {
            if (r.width < 1 || r.height < 1) continue;
            words++;
            const hit =
              sb &&
              r.left < sb.right - 0.5 &&
              sb.left < r.right - 0.5 &&
              r.top < sb.bottom - 0.5 &&
              sb.top < r.bottom - 0.5;
            if (hit) under.push(`"${text.slice(0, 30)}"`);
          }
        }
      }
      return { rows: rows.map((r) => r.dataset['option'] ?? ''), controls, off, small, missed, words, under };
    };
  });
}

const measure = (page: Page) =>
  page.evaluate(() => {
    const m = (window as MeasureWindow).__measureRaceOptions;
    if (!m) throw new Error('the measure is not installed');
    return m();
  });
for (const [where, width, height] of [
  ['568x320', 568, 320],
  ['640x360', 640, 360],
  ['740x360', 740, 360],
  ['915x412', 915, 412],
] as const) {
  test.describe(`race options at ${where}`, () => {
    test.use({ viewport: { width, height } });

    test('every option is on the screen and big enough to tap, Back and Race too, and the stamp covers no word', async ({
      page,
    }) => {
      const problems = watchErrors(page);
      await page.addInitScript(() => {
        (window as TestWindow).__GAME_TEST__ = true;
      });
      await installMeasure(page);
      await page.goto('./');
      await openOptions(page);
      await settle(page);
      const m = await measure(page);
      console.log(`${where}: ${JSON.stringify(m)}`);
      expect(m.rows, `${where}: the options`).toEqual(
        expect.arrayContaining(['bike', 'time', 'weather', 'rivals', 'cops', 'difficulty', 'traffic']),
      );
      expect(m.controls, `${where}: three controls a row`).toBe(m.rows.length * 3);
      expect(m.off, `${where}: controls off the screen`).toEqual([]);
      expect(m.small, `${where}: controls under 44 px`).toEqual([]);
      expect(m.missed, `${where}: arrows a tap at the centre misses`).toEqual([]);
      expect(m.words, `${where}: words were measured`).toBeGreaterThan(10);
      expect(m.under, `${where}: words under the stamp`).toEqual([]);
      mkdirSync('test-results/screenshots', { recursive: true });
      await page.screenshot({ path: `test-results/screenshots/ui-race-options-${where}.png` });

      // The measures can fire: a row planted off the screen and words planted under the stamp (forced
      // shown at its home corner), measured in the same step.
      const again = await page.evaluate(() => {
        const list = document.getElementById('race-options-list');
        const stamp = document.getElementById('build-stamp');
        const m = (window as MeasureWindow).__measureRaceOptions;
        if (!list || !stamp || !m) throw new Error('no list, stamp or measure');
        const row = document.createElement('div');
        row.className = 'ro-row';
        Object.assign(row.style, { position: 'fixed', left: '-400px', top: '0px', width: '200px' });
        const b = document.createElement('button');
        b.id = 'planted-button';
        b.textContent = 'PLANTED';
        row.append(b);
        list.append(row);
        stamp.classList.remove('at-right', 'yield');
        stamp.style.display = 'block';
        const r = stamp.getBoundingClientRect();
        const words = document.createElement('span');
        words.textContent = 'PLANTED WORDS';
        Object.assign(words.style, {
          position: 'fixed',
          left: `${r.left}px`,
          top: `${r.top}px`,
          zIndex: '3',
        });
        document.getElementById('race-options')?.append(words);
        const found = m();
        row.remove();
        words.remove();
        stamp.style.display = '';
        return found;
      });
      expect(
        again.off.some((o) => o.startsWith('planted-button')),
        'the off-screen measure names the planted row',
      ).toBe(true);
      expect(
        again.under.some((u) => u.includes('PLANTED WORDS')),
        'the stamp measure names the planted words',
      ).toBe(true);
      expect(problems).toEqual([]);
    });
  });
}

test('the picks reach the race and its recording, and are remembered after a reload', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await openOptions(page);
  const value = (id: string) => page.locator(`#race-option-${id}`).getAttribute('data-value');
  // The defaults are the race as it was: the garage's bike, the usual field, the law on.
  expect(await value('bike')).toBe('');
  expect(await value('rivals')).toBe('');
  expect(await value('cops')).toBe('true');
  // Cops off, no rivals (the step after Usual), and the first bike on offer.
  await page.locator('#race-option-cops-next').click();
  await expect(page.locator('#race-option-cops')).toHaveAttribute('data-value', 'false');
  await page.locator('#race-option-rivals-next').click();
  await expect(page.locator('#race-option-rivals')).toHaveAttribute('data-value', '0');
  await page.locator('#race-option-bike-value').click();
  const bike = (await value('bike')) ?? '';
  expect(bike, 'a bike was picked').toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);

  await page.locator('#race-options-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 30, null, {
    timeout: 60_000,
  });
  const riders = await page.evaluate(
    () => (window as TestWindow).__game?.snapshot()?.entities.filter((e) => e.kind === 'rider') ?? [],
  );
  console.log(`[print] riders ${riders.map((r) => `${r.contentId} (${r.faction ?? '?'})`).join(', ')}`);
  expect(
    riders.map((r) => r.contentId),
    'only the player rides: no rival, no law',
  ).toEqual(['base:player']);

  const text = await page.evaluate(() => (window as TestWindow).__game?.debugFileText() ?? '');
  const lines = text.split('\n');
  const replay = JSON.parse(lines[lines.indexOf(REPLAY_MARKER) + 1] ?? 'null') as {
    header?: {
      raceOptions?: Record<string, unknown>;
      config?: {
        riders?: { role: string; bike: { contentId: string } }[];
        event?: { cops?: { mode?: string } };
      };
    };
  } | null;
  const header = replay?.header;
  console.log(`[print] header raceOptions ${JSON.stringify(header?.raceOptions)}`);
  expect(header?.raceOptions).toMatchObject({ cops: false, rivals: 0, bike });
  expect(header?.config?.riders?.find((r) => r.role === 'player')?.bike.contentId).toBe(bike);
  expect(header?.config?.event?.cops?.mode).toBe('none');

  // Remembered: a reload shows the same picks.
  await page.reload();
  await openOptions(page);
  await expect(page.locator('#race-option-cops')).toHaveAttribute('data-value', 'false');
  await expect(page.locator('#race-option-rivals')).toHaveAttribute('data-value', '0');
  await expect(page.locator('#race-option-bike')).toHaveAttribute('data-value', bike);
  expect(problems).toEqual([]);
});
