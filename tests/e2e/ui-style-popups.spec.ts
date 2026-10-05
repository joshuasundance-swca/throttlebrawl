import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { PROMPTS } from '../../src/career/onboarding.ts';
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
// rival's health bar and a bark on the ticker beside them), and through a landing that pays (the
// landing one-liner is a `line` item on the ticker since the ticker integration, T8.2; the strip is
// measured against the player's bike on every frame of the landing's settle). Overlaps main already
// has are named in KNOWN_LAYOUT_FINDINGS,
// a list that can only shrink: a finding not on it fails, and so does an entry that no longer
// happens.
//
// Playtest 3's wheelie gauge (T6.3, `#hud-wheelie`, the one new widget) is shown at its resting place
// beside the stick in a second frame of the heat and toast moments, so it is measured against every
// other piece, the touch buttons and the road ahead like the rest; the career prompt steps aside
// while it is up (ui/moves-meter.ts), so every prompt put in the box in that frame must be hidden.
// ui/moves-meter.test.ts sweeps where else a thumb can put it.
//
// The live check after the HUD run (#428-#430) found what the road-ahead box alone cannot see: the
// in-air prompt under the BRAKE button, and the slow-frames toast and the landing line over the
// player's own bike. So the player's bike is a piece too (its painted screen box: the rider's
// drawn frame, projected through the camera three.js last drew the race with; it may sit in the
// road ahead, it is the thing ahead of the camera), the touch buttons are pieces, every tutorial
// prompt is measured in the prompt box at the heat moment (or the start, in a quick race), and the
// longest producer ask is measured as the ticker item it now is. The live check after the HUD fix
// (#431) found the landing line still over the bottom of the bike on the Keys for about 1.3 s (it
// was placed from the first in-air frame, then the bike sank). The line is a ticker item now, and
// the landing moment measures the strip against the bike on every frame of the landing's settle.

const LOOK_AHEAD = { left: 0.25, right: 0.75, top: 0.25, bottom: 0.65 };
/** The player's bike: allowed in the road ahead, never under another piece. */
const BIKE = 'player-bike';

/**
 * Every prompt the career's prompt box shows: the tutorial's (career/onboarding.ts). The producer's
 * asks left the box for the ticker (T8.2): they are `ask` items, measured below as the strip's.
 */
interface CareerFile {
  show?: { asks?: { text: string; cash: number }[] };
}
const CAREER_PROMPTS: readonly string[] = Object.values(PROMPTS);

/** The producer's asks from every career pack. */
const ASKS = readdirSync('packs').flatMap((pack) => {
  const dir = `packs/${pack}/careers`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => (JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as CareerFile).show?.asks ?? []);
});

/** Every region's landing one-liners (the pools app/ picks from). */
interface RegionFile {
  landingLines?: { text: string }[];
}
const LANDING_LINES = readdirSync('packs').flatMap((pack) => {
  const dir = `packs/${pack}/regions`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((r) => {
    const file = `${dir}/${r}/region.json`;
    return existsSync(file)
      ? ((JSON.parse(readFileSync(file, 'utf8')) as RegionFile).landingLines ?? []).map((l) => l.text)
      : [];
  });
});

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
  /** Each career and tutorial prompt as the prompt box paints it in that frame, by its words. */
  prompts: { text: string; box: Box; hidden: boolean }[];
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
    snapshot(): {
      tick: number;
      law?: LawLike;
      entities?: { id: number; x: number; y: number; z: number }[];
    } | null;
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
  /** The layout probe: the player's bike as the last frame drew it (its screen box), or null. */
  __playerBike?: () => Box | null;
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
/** The widest producer ask (app/ticker-feed.ts `producerAskItem`): the tag, the words and the cash. */
const LONGEST_ASK: TickerItemLike = (() => {
  const widest = ASKS.reduce((a, b) => (b.text.length > a.text.length ? b : a), { text: '', cash: 0 });
  return { cls: 'ask', tag: 'PRODUCER', text: widest.text, cash: widest.cash, dwellMs: 600_000 };
})();
/** The widest landing line, as app/ puts it on the strip (`landingLineItem`). */
const LONGEST_LANDING: TickerItemLike = {
  cls: 'line',
  text: LANDING_LINES.reduce((a, b) => (b.length > a.length ? b : a), ''),
  contentRef: 'base:region/florida-keys#test-landing',
  dwellMs: 600_000,
};

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
    // The bike is what the road ahead is kept clear for: it may sit in it.
    if (a.name !== BIKE && overlaps(a.box, look)) out.add(`${a.name} in the road ahead`);
    for (const b of against ? pieces : pieces.slice(i + 1))
      if (b !== a && overlaps(a.box, b.box)) out.add([a.name, b.name].sort().join(' × '));
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

