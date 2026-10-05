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

// ---- The career map keeps its words clear of the title's underline and the build stamp ------------
// Wave B's live check (playtest 3, item 12), on the career map at 915x412 in every look: the tally
// line ("Tier 1 of 4: ...") was clipped at its top by the title banner's red underline (the banner is
// tilted and throws a 4 px offset shadow), and the build stamp sat over a side-gig card's last line
// and a tier's "LOCKED" header (the stamp only stepped aside for controls, not for words). This
// measures both on the painted boxes, on the map (each region) and the garage, scrolled to the top,
// the middle and the end, in each look the settings offer, at 915x412 and at 568x320 (the shortest
// phone). The stamp may hide or take the other corner; it may never cover a word or a control.
// KNOWN_CAREER_FINDINGS names what main has today by case and only shrinks; it is empty.

const KNOWN_CAREER_FINDINGS: Record<string, readonly string[]> = {};
const KNOWN_CAREER_CAP = 0;

const MAP_SIZES = [
  { name: '915x412', width: 915, height: 412 },
  { name: '568x320', width: 568, height: 320 },
] as const;

interface Rect4 {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * What is wrong with the career screen as painted now: the tally under the title's underline, and
 * every word or control the stamp covers. `stampBox` replaces the stamp's own box (the negative
 * control puts it over a known word). Returns the findings and how many words were examined.
 */
async function careerFindings(page: Page, stampBox?: Rect4 | null) {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  return page.evaluate((forced) => {
    const hit = (a: Rect4, b: Rect4) =>
      a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const out = new Set<string>();
    const stamp = document.getElementById('build-stamp');
    const own: Rect4 | null = stamp?.checkVisibility() ? stamp.getBoundingClientRect() : null;
    const sb = forced ?? own;
    let words = 0;
    for (const e of document.querySelectorAll<HTMLElement>('#career *')) {
      if (!e.checkVisibility() || getComputedStyle(e).visibility === 'hidden') continue;
      const name = `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}`;
      if (sb && e.matches('button, input, select, textarea, label, summary, a')) {
        const r = e.getBoundingClientRect();
        if (r.width > 0 && hit(sb, r))
          out.add(`the stamp covers ${name} "${(e.textContent ?? '').trim().slice(0, 24)}"`);
      }
      for (const n of e.childNodes) {
        if (n.nodeType !== Node.TEXT_NODE || (n.textContent ?? '').trim() === '') continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          // A line under half a pixel either way paints no readable word, and the stamp's own rule
          // (ui/stamp.ts) skips an unpainted box too: the map's secret marks are sized in the
          // network's metres, so at a whole-network scale they can come out that small.
          if (r.width < 0.5 || r.height < 0.5) continue;
          words++;
          if (sb && hit(sb, r))
            out.add(`the stamp covers ${name} "${(n.textContent ?? '').trim().slice(0, 24)}"`);
        }
      }
    }
    // The title banner's underline (its box shadow's low edge) against the tally line under it.
    const title = document.querySelector<HTMLElement>('#career .career-head .title');
    const tally = document.querySelector<HTMLElement>('#career .career-head .career-tally');
    if (title?.checkVisibility() && tally?.checkVisibility()) {
      const m = /(-?[\d.]+)px (-?[\d.]+)px/.exec(getComputedStyle(title).boxShadow);
      const down = Math.max(0, Number(m?.[2] ?? 0));
      const under = title.getBoundingClientRect().bottom + down;
      if (tally.getBoundingClientRect().top < under - 0.5)
        out.add("the title's underline covers the tally line");
    }
    return { findings: [...out].sort(), words, stampShown: own !== null };
  }, stampBox ?? null);
}

function expectCareerClear(found: readonly string[], where: string) {
  const known = KNOWN_CAREER_FINDINGS[where] ?? [];
  const unexpected = found.filter((f) => !known.includes(f));
  const gone = known.filter((f) => !found.includes(f));
  expect(unexpected, `${where}: words or controls under the stamp, or under the title's underline`).toEqual(
    [],
  );
  expect(gone, `${where}: known findings that no longer happen (delete them from the list)`).toEqual([]);
}

async function toCareerMenu(page: Page) {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-career')).toBeVisible();
}

