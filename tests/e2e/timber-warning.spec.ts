import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { SignaturePhase } from '../../src/sim/api';
import { diskCareers, diskEvents, diskName, diskRegions, qualifyIn, type DiskCareer } from './packs-on-disk';

// Separate pages/storage and independent seed searches keep font cases parallel in CI.
test.describe.configure({ mode: 'parallel' });
const careers = diskCareers() as (DiskCareer & { boss: string })[];
const events = diskEvents();
const selected = careers.find((c) =>
  events.some(
    (e) =>
      e.key === qualifyIn(c.pack, c.nodes.find((n) => n.id === c.boss)?.event ?? '') &&
      (e['rules'] as { rule?: string }).rule === 'timber',
  ),
);
if (!selected) throw new Error('No authored Timber boss career');
const career = selected;
const boss = career.nodes.find((n) => n.id === career.boss);
if (!boss) throw new Error('No Timber boss node');
const event = events.find((e) => e.key === qualifyIn(career.pack, boss.event));
if (!event) throw new Error('No Timber boss event');
const rivalKey = qualifyIn(career.pack, (event['rules'] as { rival: string }).rival);
const rivalName = diskName('riders', career.pack, rivalKey);
const regions = diskRegions();
const chapter = regions.find((r) => r.key === career.region)?.chapter;
if (!chapter) throw new Error('No Timber boss chapter');
const fixture = JSON.parse(readFileSync('tests/fixtures/save/profile-v1.json', 'utf8')) as {
  data: { regions: Record<string, unknown> };
};
// Same content-derived unlock rule as old-growth-encounter.spec.ts; only this boss is left unwon.
fixture.data.regions = Object.fromEntries(
  careers.map((c) => {
    const prior = (regions.find((r) => r.key === c.region)?.chapter ?? Infinity) < chapter;
    return [
      c.region.slice(c.region.indexOf(':') + 1),
      {
        tier: prior || c === career ? c.tiers.length : 1,
        won: c.nodes.filter((n) => prior || (c === career && n.id !== boss.id)).map((n) => n.id),
        unlockedRoads: [],
        claimedRoads: [],
        foundShortcuts: [],
        secrets: [],
        finaleBeaten: prior,
      },
    ];
  }),
);

const phases: readonly [SignaturePhase, string][] = [
  ['tell', 'WINDUP'],
  ['act', 'CHARGE'],
  ['open', 'WINDED'],
];
const SEARCH_SEEDS = 8;
const SEARCH_TICKS = 3 * 60 * 60;