function roundBox(b: Box): number[] {
  return [b.left, b.top, b.right, b.bottom].map(Math.round);
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
 * the career's objective and prompt, the touch buttons, the slow-frames toast, the notice card and
 * the player's bike. `__playerBike()` finds the player's
 * rider frame (render/views.ts: the group a rider's boxes or its rig are drawn on, at its ground
 * point, turned with its heading, lean and pitch) nearest the player's snapshot position, and
 * projects a box round the bike and rider through the camera the renderer last drew the race with
 * (caught by wrapping its `render`).
 */
async function installLayoutProbe(page: Page) {
  await page.addInitScript(() => {
    interface NodeLike {
      name: string;
      rotation: { order: string };
      matrixWorld: { elements: ArrayLike<number> };
      children: NodeLike[];
    }
    interface CameraLike {
      isPerspectiveCamera?: boolean;
      matrixWorldInverse: { elements: ArrayLike<number> };
      projectionMatrix: { elements: ArrayLike<number> };
    }
    interface Observed {
      isScene?: boolean;
      isWebGLRenderer?: boolean;
      name?: string;
      domElement?: HTMLCanvasElement;
      getObjectByName?: (name: string) => NodeLike | undefined;
      render?: (scene: Observed, camera: CameraLike) => void;
    }
    const seen: Observed[] = [];
    // The race's own draw: the last perspective camera and the scene it drew.
    let drawn: { scene: Observed; camera: CameraLike } | null = null;
    const hook = new EventTarget();
    hook.addEventListener('observe', (e) => {
      const d = (e as CustomEvent<Observed>).detail;
      if (d && (d.isScene || d.isWebGLRenderer)) seen.push(d);
      const render = d?.isWebGLRenderer ? d.render : undefined;
      if (d && render) {
        d.render = function (this: Observed, scene: Observed, camera: CameraLike) {
          if (camera?.isPerspectiveCamera && scene?.isScene) drawn = { scene, camera };
          render.call(this, scene, camera);
        };
      }
    });
    const w = window as Window & {
      __THREE_DEVTOOLS__?: EventTarget;
      __layoutPieces?: () => { name: string; box: Box }[];
      __playerBike?: () => Box | null;
      __game?: {
        playerId(): number;
        snapshot(): { entities?: { id: number; x: number; y: number; z: number }[] } | null;
      };
    };
    w.__THREE_DEVTOOLS__ = hook;
    // The bike, then the rider on it, as boxes in the rider's frame: across, up from the ground,
    // along (metres; render/air-pays.ts BIKE_SHAPE, kept the same by hand: this is the check's own
    // measure, fitted to the painted rider in CI's screenshots).
    const SHAPE: { min: [number, number, number]; max: [number, number, number] }[] = [
      { min: [-0.35, 0, -0.95], max: [0.35, 1.05, 0.95] },
      { min: [-0.45, 0.5, -0.45], max: [0.45, 1.75, 0.35] },
    ];
    w.__playerBike = () => {
      const canvas = seen.find((s) => s.isWebGLRenderer)?.domElement;
      const game = w.__game;
      if (!drawn || !canvas || !game) return null;
      const me = game.playerId();
      const self = game.snapshot()?.entities?.find((e) => e.id === me);
      const riders = drawn.scene.getObjectByName?.('entities')?.children ?? [];
      let best: NodeLike | null = null;
      let bestD = 6; // metres: farther than this is not the player's frame
      for (const r of riders) {
        if (r.name !== '' || r.rotation.order !== 'YXZ' || !self) continue;
        const m = r.matrixWorld.elements;
        const d = Math.hypot((m[12] ?? 0) - self.x, (m[13] ?? 0) - self.y, (m[14] ?? 0) - self.z);
        if (d < bestD) [best, bestD] = [r, d];
      }
      if (!best) return null;
      const m = best.matrixWorld.elements;
      const v = drawn.camera.matrixWorldInverse.elements;
      const p = drawn.camera.projectionMatrix.elements;
      const mul = (e: ArrayLike<number>, x: number, y: number, z: number, wv: number) =>
        [0, 1, 2, 3].map(
          (i) => (e[i] ?? 0) * x + (e[4 + i] ?? 0) * y + (e[8 + i] ?? 0) * z + (e[12 + i] ?? 0) * wv,
        ) as [number, number, number, number];
      const c = canvas.getBoundingClientRect();
      const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (const b of SHAPE)
        for (const x of [b.min[0], b.max[0]])
          for (const y of [b.min[1], b.max[1]])
            for (const z of [b.min[2], b.max[2]]) {
              const world = mul(m, x, y, z, 1);
              const view = mul(v, world[0], world[1], world[2], 1);
              const [cx, cy, , cw] = mul(p, view[0], view[1], view[2], 1);
              if (!(cw > 0.05)) continue; // behind the camera
              const sx = c.left + ((cx / cw + 1) / 2) * c.width;
              const sy = c.top + ((1 - cy / cw) / 2) * c.height;
              box.left = Math.min(box.left, sx);
              box.right = Math.max(box.right, sx);
              box.top = Math.min(box.top, sy);
              box.bottom = Math.max(box.bottom, sy);
            }
      if (!(box.right > box.left)) return null;
      // Only what is on screen is painted.
      return {
        left: Math.max(c.left, box.left),
        top: Math.max(c.top, box.top),
        right: Math.min(c.right, box.right),
        bottom: Math.min(c.bottom, box.bottom),
      };
    };
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
      const bike = w.__playerBike?.() ?? null;
      if (bike) out.push({ name: 'player-bike', box: bike });
      return out;
    };
  });
}

