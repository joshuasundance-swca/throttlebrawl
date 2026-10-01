import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Playtest 1c (2026-09-30, the roadmap change): "start adding other regions". The menu's region
// picker lists every region app/'s registry offers, in the zine menu style, with the Keys picked by
// default. Picking a region and tapping Race starts a race THERE: the race's recorded event (the
// replay header the debug file carries) belongs to the picked region, read from the pack files on
// disk, so the check is the race's own record and not the picker's state.

type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: { snapshot(): { tick: number } | null; debugFileText(): string; state(): string };
};

const REPLAY_MARKER = '===== replay (one line of JSON) =====';
const bare = (id: string) => id.slice(id.indexOf(':') + 1);

/** Every event file in every pack on disk: its bare id and its region's bare id. */
function eventRegions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const pack of readdirSync('packs')) {
    const dir = join('packs', pack, 'events');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const e = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { id: string; region: string };
      out.set(bare(e.id), bare(e.region));
    }
  }
  return out;
}

async function toMenu(page: Page) {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
}

/** The recorded event of the race running now, from the debug file's replay header. */
async function raceEventId(page: Page): Promise<string> {
  const text = await page.evaluate(() => (window as TestWindow).__game?.debugFileText() ?? '');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const replay = JSON.parse(lines[lines.indexOf(REPLAY_MARKER) + 1] ?? 'null') as {
    header?: { eventId?: string };
  } | null;
  return replay?.header?.eventId ?? '';
}

/**
 * True once app/ hands regions to the ui (the runtime lane's wiring): any app/ source that passes
 * `regions:` to the ui, calls `setRegions(`, or reads `ui.region` / `onRegionChange`. Until then
 * the picker stays hidden by design and this test reports SKIPPED, never passed. Once armed, a
 * missing or ignored picker fails it.
 */
function appWiresRegions(): boolean {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.ts') && !d.name.endsWith('.test.ts')) files.push(p);
    }
  };
  walk(join('src', 'app'));
  return files.some((f) =>
    /setRegions\(|onRegionChange|\bui\.region\b|\bregions\s*:/.test(readFileSync(f, 'utf8')),
  );
}

test('the menu offers the regions, the Keys picked by default, and a pick starts the race there', async ({
  page,
}) => {
  test.skip(!appWiresRegions(), 'app/ does not hand the region registry to the ui yet (runtime lane)');
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  const events = eventRegions();
  await toMenu(page);

  const picker = page.locator('#region-picker');
  await expect(picker, 'app/ hands the registry regions to the picker').toBeVisible();
  const chips = picker.locator('button.region');
  const count = await chips.count();
  const ids = await chips.evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset['region'] ?? ''));
  console.log(`regions offered: ${count} (${ids.join(', ')})`);
  expect(count).toBeGreaterThanOrEqual(1);
  // The default is the Keys, and exactly one chip is picked.
  const checked = picker.locator('button.region[aria-checked="true"]');
  await expect(checked).toHaveCount(1);
  expect(bare((await checked.getAttribute('data-region')) ?? '')).toBe('florida-keys');
  // On the phone-landscape screen the picker and the Race button are on screen together.
  const view = page.viewportSize()!;
  for (const loc of [picker, page.locator('#menu-race')]) {
    const b = (await loc.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(view.height);
  }
  await page.screenshot({ path: 'test-results/region-picker-menu.png' });

  // Every region in turn, the non-default ones first, then the Keys again: pick, race, check, quit.
  const order = [
    ...ids.filter((id) => bare(id) !== 'florida-keys'),
    ...ids.filter((id) => bare(id) === 'florida-keys'),
  ];
  for (const id of order) {
    const chip = picker.locator(`button.region[data-region="${id}"]`);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-checked', 'true');
    await expect(checked).toHaveCount(1);
    await page.locator('#menu-race').click();
    await expect(page.locator('#hud-position')).toBeVisible();
    await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 30);
    const eventId = await raceEventId(page);
    const raced = events.get(bare(eventId));
    console.log(`picked ${id}: race event ${eventId}, region ${raced ?? '(unknown event)'}`);
    expect(raced, `the race's event ${eventId} is in the picked region`).toBe(bare(id));
    await page.screenshot({ path: `test-results/region-race-${bare(id)}.png` });
    await page.locator('#hud-pause').click();
    await page.locator('#pause-quit').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    // The pick survives the trip back to the menu.
    await expect(chip).toHaveAttribute('aria-checked', 'true');
  }
  expect(problems).toEqual([]);
});
