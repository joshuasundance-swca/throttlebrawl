import { expect, test, type Page } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

// M5 riding-readability: join real pack words, decoded voice delivery and Largest-text layout.
// The ticker seam replaces/holds presentation only; it never rewrites simulation state.
interface VoiceLine {
  ref: string;
  text: string;
  speaker: string;
  clipId: string;
}
interface BarkFile {
  id: string;
  meta?: { status?: string };
  defaults?: { speaker?: string };
  lines: {
    id: string;
    text: string;
    speaker?: string;
    status?: string;
    audioStatus?: string;
    audioAsset?: string | null;
  }[];
}
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const releaseLoads = (status: string | undefined): boolean => status === undefined || status === 'live';
const packs = readdirSync('packs', { withFileTypes: true }).filter((entry) => entry.isDirectory());
const speakers = new Map<string, string>();
for (const pack of packs) {
  const dir = `packs/${pack.name}/riders`;
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const rider = readJson(`${dir}/${file}`) as { id: string; name: string; meta?: { status?: string } };
    if (!releaseLoads(rider.meta?.status)) continue;
    speakers.set(`${pack.name}:${rider.id}`, rider.name);
  }
}
const VOICES: VoiceLine[] = [];
for (const pack of packs) {
  const dir = `packs/${pack.name}/barks`;
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const set = readJson(`${dir}/${file}`) as BarkFile;
    if (!releaseLoads(set.meta?.status)) continue;
    for (const line of set.lines) {
      // Audio draft is review metadata, not a runtime hold: an existing draft clip still plays.
      if (!line.audioAsset || !releaseLoads(line.status) || line.audioStatus === 'vetoed') continue;
      const id = line.speaker ?? set.defaults?.speaker ?? '';
      const speaker = id.includes(':')
        ? speakers.get(id)
        : (speakers.get(`${pack.name}:${id}`) ?? speakers.get(`base:${id}`));
      const ref = `${pack.name}:bark-set/${set.id}#${line.id}`;
      if (!speaker) throw new Error(`Cannot resolve the real speaker of ${ref}: ${id}`);
      VOICES.push({ ref, text: line.text, speaker, clipId: line.id });
    }
  }
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface StripEvidence {
  ref: string;
  words: string;
  speaker: string;
  role: string | null;
  live: string | null;
  visible: boolean;
  textVisible: boolean;
  tagVisible: boolean;
  opacity: number;
  fontPx: number;
  fit: string;
  viewport: { width: number; height: number };
  box: Box;
  textBoxes: Box[];
  tagBoxes: Box[];
  others: { id: string; box: Box }[];
}
type DeliveryWindow = Window & {
  __GAME_TEST__?: boolean;
  __uiTickerQuiet?: boolean;
  __uiTicker?: (items: unknown[]) => void;
  __game?: { setBot(on: boolean): void; lockstep(steps: number): void; state(): string };
  __subtitleVoices?: Record<string, { durationS: number; textAtStart: string; refAtStart: string }>;
  __subtitleDeliveryEvidence?: unknown[];
};