/** The career's first event's seed: its bot gets real air and some heat early. */
const CAREER_SEED = 4;

async function startRace(page: Page, opts: { mirror?: boolean; classic?: boolean; career?: boolean } = {}) {
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
    ({ career }) => {
      (window as TestWindow).__GAME_TEST__ = true;
      // A new device's first tap goes straight into the career's first race (its objective is up).
      if (career) (window as TestWindow).__raceFirst = true;
    },
    { career: opts.career ?? false },
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
  /** Put each of these words in the career's prompt box in turn and measure it (then restore). */
  prompts?: readonly string[];
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
      // Every prompt in the career's prompt box, as it would show in this frame.
      const prompts: { text: string; box: ReturnType<typeof box>; hidden: boolean }[] = [];
      const promptBox = document.getElementById('career-prompt');
      if (promptBox && opts.prompts?.length) {
        const was = { text: promptBox.textContent, hidden: promptBox.hidden };
        promptBox.hidden = false;
        for (const t of opts.prompts) {
          promptBox.textContent = t;
          if (promptBox.checkVisibility())
            prompts.push({
              text: t,
              box: box(promptBox),
              // Stepped aside (visibility: hidden: the landing line, the wheelie gauge): not painted.
              hidden: getComputedStyle(promptBox).visibility === 'hidden',
            });
        }
        promptBox.textContent = was.text;
        promptBox.hidden = was.hidden;
      }
      for (const e of shownNow) e.hidden = true;
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        ticker,
        others,
        layout,
        prompts,
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
function momentFindings(m: Measured, where: string, promptsMeasured = false): string[] {
  logPieces(where, m.layout);
  if (promptsMeasured)
    expect(m.prompts.length, `${where}: every career and tutorial prompt measured`).toBe(
      CAREER_PROMPTS.length,
    );
  const names = new Set(m.layout.map((p) => p.name));
  // The probe sees what the pop-up check sees: it is not measuring an empty screen.
  // On a phone the slow-frames toast takes the ticker's place, and the strip steps aside while it
  // is up (ui/index.ts): with the toast measured, the strip is not required.
  const toastUp = names.has('look-offer');
  for (const must of ['hud-speed', 'hud-position', BIKE, ...(toastUp ? [] : ['hud-ticker'])])
    expect(names.has(must), `${where}: the layout probe measured ${must}`).toBe(true);
  const found = new Set(layoutFindings(m.layout, m.viewport.w, m.viewport.h));
  // Each prompt against everything else in the frame (the live prompt's own box left out).
  const rest = m.layout.filter((p) => p.name !== 'career-prompt');
  const byPrompt: string[] = [];
  for (const p of m.prompts) {
    if (p.hidden) continue;
    const piece: Piece = { name: 'career-prompt', box: p.box };
    const f = layoutFindings(rest, m.viewport.w, m.viewport.h, [piece]);
    for (const x of f) found.add(x);
    if (f.length) byPrompt.push(`"${p.text}" ${JSON.stringify(f)}`);
  }
  if (m.prompts.length) {
    const tallest = m.prompts.reduce((a, b) => (b.box.bottom - b.box.top > a.box.bottom - a.box.top ? b : a));
    console.log(
      `${where}: ${m.prompts.length} prompts measured (tallest ${JSON.stringify(tallest)}); with findings: ${byPrompt.join('; ') || 'none'}`,
    );
  }
  return [...found].sort();
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
  const m = await tickerAndMeasure(page, [LONGEST_BARK], {
    show: ['look-offer', 'hud-target'],
    prompts: CAREER_PROMPTS,
  });
  const names = new Set(m.layout.map((p) => p.name));
  for (const must of ['hud-heat', 'hud-objective', 'look-offer', 'hud-target'])
    expect(names.has(must), `${where}: the layout probe measured ${must} with the heat up`).toBe(true);
  await shot(
    page,
    `${where.replace(/\s+/g, '-')}-heat`,
    m.layout.filter((p) => p.name === BIKE).map((p) => p.box),
    ['look-offer'],
  );
  const found = momentFindings(m, `${where}, heat`, true);
  found.push(...(await gaugeMoment(page, `${where}, heat`)));
  await page.evaluate(() => (window as TestWindow).__game?.lockstep(null));
  return found;
}

/**
 * Playtest 3's wheelie gauge (T6.3) up at its resting place beside where the stick lands, in the same
 * frozen frame as the moment's other pieces (a bark held, the toast and the rival's bar): it is
 * measured against every piece, the touch buttons and the road ahead. The career prompt steps aside
 * while the gauge is up (ui/moves-meter.ts), so every prompt put in the box in this frame is hidden.
 */
async function gaugeMoment(page: Page, where: string): Promise<string[]> {
  const g = await tickerAndMeasure(page, [LONGEST_BARK], {
    show: ['look-offer', 'hud-target', 'hud-wheelie'],
    prompts: CAREER_PROMPTS,
  });
  expect(
    g.layout.some((p) => p.name === 'hud-wheelie'),
    `${where}: the layout probe measured hud-wheelie`,
  ).toBe(true);
  expect(g.prompts.length, `${where}: every prompt put in the box with the gauge up`).toBe(
    CAREER_PROMPTS.length,
  );
  expect(
    g.prompts.filter((p) => !p.hidden).map((p) => p.text),
    `${where}: prompts that show beside the wheelie gauge`,
  ).toEqual([]);
  expect(
    g.layout.some((p) => p.name === 'career-prompt'),
    `${where}: the live prompt steps aside while the gauge is up`,
  ).toBe(false);
  return momentFindings(g, `${where}, wheelie gauge`);
}

/**
 * Rides on until the player's next clean landing after real air (the one that puts a line on the
 * ticker), then measures the strip as a landing line, every frame for a stretch of the settle (the
 * live check found the bike sinking 30 to 64 px as the camera eased back after touchdown): the strip
 * must stay out of the road ahead and off every piece drawn in its frame, the player's bike
 * included. The slow-frames toast is held up beside it where the layout puts the two side by side
 * (stacked, the strip steps aside while the toast shows, so there is no line to measure then). The
 * prompt (the in-air one comes with every first jump) is checked against everything in those frames
 * too. Pairs of the other pieces (the ticker, moving on its own clock) are judged at the frozen
 * moments instead.
 *
 * The real path (the landing's event reaching the strip) can be displaced by a bark that is up at
 * that moment (a lower class waits or is dropped), so the strip is given the regions' widest
 * landing line through the seam, held, and the real path is checked where nothing displaces it: the
 * veto's "recently seen" list, which app/ notes the line in as it puts it on the strip.
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
  const samples = await page.evaluate(async (line) => {
    const w = window as TestWindow;
    const out: { strip: Box; pieces: Piece[]; vw: number; vh: number }[] = [];
    // The strip carries the landing line, held up so the live race cannot displace it.
    w.__uiTicker?.([line], true);
    // The toast held up beside the strip, where ui/ places the two side by side (hidden again after).
    const toast = document.getElementById('look-offer');
    const toastWasHidden = toast?.hidden ?? false;
    const stacked = document.getElementById('ui')?.dataset['top'] === 'stacked';
    if (toast && !stacked) toast.hidden = false;
    const t0 = performance.now();
    // 90 frames: the camera's settle after a touchdown takes about 1.3 s of the race. 6 s is a hang guard.
    for (let i = 0; i < 90 && performance.now() - t0 < 6000; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const pieces = w.__layoutPieces?.() ?? [];
      const strip = pieces.find((p) => p.name === 'hud-ticker');
      const el = document.getElementById('hud-ticker');
      if (strip && el?.dataset['cls'] === 'line')
        out.push({
          strip: strip.box,
          pieces: pieces.filter((p) => p !== strip),
          vw: innerWidth,
          vh: innerHeight,
        });
    }
    if (toast) toast.hidden = toastWasHidden;
    return out;
  }, LONGEST_LANDING);
  console.log(
    `${where}: the strip as a landing line in ${samples.length} frames: ${JSON.stringify(samples.slice(0, 3).map((s) => roundBox(s.strip)))} ...`,
  );
  expect(samples.length, `${where}: the strip showed the landing line and was measured`).toBeGreaterThan(20);
  const checked = new Set(['career-prompt', 'look-offer', BIKE]);
  const found = new Set<string>();
  const bikes: Box[] = [];
  for (const s of samples) {
    const line: Piece = { name: 'landing-line', box: s.strip };
    const pieces = s.pieces.filter((p) => !p.name.startsWith('div.card'));
    const against = [line, ...pieces.filter((p) => checked.has(p.name))];
    for (const f of layoutFindings(pieces, s.vw, s.vh, against)) found.add(f);
    const bike = pieces.find((p) => p.name === BIKE);
    if (bike) bikes.push(bike.box);
  }
  console.log(`${where}: the player's bike in those frames: ${JSON.stringify(bikes.map(roundBox))}`);
  expect(bikes.length, `${where}: the bike was measured in every landing frame`).toBe(samples.length);
  // The strip never covers the bike, on any frame: the check the HUD run's live check asked for.
  const covering = samples.filter((s) => {
    const bike = s.pieces.find((p) => p.name === BIKE);
    return !!bike && overlaps(s.strip, bike.box);
  });
  expect(covering.length, `${where}: frames where the landing line covers the bike`).toBe(0);
  const first = samples[0];
  if (first) logPieces(`${where}, landing`, first.pieces);
  await recentlySeenHasLanding(page, where);
  return [...found];
}

/**
 * The real path, end to end: app/ put the landing's line on the strip (and noted it as seen), so
 * the pause screen's "recently seen" list names one of the regions' landing lines. The pause ends
 * the case's measuring, so this runs last.
 */
async function recentlySeenHasLanding(page: Page, where: string) {
  await page.keyboard.press('Escape');
  const list = page.locator('#pause-screen #recently-seen');
  await expect(list, `${where}: the pause screen's recently-seen list`).toBeVisible();
  const rows = await list
    .locator('.rs-item')
    .evaluateAll((els) =>
      els.map((e) => ({ ref: e.getAttribute('data-content-ref') ?? '', text: e.textContent ?? '' })),
    );
  console.log(`${where}: recently seen: ${JSON.stringify(rows.map((r) => r.ref))}`);
  const landing = rows.filter((r) => LANDING_LINES.some((l) => r.text.includes(l)));
  expect(
    landing.map((r) => r.ref),
    `${where}: the landing line is in "recently seen" (app/ noted it as it put it on the strip)`,
  ).not.toEqual([]);
  for (const r of landing)
    expect(r.ref, `${where}: a landing line's reference`).toMatch(/^[\w-]+:region\/[\w-]+#[\w-]+$/);
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

/**
 * A screenshot; `outline` boxes (the measured bike) are drawn on it as dashed frames, and the `show`
 * elements (the slow-frames toast) are up for it, then all is put back.
 */
async function shot(page: Page, name: string, outline: readonly Box[] = [], show: readonly string[] = []) {
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.evaluate(
    ({ boxes, ids }) => {
      for (const id of ids) {
        const e = document.getElementById(id);
        if (e?.hidden) {
          e.hidden = false;
          e.classList.add('probe-shown');
        }
      }
      for (const b of boxes) {
        const d = document.createElement('div');
        d.className = 'probe-outline';
        Object.assign(d.style, {
          position: 'fixed',
          left: `${b.left}px`,
          top: `${b.top}px`,
          width: `${b.right - b.left}px`,
          height: `${b.bottom - b.top}px`,
          outline: '2px dashed #0ff',
          pointerEvents: 'none',
          zIndex: '99',
        });
        document.body.append(d);
      }
    },
    { boxes: outline, ids: show },
  );
  await page.screenshot({ path: `test-results/screenshots/ui-style-popups-${name}.png` });
  await page.evaluate(() => {
    document.querySelectorAll('.probe-outline').forEach((e) => e.remove());
    document.querySelectorAll<HTMLElement>('.probe-shown').forEach((e) => {
      e.hidden = true;
      e.classList.remove('probe-shown');
    });
  });
}

/**
 * The slow-frames toast (shown where ui/ places it) and every career and tutorial prompt, measured in
 * one frozen frame with a bark held on the ticker and the rival's bar: for the cases that do not
 * ride on to the heat moment.
 */
async function toastAndPrompts(page: Page, where: string): Promise<string[]> {
  const m = await tickerAndMeasure(page, [LONGEST_BARK], {
    show: ['look-offer', 'hud-target'],
    prompts: CAREER_PROMPTS,
  });
  expect(
    m.layout.some((p) => p.name === 'look-offer'),
    `${where}: the layout probe measured look-offer`,
  ).toBe(true);
  await shot(
    page,
    `${where.replace(/\s+/g, '-')}-toast`,
    m.layout.filter((p) => p.name === BIKE).map((p) => p.box),
    ['look-offer'],
  );
  // Playtest 3's wheelie gauge (T6.3) up too, in a second frame: the prompt steps aside for it.
  return [...momentFindings(m, `${where}, toast`, true), ...(await gaugeMoment(page, `${where}, toast`))];
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

  // The producer's longest ask and the widest landing line (T8.2: both are ticker items now).
  const ask = await tickerAndMeasure(page, [LONGEST_ASK]);
  expectClear(ask, 'phone landscape, ask');
  expectCompact(ask, 'phone landscape, ask');
  expect(ask.ticker?.text, 'the ask is tagged PRODUCER and shows its cash').toMatch(/^PRODUCER .+ \+\$\d+$/);
  const landing = await tickerAndMeasure(page, [LONGEST_LANDING]);
  expectClear(landing, 'phone landscape, landing line');
  expectCompact(landing, 'phone landscape, landing line');
  expect(landing.ticker?.cls).toBe('line');

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
  await shot(
    page,
    'mirrored',
    m.layout.filter((p) => p.name === BIKE).map((p) => p.box),
  );
  const found = momentFindings(m, 'mirrored, start');
  found.push(...(await toastAndPrompts(page, 'mirrored')));
  expectLayout(found, 'mirrored');
  expect(problems).toEqual([]);
});

// An upright screen races only as a narrow window with a fine pointer: a phone or tablet held
// upright shows platform/'s rotate screen and pauses (any touch device, `updateRotate`), so there
// are no touch buttons on it (until 2026-10-04 this case raced with touch and the portrait shim, a
// screen no player sees).
test.describe('phone portrait', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: false, hasTouch: false });
  test('the ticker sits clear of the road ahead', async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watchErrors(page);
    await startRace(page, { career: true });
    const m = await tickerAndMeasure(page, [LONGEST_BARK]);
    expectClear(m, 'phone portrait');
    expectCompact(m, 'phone portrait');
    await shot(page, 'portrait');
    await expectWholeLayout(page, m, 'phone portrait');
    expect(problems).toEqual([]);
  });
});