/** Settings > Display > Look from the menu (the settings controls are tapped by dispatch: this spec is about the career). */
async function pickMenuLook(page: Page, look: string) {
  await page.locator('#menu-settings').click();
  await page.locator('#settings-tab-display').dispatchEvent('click');
  const button = page.locator(`#settings-look button[data-value="${look}"]`);
  await button.dispatchEvent('click');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#settings-back').dispatchEvent('click');
  await expect(page.locator('#menu-career')).toBeVisible();
}

for (const size of MAP_SIZES) {
  test.describe(`career map words at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('the title underline and the build stamp keep off the career map and garage words, in every look', async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await toCareerMenu(page);
      // The looks come from the settings' own buttons, not a list here.
      await page.locator('#menu-settings').click();
      await page.locator('#settings-tab-display').dispatchEvent('click');
      const looks = await page
        .locator('#settings-look button[data-value]')
        .evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset['value'] ?? ''));
      await page.locator('#settings-back').dispatchEvent('click');
      await expect(page.locator('#menu-career')).toBeVisible();
      expect(looks.length, 'the settings offer looks').toBeGreaterThan(1);

      let words = 0;
      let positions = 0;
      for (const look of looks) {
        await pickMenuLook(page, look);
        await page.locator('#menu-career').click();
        await expect(page.locator('#career')).toBeVisible();
        const ids = await regionIds(page);
        const views: (string | null)[] = [...ids, null];
        for (const region of views) {
          if (region) {
            await page.locator('#career-tab-map').click();
            await page.locator(`#career-region-${region}`).click();
          } else await page.locator('#career-tab-garage').click();
          const room = await page.evaluate(() => {
            const c = document.getElementById('career');
            return c ? c.scrollHeight - c.clientHeight : 0;
          });
          for (const at of [0, 0.5, 1]) {
            await page.evaluate((top) => document.getElementById('career')?.scrollTo({ top }), room * at);
            const where = `${look}, ${region ?? 'garage'}, scrolled ${at * 100}% at ${size.name}`;
            const r = await careerFindings(page);
            words += r.words;
            positions++;
            console.log(
              `${where}: ${r.words} words, stamp ${r.stampShown ? 'shown' : 'not shown'}, findings ${JSON.stringify(r.findings)}`,
            );
            expectCareerClear(r.findings, where);
          }
        }
        await page.locator('#career-back').click();
        await expect(page.locator('#menu-career')).toBeVisible();
      }
      console.log(
        `career map words at ${size.name}: ${words} words in ${positions} positions, ${looks.length} looks`,
      );
      expect(words, 'words were examined').toBeGreaterThan(0);
    });
  });
}

// The check must fire: a stamp laid over a known word names it, and a tally pulled up under the
// title names the underline (negative controls, so a clean run above is not a blind one).
test('the career map check catches the stamp over a word and the underline over the tally (negative control)', async ({
  page,
}) => {
  await toCareerMenu(page);
  await page.locator('#menu-career').click();
  await expect(page.locator('#career')).toBeVisible();
  const clean = await careerFindings(page);
  expectCareerClear(clean.findings, 'negative control, before');
  const title = page.locator('#career .career-head .title');
  const box = await title.boundingBox();
  expect(box, 'the title was measured').not.toBeNull();
  const t = box ?? { x: 0, y: 0, width: 1, height: 1 };
  const words = ((await title.textContent()) ?? '').trim().slice(0, 24);
  const covered = await careerFindings(page, {
    left: t.x,
    top: t.y,
    right: t.x + t.width,
    bottom: t.y + t.height,
  });
  expect(covered.findings).toContain(`the stamp covers div "${words}"`);
  await page.addStyleTag({ content: '#career .career-head .career-tally { margin-top: 0 !important; }' });
  const pulled = await careerFindings(page);
  expect(pulled.findings).toContain("the title's underline covers the tally line");
});

test('the known career layout list only shrinks', () => {
  const entries = Object.values(KNOWN_CAREER_FINDINGS).flat();
  expect(entries.length, 'KNOWN_CAREER_CAP must equal the list: lower it when you fix one').toBe(
    KNOWN_CAREER_CAP,
  );
});
