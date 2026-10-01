import { expect, test, type Page } from '@playwright/test';

// Set pieces from the race seed, in the real game (playtest 1c item 2, 2026-09-30: "I want
// randomness so you don't see the same cars in the same order, ramp truck in the same place").
// The sim picks one candidate per set-piece slot from the race seed (#190); render draws only the
// picked one, and reports what it drew in rendererStats().setPieces. Each region's race starts with
// one seed, then Restart starts another: the drawn ramp trucks and boost pads must follow the seed,
// and where a track has slot candidates, two seeds that pick differently draw them in different
// places. A track whose set pieces carry no slot draws every one of them for every seed.

interface DrawnSetPiece {
  id: string;
  kind: string;
  slot: string | null;
  x: number;
  z: number;
}
interface Handle {
  snapshot(): { tick: number } | null;
  setSeed(seed: number): void;
  rendererStats(): { setPieces?: readonly DrawnSetPiece[] };
}
type TestWindow = Window & { __GAME_TEST__?: boolean; __game?: Handle };

const REGIONS = [
  { chip: '#region-base-florida-keys', name: 'The Keys' },
  { chip: '#region-region-pnw-pacific-northwest', name: 'The Pacific Northwest' },
  { chip: '#region-region-sf-san-francisco', name: 'San Francisco' },
];

async function drawnAfterStart(page: Page): Promise<readonly DrawnSetPiece[]> {
  await expect(page.locator('#hud-position')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 5, null, {
    timeout: 30_000,
  });
  return page.evaluate(() => (window as TestWindow).__game?.rendererStats().setPieces ?? []);
}

const where = (pieces: readonly DrawnSetPiece[]) =>
  pieces.map((p) => `${p.kind} ${p.id} @ ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).sort();

for (const region of REGIONS) {
  test(`${region.name}: the drawn ramp trucks and boost pads follow the race seed`, async ({ page }) => {
    test.setTimeout(150_000);
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    await page.addInitScript(() => {
      (window as TestWindow).__GAME_TEST__ = true;
    });
    await page.goto('./');
    await page.locator('#start-screen').click();
    await page.locator(region.chip).click();
    await page.evaluate(() => (window as TestWindow).__game?.setSeed(1));
    await page.locator('#menu-race').click();
    const first = await drawnAfterStart(page);
    expect(first.length, 'the race draws its set pieces').toBeGreaterThan(0);
    // At most one candidate per slot is ever drawn.
    const slots = first.map((p) => p.slot).filter((s): s is string => s !== null);
    expect(new Set(slots).size).toBe(slots.length);

    // Restart with other seeds, up to nine, until one draws a different set.
    const seen = [where(first)];
    let moved = false;
    for (const seed of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      await page.evaluate((s) => (window as TestWindow).__game?.setSeed(s), seed);
      await page.locator('#hud-pause').click();
      await page.locator('#pause-restart').click();
      const next = await drawnAfterStart(page);
      seen.push(where(next));
      // Pieces with no slot never move.
      expect(where(next.filter((p) => p.slot === null))).toEqual(where(first.filter((p) => p.slot === null)));
      if (where(next).join() !== where(first).join()) {
        moved = true;
        break;
      }
    }
    console.log(
      `[print] ${region.name}: ${slots.length} slotted of ${first.length} drawn; per seed:\n${seen.map((s) => s.join('; ')).join('\n')}`,
    );
    if (slots.length > 0)
      expect(moved, 'two seeds draw the slotted set pieces in different places').toBe(true);
    else expect(moved, 'with no slot candidates, every seed draws the same set pieces').toBe(false);
    expect(problems).toEqual([]);
  });
}