// The small phones: the rival's bar beside the ticker (on these screens the top row is tightest),
// the slow-frames toast and every prompt. 568x320 is a small older phone held sideways: its menu's
// Race button sat under the build stamp, so the case was left out of the first version of this
// check; the stamp keeps clear of controls now (ui/stamp.ts), and this case races from the menu
// like the others, with the same empty known list.
for (const [where, width, height] of [
  ['small phone', 740, 360],
  ['tiny phone', 568, 320],
] as const) {
  test.describe(`${where} landscape`, () => {
    test.use({ viewport: { width, height } });
    test('the ticker sits clear of the road ahead', async ({ page }) => {
      const problems = watchErrors(page);
      await startRace(page);
      // The rival's bar beside the ticker: on this screen the top row is tightest.
      const m = await tickerAndMeasure(page, [LONGEST_BARK], { show: ['hud-target'] });
      expectClear(m, where);
      expectCompact(m, where);
      await shot(
        page,
        where.replace(/\s+/g, '-'),
        m.layout.filter((p) => p.name === BIKE).map((p) => p.box),
      );
      const found = momentFindings(m, `${where}, start`);
      // The HUD run's lane report inferred that the toast could reach the BRAKE button on a small
      // phone: measured here, with every prompt.
      found.push(...(await toastAndPrompts(page, where)));
      expectLayout(found, where);
      expect(problems).toEqual([]);
    });
  });
}

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
  // A landing line laid over the bike is caught, the way the landing moment measures it.
  const bikeBox = m.layout.find((p) => p.name === BIKE)?.box;
  expect(bikeBox, 'the probe measured the player bike').toBeDefined();
  if (bikeBox)
    expect(layoutFindings(m.layout, w, h, [{ name: 'landing-line', box: bikeBox }])).toContain(
      `landing-line × ${BIKE}`,
    );

  // The player's bike is measured where the chase camera puts it (low in the middle, a rider-sized
  // box), and it may sit in the road ahead.
  const bike = m.layout.find((p) => p.name === BIKE)?.box;
  console.log(`negative control: the player's bike ${JSON.stringify(bike && roundBox(bike))}`);
  expect(bike, 'the probe measured the player bike').toBeDefined();
  if (!bike) return;
  const [cx, cy] = [(bike.left + bike.right) / 2, (bike.top + bike.bottom) / 2];
  expect(cx / w, 'the bike is in the middle across').toBeGreaterThan(0.3);
  expect(cx / w, 'the bike is in the middle across').toBeLessThan(0.7);
  expect(cy / h, 'the bike is in the lower half').toBeGreaterThan(0.45);
  expect(bike.bottom - bike.top, 'the bike is rider-sized').toBeGreaterThan(20);
  expect(found.filter((f) => f.includes(BIKE))).toEqual([]);
  // A card laid over the bike is caught against it, and so is a prompt laid over the BRAKE button.
  await page.evaluate((b) => {
    const cover = document.createElement('div');
    cover.id = 'planted-cover';
    cover.textContent = 'COVER';
    Object.assign(cover.style, {
      position: 'fixed',
      left: `${b.left - 10}px`,
      top: `${b.top - 10}px`,
      width: `${b.right - b.left + 20}px`,
      height: `${b.bottom - b.top + 20}px`,
      background: '#000a',
    });
    document.getElementById('hud')?.append(cover);
    const brake = document.getElementById('touch-brake')?.getBoundingClientRect();
    const prompt = document.getElementById('career-prompt');
    if (brake && prompt)
      Object.assign(prompt.style, {
        position: 'fixed',
        left: `${brake.left}px`,
        top: `${brake.top}px`,
        bottom: 'auto',
      });
  }, bike);
  const covered = await tickerAndMeasure(page, [], { prompts: ['PLANTED PROMPT'] });
  const coverFound = layoutFindings(covered.layout, w, h);
  console.log(`negative control: covered findings ${JSON.stringify(coverFound)}`);
  expect(coverFound).toContain(`planted-cover × ${BIKE}`);
  const promptBox = covered.prompts[0]?.box;
  expect(promptBox, 'the planted prompt was measured').toBeDefined();
  if (promptBox)
    expect(layoutFindings(covered.layout, w, h, [{ name: 'career-prompt', box: promptBox }])).toContain(
      'career-prompt × touch-brake',
    );
});

