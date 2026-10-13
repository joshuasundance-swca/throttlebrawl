import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SignaturePhase } from '../../src/sim/api';
import { diskCareers, diskEvents, diskRegions, qualifyIn, type DiskCareer } from './packs-on-disk';
import { enterReloadedMenu } from './menu-navigation';

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
  data: { regions: Record<string, unknown>; bikes: { owned: string[]; current: string } };
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

// Match a rider reaching this boss with a final-tier bike, as in the served encounter fixture.
// Select from current shop/content data instead of copying today's bike id or handling cap.
const finalTier = def.tiers.at(-1)?.id;
const bike = def.shop
  .filter((b) => b.unlockTier === finalTier)
  .map((b) => {
    const key = qualifyIn(def.pack, b.bike);
    const [pack, id] = key.split(':');
    const content = JSON.parse(readFileSync(join('packs', pack!, 'bikes', `${id}.json`), 'utf8')) as {
      handling: { topSpeedMps: number };
    };
    return { key, speed: content.handling.topSpeedMps };
  })
  .sort((a, b) => b.speed - a.speed || a.key.localeCompare(b.key))[0];
if (!bike) throw new Error('No final-tier Timber boss bike');
fixture.data.bikes.current = bike.key;
fixture.data.bikes.owned = [...new Set([...fixture.data.bikes.owned, bike.key])];

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

const phases: readonly [SignaturePhase, string][] = [
  ['tell', 'WINDUP'],
  ['act', 'CHARGE'],
  ['open', 'WINDED'],
];
const SEARCH_SEEDS = 8;
const SEARCH_TICKS = 3 * 60 * 60;

// Evaluated in the browser: sample eligibility, current health and rendered DOM in one task.
// Slow lockstep allows rendering to continue; rechecks never assume that a phase is frozen.
function warningViewAt({ phase, rivalKey }: { phase: SignaturePhase; rivalKey: string }) {
  const g = window.__game!;
  const s = g.snapshot();
  const me = s?.entities[g.playerId()];
  const r = s?.entities.find((e) => e.contentId === rivalKey);
  if (
    g.state() !== 'race' ||
    me?.kind !== 'rider' ||
    me.mode !== 'Road' ||
    !(me.health > 0) ||
    me.finished ||
    r?.kind !== 'rider' ||
    r.mode !== 'Road' ||
    !(r.health > 0) ||
    r.finished ||
    r.road.edge !== me.road.edge ||
    !(Math.abs(r.progress - me.progress) <= 35) ||
    !(Math.abs(r.road.h - me.road.h) <= 2) ||
    r.signature?.move !== 'timber' ||
    r.signature.phase !== phase ||
    r.signature.targetId !== me.id
  )
    return null;
  const widget = document.querySelector<HTMLElement>('#hud-target')!;
  const box = widget.getBoundingClientRect();
  const name = widget.querySelector<HTMLElement>('.hud-name')!;
  const fill = widget.querySelector<HTMLElement>('.hud-bar > div')!;
  const text = document.createRange();
  text.selectNodeContents(name);
  const words = text.getBoundingClientRect();
  const nb = name.getBoundingClientRect();
  return {
    tick: s!.tick,
    name: r.name,
    health: r.health,
    max: r.healthMax,
    gap: r.progress - me.progress,
    text: name.textContent,
    title: name.title,
    onScreen:
      box.left >= -0.5 && box.top >= -0.5 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5,
    fits:
      name.scrollWidth <= name.clientWidth + 1 &&
      words.right <= nb.right + 0.5 &&
      words.left >= nb.left - 0.5,
    font: getComputedStyle(name).fontSize,
    width: widget.clientWidth,
    fill: fill.style.width,
  };
}

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
      if (seed === 1) await page.locator('#start-screen').click();
      else await enterReloadedMenu(page);
      await page.locator('#menu-career').click();
      await page.locator(`#career-region-${def.region.slice(def.region.indexOf(':') + 1)}`).click();
      await expect(page.locator('.career-map').first()).toBeVisible();
      await page.locator(`.career-node[data-node="${boss.id}"]`).click();
      await expect(page.locator('.career-detail')).toHaveAttribute('data-node', boss.id);
      const ride = page.locator('#career-ride');
      await expect(ride).toBeEnabled();
      await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
      await page.evaluate((seed) => {
        window.__game!.setSeed(seed);
        window.__game!.setBot(true);
        window.__game!.lockstep(1);
      }, seed);
      // Roads arriving can rebuild this button. A normal locator click retries detachment and
      // performs its own scroll/actionability checks; do not hold a separately scrolled element.
      await ride.click();
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
        // Real RAF drives the loop. The condition, not elapsed time or frame count, ends the run.
        await expect
          .poll(
            () => page.evaluate(() => window.__game!.state() !== 'race' || !window.__game!.fastForwarding()),
            { timeout: 60_000 },
          )
          .toBe(true);
        const at = await page.evaluate(warningViewAt, { phase, rivalKey });
        if (!at) break;
        expect(at.name).toBe(rival.name);
        const widget = page.locator('#hud-target');
        const name = widget.locator('.hud-name');
        await expect(widget).toBeVisible();
        await expect(name).toHaveText(`${label} ${rival.name}`);
        await expect(name).toHaveAttribute('title', `${label} ${rival.name}`);
        const measured = await page.evaluate(warningViewAt, { phase, rivalKey });
        expect(measured, 'player-targeted nearby phase remains eligible during measurement').not.toBeNull();
        expect(measured).toMatchObject({
          name: rival.name,
          text: `${label} ${rival.name}`,
          title: `${label} ${rival.name}`,
          onScreen: true,
          fits: true,
          font: '12px',
          width: 150,
          fill: `${Math.round(Math.max(0, Math.min(1, measured!.health / measured!.max)) * 1000) / 10}%`,
        });
        await test.info().attach(`timber-warning-${textSize}-${seed}-${phase}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        const after = await page.evaluate(warningViewAt, { phase, rivalKey });
        expect(after, 'captured warning remains in the eligible player-targeted phase').not.toBeNull();
        expect(after).toMatchObject({ text: `${label} ${rival.name}`, title: `${label} ${rival.name}` });
        console.log(
          `[timber-warning] ${textSize} seed ${seed} ${phase}: tick ${at.tick}, gap ${at.gap.toFixed(2)} m, full name/phase fits`,
        );
        found.add(phase);
      }
    }
    expect([...found], `all player-targeted Timber phases within seeds 1..${SEARCH_SEEDS}`).toEqual(
      expect.arrayContaining(phases.map(([p]) => p)),
    );
    expect(problems).toEqual([]);
  });
}
