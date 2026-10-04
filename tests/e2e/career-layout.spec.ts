import { expect, test, type Page } from '@playwright/test';

// The career screens' layout on small phones (playtest 3, T7.4): the Season 2 card's title keeps
// its whole first line (wave A's check flagged it, unmeasured), a shut region's lock banner and
// locked cards, and the garage's lines (a step number, the price in races, a crash's cost) all sit
// inside the screen and inside their own boxes at 320x568 (the narrowest phone), 360x640 and
// 568x320 (a short phone held sideways). The words themselves are read by
// src/ui/career-screens.test.ts; this measures the real boxes. Seasons are reached the player's
// way: a backup code carrying a profile with every region boss down, loaded in the garage.

type TestWindow = Window & { __GAME_TEST__?: boolean };

const SIZES = [
  { name: '320x568 portrait', width: 320, height: 568 },
  { name: '360x640 portrait', width: 360, height: 640 },
  { name: '568x320 landscape', width: 568, height: 320 },
] as const;

/** Every visible text element inside `root` sits on the screen and does not overflow its box. */
async function expectNoOverflow(page: Page, root: string, where: string) {
  const found = await page.evaluate((sel) => {
    const out: string[] = [];
    let examined = 0;
    const vw = window.innerWidth;
    for (const e of document.querySelectorAll<HTMLElement>(`${sel} *`)) {
      if (!e.checkVisibility()) continue;
      const own = [...e.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim() !== '');
      if (!own) continue;
      examined++;
      const r = e.getBoundingClientRect();
      const name = `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''} "${(e.textContent ?? '').trim().slice(0, 30)}"`;
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${name} leaves the screen sideways`);
      if (getComputedStyle(e).display !== 'inline' && e.tagName !== 'TEXTAREA') {
        if (e.scrollWidth > e.clientWidth + 1) out.push(`${name} overflows sideways`);
        if (e.scrollHeight > e.clientHeight + 1) out.push(`${name} overflows downwards`);
      }
    }
    return { out, examined };
  }, root);
  console.log(`${where}: ${found.examined} text elements checked for overflow`);
  expect(found.examined).toBeGreaterThan(0);
  expect(found.out, where).toEqual([]);
}

async function openCareerMap(page: Page) {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await page.locator('#menu-career').click();
  await expect(page.locator('#career')).toBeVisible();
}

/** The profile carried by the backup code the garage shows. */
async function readCode(page: Page): Promise<string> {
  await page.locator('#career-tab-garage').click();
  await page.locator('#career-code-copy').click();
  await expect(page.locator('#career-code')).toHaveValue(/^EC1\./);
  const code = await page.locator('#career-code').inputValue();
  await page.locator('#career-tab-map').click();
  return code;
}

/** A code for the same career with `edit` applied to its profile data (the checksum redone). */
async function craftCode(page: Page, code: string, edit: Record<string, unknown>): Promise<string> {
  return page.evaluate(
    async ({ code, edit }) => {
      const [, flag, payload = ''] = code.split('.');
      const bin = atob(
        payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4),
      );
      let bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      if (flag === 'z') {
        const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        bytes = new Uint8Array(await new Response(out).arrayBuffer());
      }
      const bundle = JSON.parse(new TextDecoder().decode(bytes)) as {
        profile: { data: Record<string, unknown> };
      };
      bundle.profile.data = { ...bundle.profile.data, ...edit };
      const sort = (v: unknown): unknown =>
        Array.isArray(v)
          ? v.map(sort)
          : v && typeof v === 'object'
            ? Object.fromEntries(
                Object.keys(v)
                  .sort()
                  .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
              )
            : v;
      const raw = new TextEncoder().encode(JSON.stringify(sort(bundle)));
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
      let crc = 0xffffffff;
      for (const b of raw) crc = (table[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8);
      const hex = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
      let text = '';
      for (const b of raw) text += String.fromCharCode(b);
      return `EC1.p.${btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${hex}`;
    },
    { code, edit },
  );
}

async function loadCode(page: Page, code: string) {
  await page.locator('#career-tab-garage').click();
  await page.locator('#career-code').fill(code);
  await page.locator('#career-code-load').click();
  await expect(page.locator('.career-msg')).toContainText('Loaded');
  await page.locator('#career-tab-map').click();
}

/** The region ids the tabs offer, in chapter order. */
async function regionIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.career-tabs button')].map((b) =>
      b.id.replace(/^career-region-/, ''),
    ),
  );
}

for (const size of SIZES) {
  test.describe(`career screens at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, isMobile: false, hasTouch: false });

    test('a shut region shows why and which boss opens it, every event locked, and nothing overflows', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openCareerMap(page);
      const ids = await regionIds(page);
      expect(ids.length).toBeGreaterThan(1);
      // The first region is open; the second waits for the first's boss.
      await expect(page.locator('#career-lock')).toHaveCount(0);
      await page.locator(`#career-region-${ids[1]}`).click();
      const lock = page.locator('#career-lock');
      await expect(lock).toBeVisible();
      await expect(lock).toContainText('Opens when');
      await expect(lock).toContainText('falls.');
      await expect(lock).toContainText('The boss is the last race of');
      await expect(page.locator(`#career-region-${ids[1]}`)).toHaveAttribute('data-locked', 'true');
      const states = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.career-node')].map((b) => b.dataset['state']),
      );
      expect(states.length).toBeGreaterThan(0);
      expect(new Set(states)).toEqual(new Set(['locked']));
      // A card in the shut region cannot ride, and says the region's reason.
      await page.locator('.career-node').first().click();
      await expect(page.locator('#career-ride')).toBeDisabled();
      await expect(page.locator('.career-detail')).toContainText('Opens when');
      await expectNoOverflow(page, '#career', `shut region at ${size.name}`);
      // The lock box itself sits wholly on the screen.
      const box = await lock.boundingBox();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width + 0.5);
    });

    test('the Season 2 card keeps its whole title and lines on the screen, and the garage lines fit', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openCareerMap(page);
      const ids = await regionIds(page);
      const done = {
        tier: 4,
        won: [] as string[],
        unlockedRoads: [] as string[],
        claimedRoads: [] as string[],
        foundShortcuts: [] as string[],
        secrets: [] as string[],
        finaleBeaten: true,
      };
      const regions = Object.fromEntries(ids.map((id) => [id, done]));
      const code = await craftCode(page, await readCode(page), { cash: 50_000, regions });
      await loadCode(page, code);

      // The card: its title inside its box (a rotated, clipped first line would poke out), whole.
      const card = page.locator('#career-season-card');
      await expect(card).toBeVisible();
      await expect(card.locator('.season-title')).toContainText('Season 2');
      await card.scrollIntoViewIfNeeded();
      const m = await page.evaluate(() => {
        const c = document.querySelector<HTMLElement>('#career-season-card');
        const t = c?.querySelector<HTMLElement>('.season-title');
        if (!c || !t) return null;
        const cr = c.getBoundingClientRect();
        const tr = t.getBoundingClientRect();
        const line = parseFloat(getComputedStyle(t).lineHeight);
        return {
          inside:
            tr.top >= cr.top - 0.5 &&
            tr.bottom <= cr.bottom + 0.5 &&
            tr.left >= cr.left - 0.5 &&
            tr.right <= cr.right + 0.5,
          onScreen: cr.left >= -0.5 && cr.right <= window.innerWidth + 0.5,
          fits: t.scrollHeight <= t.clientHeight + 1 && t.scrollWidth <= t.clientWidth + 1,
          tall: tr.height >= line - 0.5,
          transform: getComputedStyle(t).transform,
        };
      });
      expect(m, 'the card and its title exist').not.toBeNull();
      expect(m?.inside, 'the title lies inside the card').toBe(true);
      expect(m?.onScreen, 'the card lies inside the screen').toBe(true);
      expect(m?.fits, 'the title does not overflow its box').toBe(true);
      expect(m?.tall, 'the title box holds at least one whole line').toBe(true);
      expect(m?.transform, 'the title is not rotated').toBe('none');
      await expect(page.locator('#career-start-season')).toBeVisible();
      await expectNoOverflow(page, '#career', `season card at ${size.name}`);

      // The garage: every bike row says its step, and a bike not yet owned says its price in races.
      await page.locator('#career-tab-garage').click();
      await expect(page.locator('#garage-pay')).toContainText('A race pays about');
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.garage-row[data-bike]')].map((r) => ({
          state: r.dataset['state'],
          text: r.innerText,
        })),
      );
      expect(rows.length).toBeGreaterThan(3);
      for (const r of rows) {
        expect(r.text, 'each bike row says its step or its novelty').toMatch(
          /Step \d+ of \d+|Novelty ride|\(secret\)/,
        );
        if (r.state !== 'owned') expect(r.text).toMatch(/afford|have the cash/);
      }
      await expectNoOverflow(page, '#career', `garage at ${size.name}`);
      // New career: its panel and button are on the screen too.
      await expect(page.locator('#career-newcareer')).toBeVisible();
      await expectNoOverflow(page, '#career-newcareer', `new career panel at ${size.name}`);
    });
  });
}