// ---- The build stamp keeps clear of every control (F1) -----------------------------------------
// The HUD run's 568x320 case could not start: the menu's Race button sat under #build-stamp, which
// took the tap. The stamp now never takes a tap, takes the other bottom corner when a control is
// under it, and hides when a control is under both (ui/stamp.ts). This measures it on every screen
// with controls, at phone sizes sideways and upright and at a laptop's.

/** What the stamp covers on this screen, from painted boxes (the UI ignores the pointer outside its controls). */
async function stampCover(page: Page) {
  return page.evaluate(() => {
    const stamp = document.getElementById('build-stamp');
    const shown = !!stamp && stamp.checkVisibility();
    const sb = stamp?.getBoundingClientRect();
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        '#ui button, #ui input, #ui select, #ui textarea, #ui label, #ui summary, #ui a, #ui .setting-label, #ui output',
      ),
    ].filter((e) => e.checkVisibility() && getComputedStyle(e).visibility !== 'hidden');
    const under: string[] = [];
    // Footers span the screen: only their words count.
    for (const f of document.querySelectorAll<HTMLElement>('#ui .footer')) {
      if (!f.checkVisibility() || !sb || !shown) continue;
      const range = document.createRange();
      range.selectNodeContents(f);
      if (hit(sb, range.getBoundingClientRect())) under.push(`#${f.id} (words)`);
    }
    // The Race button's centre must hit the button itself, never the stamp or anything else.
    const blocked: string[] = [];
    for (const e of controls) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (sb && shown && hit(sb, r))
        under.push(`${e.id || e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 20)}"`);
      if (e.id !== 'menu-race') continue;
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      if (top !== e && !e.contains(top))
        blocked.push(`#menu-race: the tap lands on ${top?.id || top?.tagName}`);
    }
    return {
      shown,
      at: stamp?.className ?? '',
      box: sb ? [sb.left, sb.top, sb.right, sb.bottom].map(Math.round) : null,
      examined: controls.length,
      under,
      blocked,
    };
  });
}