async function measure(page: Page): Promise<StripEvidence> {
  return page.evaluate(() => {
    const root = document.getElementById('hud-ticker');
    if (!root) throw new Error('No production ticker');
    for (const animation of root.getAnimations()) animation.finish();
    const box = (rect: DOMRect): Box => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    });
    const text = root.querySelector('.ticker-text');
    const tag = root.querySelector('.ticker-tag');
    const ranges = (node: Element | null): Box[] => {
      if (!node) return [];
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].filter((rect) => rect.width > 0).map(box);
    };
    const style = getComputedStyle(root);
    const visible = (node: Element | null): boolean =>
      !!node &&
      node.checkVisibility() &&
      getComputedStyle(node).visibility === 'visible' &&
      Number(getComputedStyle(node).opacity) > 0;
    return {
      ref: root.dataset['contentRef'] ?? '',
      words: text?.textContent ?? '',
      speaker: tag?.textContent ?? '',
      role: root.getAttribute('role'),
      live: root.getAttribute('aria-live'),
      visible: root.checkVisibility(),
      textVisible: visible(text),
      tagVisible: visible(tag),
      opacity: Number(style.opacity),
      fontPx: Number.parseFloat(style.fontSize),
      fit: root.dataset['fit'] ?? '',
      viewport: { width: innerWidth, height: innerHeight },
      box: box(root.getBoundingClientRect()),
      textBoxes: ranges(text),
      tagBoxes: ranges(tag),
      others: [
        'hud-speed',
        'hud-position',
        'hud-health',
        'hud-target',
        'hud-pause',
        'hud-heat',
        'hud-objective',
        'look-offer',
        'touch-attack',
        'touch-brake',
        'touch-wheelie',
      ]
        .map((id) => document.getElementById(id))
        .filter(
          (node): node is HTMLElement =>
            !!node && node.checkVisibility() && Number(getComputedStyle(node).opacity) > 0,
        )
        .map((node) => ({ id: node.id, box: box(node.getBoundingClientRect()) })),
    };
  });
}
const inside = (inner: Box, outer: Box): boolean =>
  inner.left >= outer.left - 0.5 &&
  inner.top >= outer.top - 0.5 &&
  inner.right <= outer.right + 0.5 &&
  inner.bottom <= outer.bottom + 0.5;
const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
const clipped = (reading: StripEvidence): boolean =>
  !reading.textVisible ||
  !reading.tagVisible ||
  reading.textBoxes.length === 0 ||
  reading.tagBoxes.length === 0 ||
  [...reading.textBoxes, ...reading.tagBoxes].some((box) => !inside(box, reading.box));

