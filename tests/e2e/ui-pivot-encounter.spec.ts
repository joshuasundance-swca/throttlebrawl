import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diskCareers, diskEvents, diskName, diskRegions, qualifyIn, type DiskCareer } from './packs-on-disk';

// Real app card, result and teaser layout. Runs only in CI/the coordinator's browser slot.
type FinaleCareer = DiskCareer & {
  boss: string;
  ending: { next?: string; freePlayAfter: boolean; lines: string[] };
  unlocks: { grant: string; when: { kind: string } }[];
};
const careers = diskCareers() as FinaleCareer[],
  events = diskEvents(),
  regions = diskRegions();
const selected = careers.find(
  (c) => qualifyIn(c.pack, c.nodes.find((n) => n.id === c.boss)?.event ?? '') === 'region-sf:sf-boss-pivot',
);
if (!selected) throw new Error('No canonical Pivot career');
const def = selected,
  boss = def.nodes.find((n) => n.id === def.boss);
if (!boss) throw new Error('No finale node');
const event = events.find((e) => e.key === qualifyIn(def.pack, boss.event));
if (!event) throw new Error('No finale event');
const rules = event['rules'] as { rival: string };
const rivalName = diskName('riders', def.pack, rules.rival);
const count = Number(
  (event['objectives'] as { kind: string; params: { orKnockdowns?: number } }[]).find(
    (o) => o.kind === 'beat-rival',
  )?.params.orKnockdowns,
);
if (!(count > 0)) throw new Error('No alternate victory');
const word =
  ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][count] ??
  String(count);
const victory = `Beat ${rivalName} to the line, or knock ${rivalName} down ${word} times.`;
const awards = def.unlocks
  .filter((u) => u.when.kind === 'boss-beaten')
  .map((u) => diskName('bikes', def.pack, u.grant));
const fixture = JSON.parse(readFileSync('tests/fixtures/save/profile-v1.json', 'utf8')) as {
  data: {
    regions: Record<string, unknown>;
    bikes: { owned: string[]; current: string };
    oncePerCareer?: string[];
  };
};
const chapter = regions.find((r) => r.key === def.region)?.chapter;
if (!chapter) throw new Error('No chapter order');
const prior = (c: DiskCareer) => (regions.find((r) => r.key === c.region)?.chapter ?? Infinity) < chapter;
fixture.data.regions = Object.fromEntries(
  careers.map(
    (c) =>
      [
        c.region.slice(c.region.indexOf(':') + 1),
        {
          tier: prior(c) || c === def ? c.tiers.length : 1,
          won: c.nodes.filter((n) => prior(c) || (c === def && n.id !== boss.id)).map((n) => n.id),
          unlockedRoads: [],
          claimedRoads: [],
          foundShortcuts: [],
          secrets: [],
          finaleBeaten: prior(c),
        },
      ] as const,
  ),
);
fixture.data.oncePerCareer = (fixture.data.oncePerCareer ?? []).filter(
  (flag) => flag !== `teaser:${def.region.split(':').at(-1)}`,
);
const bike = careers
  .filter((c) => prior(c) || c === def)
  .flatMap((c) =>
    c.shop.map((b) => {
      const key = qualifyIn(c.pack, b.bike),
        [pack, id] = key.split(':');
      const content = JSON.parse(readFileSync(join('packs', pack!, 'bikes', `${id}.json`), 'utf8')) as {
        handling: { topSpeedMps: number };
      };
      return { key, speed: content.handling.topSpeedMps };
    }),
  )
  .sort((a, b) => b.speed - a.speed || a.key.localeCompare(b.key))[0];
if (!bike) throw new Error('No effective finale bike');
fixture.data.bikes.current = bike.key;
fixture.data.bikes.owned = [...new Set([...fixture.data.bikes.owned, bike.key])];