for (const textSize of ['normal', 'large', 'largest']) {
  test(`a nearby authored Timber boss warns through every phase at small landscape/${textSize}`, async ({
    page,
  }) => {
    test.setTimeout(240_000); // Hang guard; encounter search is bounded by sim ticks and seeds.
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });
    await page.setViewportSize({ width: 568, height: 320 });
    await page.clock.install();
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
    const found = new Set<SignaturePhase>();
    for (let seed = 1; seed <= SEARCH_SEEDS && found.size < phases.length; seed++) {
      await page.goto('./');
      await page.locator('#start-screen').click();
      await page.locator('#menu-career').click();
      await page.locator(`#career-region-${career.region.slice(career.region.indexOf(':') + 1)}`).click();
      await page.locator(`.career-node[data-node="${boss.id}"]`).click();
      await expect(page.locator('#career-ride')).toBeEnabled();
      await page.locator('#career-ride').scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
      // Hold the presentation clock while measuring. Clock pumps only drive a sim-predicate
      // fast-forward; no test waits for a frame count or writes an entity/sim state.
      await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 1).toISOString()));
      await page.evaluate((seed) => {
        window.__game!.setSeed(seed);
        window.__game!.setBot(true);
      }, seed);
      await page.locator('#career-ride').click({ force: true });
      await expect.poll(() => page.evaluate(() => window.__game!.state()), { timeout: 60_000 }).toBe('race');
      for (const [phase, label] of phases) {
        if (found.has(phase)) continue;
        await page.evaluate(
          ({ phase, rivalKey, by }) => {
            const g = window.__game!;
            g.fastForward(
              (s) => {
                const me = s.entities[g.playerId()];
                return (
                  s.tick >= by ||
                  s.entities.some(
                    (r) =>
                      me?.kind === 'rider' &&
                      me.mode === 'Road' &&
                      me.health > 0 &&
                      !me.finished &&
                      r.contentId === rivalKey &&
                      r.kind === 'rider' &&
                      r.mode === 'Road' &&
                      r.health > 0 &&
                      !r.finished &&
                      r.road.edge === me.road.edge &&
                      Math.abs(r.progress - me.progress) <= 35 &&
                      Math.abs(r.road.h - me.road.h) <= 2 &&
                      r.signature?.move === 'timber' &&
                      r.signature.phase === phase &&
                      r.signature.targetId === me.id,
                  )
                );
              },
              { perFrame: 1200, then: 1 },
            );
          },
          { phase, rivalKey, by: SEARCH_TICKS },
        );
        while (
          await page.evaluate(() => window.__game!.state() === 'race' && window.__game!.fastForwarding())
        ) {
          await page.clock.fastForward(1000);
        }
        const at = await page.evaluate(
          ({ phase, rivalKey }) => {
            const g = window.__game!;
            const s = g.snapshot();
            const me = s?.entities[g.playerId()];
            const r = s?.entities.find((e) => e.contentId === rivalKey);
            return g.state() === 'race' &&
              me?.mode === 'Road' &&
              me.health > 0 &&
              !me.finished &&
              r?.mode === 'Road' &&
              r.health > 0 &&
              !r.finished &&
              r.road.edge === me.road.edge &&
              Math.abs(r.progress - me.progress) <= 35 &&
              Math.abs(r.road.h - me.road.h) <= 2 &&
              r.signature?.move === 'timber' &&
              r.signature.phase === phase &&
              r.signature.targetId === me.id
              ? {
                  tick: s!.tick,
                  name: r.name,
                  health: r.health,
                  max: r.healthMax,
                  gap: r.progress - me.progress,
                }
              : null;
          },
          { phase, rivalKey },
        );
        if (!at) break;
        expect(at.name).toBe(rivalName);
        const widget = page.locator('#hud-target');
        const name = widget.locator('.hud-name');
        await expect(widget).toBeVisible();
        await expect(name).toHaveText(`${label} ${rivalName}`);
        await expect(name).toHaveAttribute('title', `${label} ${rivalName}`);
        const measured = await widget.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const n = e.querySelector<HTMLElement>('.hud-name')!;
          const fill = e.querySelector<HTMLElement>('.hud-bar > div')!;
          const text = document.createRange();
          text.selectNodeContents(n);
          const words = text.getBoundingClientRect();
          const nb = n.getBoundingClientRect();
          return {
            onScreen:
              r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
            fits:
              n.scrollWidth <= n.clientWidth + 1 &&
              words.right <= nb.right + 0.5 &&
              words.left >= nb.left - 0.5,
            font: getComputedStyle(n).fontSize,
            width: e.clientWidth,
            fill: fill.style.width,
          };
        });
        expect(measured).toMatchObject({
          onScreen: true,
          fits: true,
          font: '12px',
          width: 150,
          fill: `${Math.round(Math.max(0, Math.min(1, at.health / at.max)) * 1000) / 10}%`,
        });
        console.log(
          `[timber-warning] ${textSize} seed ${seed} ${phase}: tick ${at.tick}, gap ${at.gap.toFixed(2)} m, full name/phase fits`,
        );
        found.add(phase);
      }
      await page.clock.resume();
    }
    expect([...found], `all player-targeted Timber phases within seeds 1..${SEARCH_SEEDS}`).toEqual(
      expect.arrayContaining(phases.map(([p]) => p)),
    );
    expect(problems).toEqual([]);
  });
}