test('every live voiced bark starts with its complete Largest subtitle clear of the road and HUD', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 915, height: 412 });
  expect(VOICES.length, 'the content-derived coverage must not be empty').toBeGreaterThan(0);
  expect(new Set(VOICES.map((line) => line.ref)).size).toBe(VOICES.length);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.addInitScript(() => {
    const w = window as DeliveryWindow;
    w.__GAME_TEST__ = true;
    w.__uiTickerQuiet = true;
    w.__subtitleVoices = {};
    w.__subtitleDeliveryEvidence = [];
    localStorage.setItem(
      'mbrawl:settings',
      JSON.stringify({
        format: 'settings',
        version: 1,
        data: { textSize: 'largest', volumes: { master: 0 } },
      }),
    );
    window.addEventListener('throttlebrawl:bark-voice', (event) => {
      const detail = (event as CustomEvent<{ contentRef: string; durationS: number }>).detail;
      const root = document.getElementById('hud-ticker');
      if (w.__subtitleVoices)
        w.__subtitleVoices[detail.contentRef] = {
          durationS: detail.durationS,
          textAtStart: root?.querySelector('.ticker-text')?.textContent ?? '',
          refAtStart: root?.dataset['contentRef'] ?? '',
        };
    });
  });
  await page.goto('./');
  await page.locator('#start-action').click();
  await page.locator('#menu-quick-play').click();
  await page.evaluate(() => {
    const game = (window as DeliveryWindow).__game;
    game?.setBot(false);
    game?.lockstep(1);
  });
  await page.locator('#menu-race').click();
  await page.waitForFunction(() => (window as DeliveryWindow).__game?.state() === 'race');
  await expect(page.locator('#hud-pause')).toBeVisible();
  expect(
    await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize)),
    'Largest really changes the root text size',
  ).toBeCloseTo(16 * 1.4, 2);

  const evidence: unknown[] = [];
  for (const line of VOICES) {
    const responsePromise = page.waitForResponse((response) => {
      const name = new URL(response.url()).pathname.split('/').pop() ?? '';
      return name.endsWith('.ogg') && (name === `${line.clipId}.ogg` || name.startsWith(`${line.clipId}-`));
    });
    await page.evaluate((line) => {
      (window as DeliveryWindow).__uiTicker?.([
        { cls: 'bark', tag: line.speaker, text: line.text, contentRef: line.ref, dwellMs: 600_000 },
      ]);
    }, line);
    const response = await responsePromise;
    expect(response.ok(), `${line.ref}: actual clip response`).toBe(true);
    expect(await response.finished(), `${line.ref}: clip transfer completed`).toBeNull();
    await page.waitForFunction((ref) => !!(window as DeliveryWindow).__subtitleVoices?.[ref], line.ref);
    const voice = await page.evaluate((ref) => (window as DeliveryWindow).__subtitleVoices?.[ref], line.ref);
    expect(voice?.durationS, `${line.ref}: decoded source started`).toBeGreaterThan(0);
    expect(voice?.textAtStart, `${line.ref}: subtitle already complete when voice starts`).toBe(line.text);
    expect(voice?.refAtStart).toBe(line.ref);
    const reading = await measure(page);
    evidence.push({ ...reading, voice, clipUrl: response.url() });
    await page.evaluate(
      (row) => (window as DeliveryWindow).__subtitleDeliveryEvidence?.push(row),
      evidence.at(-1),
    );
    expect(reading.ref).toBe(line.ref);
    expect(reading.words).toBe(line.text);
    expect(reading.speaker).toBe(line.speaker);
    expect(reading.role).toBe('status');
    expect(reading.live).toBe('polite');
    expect(reading.visible).toBe(true);
    expect(reading.textVisible).toBe(true);
    expect(reading.tagVisible).toBe(true);
    expect(reading.opacity).toBeGreaterThanOrEqual(0.9);
    expect(reading.textBoxes.length, `${line.ref}: text really has painted ranges`).toBeGreaterThan(0);
    expect(reading.tagBoxes.length, `${line.ref}: speaker really has painted ranges`).toBeGreaterThan(0);
    expect(
      new Set(reading.textBoxes.map((box) => Math.round(box.top * 2))).size,
      `${line.ref}: at most two text lines`,
    ).toBeLessThanOrEqual(2);
    expect(clipped(reading), `${line.ref}: words and speaker fit the visible strip`).toBe(false);
    expect(inside(reading.box, { left: 0, top: 0, right: 915, bottom: 412 }), `${line.ref}: viewport`).toBe(
      true,
    );
    expect(
      overlaps(reading.box, { left: 915 * 0.25, right: 915 * 0.75, top: 412 * 0.25, bottom: 412 * 0.65 }),
      `${line.ref}: road ahead`,
    ).toBe(false);
    for (const other of reading.others)
      expect(overlaps(reading.box, other.box), `${line.ref}: clear of ${other.id}`).toBe(false);
    if (evidence.length === 1) {
      const previous = await page.locator('#hud-ticker').evaluate((root) => {
        const before = root.style.maxWidth;
        root.style.maxWidth = '1px';
        return before;
      });
      try {
        expect(clipped(await measure(page)), 'negative control detects planted clipping').toBe(true);
      } finally {
        await page.locator('#hud-ticker').evaluate((root, before) => {
          root.style.maxWidth = before;
        }, previous);
      }
      expect(clipped(await measure(page)), 'restoring the control restores the complete subtitle').toBe(
        false,
      );
      const tag = page.locator('#hud-ticker .ticker-tag');
      const display = await tag.evaluate((node) => {
        const before = (node as HTMLElement).style.display;
        (node as HTMLElement).style.display = 'none';
        return before;
      });
      try {
        expect(clipped(await measure(page)), 'negative control detects an unpainted speaker').toBe(true);
      } finally {
        await tag.evaluate((node, before) => {
          (node as HTMLElement).style.display = before;
        }, display);
      }
      expect(clipped(await measure(page)), 'restoring the speaker restores the complete subtitle').toBe(
        false,
      );
    }
  }
  expect(evidence.length).toBe(VOICES.length);
  expect(problems).toEqual([]);
  console.log(
    `[examined] ${evidence.length} real voiced lines: decoded start, exact Largest subtitle, clipping and HUD geometry`,
  );
});
