import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { PROMPTS } from '../../src/career/onboarding.ts';
import { fastForwardDone } from './lockstep';

// Playtest 1c, 2026-09-30 [decided]: "The little pop-ups about near miss etc get in the way of
// seeing what's ahead. Maybe they could be less intrusive and/or less centered". The style pop-ups
// (ui-3) must stay out of the central look-ahead: the middle half of the screen's width, from above
// the horizon (hills and cresting traffic) down to just above the rider. Measured on the race
// screens of the dev machine's software renderer, the horizon sits at about 44% of the height and
// the rider's head at about 53% in every shape tried, so the rectangle below has a wide margin.
// They must also keep off the bark bubble, the HUD, the pause button and the touch buttons, on a
// phone held sideways and upright, a small phone, the left-handed mirror and a laptop.
//
// The pop-ups come from `window.__uiStyleFeed` (ui's test seam): style events fed through the same
// tally the sim's events go through, because the seeded bot race does not reliably earn style cash
// early. The bubble's line is swapped for the base pack's longest line while it is up, so it is
// measured at its widest real content.
//
// The whole HUD's layout (the quality-confidence retro's rec 6, 2026-10-03: 5 of the 13 playtest
// defects were layout). Playtest 3 found the race objective sitting over the heat meter, and black
// and white text blocking the game. So on a phone held sideways (the default look), a phone held
// upright and a laptop, during a real career race (the objective line only shows in one), every
// HUD widget and overlay on screen is measured from its painted box: no two may overlap, and none
// may reach into the look-ahead. Three moments are measured: the race's start (the bubble, the
// pop-ups, the objective and the career prompt), once the heat badge is up (with the slow-frames
// toast, the rival's health bar and the bubble held up beside it), and while the landing one-liner
// shows (render draws it in WebGL, so its plate is read from the overlay sprite three.js draws,
// through three's own devtools hook). Overlaps main already has are named in KNOWN_LAYOUT_FINDINGS,
// a list that can only shrink: a finding not on it fails, and so does an entry that no longer
// happens.
//
// The live check after the HUD run (#428-#430) found what the road-ahead box alone cannot see: the
// in-air prompt under the BRAKE button, and the slow-frames toast and the landing line over the
// player's own bike. So the player's bike is a piece too (its painted screen box: the rider's
// drawn frame, projected through the camera three.js last drew the race with; it may sit in the
// road ahead, it is the thing ahead of the camera), the touch buttons are pieces, every career and
// tutorial prompt is measured in the prompt box at the heat moment (or the start, in a quick race),
// and the landing line is read with the toast up beside it and the in-air prompt as it is.

const LOOK_AHEAD = { left: 0.25, right: 0.75, top: 0.25, bottom: 0.65 };
/** The player's bike: allowed in the road ahead, never under another piece. */
const BIKE = 'player-bike';

/**
 * Every prompt the career box shows: the tutorial's (career/onboarding.ts) and the producer's asks
 * from every career pack, as app/ words them (`PRODUCER: <ask> +$<cash>`, and the thank-you).
 */
interface CareerFile {
  show?: { asks?: { text: string; cash: number }[] };
}
const CAREER_PROMPTS: readonly string[] = [
  ...Object.values(PROMPTS),
  ...readdirSync('packs').flatMap((pack) => {
    const dir = `packs/${pack}/careers`;
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => (JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as CareerFile).show?.asks ?? [])
      .flatMap((a) => [`PRODUCER: ${a.text} +$${a.cash}`, `PRODUCER: Got it. +$${a.cash}`]);
  }),
];

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
  pops: { text: string; box: Box; labelPx: number; cashPx: number; opacity: number; duration: string }[];
  bubble: Box | null;
  bubbleText: string;
  others: { id: string; box: Box }[];
  /** Every HUD widget and overlay painted in the same frozen frame. */
  layout: Piece[];
  /** Each career and tutorial prompt as the prompt box paints it in that frame, by its words. */
  prompts: { text: string; box: Box }[];
  /** Whether every chip had slid in and the stack had stopped moving, and when (ms after the feed). */
  settled: boolean;
  settledMs: number;
}
type FeedPop = { kind: string; points?: number };
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
  __uiStyleFeed?: (pops: FeedPop[]) => void;
  /** The layout probe (installLayoutProbe): every painted HUD widget and overlay. */
  __layoutPieces?: () => Piece[];
  /** The layout probe: the landing one-liner's plate as the last frame drew it, or null. */
  __landingPlate?: () => Box | null;
  /** The layout probe: the player's bike as the last frame drew it (its screen box), or null. */
  __playerBike?: () => Box | null;
};