/** Lets the stamp's own check run (it re-checks a frame after a screen or its content changes). */
async function settleStamp(page: Page) {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/**
 * A tap on a control to get to the next screen. A control that is off the screen (the menu is
 * taller than a 568x320 phone: its Settings row is cut off, a separate defect this check does not
 * fix) is clicked by dispatch instead, and the case says so in the log.
 */
async function press(page: Page, selector: string, where: string) {
  const target = page.locator(selector);
  const onScreen = await target.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
  if (onScreen) await target.click();
  else {
    console.log(`${where}: ${selector} is off the screen; clicking it by dispatch`);
    await target.dispatchEvent('click');
  }
}

async function expectStampClear(page: Page, where: string) {
  await settleStamp(page);
  const c = await stampCover(page);
  console.log(
    `${where}: stamp ${JSON.stringify({ shown: c.shown, at: c.at, box: c.box })}, ${c.examined} controls`,
  );
  expect(c.examined, `${where}: controls were examined`).toBeGreaterThan(0);
  expect(c.under, `${where}: controls and words under the stamp`).toEqual([]);
  expect(c.blocked, `${where}: taps that do not land on their control`).toEqual([]);
}

for (const [where, width, height, finePointer] of [
  ['568x320', 568, 320, false],
  ['640x360', 640, 360, false],
  ['740x360', 740, 360, false],
  ['915x412', 915, 412, false],
  ['360x640 upright', 360, 640, true],
  ['412x915 upright', 412, 915, true],
  ['1366x768', 1366, 768, true],
] as const) {
  test.describe(`build stamp at ${where}`, () => {
    // A touch device held upright gets the rotate screen, so the upright sizes (and the laptop) use a fine pointer.
    test.use({ viewport: { width, height }, ...(finePointer ? { isMobile: false, hasTouch: false } : {}) });
    test('never covers a control on the start screen, menu, settings tabs or changelog', async ({ page }) => {
      const problems = watchErrors(page);
      await page.addInitScript(() => {
        (window as TestWindow).__GAME_TEST__ = true;
      });
      await page.goto('./');
      await expect(page.locator('#start-screen')).toBeVisible();
      // The start screen has no control to avoid: the stamp shows there (it names the build).
      await settleStamp(page);
      const start = await stampCover(page);
      expect(start.shown, `${where}: the stamp shows on the start screen`).toBe(true);

      await page.locator('#start-screen').click();
      await expect(page.locator('#menu-race')).toBeVisible();
      await expectStampClear(page, `${where}, menu`);

      await press(page, '#menu-settings', where);
      const tabs = await page.locator('[id^="settings-tab-"]').evaluateAll((els) => els.map((e) => e.id));
      expect(tabs.length, `${where}: the settings tabs were found`).toBeGreaterThan(0);
      for (const id of tabs) {
        await press(page, `#${id}`, where);
        await expectStampClear(page, `${where}, settings ${id}`);
      }
      await press(page, '#settings-back', where);

      await press(page, '#menu-changelog', where);
      await expect(page.locator('#changelog')).toBeVisible();
      await expectStampClear(page, `${where}, changelog`);
      await press(page, '#changelog-back', where);
      await expect(page.locator('#menu-race')).toBeVisible();

      // The tap on Race lands: the race starts, and the stamp is out of the race.
      await page.locator('#menu-race').click();
      await page.waitForFunction(() => (window as TestWindow).__game?.state() === 'race');
      await expect(page.locator('#build-stamp')).toBeHidden();
      expect(problems).toEqual([]);
    });
  });
}

// The check must fire: a control planted under the stamp is named while the stamp is forced to
// show, and the stamp itself steps away from it (to the other corner, or hides) when it is not.
test('the stamp check catches a control under the stamp, and the stamp steps away from one (negative control)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  await page.locator('#start-screen').click();
  await expect(page.locator('#menu-race')).toBeVisible();
  await settleStamp(page);
  // The stamp at its home corner (left), shown, wherever the menu had put it.
  await page.evaluate(() => {
    const s = document.getElementById('build-stamp');
    s?.classList.remove('at-right', 'yield');
  });
  const before = await stampCover(page);
  expect(before.shown, 'the stamp was put back in its left corner').toBe(true);
  expect(before.box, 'the stamp was measured').not.toBeNull();
  // A button laid exactly over the stamp where it sits now.
  await page.evaluate((box) => {
    const [left = 0, top = 0, right = 0, bottom = 0] = box ?? [];
    const b = document.createElement('button');
    b.id = 'planted-under-stamp';
    b.textContent = 'PLANTED';
    Object.assign(b.style, {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
      zIndex: '3',
    });
    document.getElementById('menu')?.append(b);
  }, before.box);
  await settleStamp(page);
  const moved = await stampCover(page);
  console.log(
    `negative control: after planting ${JSON.stringify({ shown: moved.shown, at: moved.at, under: moved.under })}`,
  );
  expect(moved.under, 'the stamp stepped away from the planted button').toEqual([]);
  expect(moved.at !== before.at || !moved.shown, 'the stamp moved or hid').toBe(true);
  // Forced back over it, the check names it.
  await page.evaluate(() => {
    const s = document.getElementById('build-stamp');
    s?.classList.remove('at-right', 'yield');
    if (s) s.style.display = 'block';
  });
  const forced = await stampCover(page);
  console.log(`negative control: forced ${JSON.stringify(forced.under)}`);
  expect(forced.under.some((u) => u.includes('planted-under-stamp'))).toBe(true);
});
