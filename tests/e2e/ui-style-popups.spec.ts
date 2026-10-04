import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { fastForwardDone } from './lockstep';

// Playtest 1c, 2026-09-30 [decided]: "The little pop-ups about near miss etc get in the way of
// seeing what's ahead. Maybe they could be less intrusive and/or less centered". Playtest 3,
// 2026-10-03 [decided]: "The black and white text pop-ups block the actual game", answered by the top
// ticker strip: every in-race text pop-up (a rival's or cop's bark, a style chip, a takedown name,
// the live style meter) is one line at a time in `#hud-ticker`. The strip must stay out of the
// central look-ahead: the middle half of the screen's width, from above the horizon (hills and
// cresting traffic) down to just above the rider. Measured on the race screens of the dev machine's
// software renderer, the horizon sits at about 44% of the height and the rider's head at about 53%
// in every shape tried, so the rectangle below has a wide margin. It must also keep off the HUD,
// the pause button and the touch buttons, on a phone held sideways and upright, a small phone, the
// left-handed mirror and a laptop.
//
// What the strip shows comes from `window.__uiTicker` (ui's test seam): it drops what shows, shows
// these items and holds the first up, so the live race cannot displace it while the spec measures
// it. The bark is swapped for the base pack's longest line, so it is measured at its widest real
// content. (ui-ticker.spec.ts measures the strip's own fit and looks; the events path is in it too.)
//
// The whole HUD's layout (the quality-confidence retro's rec 6, 2026-10-03: 5 of the 13 playtest
// defects were layout). Playtest 3 found the race objective sitting over the heat meter, and black
// and white text blocking the game. So on a phone held sideways (the default look), a phone held
// upright and a laptop, during a real career race (the objective line only shows in one), every
// HUD widget and overlay on screen is measured from its painted box: no two may overlap, and none
// may reach into the look-ahead. Three moments are measured: the race's start (the ticker, the
// objective and the career prompt), once the heat badge is up (with the slow-frames toast, the
// rival's health bar and a bark on the ticker beside them), and while the landing one-liner
// shows (render draws it in WebGL, so its plate is read from the overlay sprite three.js draws,
// through three's own devtools hook). Overlaps main already has are named in KNOWN_LAYOUT_FINDINGS,
// a list that can only shrink: a finding not on it fails, and so does an entry that no longer
// happens.

const LOOK_AHEAD = { left: 0.25, right: 0.75, top: 0.25, bottom: 0.65 };

interface BarkSetFile {
  lines: { text: string }[];
}
const LONGEST_LINE = readdirSync('packs/base/barks')
  .flatMap((f) => (JSON.parse(readFileSync(`packs/base/barks/${f}`, 'utf8')) as BarkSetFile).lines)
  .map((l) => l.text)
  .reduce((a, b) => (b.length > a.length ? b : a), '');

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** One HUD widget or overlay as painted: its name (the element's id, or what it is) and its box. */
interface Piece {
  name: string;
  box: Box;
}
interface Measured {
  viewport: { w: number; h: number };
  /** The strip as painted, or null when it is not up. */
  ticker: { cls: string; text: string; box: Box; fontPx: number; opacity: number } | null;
  others: { id: string; box: Box }[];
  /** Every HUD widget and overlay painted in the same frozen frame. */
  layout: Piece[];
  /** Whether the strip had finished sliding in and fading. */
  settled: boolean;
}
interface TickerItemLike {
  cls: string;
  text: string;
  tag?: string;
  cash?: number | null;
  kind?: string;
  contentRef?: string;
  dwellMs?: number;
}
interface LawLike {
  heat: number;
  tier: number;
}
interface SimEventLike {
  type: string;
  actor: number;
  tick: number;
  data?: Record<string, unknown>;
}
type TestWindow = Window & {
  __GAME_TEST__?: boolean;
  __raceFirst?: boolean;
  __game?: {
    setBot(on: boolean): void;
    setSeed(seed: number): void;
    state(): string;
    snapshot(): { tick: number; law?: LawLike } | null;
    events(): readonly SimEventLike[];
    playerId(): number;
    lockstep(steps: number | null): void;
    fastForward(
      until: (snap: { tick: number; law?: LawLike }) => boolean,
      opts?: { perFrame?: number; then?: number | null },
    ): void;
  };
  __uiTicker?: (items: TickerItemLike[], hold?: boolean) => void;
  /** The layout probe (installLayoutProbe): every painted HUD widget and overlay. */
  __layoutPieces?: () => Piece[];
  /** The layout probe: the landing one-liner's plate as the last frame drew it, or null. */
  __landingPlate?: () => Box | null;
};

/** A rival's bark with the base pack's longest line: the widest content the strip carries. */
const LONGEST_BARK: TickerItemLike = {
  cls: 'bark',
  tag: 'Deacon Vane',
  text: LONGEST_LINE,
  contentRef: 'base:bark-set/deacon-core#test',
  dwellMs: 600_000,
};
/** The widest style chip a race makes: a run of near misses with a big cash figure. */
const WIDE_CHIP: TickerItemLike = { cls: 'style', text: 'NEAR MISS ×12', kind: 'nearMiss', cash: 12345 };
const NAME: TickerItemLike = { cls: 'name', text: 'CATCH OF THE DAY', dwellMs: 600_000 };

/**
 * The layout findings main has today, by case: "a × b" for two pieces that overlap, "a in the road
 * ahead" for a piece inside the look-ahead. This list can only shrink. Fix one and delete its line
 * (the check fails while a line names something that no longer happens); never add one to get a
 * new overlap through: move the widget instead. KNOWN_LAYOUT_CAP holds the count, so growing the
 * list shows in the diff as a raised cap. Measured on CI's software renderer, 2026-10-03 (PR #416);
 * the playtest-3 HUD work (shelved) is where these get fixed.
 */
// Empty since the top HUD cluster (#428) and the transient overlays (#429) both landed.
const KNOWN_LAYOUT_FINDINGS: Record<string, readonly string[]> = {};
const KNOWN_LAYOUT_CAP = 0;

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
}

