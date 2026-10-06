import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// dev-3's browser tests (docs/milestones/M1.md, dev-3): "copy debug report" puts a summary with the
// build id and the replay key on a (mocked) clipboard, within 2 KB, from the menu and from the
// pause screen; "save debug file" downloads a file whose replay loads and replays to its hashes
// (and a tampered copy does not); the share sheet path hands over the same kind of file.

interface ReplayCheck {
  ticks: number;
  checked: number;
  desync: { tick: number; expected: number; actual: number } | null;
  keyMatches: boolean;
  summary: string;
}
interface Handle {
  state(): string;
  snapshot(): { tick: number } | null;
  setBot(on: boolean): void;
  contentHashes(): { sim: string; full: string };
  checkDebugFile(text: string): ReplayCheck;
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __game?: Handle;
  __copied?: string[];
  __shared?: { name: string; type: string; text: string }[];
};

const REPLAY_MARKER = '===== replay (one line of JSON) =====';

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as TestWindow;
    w.__GAME_TEST__ = true;
    w.__copied = [];
    // The mocked clipboard: whatever the game copies lands in window.__copied.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          w.__copied?.push(text);
          return Promise.resolve();
        },
      },
    });
    // No share sheet by default, so "save debug file" takes the download path.
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
  });
});

/** The build id from the stamp, and the replay key this build should report. */
/**
 * The replay key the page must report: `simCodeHash + simContentHash` (M2 app-3), where the code
 * part is the first 12 hex digits of the SHA-256 of the sim chunk the page actually loaded, then each of
 * the road's lazy planner chunks in file name order, joined by a newline (scripts/sim-chunk.mjs,
 * `simCodeHashOfChunks`). A planner chunk may not be loaded yet; the loaded chunks name it.
 */
async function expectedKey(page: Page): Promise<{ id: string; key: string }> {
  const stamp = await page.locator('#build-stamp').innerText();
  const id = stamp.trim().split(' · ').pop() ?? '';
  const sim = await page.evaluate(() => (window as TestWindow).__game?.contentHashes().sim ?? '');
  const code = await page.evaluate(async () => {
    const scripts = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /\/assets\/[^/]+\.js$/.test(n));
    const url = scripts.find((n) => /\/assets\/sim-[^/]*\.js$/.test(n));
    if (!url) return '';
    const text = async (u: string) => (await fetch(u)).text();
    const names = new Set<string>();
    for (const s of scripts)
      for (const m of (await text(s)).matchAll(/road-structures-[\w-]+\.js/g)) names.add(m[0]);
    const lazy = [...names].sort().map((n) => new URL(n, url).href);
    const codes = [await text(url), ...(await Promise.all(lazy.map(text)))];
    const bytes = new TextEncoder().encode(codes.join('\n'));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...digest]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 12);
  });
  expect(id).toMatch(/^[0-9a-f]{7}$/);
  expect(sim.length).toBeGreaterThan(0);
  expect(code).toMatch(/^[0-9a-f]{12}$/);
  return { id, key: `${code}+${sim}` };
}

async function lastCopied(page: Page, count: number): Promise<string> {
  await page.waitForFunction((n) => ((window as TestWindow).__copied?.length ?? 0) >= n, count);
  return page.evaluate(() => {
    const all = (window as TestWindow).__copied ?? [];
    return all[all.length - 1] ?? '';
  });
}

test('copy debug report puts the build id and replay key on the clipboard, within 2 KB', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchErrors(page);
  await page.goto('./');
  await page.locator('#start-screen').click();
  const { id, key } = await expectedKey(page);

  // From the menu, before any race.
  await page.locator('#menu-copy-report').click();
  const fromMenu = await lastCopied(page, 1);
  console.log(`menu report: ${Buffer.byteLength(fromMenu, 'utf8')} bytes\n${fromMenu}`);
  expect(fromMenu).toContain(`build ${id}`);
  expect(fromMenu).toContain(`replay key ${key}`);
  expect(fromMenu).toContain('state menu');
  expect(fromMenu).toContain('vetoes none');
  expect(Buffer.byteLength(fromMenu, 'utf8')).toBeLessThanOrEqual(2048);
  await expect(page.locator('#debug-report-toast')).toContainText('copied');

  // From the pause screen, mid-race: the race's state, tick and events are in it too.
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 300);
  await page.locator('#hud-pause').click();
  await expect(page.locator('#pause-screen')).toBeVisible();
  await page.locator('#pause-copy-report').click();
  const fromPause = await lastCopied(page, 2);
  const bytes = Buffer.byteLength(fromPause, 'utf8');
  const eventLines = fromPause.split('\n').filter((l) => /^ t\d+ /.test(l)).length;
  console.log(`pause report: ${bytes} bytes, ${eventLines} event lines\n${fromPause}`);
  expect(fromPause).toContain(`build ${id}`);
  expect(fromPause).toContain(`replay key ${key}`);
  expect(fromPause).toMatch(/state race · tick \d+ · seed 1 · replay \d+ ticks/);
  expect(fromPause).toMatch(/frames p50 [\d.]+ p95 [\d.]+ max [\d.]+ ms/);
  // M2 dev-4: what the race is played with, and the saved race with the fast-forward time (an
  // estimate from the live sim step until app-4 reports the saved recording and a measured resume).
  expect(fromPause).toMatch(
    /play difficulty (easy|normal|hard) · steer assist (off|light|strong) · throttle/,
  );
  expect(fromPause).toMatch(
    /(saved race not wired \(app-4\)|saved race) .*6-min fast-forward (est )?[\d.]+ s/,
  );
  expect(eventLines).toBeGreaterThan(0);
  expect(bytes).toBeLessThanOrEqual(2048);
  expect(problems).toEqual([]);
});