/** Twelve near misses, a long oncoming stretch and a big combo: the widest pop-ups a race makes. */
const WIDE_FEED: FeedPop[] = [
  ...Array.from({ length: 12 }, () => ({ kind: 'nearMiss', points: 25 })),
  { kind: 'oncoming', points: 1440 },
  { kind: 'takedownCombo', points: 12345 },
];

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
 * overlay: the HUD's own pieces (any new one, such as a ticker, is picked up by being in #hud), the
 * career's objective and prompt, each pop-up chip, the touch buttons, the bark bubble (with its
 * 9 px tail), the slow-frames toast, the notice card and the player's bike. `__landingPlate()`
 * reads the landing one-liner's sprite (render/air-pays.ts) from the overlay scene three.js
 * reported through its devtools hook: in CSS px, an orthographic camera with y up and the sprite
 * centred on its position. `__playerBike()` finds the player's rider frame (render/views.ts: the
 * group a rider's boxes or its rig are drawn on, at its ground point, turned with its heading, lean
 * and pitch) nearest the player's snapshot position, and projects a box round the bike and rider
 * through the camera the renderer last drew the race with (caught by wrapping its `render`).
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
      getObjectByName?: (name: string) => (SpriteLike & NodeLike) | undefined;
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
      __landingPlate?: () => Box | null;
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
        '#style-popups > .style-pop',
        '#touch-surface > .touch-button',
        '#bark-bubble',
        '#look-offer',
        '#ui > .notice',
      ].join(', ');
      const containers = new Set(['style-popups', 'career-overlays']);
      const nodes = new Set(document.querySelectorAll<HTMLElement>(sel));
      for (const e of nodes) {
        if (containers.has(e.id)) continue;
        if (!e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const name = e.classList.contains('style-pop')
          ? 'style-pop'
          : e.id || `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`;
        // The bubble's speech tail hangs 9 px below its box.
        const tail = e.id === 'bark-bubble' ? 9 : 0;
        out.push({ name, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom + tail } });
      }
      const bike = w.__playerBike?.() ?? null;
      if (bike) out.push({ name: 'player-bike', box: bike });
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