function lookAheadBox(w: number, h: number): Box {
  return {
    left: LOOK_AHEAD.left * w,
    right: LOOK_AHEAD.right * w,
    top: LOOK_AHEAD.top * h,
    bottom: LOOK_AHEAD.bottom * h,
  };
}

/**
 * What is wrong with one frame's layout: every pair of pieces whose painted boxes overlap, and every
 * piece inside the look-ahead. `against`, when given, limits the pairs to those with one of its
 * pieces (the landing line against the HUD drawn in its frame).
 */
function layoutFindings(
  pieces: readonly Piece[],
  w: number,
  h: number,
  against?: readonly Piece[],
): string[] {
  const out = new Set<string>();
  const look = lookAheadBox(w, h);
  const firsts = against ?? pieces;
  for (const [i, a] of firsts.entries()) {
    if (overlaps(a.box, look)) out.add(`${a.name} in the road ahead`);
    for (const b of against ? pieces : pieces.slice(i + 1))
      if (overlaps(a.box, b.box)) out.add([a.name, b.name].sort().join(' × '));
  }
  return [...out].sort();
}

/** The findings of every measured moment of one case, against its known list (exactly). */
function expectLayout(found: readonly string[], where: string) {
  const known = KNOWN_LAYOUT_FINDINGS[where] ?? [];
  const all = new Set(found);
  console.log(`${where}: layout findings ${JSON.stringify([...all].sort())}`);
  const unexpected = [...all].filter((f) => !known.includes(f)).sort();
  const gone = known.filter((f) => !all.has(f));
  expect(unexpected, `${where}: HUD widgets or overlays that overlap or sit in the road ahead`).toEqual([]);
  expect(gone, `${where}: known findings that no longer happen (delete them from the list)`).toEqual([]);
}

function logPieces(where: string, pieces: readonly Piece[]) {
  console.log(
    `${where}: ${pieces.length} pieces measured: ${pieces
      .map(
        (p) => `${p.name} [${[p.box.left, p.box.top, p.box.right, p.box.bottom].map(Math.round).join(',')}]`,
      )
      .join('; ')}`,
  );
}

function watchErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

/**
 * The layout probe, before the page loads. `__layoutPieces()` measures every painted HUD widget and
 * overlay: the HUD's own pieces (any new one is picked up by being in #hud, the ticker among them),
 * the career's objective and prompt, the touch buttons, the slow-frames toast and the notice card. `__landingPlate()` reads the landing
 * one-liner's sprite (render/air-pays.ts) from the overlay scene three.js reported through its
 * devtools hook: in CSS px, an orthographic camera with y up and the sprite centred on its position.
 */
