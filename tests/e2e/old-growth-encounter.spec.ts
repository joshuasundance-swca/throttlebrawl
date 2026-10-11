import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { diskCareers, diskEvents, diskRegions, qualifyIn, type DiskCareer } from './packs-on-disk';

// Each font-size case owns a separate page and storage fixture.
test.describe.configure({ mode: 'parallel' });

type BossCareer = DiskCareer & {
  boss: string;
  ending: { next: string };
  show: { rules: { timber: { name: string; line: string } } };
};
const events = diskEvents();
const careers = diskCareers() as BossCareer[];
const selectedDef = careers.find((c) =>
  events.some(
    (e) =>
      e.key === qualifyIn(c.pack, c.nodes.find((n) => n.id === c.boss)?.event ?? '') &&
      (e['rules'] as { rule?: string }).rule === 'timber',
  ),
);
if (!selectedDef) throw new Error('No Timber regional boss');
const def = selectedDef;
const selectedBoss = def.nodes.find((n) => n.id === def.boss);
if (!selectedBoss) throw new Error('No boss node');
const boss = selectedBoss;
const event = events.find((e) => e.key === qualifyIn(def.pack, boss.event));
if (!event) throw new Error('No boss event');
const rivalKey = qualifyIn(def.pack, (event['rules'] as { rival: string }).rival);
const [rivalPack, rivalId] = rivalKey.split(':');
const rival = JSON.parse(readFileSync(`packs/${rivalPack}/riders/${rivalId}.json`, 'utf8')) as {
  name: string;
};
const selectedNext = diskRegions().find((r) => r.key === def.ending.next);
if (!selectedNext?.name) throw new Error('No next chapter');
const next = selectedNext;
const count = Number(
  (event['objectives'] as { kind: string; params: { orKnockdowns?: number } }[]).find(
    (o) => o.kind === 'beat-rival',
  )?.params.orKnockdowns,
);
if (!(count > 0)) throw new Error('No environmental victory route');
const countWord =
  ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][count] ??
  String(count);
const fixture = JSON.parse(readFileSync('tests/fixtures/save/profile-v1.json', 'utf8')) as {
  data: { regions: Record<string, unknown> };
};
const regions = diskRegions();
const selectedChapter = regions.find((r) => r.key === def.region)?.chapter;
if (!selectedChapter) throw new Error('No boss chapter order');
const chapter = selectedChapter;
fixture.data.regions = Object.fromEntries(
  careers.map((c) => {
    const region = c.region.slice(c.region.indexOf(':') + 1);
    const prior = (regions.find((r) => r.key === c.region)?.chapter ?? Infinity) < chapter;
    return [
      region,
      {
        tier: prior || c === def ? c.tiers.length : 1,
        won: c.nodes.filter((n) => prior || (c === def && n.id !== boss.id)).map((n) => n.id),
        unlockedRoads: [],
        claimedRoads: [],
        foundShortcuts: [],
        secrets: [],
        finaleBeaten: prior,
      },
    ];
  }),
);

for (const textSize of ['normal', 'large', 'largest']) {
  test(`the Timber boss card explains both victories and the chapter stake at short landscape/${textSize}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 568, height: 320 });
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
            savedAt: '2026-10-10T00:00:00Z',
            data: { textSize, volumes: { master: 0 } },
          }),
        );
      },
      { fixture, textSize },
    );
    await page.goto('./');
    await page.locator('#start-screen').click();
    await expect(page.locator('#ui')).toHaveAttribute('data-text', textSize);
    await page.locator('#menu-career').click();
    await page.locator(`#career-region-${def.region.slice(def.region.indexOf(':') + 1)}`).click();
    await expect(page.locator('.career-map').first()).toBeVisible();
    await page.locator(`.career-node[data-node="${boss.id}"]`).click();
    const detail = page.locator('.career-detail');
    await expect(detail.locator('.facts').first()).toContainText(`REGION BOSS · ${rival.name.toUpperCase()}`);
    await expect(detail.locator('.why').first()).toContainText(
      `Beat ${rival.name} to the line, or knock ${rival.name} into traffic or scenery ${countWord} times.`,
    );
    await expect(detail.locator('.why').first()).toContainText(`Win to open ${next.name}.`);
    await expect(detail).toContainText(def.show.rules.timber.line);
    const measured = await detail.evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>('h2, .facts, .why, button')].map((e) => {
        const r = e.getBoundingClientRect();
        return {
          text: e.textContent,
          onScreen: r.left >= -0.5 && r.right <= innerWidth + 0.5,
          fits: e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1,
        };
      }),
    );
    expect(measured.length).toBeGreaterThan(0);
    for (const m of measured) expect(m, m.text ?? '').toMatchObject({ onScreen: true, fits: true });
    const ride = page.locator('#career-ride');
    await expect(ride).toBeEnabled();
    await ride.scrollIntoViewIfNeeded();
    const box = await ride.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(320.5);
  });
}
