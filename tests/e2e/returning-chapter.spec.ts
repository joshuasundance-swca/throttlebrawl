import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { APP_ID } from '../../src/platform';
import { profileKey, type EventResult } from '../../src/save';
import { careerPicks, domId, qualifyIn } from './packs-on-disk';

// Acceptance: docs/milestones/returning-chapter.md. Persist a real profile record, then exercise
// the fresh-page lazy initializer via the player's Start and Career buttons.
const { first, next } = careerPicks();
const bare = (ref: string) => ref.slice(ref.indexOf(':') + 1);
const node = next.nodes[0];
if (!node) throw new Error(`${next.key}: no career node for the returning-chapter fixture`);
const history: EventResult[] = [
  {
    event: qualifyIn(next.pack, node.event),
    node: node.id,
    region: bare(next.region),
    place: 0,
    outcome: 'lost',
    cash: 0,
    takedowns: 0,
    build: 'test',
    at: '',
  },
];
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/save/profile-v1.json', import.meta.url), 'utf8'),
) as { data: Record<string, unknown> };
fixture.data = { ...fixture.data, regions: {}, history, season: 1 };

test('reload restores the latest played chapter, while an explicit choice survives menu reentry', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    (window as Window & { __GAME_TEST__?: boolean }).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await expect(page.locator('#start-screen')).toBeVisible();
  expect(
    await page
      .locator('canvas')
      .first()
      .evaluate((canvas) => Boolean((canvas as HTMLCanvasElement).getContext('webgl2'))),
  ).toBe(true);
  await page.evaluate(({ key, record }) => localStorage.setItem(key, JSON.stringify(record)), {
    key: profileKey(APP_ID),
    record: fixture,
  });
  await page.reload();
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu')).toBeVisible();
  await page.locator('#menu-career').click();
  await expect(page.locator('#career')).toBeVisible();
  await expect(page.locator('.career-head .title')).toHaveText(next.name);
  const laterTab = page.locator(`#career-region-${domId(bare(next.region))}`);
  const firstTab = page.locator(`#career-region-${domId(bare(first.region))}`);
  await expect(laterTab).toHaveAttribute('aria-selected', 'true');
  await expect(firstTab).toHaveAttribute('aria-selected', 'false');
  await expect(laterTab).not.toHaveAttribute('data-locked', 'true');

  await firstTab.click();
  await expect(page.locator('.career-head .title')).toHaveText(first.name);
  await expect(firstTab).toHaveAttribute('aria-selected', 'true');
  await page.locator('#career-back').click();
  await expect(page.locator('#menu')).toBeVisible();
  await page.locator('#menu-career').click();
  await expect(page.locator('#career')).toBeVisible();
  await expect(page.locator('.career-head .title')).toHaveText(first.name);
  await expect(firstTab).toHaveAttribute('aria-selected', 'true');
  await expect(laterTab).toHaveAttribute('aria-selected', 'false');
  expect(errors).toEqual([]);
});