async function installLayoutProbe(page: Page) {
  await page.addInitScript(() => {
    interface SpriteLike {
      visible: boolean;
      position: { x: number; y: number };
      scale: { x: number; y: number };
      center: { x: number; y: number };
      material: { opacity: number; map: unknown };
    }
    interface Observed {
      isScene?: boolean;
      isWebGLRenderer?: boolean;
      name?: string;
      domElement?: HTMLCanvasElement;
      getObjectByName?: (name: string) => SpriteLike | undefined;
    }
    const seen: Observed[] = [];
    const hook = new EventTarget();
    hook.addEventListener('observe', (e) => {
      const d = (e as CustomEvent<Observed>).detail;
      if (d && (d.isScene || d.isWebGLRenderer)) seen.push(d);
    });
    const w = window as Window & {
      __THREE_DEVTOOLS__?: EventTarget;
      __layoutPieces?: () => { name: string; box: Box }[];
      __landingPlate?: () => Box | null;
    };
    w.__THREE_DEVTOOLS__ = hook;
    w.__layoutPieces = () => {
      const out: { name: string; box: Box }[] = [];
      const sel = [
        '#hud > *',
        '#career-overlays > *',
        '#touch-surface > .touch-button',
        '#look-offer',
        '#ui > .notice',
      ].join(', ');
      const containers = new Set(['career-overlays']);
      const nodes = new Set(document.querySelectorAll<HTMLElement>(sel));
      for (const e of nodes) {
        if (containers.has(e.id)) continue;
        if (!e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const name = e.id || `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`;
        out.push({ name, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
      }
      return out;
    };
    w.__landingPlate = () => {
      const scene = seen.find((s) => s.isScene && s.name === 'air-pays-overlay');
      const line = scene?.getObjectByName?.('landing-line');
      const canvas = seen.find((s) => s.isWebGLRenderer)?.domElement;
      if (!line || !canvas || !line.visible || !line.material.map || !(line.material.opacity > 0.05))
        return null;
      const c = canvas.getBoundingClientRect();
      const left = c.left + line.position.x - line.scale.x * line.center.x;
      const top = c.top + canvas.clientHeight - (line.position.y + line.scale.y * (1 - line.center.y));
      return { left, top, right: left + line.scale.x, bottom: top + line.scale.y };
    };
  });
}

/** The career's first event's seed: its bot gets real air and some heat early. */
const CAREER_SEED = 4;

async function startRace(
  page: Page,
  opts: { portrait?: boolean; mirror?: boolean; classic?: boolean; career?: boolean } = {},
) {
  await installLayoutProbe(page);
  if (opts.classic) {
    // The laptop is the biggest screen here, and software WebGL takes about half a second a frame
    // there in the default ink look's offscreen pass (W-P's busier roads tipped it over in CI three
    // times running). The layout does not depend on the look, so this case races in the Classic
    // look, chosen through the saved record as a player would (as tests/perf/perf.spec.ts does).
    await page.addInitScript(() => {
      const record = {
        format: 'settings',
        version: 1,
        build: 'e2e',
        savedAt: '2026-10-02T00:00:00.000Z',
        data: { look: 'classic' },
      };
      localStorage.setItem('mbrawl:settings', JSON.stringify(record));
    });
  }
  await page.addInitScript(
    ({ portrait, career }) => {
      (window as TestWindow).__GAME_TEST__ = true;
      // A new device's first tap goes straight into the career's first race (its objective is up).
      if (career) (window as TestWindow).__raceFirst = true;
      // A phone held upright shows platform/'s rotate screen and pauses (its own spec covers that).
      // To measure the race screen in that shape, the page is told it is not portrait.
      if (portrait) {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (q: string) => {
          const list = real(q);
          if (!q.includes('orientation: portrait')) return list;
          return new Proxy(list, {
            get(target, key) {
              if (key === 'matches') return false;
              const value: unknown = Reflect.get(target, key, target);
              return typeof value === 'function'
                ? (value as (...a: unknown[]) => unknown).bind(target)
                : value;
            },
          });
        };
      }
    },
    { portrait: opts.portrait ?? false, career: opts.career ?? false },
  );
  await page.goto('./');
  if (opts.career) {
    // The bot rides from the first tick, so every case rides the same race (the moments below come
    // at the same ticks whatever the screen or the renderer's speed).
    await page.evaluate((seed) => {
      const g = (window as TestWindow).__game;
      g?.setSeed(seed);
      g?.setBot(true);
    }, CAREER_SEED);
    await page.locator('#start-screen').click();
    await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
    await expect(page.locator('#hud-objective')).toBeVisible();
  } else {
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-race')).toBeVisible();
    if (opts.mirror) {
      await page.locator('#menu-settings').click();
      await page.locator('#settings-tab-controls').click();
      await page.locator('#settings-mirror').check();
      await page.keyboard.press('Escape');
      await expect(page.locator('#menu-race')).toBeVisible();
    }
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await page.locator('#menu-race').click();
  }
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 20);
  // The race's first bark is on the strip: the real pipeline (events, narrative, ticker) is live.
  await expect(page.locator('#hud-ticker[data-cls="bark"]')).toBeVisible({ timeout: 10_000 });
}

interface MeasureOpts {
  /**
   * Elements to show while measuring, as ui/ shows them in a race: the slow-frames toast
   * (#look-offer, app/ raises it when frames run slow) and the rival's health bar (#hud-target, up
   * while the player fights one). ui/ places them whether shown or not.
   */
  show?: string[];
}

/**
 * Puts these items on the strip (held up, so the live race cannot displace them), lets its slide-in
 * and fade finish, and measures everything on the same frozen frame. The strip is judged at rest
 * whatever the renderer's speed: on a software renderer at about half a second a frame, a wait of a
 * few frames could land in a fade-out.
 */
function tickerAndMeasure(page: Page, items: TickerItemLike[], opts: MeasureOpts = {}): Promise<Measured> {
  return page.evaluate(
    ({ items, opts }) => {
      const box = (e: Element): { left: number; top: number; right: number; bottom: number } => {
        const r = e.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      (window as TestWindow).__uiTicker?.(items);
      const root = document.getElementById('hud-ticker');
      for (const a of document.getAnimations()) {
        if (root && a.effect instanceof KeyframeEffect && a.effect.target === root) a.finish();
      }
      // Shown for the measurement only, where ui/ has already placed them: hidden again after.
      const shownNow = (opts.show ?? [])
        .map((id) => document.getElementById(id))
        .filter((e): e is HTMLElement => !!e && e.hidden === true);
      for (const e of shownNow) e.hidden = false;
      const others = [
        'hud-speed',
        'hud-position',
        'hud-health',
        'hud-target',
        'hud-pause',
        'touch-attack',
        'touch-brake',
      ]
        .map((id) => document.getElementById(id))
        .filter((e): e is HTMLElement => !!e && e.checkVisibility())
        .map((e) => ({ id: e.id, box: box(e) }));
      const layout = (window as TestWindow).__layoutPieces?.() ?? [];
      const up = !!root && !root.hidden && root.checkVisibility();
      const style = root ? getComputedStyle(root) : null;
      const ticker =
        up && root && style
          ? {
              cls: root.dataset['cls'] ?? '',
              text: [
                root.querySelector('.ticker-tag')?.textContent ?? '',
                root.querySelector('.ticker-text')?.textContent ?? '',
                root.querySelector('.ticker-cash')?.textContent ?? '',
              ]
                .filter((t) => t !== '')
                .join(' '),
              box: box(root),
              fontPx: parseFloat(style.fontSize),
              opacity: parseFloat(style.opacity),
            }
          : null;
      for (const e of shownNow) e.hidden = true;
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        ticker,
        others,
        layout,
        settled: !!root && root.getAnimations().length === 0,
      };
    },
    { items, opts },
  );
}

function expectClear(m: Measured, where: string) {
  const { w, h } = m.viewport;
  const look = lookAheadBox(w, h);
  console.log(`${where}: look-ahead ${JSON.stringify(look)}`);
  console.log(`${where}: ticker ${JSON.stringify(m.ticker)}`);
  console.log(`${where}: ${m.others.length} HUD pieces and controls ${m.others.map((o) => o.id).join(', ')}`);
  expect(m.settled, `${where}: measured at rest, after the slide-in and the fade`).toBe(true);
  expect(m.ticker, `${where}: the ticker was up while measured`).not.toBeNull();
  const t = m.ticker;
  if (!t) return;
  expect(t.opacity, `${where}: "${t.text}" clearly shown`).toBeGreaterThanOrEqual(0.9);
  expect(overlaps(t.box, look), `${where}: "${t.text}" stays out of the look-ahead`).toBe(false);
  for (const o of m.others)
    expect(overlaps(t.box, o.box), `${where}: "${t.text}" clear of ${o.id}`).toBe(false);
  expect(
    t.box.left >= 0 && t.box.top >= 0 && t.box.right <= w && t.box.bottom <= h,
    `${where}: on screen`,
  ).toBe(true);
}

/** One measured moment's layout findings, with what it examined printed beside them. */
function momentFindings(m: Measured, where: string): string[] {
  logPieces(where, m.layout);
  const names = new Set(m.layout.map((p) => p.name));
  // The probe sees what the pop-up check sees: it is not measuring an empty screen.
  for (const must of ['hud-speed', 'hud-position', 'hud-ticker'])
    expect(names.has(must), `${where}: the layout probe measured ${must}`).toBe(true);
  return layoutFindings(m.layout, m.viewport.w, m.viewport.h);
}

/**
 * Rides on (fast-forward) until the heat badge is up, then measures the HUD with it, a bark held
 * on the ticker, the slow-frames toast and the rival's health bar shown. The race then crawls a
 * tick a frame, so the heat cannot cool off while the badge's lazy chunk arrives.
 */
async function heatMoment(page: Page, where: string): Promise<string[]> {
  await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    const from = g?.snapshot()?.tick ?? 0;
    // 3 minutes of race is a hang guard only; the check below fails if no heat came.
    g?.fastForward(
      (s) => s.tick > from + 3 * 60 * 60 || (s.law?.heat ?? 0) > 0.05 || (s.law?.tier ?? 0) > 0,
      {
        then: 1,
      },
    );
  });
  await fastForwardDone(page, `${where}: the heat badge`);
  await expect(page.locator('#hud-heat'), `${where}: the heat badge came up`).toBeVisible({
    timeout: 15_000,
  });
  const m = await tickerAndMeasure(page, [LONGEST_BARK], { show: ['look-offer', 'hud-target'] });
  const names = new Set(m.layout.map((p) => p.name));
  for (const must of ['hud-heat', 'hud-objective', 'look-offer', 'hud-target'])
    expect(names.has(must), `${where}: the layout probe measured ${must} with the heat up`).toBe(true);
  await shot(page, `${where.replace(/\s+/g, '-')}-heat`);
  const found = momentFindings(m, `${where}, heat`);
  await page.evaluate(() => (window as TestWindow).__game?.lockstep(null));
  return found;
}

