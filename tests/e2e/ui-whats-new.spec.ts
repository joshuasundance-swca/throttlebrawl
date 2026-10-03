import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// ui-3's browser tests (docs/milestones/M2.md, ui-3): the "what's new since you last played" card
// shows only notes newer than the build this device last saw, shows nothing when there are none,
// greets a first launch with a short welcome, and updates `lastSeenBuild` once it is seen; the
// changelog page lists every player note from dist/changelog.json, with the developer notes behind
// a button. The card's own notes come from a routed changelog.json, so the test knows the history.

type TestWindow = Window & { __GAME_TEST__?: boolean };
const SETTINGS_KEY = 'mbrawl:settings'; // platform's APP_ID plus save's key suffix

async function shot(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: `test-results/screenshots/ui-${name}.png` });
}

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

const buildIdOf = async (page: Page) =>
  ((await page.locator('#menu-build').textContent()) ?? '').replace('build ', '');

const lastSeen = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw
      ? ((JSON.parse(raw) as { data: { lastSeenBuild?: string | null } }).data.lastSeenBuild ?? null)
      : null;
  }, SETTINGS_KEY);

/** Rewrites the stored record's lastSeenBuild, as if this device last played that build. */
const setLastSeen = (page: Page, build: string) =>
  page.evaluate(
    ([key, b]) => {
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error('no settings record yet');
      const rec = JSON.parse(raw) as { data: Record<string, unknown> };
      rec.data['lastSeenBuild'] = b;
      localStorage.setItem(key, JSON.stringify(rec));
    },
    [SETTINGS_KEY, build] as const,
  );

const note = (id: string, commit: string, date: string, text: string, audience = 'player') => ({
  id,
  kind: 'new',
  audience,
  text,
  commit,
  date,
});

/** Serves a known changelog; returns how many times it was fetched. */
async function routeChangelog(page: Page, notes: unknown[]) {
  const hits = { n: 0 };
  await page.route('**/changelog.json', async (route) => {
    hits.n++;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ format: 1, notes }) });
  });
  return hits;
}

async function toMenu(page: Page) {
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
});

test('a first launch shows a short welcome beside the menu, and remembers the build', async ({ page }) => {
  const problems = watchErrors(page);
  await toMenu(page);
  const card = page.locator('#whats-new');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Welcome');
  expect(await card.locator('li').count(), 'a welcome, not the whole history').toBe(1);
  const build = await buildIdOf(page);
  await expect
    .poll(() => lastSeen(page), { message: 'lastSeenBuild is stored once the card is seen' })
    .toBe(build);
  // The card sits beside the menu: the Race button is not covered and still works.
  const raceBox = await page.locator('#menu-race').boundingBox();
  const cardBox = await card.boundingBox();
  expect(
    raceBox && cardBox && raceBox.x + raceBox.width <= cardBox.x,
    'the card is to the right of Race',
  ).toBe(true);
  await shot(page, 'whats-new-welcome');
  await page.locator('#whats-new-ok').click();
  await expect(card).toBeHidden();
  // Seen: a reload of the same build shows nothing.
  await toMenu(page);
  // eslint-disable-next-line no-restricted-syntax -- a negative check with no event to wait on: the card stays away a moment after the menu draws
  await page.waitForTimeout(500);
  await expect(card).toBeHidden();
  expect(problems).toEqual([]);
});

test('the card lists only the player notes newer than the last build seen, then updates it', async ({
  page,
}) => {
  const problems = watchErrors(page);
  await toMenu(page); // the first launch stores a record
  const build = await buildIdOf(page);
  await setLastSeen(page, 'bbbbbbb');
  const hits = await routeChangelog(page, [
    note('n-new2', build, '2026-10-02T00:00:00+00:00', 'Second new thing. With more words after it.'),
    note('n-dev', 'ccccccc1', '2026-10-01T12:00:00+00:00', 'A developer note.', 'dev'),
    note('n-new1', 'ccccccc1', '2026-10-01T12:00:00+00:00', 'First new thing.'),
    note('n-seen', 'bbbbbbb1', '2026-10-01T00:00:00+00:00', 'Already seen.'),
    note('n-old', 'aaaaaaa1', '2026-09-01T00:00:00+00:00', 'Old news.'),
  ]);
  await toMenu(page);
  const card = page.locator('#whats-new');
  await expect(card).toBeVisible();
  await expect(card).toContainText('New since you last played');
  const lines = await card.locator('li').allTextContents();
  console.log(`card lines: ${JSON.stringify(lines)} (changelog fetched ${hits.n} time(s))`);
  expect(lines).toEqual(['Second new thing.', 'First new thing.']);
  await expect.poll(() => lastSeen(page)).toBe(build);
  await shot(page, 'whats-new-notes');
  // "All changes" opens the page, which lists the same file.
  await page.locator('#whats-new-all').click();
  await expect(page.locator('#changelog')).toBeVisible();
  await expect(page.locator('#changelog-list p')).toHaveCount(4);
  expect(problems).toEqual([]);
});

test('the card shows nothing when nothing is newer, and still records the build', async ({ page }) => {
  const problems = watchErrors(page);
  await toMenu(page);
  const build = await buildIdOf(page);
  await setLastSeen(page, 'ccccccc');
  const hits = await routeChangelog(page, [
    note('n-dev', 'dddddddd', '2026-10-02T00:00:00+00:00', 'Only a developer note is newer.', 'dev'),
    note('n-c', 'ccccccc1', '2026-10-01T00:00:00+00:00', 'Seen already.'),
    note('n-old', 'aaaaaaa1', '2026-09-01T00:00:00+00:00', 'Old news.'),
  ]);
  await toMenu(page);
  await expect.poll(() => hits.n, { message: 'the changelog was fetched' }).toBeGreaterThan(0);
  await expect.poll(() => lastSeen(page)).toBe(build);
  await expect(page.locator('#whats-new')).toBeHidden();
  expect(problems).toEqual([]);
});

test('the changelog page lists every player note, with the developer notes behind a button', async ({
  page,
}) => {
  const problems = watchErrors(page);
  const file = (await (await page.request.get('./changelog.json')).json()) as {
    notes: { audience: string }[];
  };
  const players = file.notes.filter((n) => n.audience === 'player').length;
  const devs = file.notes.length - players;
  console.log(`dist/changelog.json: ${players} player notes, ${devs} developer notes`);
  expect(players).toBeGreaterThan(0);
  await toMenu(page);
  await page.locator('#menu-changelog').click();
  const list = page.locator('#changelog-list');
  await expect(list.locator('p')).toHaveCount(players);
  await expect(list.locator('h3').first()).toHaveText(/^(\d{4}-\d{2}-\d{2}|not yet released)$/);
  // The list scrolls inside the screen; the page itself never leaves it.
  const box = await list.boundingBox();
  const vh = page.viewportSize()?.height ?? 0;
  expect(box && box.y >= 0 && box.y + box.height <= vh + 0.5, 'the list fits the screen').toBe(true);
  await shot(page, 'changelog');
  await page.locator('#changelog-dev').click();
  await expect(list.locator('p')).toHaveCount(devs);
  await page.locator('#changelog-back').click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(problems).toEqual([]);
});