test("save debug file: the file's replay loads and matches its hashes; the share sheet gets it too", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = watchErrors(page);
  await page.goto('./');
  await page.locator('#start-screen').click();
  const { id, key } = await expectedKey(page);
  await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 720, null, {
    timeout: 120_000,
  });
  await page.locator('#hud-pause').click();
  await expect(page.locator('#pause-save-file')).toBeVisible();

  // No share sheet: the file downloads.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#pause-save-file').click(),
  ]);
  const name = download.suggestedFilename();
  const text = readFileSync(await download.path(), 'utf8');
  console.log(`debug file ${name}: ${Buffer.byteLength(text, 'utf8')} bytes`);
  expect(name).toMatch(new RegExp(`^throttlebrawl-debug-${id}-\\d{8}-\\d{6}\\.txt$`));
  expect(text).toContain(`replay key ${key}`);
  expect(text).toContain('===== full report =====');
  expect(text).toContain(REPLAY_MARKER);

  // The replay loads, and replayed against a fresh sim it matches every stored hash.
  const check = await page.evaluate((t) => (window as TestWindow).__game?.checkDebugFile(t), text);
  console.log(`replay check: ${JSON.stringify({ ...check, summary: undefined })}`);
  expect(check?.desync).toBeNull();
  expect(check?.keyMatches).toBe(true);
  expect(check?.ticks ?? 0).toBeGreaterThan(720);
  expect(check?.checked ?? 0).toBeGreaterThanOrEqual(12);
  expect(check?.summary).toContain(`build ${id}`);

  // The check can fail: a copy with one input run changed reports a desync.
  const lines = text.split('\n');
  const at = lines.indexOf(REPLAY_MARKER);
  const replay = JSON.parse(lines[at + 1] ?? 'null') as { inputs: { slots: number[][] } };
  const runs = replay.inputs.slots[0] ?? [];
  runs[2] = runs[2] === 255 ? 0 : 255; // the first run's throttle
  lines[at + 1] = JSON.stringify(replay);
  const tampered = await page.evaluate(
    (t) => (window as TestWindow).__game?.checkDebugFile(t),
    lines.join('\n'),
  );
  console.log(`tampered replay check: desync ${JSON.stringify(tampered?.desync)}`);
  expect(tampered?.desync).not.toBeNull();

  // With a share sheet that takes files, the same file goes to it instead of downloading.
  await page.evaluate(() => {
    const w = window as TestWindow;
    w.__shared = [];
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (d: ShareData) => (d.files?.length ?? 0) > 0,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: ShareData) => {
        for (const f of d.files ?? []) w.__shared?.push({ name: f.name, type: f.type, text: await f.text() });
      },
    });
  });
  await page.locator('#pause-save-file').click();
  await page.waitForFunction(() => ((window as TestWindow).__shared?.length ?? 0) > 0);
  const shared = await page.evaluate(() => (window as TestWindow).__shared?.[0]);
  expect(shared?.name).toMatch(/^throttlebrawl-debug-.*\.txt$/);
  expect(shared?.type).toBe('text/plain');
  expect(shared?.text).toContain(REPLAY_MARKER);
  const sharedCheck = await page.evaluate(
    (t) => (window as TestWindow).__game?.checkDebugFile(t),
    shared?.text ?? '',
  );
  expect(sharedCheck?.desync).toBeNull();
  expect(problems).toEqual([]);
});