/**
 * Rides on until the player's next clean landing after real air, then reads the landing one-liner's
 * plate every frame it shows: it must stay out of the road ahead and off the HUD drawn in its frame
 * (the HUD's lasting pieces; the ticker, the toast and the prompt come and go on their own clocks).
 */
async function landingMoment(page: Page, where: string): Promise<string[]> {
  await page.evaluate(() => {
    const g = (window as TestWindow).__game;
    if (!g) return;
    const from = g.snapshot()?.tick ?? 0;
    const me = g.playerId();
    g.fastForward(
      (s) =>
        s.tick > from + 4 * 60 * 60 ||
        g
          .events()
          .some((e) => e.type === 'land' && e.data?.['surge'] === true && e.actor === me && e.tick > from),
    );
  });
  await fastForwardDone(page, `${where}: a landing that pays`);
  const samples = await page.evaluate(async () => {
    const w = window as TestWindow;
    const out: { plate: Box; pieces: Piece[]; vw: number; vh: number }[] = [];
    const t0 = performance.now();
    // The line lasts 2 s; 4 s and 240 frames are hang guards only.
    for (let i = 0; i < 240 && performance.now() - t0 < 4000; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const plate = w.__landingPlate?.() ?? null;
      if (plate) out.push({ plate, pieces: w.__layoutPieces?.() ?? [], vw: innerWidth, vh: innerHeight });
      else if (out.length > 0) break;
    }
    return out;
  });
  console.log(
    `${where}: the landing line's plate in ${samples.length} frames: ${JSON.stringify(samples.map((s) => s.plate))}`,
  );
  expect(samples.length, `${where}: the landing one-liner was drawn and measured`).toBeGreaterThan(0);
  const transient = new Set(['hud-ticker', 'look-offer', 'career-prompt', 'hud-target']);
  const found = new Set<string>();
  for (const s of samples) {
    const line: Piece = { name: 'landing-line', box: s.plate };
    const hud = s.pieces.filter((p) => !transient.has(p.name) && !p.name.startsWith('div.card'));
    for (const f of layoutFindings(hud, s.vw, s.vh, [line])) found.add(f);
  }
  const first = samples[0];
  if (first) logPieces(`${where}, landing`, first.pieces);
  return [...found];
}

