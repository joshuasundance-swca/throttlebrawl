import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diskCareers, diskRegions, domId, qualifyIn } from './packs-on-disk';
import { openQuickPlay } from './menu-navigation';

test.describe.configure({ mode: 'parallel' });
const regions = diskRegions();
const career = diskCareers().sort(
  (a, b) =>
    (regions.find((r) => r.key === a.region)?.chapter ?? Infinity) -
    (regions.find((r) => r.key === b.region)?.chapter ?? Infinity),
)[0];
if (!career) throw new Error('No starting career');
const baseline = qualifyIn(career.pack, career.startingBike);
const candidate = career.shop.map((b) => qualifyIn(career.pack, b.bike)).find((key) => key !== baseline);
if (!candidate) throw new Error('No alternative shop bike');
const nameOf = (key: string) => {
  const [pack, id] = key.split(':');
  return (JSON.parse(readFileSync(join('packs', pack!, 'bikes', `${id}.json`), 'utf8')) as { name: string })
    .name;
};
const fixture = JSON.parse(readFileSync('tests/fixtures/save/profile-v1.json', 'utf8')) as {
  data: { bikes: { owned: string[]; current: string } };
};
fixture.data.bikes.current = baseline;
fixture.data.bikes.owned = [baseline, candidate];

/** Inspect painted text lines, including clipping inside their own container. */
async function noteFindings(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) =>
    elements.map((node) => {
      const element = node as HTMLElement;
      const box = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = [...range.getClientRects()];
      return {
        text: element.textContent,
        visible: element.checkVisibility(),
        lines: lines.length,
        clipped: lines.some(
          (line) =>
            line.left < box.left - 1 ||
            line.right > box.right + 1 ||
            line.left < -1 ||
            line.right > innerWidth + 1,
        ),
        overflow: element.scrollWidth > element.clientWidth + 1,
      };
    }),
  );
}

for (const textSize of ['normal', 'large', 'largest']) {
  test(`bike comparisons remain readable and follow the ridden bike at 568x320/${textSize}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await page.addInitScript(
      ({ fixture, textSize, baseline }) => {
        (window as Window & { __GAME_TEST__?: boolean }).__GAME_TEST__ = true;
        localStorage.setItem('mbrawl:profile', JSON.stringify(fixture));
        localStorage.setItem(
          'mbrawl:settings',
          JSON.stringify({
            format: 'settings',
            version: 1,
            build: 'test',
            savedAt: '2026-10-11T00:00:00Z',
            data: { textSize, volumes: { master: 0 }, raceOptions: { bike: baseline } },
          }),
        );
      },
      { fixture, textSize, baseline },
    );
    await page.goto('./');
    await page.locator('#start-screen').click();
    await page.locator('#menu-career').click();
    await page.locator('#career-tab-garage').click();
    const candidateRow = page.locator(`.garage-row[data-bike="${candidate}"]`);
    await expect(candidateRow).toContainText(`Compared with ${nameOf(baseline)}:`);
    const notes = '.garage-row[data-bike] .what small';
    const garageNotes = await noteFindings(page, notes);
    const comparisons = garageNotes.filter((n) => n.text?.includes('Compared with'));
    expect(comparisons.length).toBeGreaterThan(0);
    for (const note of comparisons) {
      expect(note.visible).toBe(true);
      expect(note.lines).toBeGreaterThan(0);
      expect(note.clipped || note.overflow, note.text ?? '').toBe(false);
    }
    await page.locator(`#garage-ride-${domId(candidate)}`).click();
    await expect(page.locator(`.garage-row[data-bike="${baseline}"]`)).toContainText(
      `Compared with ${nameOf(candidate)}:`,
    );
    await page.locator('#career-back').click();
    await openQuickPlay(page);
    await page.locator('#menu-options').click();
    const quickNote = '#race-option-bike .ro-note';
    await expect(page.locator(quickNote)).toContainText(`Compared with ${nameOf(candidate)}:`);
    await page.locator(quickNote).scrollIntoViewIfNeeded();
    const measured = await noteFindings(page, quickNote);
    expect(measured).toHaveLength(1);
    expect(measured[0]?.visible).toBe(true);
    expect(measured[0]?.clipped || measured[0]?.overflow).toBe(false);
    // A forced narrow container must be caught by the same measure.
    await page.addStyleTag({
      content: `${quickNote} { width: 1px !important; white-space: nowrap !important; }`,
    });
    const broken = await noteFindings(page, quickNote);
    expect(broken[0]?.clipped || broken[0]?.overflow).toBe(true);
  });
}