async function startRace(page: Page, opts: { mirror?: boolean; classic?: boolean; career?: boolean } = {}) {
  await installLayoutProbe(page);
  if (opts.classic) {
    // The laptop is the biggest screen here, and software WebGL takes about half a second a frame
    // there in the default ink look's offscreen pass: the 1.1 s pop-ups could fade before two
    // frames had passed (W-P's busier roads tipped it over in CI three times running). The pop-up
    // layout does not depend on the look, so this case races in the Classic look, chosen through
    // the saved record as a player would (as tests/perf/perf.spec.ts does).
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
  await expect(page.locator('#bark-bubble')).toBeVisible({ timeout: 10_000 });
}

interface MeasureOpts {
  /** A bubble far wider than today's (a future layout, or a longer line), reaching the stack. */
  wideBubble?: boolean;
  /** Put the bubble up with the longest line if it has gone, so the moment is measured with it. */
  holdBubble?: boolean;
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
 * Widens the bark bubble to the longest base-pack line, feeds the pop-ups, and measures everything
 * on a frozen frame, while the bubble is still up. The feed reaches the screen on the next drawn
 * frame (ui raises the chips and moves the stack off the bubble in the same race update). In the
 * first frame that shows them, before any timer can run, every pop-up animation is paused at a set
 * point of its dwell (a quarter of the way in: past the 10% slide-in, before the 75% fade) and the
 * stack's move is finished, then everything is measured. So the layout is judged at rest whatever
 * the renderer's speed: on a software renderer at about half a second a frame, a wait of a few
 * frames could land in the 1.1 s fade-out, or after ui's timer had removed the chips.
 */
function feedAndMeasure(page: Page, feed: FeedPop[], opts: MeasureOpts = {}): Promise<Measured> {
  return page.evaluate(
    async ({ feed, longest, opts }) => {
      const box = (e: Element): { left: number; top: number; right: number; bottom: number } => {
        const r = e.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const bubble = document.getElementById('bark-bubble');
      const text = bubble?.querySelector('.bark-text');
      // Held up: the bubble as narrative/ shows it, with the longest line (its timer may have ended).
      const holdUp = () => {
        if (opts.holdBubble && bubble && text && bubble.hidden) {
          text.textContent = longest;
          bubble.hidden = false;
          return true;
        }
        return false;
      };
      let held = holdUp();
      if (bubble && !bubble.hidden && text) text.textContent = longest;
      if (bubble && opts.wideBubble) Object.assign(bubble.style, { width: '96vw', maxWidth: 'none' });
      const chipTexts = () =>
        [...document.querySelectorAll<HTMLElement>('.style-pop')].map((e) => e.textContent ?? '').join('|');
      const before = chipTexts();
      (window as TestWindow).__uiStyleFeed?.(feed);
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const host = document.getElementById('style-popups');
      const atRest = () => {
        const chips = [...document.querySelectorAll<HTMLElement>('.style-pop')];
        return (
          chips.length > 0 &&
          chips.every((c) => getComputedStyle(c).transform === 'none') &&
          !!host &&
          getComputedStyle(host).top === host.style.top
        );
      };
      // The frame that shows the feed: the chips changed (an empty feed: the next frame). The game
      // loop's frame callback was queued before this one, so it has already run in that frame. 600
      // frames is a hang guard only.
      const t0 = performance.now();
      let frames = 0;
      do {
        await frame();
        frames++;
      } while (feed.length > 0 && chipTexts() === before && frames < 600);
      // Freeze. Document.getAnimations() brings styles up to date first, so the stack's move (a CSS
      // transition on `top`) exists by now.
      for (const a of document.getAnimations()) {
        const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
        if (!host || !(target instanceof HTMLElement)) continue;
        const timing = a.effect?.getComputedTiming();
        if (a instanceof CSSTransition) {
          if (target === host) a.finish(); // the stack's move below the bubble: to where it ends
        } else if (target.classList.contains('style-pop') && host.contains(target)) {
          if (timing?.fill === 'forwards') {
            // A chip's dwell: a quarter of the way in, slid in and fully shown.
            a.pause();
            a.currentTime = (typeof timing.duration === 'number' ? timing.duration : 0) * 0.25;
          } else a.finish(); // the live meter's 0.11 s fade-in
        }
      }
      const settled = atRest();
      const settledMs = Math.round(performance.now() - t0);
      held = holdUp() || held;
      // Shown for the measurement only, where ui/ has already placed them: hidden again after.
      const shownNow = (opts.show ?? [])
        .map((id) => document.getElementById(id))
        .filter((e): e is HTMLElement => !!e && e.hidden === true);
      for (const e of shownNow) e.hidden = false;
      const pops = [...document.querySelectorAll<HTMLElement>('.style-pop')]
        .filter((e) => e.checkVisibility())
        .map((e) => {
          const label = e.querySelector('.pop-label') ?? e;
          const cash = e.querySelector('.pop-cash') ?? e;
          return {
            text: e.innerText.replace(/\s+/g, ' ').trim(),
            box: box(e),
            labelPx: parseFloat(getComputedStyle(label).fontSize),
            cashPx: parseFloat(getComputedStyle(cash).fontSize),
            opacity: parseFloat(getComputedStyle(e).opacity),
            duration: getComputedStyle(e).animationDuration,
          };
        });
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
      // Every prompt in the career's prompt box, as it would show in this frame.
      const prompts: { text: string; box: ReturnType<typeof box> }[] = [];
      const promptBox = document.getElementById('career-prompt');
      if (promptBox && opts.prompts?.length) {
        const was = { text: promptBox.textContent, hidden: promptBox.hidden };
        promptBox.hidden = false;
        for (const t of opts.prompts) {
          promptBox.textContent = t;
          if (promptBox.checkVisibility()) prompts.push({ text: t, box: box(promptBox) });
        }
        promptBox.textContent = was.text;
        promptBox.hidden = was.hidden;
      }
      const shown = !!bubble && !bubble.hidden && bubble.checkVisibility();
      const bubbleText = shown ? (text?.textContent ?? '') : '';
      const bubbleBox = shown && bubble ? { ...box(bubble), bottom: box(bubble).bottom + 9 } : null;
      for (const e of shownNow) e.hidden = true;
      if (held && bubble) bubble.hidden = true;
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        pops,
        // The bubble's speech tail hangs 9 px below its box.
        bubble: bubbleBox,
        bubbleText,
        others,
        layout,
        prompts,
        settled,
        settledMs,
      };
    },
    { feed, longest: LONGEST_LINE, opts },
  );
}

function expectClear(m: Measured, where: string) {
  const { w, h } = m.viewport;
  const look = lookAheadBox(w, h);
  console.log(`${where}: look-ahead ${JSON.stringify(look)}`);
  console.log(`${where}: ${m.pops.length} pop-ups ${JSON.stringify(m.pops)}`);
  console.log(`${where}: bubble ${JSON.stringify(m.bubble)} "${m.bubbleText}"`);
  console.log(`${where}: ${m.others.length} HUD pieces and controls ${m.others.map((o) => o.id).join(', ')}`);
  console.log(`${where}: settled ${m.settled} after ${m.settledMs} ms`);
  expect(m.pops.length, `${where}: pop-ups on screen`).toBeGreaterThan(0);
  expect(m.settled, `${where}: measured at rest, after the slide-in and any move`).toBe(true);
  for (const p of m.pops) {
    expect(p.opacity, `${where}: "${p.text}" clearly shown`).toBeGreaterThanOrEqual(0.5);
    expect(overlaps(p.box, look), `${where}: "${p.text}" stays out of the look-ahead`).toBe(false);
  }
  expect(m.bubble, `${where}: the bark bubble was up while measured`).not.toBeNull();
  expect(m.bubbleText).toBe(LONGEST_LINE);
  for (const p of m.pops) {
    if (m.bubble) expect(overlaps(p.box, m.bubble), `${where}: "${p.text}" clear of the bubble`).toBe(false);
    for (const o of m.others)
      expect(overlaps(p.box, o.box), `${where}: "${p.text}" clear of ${o.id}`).toBe(false);
    expect(
      p.box.left >= 0 && p.box.top >= 0 && p.box.right <= w && p.box.bottom <= h,
      `${where}: on screen`,
    ).toBe(true);
  }
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
  // On a phone the slow-frames toast takes the bubble's place, and the bubble steps aside while it
  // is up (ui/index.ts): with the toast measured, the bubble is not required.
  const toastUp = names.has('look-offer');
  for (const must of ['hud-speed', 'hud-position', 'style-pop', BIKE, ...(toastUp ? [] : ['bark-bubble'])])
    expect(names.has(must), `${where}: the layout probe measured ${must}`).toBe(true);
  const found = new Set(layoutFindings(m.layout, m.viewport.w, m.viewport.h));
  // Each prompt against everything else in the frame (the live prompt's own box left out).
  const rest = m.layout.filter((p) => p.name !== 'career-prompt');
  const byPrompt: string[] = [];
  for (const p of m.prompts) {
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
 * Rides on (fast-forward) until the heat badge is up, then measures the HUD with it, the pop-ups,
 * the bubble held up, the slow-frames toast and the rival's health bar shown. The race then crawls
 * a tick a frame, so the
 * heat cannot cool off while the badge's lazy chunk arrives.
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
  const m = await feedAndMeasure(page, WIDE_FEED, {
    holdBubble: true,
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
  await page.evaluate(() => (window as TestWindow).__game?.lockstep(null));
  return found;
}

/**
 * Rides on until the player's next clean landing after real air, then reads the landing one-liner's
 * plate every frame it shows, with the slow-frames toast held up beside it (both are transient, and
 * could show at once): the plate must stay out of the road ahead and off every piece drawn in its
 * frame, the player's bike included. The prompt (the in-air one comes with every first jump) and
 * the toast are checked against everything in those frames too. Pairs of the other pieces (the
 * bubble and the pop-ups, moving on their own clocks) are judged at the frozen moments instead.
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
    // The toast held up beside the line, where ui/ places it (hidden again after).
    const toast = document.getElementById('look-offer');
    const toastWasHidden = toast?.hidden ?? false;
    if (toast) toast.hidden = false;
    const t0 = performance.now();
    // The line lasts 2 s; 4 s and 240 frames are hang guards only.
    for (let i = 0; i < 240 && performance.now() - t0 < 4000; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const plate = w.__landingPlate?.() ?? null;
      if (plate) out.push({ plate, pieces: w.__layoutPieces?.() ?? [], vw: innerWidth, vh: innerHeight });
      else if (out.length > 0) break;
    }
    if (toast) toast.hidden = toastWasHidden;
    return out;
  });
  console.log(
    `${where}: the landing line's plate in ${samples.length} frames: ${JSON.stringify(samples.map((s) => s.plate))}`,
  );
  expect(samples.length, `${where}: the landing one-liner was drawn and measured`).toBeGreaterThan(0);
  const checked = new Set(['career-prompt', 'look-offer', BIKE]);
  const found = new Set<string>();
  const bikes: Box[] = [];
  for (const s of samples) {
    const line: Piece = { name: 'landing-line', box: s.plate };
    const pieces = s.pieces.filter((p) => !p.name.startsWith('div.card'));
    const against = [line, ...pieces.filter((p) => checked.has(p.name))];
    for (const f of layoutFindings(pieces, s.vw, s.vh, against)) found.add(f);
    const bike = pieces.find((p) => p.name === BIKE);
    if (bike) bikes.push(bike.box);
  }
  console.log(`${where}: the player's bike in those frames: ${JSON.stringify(bikes.map(roundBox))}`);
  expect(bikes.length, `${where}: the bike was measured in every landing frame`).toBe(samples.length);
  const first = samples[0];
  if (first) logPieces(`${where}, landing`, first.pieces);
  return [...found];
}

/**
 * Less intrusive, still readable: small words, a readable cash figure, a short dwell. A chip is one
 * line of words over its cash; on a screen too narrow for the words they may wrap (`maxHeight`).
 */
function expectCompact(m: Measured, where: string, maxHeight = 44) {
  expect(m.pops.map((p) => p.text).sort()).toEqual([
    'COMBO +$12,345',
    'NEAR MISS ×12 +$300',
    'ONCOMING +$1,440',
  ]);
  for (const p of m.pops) {
    expect(p.labelPx, `${where}: small words`).toBeLessThanOrEqual(12);
    expect(p.cashPx, `${where}: readable cash`).toBeGreaterThanOrEqual(14);
    expect(p.box.bottom - p.box.top, `${where}: a compact chip`).toBeLessThanOrEqual(maxHeight);
    expect(parseFloat(p.duration), `${where}: a short dwell`).toBeLessThanOrEqual(1.2);
  }
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
 * one frozen frame with the pop-ups, the bubble held up and the rival's bar: for the cases that do
 * not ride on to the heat moment.
 */
async function toastAndPrompts(page: Page, where: string): Promise<string[]> {
  const m = await feedAndMeasure(page, WIDE_FEED, {
    holdBubble: true,
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
  return momentFindings(m, `${where}, toast`, true);
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

test('phone landscape: pop-ups sit clear of the road ahead, merge repeats and fade quickly', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const problems = watchErrors(page);
  await startRace(page, { career: true });
  const m = await feedAndMeasure(page, WIDE_FEED);
  expectClear(m, 'phone landscape');
  expectCompact(m, 'phone landscape');
  await shot(page, 'phone');

  // A quick fade: gone well inside two seconds of the screenshot.
  const before = Date.now();
  await expect(page.locator('.style-pop')).toHaveCount(0, { timeout: 2_000 });
  console.log(`pop-ups gone ${Date.now() - before} ms after the screenshot`);

  // A near miss in a later step, while the first one's chip is up, adds to that chip rather than
  // stacking a second one. Both feeds run inside the page, so a slow round trip to the test runner
  // (a loaded machine) cannot let the first chip time out in between. The second feed goes in the
  // frame that first shows the first chip, so it reaches a later race update one frame later,
  // whatever the renderer's speed (a fixed 150 ms wait used to sit in between). 600 frames is a
  // hang guard only.
  const merged = await page.evaluate(async () => {
    const feed = (window as TestWindow).__uiStyleFeed;
    const texts = () =>
      [...document.querySelectorAll<HTMLElement>('.style-pop')].map((e) =>
        e.innerText.replace(/\s+/g, ' ').trim(),
      );
    const nextChange = async () => {
      const was = texts().join('|');
      for (let i = 0; i < 600 && texts().join('|') === was; i++)
        await new Promise((r) => requestAnimationFrame(r));
    };
    let change = nextChange();
    feed?.([{ kind: 'nearMiss', points: 25 }]);
    await change;
    change = nextChange();
    feed?.([{ kind: 'nearMiss', points: 25 }]);
    await change;
    return texts();
  });
  console.log(`merged across steps: ${JSON.stringify(merged)}`);
  expect(merged).toEqual(['NEAR MISS ×2 +$50']);

  await expectWholeLayout(page, m, 'phone landscape');
  expect(problems).toEqual([]);
});

test('phone landscape, left-handed mirror: pop-ups follow the position badge to the other side', async ({
  page,
}) => {
  const problems = watchErrors(page);
  await startRace(page, { mirror: true });
  // The rival's bar is shown beside the bubble: sideways they share the top row.
  const m = await feedAndMeasure(page, WIDE_FEED, { show: ['hud-target'] });
  expectClear(m, 'mirrored');
  const w = m.viewport.w;
  for (const p of m.pops) expect(p.box.left, 'on the right half').toBeGreaterThan(w / 2);
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
  test('pop-ups sit clear of the road ahead', async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watchErrors(page);
    await startRace(page, { career: true });
    const m = await feedAndMeasure(page, WIDE_FEED);
    expectClear(m, 'phone portrait');
    expectCompact(m, 'phone portrait', 60);
    await shot(page, 'portrait');
    await expectWholeLayout(page, m, 'phone portrait');
    expect(problems).toEqual([]);
  });
});

test.describe('small phone landscape', () => {
  test.use({ viewport: { width: 740, height: 360 } });
  test('pop-ups sit clear of the road ahead', async ({ page }) => {
    const problems = watchErrors(page);
    await startRace(page);
    // The rival's bar beside the bubble: on this screen the top row is tightest.
    const m = await feedAndMeasure(page, WIDE_FEED, { show: ['hud-target'] });
    expectClear(m, 'small phone');
    await shot(
      page,
      'small',
      m.layout.filter((p) => p.name === BIKE).map((p) => p.box),
    );
    const found = momentFindings(m, 'small phone, start');
    // The HUD run's lane report inferred that the toast could reach the BRAKE button on a small
    // phone: measured here, with every prompt.
    found.push(...(await toastAndPrompts(page, 'small phone')));
    expectLayout(found, 'small phone');
    expect(problems).toEqual([]);
  });
});

test.describe('laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false });
  test('pop-ups sit clear of the road ahead', async ({ page }) => {
    test.setTimeout(150_000);
    const problems = watchErrors(page);
    await startRace(page, { classic: true, career: true });
    const m = await feedAndMeasure(page, WIDE_FEED);
    expectClear(m, 'laptop');
    expectCompact(m, 'laptop');
    await shot(page, 'laptop');
    await expectWholeLayout(page, m, 'laptop');
    expect(problems).toEqual([]);
  });
});

test('a bubble that reaches the stack pushes it below the bubble, still clear of the road', async ({
  page,
}) => {
  const problems = watchErrors(page);
  await startRace(page);
  const m = await feedAndMeasure(page, WIDE_FEED, { wideBubble: true });
  expectClear(m, 'wide bubble');
  const bubbleBottom = m.bubble?.bottom ?? Infinity;
  for (const p of m.pops)
    expect(p.box.top, `"${p.text}" below the bubble`).toBeGreaterThanOrEqual(bubbleBottom);
  await shot(page, 'wide-bubble');
  expect(problems).toEqual([]);
});

// The overlap checks must fire: a pop-up planted in the middle of the screen is caught, and so is a
// HUD widget moved over another (here the heat badge's spot, where playtest 3 saw the objective).
test('the look-ahead and layout checks catch a centred pop-up and overlapped widgets (negative control)', async ({
  page,
}) => {
  await startRace(page);
  await page.evaluate(() => {
    const host = document.getElementById('style-popups');
    const pop = document.createElement('div');
    pop.className = 'style-pop';
    pop.textContent = 'PLANTED';
    Object.assign(pop.style, { position: 'fixed', left: '45%', top: '40%', animation: 'none', opacity: '1' });
    host?.append(pop);
    // The speed readout dropped onto the position badge, and a widget at the heat badge's spot
    // under one at the objective's: both pairs overlap by construction.
    const speed = document.getElementById('hud-speed');
    const position = document.getElementById('hud-position');
    if (speed && position) {
      const p = position.getBoundingClientRect();
      Object.assign(speed.style, { left: `${p.left}px`, top: `${p.top}px`, right: 'auto', bottom: 'auto' });
    }
    const hud = document.getElementById('hud');
    for (const id of ['planted-heat', 'planted-objective']) {
      const d = document.createElement('div');
      d.id = id;
      d.textContent = id === 'planted-heat' ? 'HEAT' : 'FINISH';
      Object.assign(d.style, {
        position: 'absolute',
        top: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '4px 10px',
        background: '#000a',
      });
      hud?.append(d);
    }
  });
  const m = await feedAndMeasure(page, []);
  const { w, h } = m.viewport;
  const look = lookAheadBox(w, h);
  const planted = m.pops.find((p) => p.text === 'PLANTED');
  expect(planted).toBeDefined();
  if (planted) expect(overlaps(planted.box, look)).toBe(true);
  const found = layoutFindings(m.layout, w, h);
  console.log(`negative control: layout findings ${JSON.stringify(found)}`);
  expect(found).toContain('hud-position × hud-speed');
  expect(found).toContain('planted-heat × planted-objective');
  expect(found).toContain('style-pop in the road ahead');
  // A landing plate laid over the middle of the road is caught against the road ahead and the HUD.
  const plate: Piece = {
    name: 'landing-line',
    box: { left: w * 0.2, right: w * 0.8, top: h * 0.3, bottom: h * 0.4 },
  };
  expect(layoutFindings(m.layout, w, h, [plate])).toContain('landing-line in the road ahead');

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
  const covered = await feedAndMeasure(page, [], { prompts: ['PLANTED PROMPT'] });
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