/**
 * Less intrusive, still readable: small words on one line (or two, on a screen too narrow for the
 * words), a readable cash figure, a slot of at most 44 px. A takedown name is smaller still.
 */
function expectCompact(m: Measured, where: string) {
  const t = m.ticker;
  expect(t, `${where}: the ticker was up`).not.toBeNull();
  if (!t) return;
  expect(t.fontPx, `${where}: small words`).toBeLessThanOrEqual(15);
  expect(t.fontPx, `${where}: readable words`).toBeGreaterThanOrEqual(12);
  expect(t.box.bottom - t.box.top, `${where}: one slot`).toBeLessThanOrEqual(44);
}

async function shot(page: Page, name: string) {
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: `test-results/screenshots/ui-style-popups-${name}.png` });
}

/** A whole case's HUD layout: the start, the heat badge and the landing line, against its list. */
async function expectWholeLayout(page: Page, start: Measured, where: string) {
  const found = [...momentFindings(start, `${where}, start`)];
  found.push(...(await heatMoment(page, where)));
  found.push(...(await landingMoment(page, where)));
  expectLayout(found, where);
}

test('the known layout list only shrinks', () => {
  const entries = Object.values(KNOWN_LAYOUT_FINDINGS).flat();
  // The cap follows the list down (lower it with each fix), so any growth shows as a raised cap.
  expect(entries.length, 'KNOWN_LAYOUT_CAP must equal the list: lower it when you fix one').toBe(
    KNOWN_LAYOUT_CAP,
  );
});