async function measureText(page: Page, selector: string) {
  return page.locator(selector).evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('*')]
      .filter(
        (e) =>
          e.checkVisibility() &&
          [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== ''),
      )
      .map((e) => {
        const box = e.getBoundingClientRect();
        return {
          text: e.textContent,
          onScreenX: box.left >= -0.5 && box.right <= innerWidth + 0.5,
          fits:
            getComputedStyle(e).display === 'inline' ||
            (e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1),
        };
      }),
  );
}
async function layout(page: Page, selector: string) {
  const measured = await measureText(page, selector);
  expect(measured.length, selector).toBeGreaterThan(0);
  for (const m of measured) expect(m, m.text ?? '').toMatchObject({ onScreenX: true, fits: true });
}
async function openBoss(page: Page) {
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-career').click();
  await page.locator(`#career-region-${def.region.split(':').at(-1)}`).click();
  await expect(page.locator('.career-map').first()).toBeVisible();
  await page.locator(`.career-node[data-node="${boss!.id}"]`).click();
  await expect(page.locator('#career-ride')).toBeEnabled();
}
test('Pivot identity, victory routes and final payoff at small landscape/all text sizes', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000); // Hang guard; discover a seed once, then replay it at other text sizes.
  let successfulSeed: number | null = null;
  for (const textSize of ['normal', 'large', 'largest']) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 568, height: 320 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    try {
      await page.addInitScript(
        ({ fixture, textSize }) => {
          (window as Window & { __GAME_TEST__?: boolean }).__GAME_TEST__ = true;
          localStorage.setItem('mbrawl:profile', JSON.stringify(fixture));
          localStorage.setItem(
            'mbrawl:settings',
            JSON.stringify({
              format: 'settings',
              version: 1,
              build: 'test',
              savedAt: '2026-10-11T00:00:00Z',
              data: { textSize, reduceMotion: true, volumes: { master: 0 } },
            }),
          );
        },
        { fixture, textSize },
      );
      await openBoss(page);
      await expect(page.locator('#ui')).toHaveAttribute('data-text', textSize);
      await expect(page.locator('.career-detail .facts').first()).toBeVisible();
      await expect(page.locator('.career-detail .why').first()).toBeVisible();
      await expect(page.locator('.career-detail .facts').first()).toContainText(
        `REGION BOSS · ${rivalName.toUpperCase()}`,
      );
      await expect(page.locator('.career-detail .why').first()).toContainText(victory);
      await expect(page.locator('.career-detail .why').first()).toContainText('Win for free play');
      for (const name of awards)
        await expect(page.locator('.career-detail .why').first()).toContainText(name);
      // Exercise the horizontal measurement against the actual visible objective, then restore it.
      const why = page.locator('.career-detail .why').first();
      const originalStyle = await why.getAttribute('style');
      await why.evaluate((e) => {
        (e as HTMLElement).style.transform = 'translateX(100vw)';
      });
      expect((await measureText(page, '.career-detail')).some((m) => !m.onScreenX)).toBe(true);
      await why.evaluate((e, style) => {
        if (style === null) e.removeAttribute('style');
        else e.setAttribute('style', style);
      }, originalStyle);
      await layout(page, '.career-detail');
      let won = false;
      const seeds: number[] =
        successfulSeed === null ? Array.from({ length: 8 }, (_, i) => i + 1) : [successfulSeed];
      for (const [index, seed] of seeds.entries()) {
        if (index > 0) await openBoss(page);
        await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
        await page.evaluate((seed) => {
          const g = window.__game!;
          g.setSeed(seed);
          g.setBot(true);
          g.lockstep(1);
        }, seed);
        await page.locator('#career-ride').click();
        await expect
          .poll(() => page.evaluate(() => window.__game!.state()), { timeout: 60_000 })
          .toBe('race');
        await page.evaluate(() =>
          window.__game!.fastForward((s) => s.tick >= 36_000, { perFrame: 1200, then: 1 }),
        );
        await expect
          .poll(
            () => page.evaluate(() => window.__game!.state() !== 'race' || !window.__game!.fastForwarding()),
            { timeout: 60_000 },
          )
          .toBe(true);
        await expect(page.locator('#career-results')).toBeVisible({ timeout: 60_000 });
        const title = await page.locator('#career-results-title').textContent();
        console.log(
          `[pivot-results-search] seed ${seed}; title ${title}; tick ${await page.evaluate(() => window.__game!.snapshot()?.tick)}`,
        );
        won = title === `${rivalName.toUpperCase()} BEATEN`;
        if (won) {
          successfulSeed = seed;
          break;
        }
      }
      expect(won, 'one bounded ordinary bot finale must reach the actual final payoff').toBe(true);
      await expect(page.locator('#career-results-objectives')).toBeVisible();
      await expect(page.locator('#career-results-objectives li').filter({ hasText: victory })).toBeVisible();
      await expect(page.locator('#career-results-objectives')).toContainText(victory);
      await expect(
        page.locator('#career-results .career-news').filter({ hasText: 'Free play is open.' }),
      ).toBeVisible();
      await expect(page.locator('#career-results')).toContainText('Free play is open.');
      for (const name of awards) {
        await expect(page.locator('#career-results .career-news').filter({ hasText: name })).toBeVisible();
        await expect(page.locator('#career-results')).toContainText(name);
      }
      await layout(page, '#career-results');
      await page.locator('#career-results-map').click();
      await expect(page.locator('#career-teaser')).toBeVisible();
      for (const line of def.ending.lines) {
        await expect(page.locator('#career-teaser .teaser-line').filter({ hasText: line })).toBeVisible();
        await expect(page.locator('#career-teaser')).toContainText(line);
      }
      await expect(page.locator('#career-teaser-next')).toHaveCount(0);
      await layout(page, '#career-teaser');
    } finally {
      await context.close();
    }
  }
});