test('phone landscape: the ticker sits clear of the road ahead, stays small and fades quickly', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const problems = watchErrors(page);
  await startRace(page, { career: true });
  const bark = await tickerAndMeasure(page, [LONGEST_BARK]);
  expectClear(bark, 'phone landscape, bark');
  expectCompact(bark, 'phone landscape, bark');
  expect(bark.ticker?.text).toBe(`Deacon Vane ${LONGEST_LINE}`);
  await shot(page, 'phone');

  const chip = await tickerAndMeasure(page, [WIDE_CHIP]);
  expectClear(chip, 'phone landscape, chip');
  expectCompact(chip, 'phone landscape, chip');
  expect(chip.ticker?.text).toBe('NEAR MISS ×12 +$12,345');

  // A takedown name flashes small.
  const name = await tickerAndMeasure(page, [NAME]);
  expectClear(name, 'phone landscape, name');
  expect(name.ticker?.fontPx, 'a takedown name is small').toBeLessThanOrEqual(12);

  // A quick fade: a chip left to itself is gone well inside a few seconds (1.1 s of the strip's clock).
  await page.evaluate(() =>
    (window as TestWindow).__uiTicker?.(
      [{ cls: 'style', text: 'NEAR MISS', kind: 'nearMiss', cash: 25 }],
      false,
    ),
  );
  const before = Date.now();
  await page.waitForFunction(
    () => {
      const root = document.getElementById('hud-ticker');
      return !root || root.hidden || !(root.textContent ?? '').includes('NEAR MISS');
    },
    null,
    { timeout: 6_000 },
  );
  console.log(`chip gone ${Date.now() - before} ms after it was shown`);

  await expectWholeLayout(page, bark, 'phone landscape');
  expect(problems).toEqual([]);
});

test('phone landscape, left-handed mirror: the ticker stays clear with the rival bar beside it', async ({
  page,
}) => {
  const problems = watchErrors(page);
  await startRace(page, { mirror: true });
  // The rival's bar is shown beside the ticker: sideways they share the top row.
  const m = await tickerAndMeasure(page, [LONGEST_BARK], { show: ['hud-target'] });
  expectClear(m, 'mirrored');
  expectCompact(m, 'mirrored');
  await shot(page, 'mirrored');
  expectLayout(momentFindings(m, 'mirrored, start'), 'mirrored');
  expect(problems).toEqual([]);
});

test.describe('phone portrait', () => {
  test.use({ viewport: { width: 412, height: 915 } });
  test('the ticker sits clear of the road ahead', async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watchErrors(page);
    await startRace(page, { portrait: true, career: true });
    const m = await tickerAndMeasure(page, [LONGEST_BARK]);
    expectClear(m, 'phone portrait');
    expectCompact(m, 'phone portrait');
    await shot(page, 'portrait');
    await expectWholeLayout(page, m, 'phone portrait');
    expect(problems).toEqual([]);
  });
});

test.describe('small phone landscape', () => {
  test.use({ viewport: { width: 740, height: 360 } });
  test('the ticker sits clear of the road ahead', async ({ page }) => {
    const problems = watchErrors(page);
    await startRace(page);
    // The rival's bar beside the ticker: on this screen the top row is tightest.
    const m = await tickerAndMeasure(page, [LONGEST_BARK], { show: ['hud-target'] });
    expectClear(m, 'small phone');
    expectCompact(m, 'small phone');
    await shot(page, 'small');
    expectLayout(momentFindings(m, 'small phone, start'), 'small phone');
    expect(problems).toEqual([]);
  });
});

test.describe('laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false });
  test('the ticker sits clear of the road ahead', async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watchErrors(page);
    await startRace(page, { classic: true, career: true });
    const m = await tickerAndMeasure(page, [LONGEST_BARK]);
    expectClear(m, 'laptop');
    expectCompact(m, 'laptop');
    await shot(page, 'laptop');
    await expectWholeLayout(page, m, 'laptop');
    expect(problems).toEqual([]);
  });
});

// The overlap checks must fire: a widget planted in the middle of the screen is caught, so is one
// moved over another (here the heat badge's spot, where playtest 3 saw the objective), and so is
// one laid over the ticker.
test('the look-ahead and layout checks catch a centred widget and overlapped widgets (negative control)', async ({
  page,
}) => {
  await startRace(page);
  const first = await tickerAndMeasure(page, [LONGEST_BARK]);
  const strip = first.ticker?.box;
  expect(strip, 'the ticker was up to plant against').toBeDefined();
  await page.evaluate((strip) => {
    const hud = document.getElementById('hud');
    const planted = (id: string, text: string, style: Record<string, string>) => {
      const d = document.createElement('div');
      d.id = id;
      d.textContent = text;
      Object.assign(d.style, style);
      hud?.append(d);
    };
    // A widget in the middle of the road ahead.
    planted('planted-pop', 'PLANTED', { position: 'fixed', left: '45%', top: '40%', background: '#000a' });
    // One laid exactly over the ticker.
    if (strip)
      planted('planted-over-ticker', 'OVER', {
        position: 'fixed',
        left: `${strip.left}px`,
        top: `${strip.top}px`,
        width: `${strip.right - strip.left}px`,
        height: `${strip.bottom - strip.top}px`,
        background: '#000a',
      });
    // The speed readout dropped onto the position badge, and a widget at the heat badge's spot
    // under one at the objective's: both pairs overlap by construction.
    const speed = document.getElementById('hud-speed');
    const position = document.getElementById('hud-position');
    if (speed && position) {
      const p = position.getBoundingClientRect();
      Object.assign(speed.style, { left: `${p.left}px`, top: `${p.top}px`, right: 'auto', bottom: 'auto' });
    }
    for (const id of ['planted-heat', 'planted-objective'])
      planted(id, id === 'planted-heat' ? 'HEAT' : 'FINISH', {
        position: 'absolute',
        top: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '4px 10px',
        background: '#000a',
      });
  }, strip);
  const m = await tickerAndMeasure(page, [LONGEST_BARK]);
  const { w, h } = m.viewport;
  const found = layoutFindings(m.layout, w, h);
  console.log(`negative control: layout findings ${JSON.stringify(found)}`);
  expect(found).toContain('hud-position × hud-speed');
  expect(found).toContain('planted-heat × planted-objective');
  expect(found).toContain('planted-pop in the road ahead');
  expect(found).toContain('hud-ticker × planted-over-ticker');
  // A ticker laid over the middle of the road is caught against the road ahead as well.
  const plate: Piece = {
    name: 'landing-line',
    box: { left: w * 0.2, right: w * 0.8, top: h * 0.3, bottom: h * 0.4 },
  };
  expect(layoutFindings(m.layout, w, h, [plate])).toContain('landing-line in the road ahead');
});
