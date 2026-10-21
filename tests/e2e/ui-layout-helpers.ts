import { openQuickPlay } from './menu-navigation';
import { expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { PROMPTS } from '../../src/career/onboarding.ts';
import { rideFirstCareerRace } from './career-start';
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
/** Test-only world-pass contribution, with actual entity-bound rest attributes and controls. */
interface RiderRaster {
  entityId: number;
  visible: number;
  hidden: number;
  unobstructed: number;
  width: number;
  height: number;
  attributes: Record<'position' | 'normal' | 'skinIndex' | 'skinWeight', number[]>;
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
  /** Historical riding hull, retained only for the independent riding fit/calibration control. */
  __playerBike?: () => Box | null;
  __playerParts?: () => { kind: 'bike' | 'rider'; box: Box }[];
  __playerIdentityControl?: () => { planted: boolean; unchanged: boolean; maskBound?: boolean };
  __playerMaskEmptyControl?: (mode?: 'visibility' | 'straight' | 'premultiplied') => void;
  __playerDepthControl?: () => { negative: Piece[]; positive: Piece[]; w: number; h: number };
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
      // BIKE is reserved for this probe's followed player's parts, never a HUD widget.
      if (b !== a && !(a.name === BIKE && b.name === BIKE) && overlaps(a.box, b.box))
        out.add([a.name, b.name].sort().join(' × '));
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
 * point, turned with its heading, lean and pitch) with the followed player's exact entityId, and
 * keeps the original riding hull as a separate fit/calibration control. Layout checks project
 * the actual depth-visible player raster, with the film pass's bounded ink reach. Posed per-bone
 * geometry remains a separate calibration/depth-occlusion control. Empty space between detached
 * bodies stays empty; real riding wheelie/slip/whip transforms and exact entity identity remain.
 */
async function installLayoutProbe(page: Page) {
  await page.addInitScript(() => {
    interface NodeLike {
      name: string;
      rotation: { order: string };
      matrixWorld: { elements: ArrayLike<number> };
      children: NodeLike[];
      parent?: NodeLike;
      visible: boolean;
      clone(recursive?: boolean): NodeLike;
      matrixAutoUpdate: boolean;
      matrix: { fromArray(elements: number[]): unknown };
      userData: { entityId?: number };
      material?: MaskMaterial | MaskMaterial[];
      geometry?: {
        attributes: Record<string, { array: ArrayLike<number>; itemSize: number; count: number }>;
        drawRange: { count: number };
      };
      skeleton?: { bones: NodeLike[]; boneInverses: { elements: ArrayLike<number> }[] };
    }
    interface CameraLike {
      isPerspectiveCamera?: boolean;
      matrixWorldInverse: {
        elements: ArrayLike<number>;
        clone(): { invert(): { elements: ArrayLike<number> } };
      };
      projectionMatrix: { elements: ArrayLike<number> };
    }
    interface MaskShader {
      fragmentShader: string;
    }
    interface MaskMaterial {
      opacity: number;
      transparent: boolean;
      premultipliedAlpha: boolean;
      needsUpdate: boolean;
      colorWrite: boolean;
      depthWrite: boolean;
      copy(original: MaskMaterial): MaskMaterial;
      clone(): MaskMaterial;
      dispose(): void;
      onBeforeCompile: (shader: MaskShader) => void;
      customProgramCacheKey: () => string;
      color?: NonNullable<Observed['background']>;
      uniforms?: Record<string, { value: unknown }>;
    }
    interface Observed {
      isScene?: boolean;
      isWebGLRenderer?: boolean;
      name?: string;
      domElement?: HTMLCanvasElement;
      getObjectByName?: (name: string) => NodeLike | undefined;
      render?: (scene: Observed, camera: CameraLike) => void;
      children?: NodeLike[];
      add?: (node: NodeLike) => void;
      remove?: (node: NodeLike) => void;
      background?:
        | {
            clone(): NonNullable<Observed['background']>;
            setRGB(r: number, g: number, b: number): unknown;
          }
        | null
        | undefined;
      getContext?: () => WebGL2RenderingContext;
      getRenderTarget?: () => unknown;
      setRenderTarget?: (target: unknown) => void;
      info?: { render: Record<string, number> };
    }
    const seen: Observed[] = [];
    // The race's own draw: the last perspective camera and the scene it drew.
    let drawn: {
      scene: Observed;
      camera: CameraLike;
      renderer: Observed;
      render: NonNullable<Observed['render']>;
      target: unknown;
      serial: number;
      inkRadius: number;
    } | null = null;
    let drawSerial = 0;
    let maskSerial = -1;
    let painted: Box[] = [];
    let primaryPainted: Box[] = [];
    let maskAssignments: { name: string; entity: number | undefined; white: boolean }[] = [];
    const maskMaterials = new Map<MaskMaterial, [MaskMaterial, MaskMaterial]>();
    const maskStats = { draws: 0, totalMs: 0, maxMs: 0 };
    let raster = { count: 0, width: 0, height: 0 };
    window.addEventListener('pagehide', () => {
      for (const pair of maskMaterials.values()) pair.forEach((m) => m.dispose());
      maskMaterials.clear();
    });
    const maskMaterial = (original: MaskMaterial, player: boolean, xray: boolean) => {
      let pair = maskMaterials.get(original);
      if (!pair) {
        pair = [original.clone(), original.clone()];
        maskMaterials.set(original, pair);
      }
      const m = pair[player ? 1 : 0];
      // Fade/ghost opacity and shader flags change during a race. copy() synchronizes the actual
      // current material; Three's public copy does not copy these compilation callbacks.
      m.copy(original);
      if (xray && !player) {
        m.colorWrite = false;
        m.depthWrite = false;
      }
      // Preserve the actual shader's skinning/instancing, map alpha, discard, side and depth.
      // Only the final RGB is semantic: player white, everything else black. Alpha/blending
      // remain real, so a translucent occluder does not erase the player beneath it.
      m.onBeforeCompile = (shader) => {
        original.onBeforeCompile(shader);
        if (!/}\s*$/.test(shader.fragmentShader)) throw new Error('mask shader has no main end');
        shader.fragmentShader = shader.fragmentShader.replace(
          /}\s*$/,
          player
            ? `
#ifdef PREMULTIPLIED_ALPHA
gl_FragColor.rgb = vec3(gl_FragColor.a);
#else
gl_FragColor.rgb = vec3(1.0);
#endif
}`
            : 'gl_FragColor.rgb = vec3(0.0); }',
        );
      };
      m.customProgramCacheKey = () => `layout-mask-${player}-${original.customProgramCacheKey()}`;
      m.needsUpdate = true;
      return m;
    };
    const paintMask = (
      renderer: Observed,
      scene: Observed,
      camera: CameraLike,
      render: NonNullable<Observed['render']>,
      xray = false,
      targetEntityId?: number,
    ) => {
      const gl = renderer.getContext?.();
      const canvas = renderer.domElement;
      const me = targetEntityId ?? (window as TestWindow).__game?.playerId();
      if (!gl || !canvas || me === undefined || !drawn)
        throw new Error('painted player mask has no actual race draw');
      const started = performance.now();
      const saved: { node: NodeLike; material: MaskMaterial | MaskMaterial[] }[] = [];
      const background = scene.background;
      const target = renderer.getRenderTarget?.();
      const info = renderer.info?.render;
      const counters = info ? { ...info } : null;
      maskAssignments = [];
      const walk = (node: NodeLike, entity?: number) => {
        const id = node.userData.entityId ?? entity;
        // Layout keeps the whole followed entity family. An explicit rider observation must
        // instead prove the actual model contributes, never its shadow, weapon or proxy.
        const selected =
          targetEntityId === undefined
            ? id === me
            : node.name === 'rig-mesh' && !!node.skeleton && node.userData.entityId === me;
        if (node.material) {
          maskAssignments.push({ name: node.name, entity: id, white: selected });
          const original = node.material;
          saved.push({ node, material: original });
          node.material = Array.isArray(original)
            ? original.map((m) => maskMaterial(m, selected, xray))
            : maskMaterial(original, selected, xray);
        }
        node.children.forEach((child) => walk(child, id));
      };
      try {
        renderer.setRenderTarget?.(drawn.target);
        scene.children?.forEach((node) => walk(node));
        const seed =
          background ??
          saved.flatMap((s) => (Array.isArray(s.material) ? s.material : [s.material])).find((m) => m.color)
            ?.color;
        if (!seed) throw new Error('painted mask has no colour seed');
        scene.background = seed.clone();
        scene.background.setRGB(0, 0, 0);
        // Run only for a consumed layout frame, using its actual race target. Restore the normal
        // drawing afterward; Classic's canvas and the film pass's texture both stay unchanged.
        render.call(renderer, scene, camera);
        const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
        const width = viewport[2] ?? 0;
        const height = viewport[3] ?? 0;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(viewport[0] ?? 0, viewport[1] ?? 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('painted player mask readPixels failed');
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) count++;
        raster = { count, width, height };
        const rect = canvas.getBoundingClientRect();
        // LookPost uses center + four axial samples at ±width, not an iterative outline.
        // Expand by the observed pass's bounded device-pixel reach (zero in Classic), preserving
        // gaps between bodies. This conservatively includes film ink, not exact ink ownership.
        const rx = (drawn.inkRadius * rect.width) / width;
        const ry = (drawn.inkRadius * rect.height) / height;
        const runs: Box[] = [];
        let previous = new Map<string, Box>();
        for (let row = 0; row < height; row++) {
          const current = new Map<string, Box>();
          let from = -1;
          for (let x = 0; x <= width; x++) {
            const at = (row * width + x) * 4;
            const white =
              x < width && ((pixels[at] ?? 0) > 0 || (pixels[at + 1] ?? 0) > 0 || (pixels[at + 2] ?? 0) > 0);
            if (white && from < 0) from = x;
            if (!white && from >= 0) {
              const box = {
                left: rect.left + (from * rect.width) / width,
                right: rect.left + (x * rect.width) / width,
                top: rect.top + ((height - row - 1) * rect.height) / height,
                bottom: rect.top + ((height - row) * rect.height) / height,
              };
              const key = `${from}:${x}`;
              const adjacent = previous.get(key);
              if (adjacent) adjacent.top = box.top;
              else runs.push(box);
              current.set(key, adjacent ?? box);
              from = -1;
            }
          }
          previous = current;
        }
        primaryPainted = runs;
        painted = runs.map((box) => ({
          left: Math.max(rect.left, box.left - rx),
          right: Math.min(rect.right, box.right + rx),
          top: Math.max(rect.top, box.top - ry),
          bottom: Math.min(rect.bottom, box.bottom + ry),
        }));
        maskSerial = drawn.serial;
      } finally {
        for (const s of saved) s.node.material = s.material;
        scene.background = background;
        try {
          render.call(renderer, scene, camera);
        } finally {
          renderer.setRenderTarget?.(target);
          if (info && counters) Object.assign(info, counters);
        }
        const elapsed = performance.now() - started;
        maskStats.draws++;
        maskStats.totalMs += elapsed;
        maskStats.maxMs = Math.max(maskStats.maxMs, elapsed);
        (window as Window & { __playerMaskStats?: typeof maskStats }).__playerMaskStats = maskStats;
      }
    };
    const hook = new EventTarget();
    hook.addEventListener('observe', (e) => {
      const d = (e as CustomEvent<Observed>).detail;
      if (d && (d.isScene || d.isWebGLRenderer)) seen.push(d);
      const render = d?.isWebGLRenderer ? d.render : undefined;
      if (d && render) {
        d.render = function (this: Observed, scene: Observed, camera: CameraLike) {
          if (camera?.isPerspectiveCamera && scene?.isScene) {
            drawn = {
              scene,
              camera,
              renderer: this,
              render,
              target: this.getRenderTarget?.(),
              serial: ++drawSerial,
              inkRadius: 0,
            };
          } else if (drawn) {
            for (const node of scene.children ?? []) {
              const materials = Array.isArray(node.material) ? node.material : [node.material];
              for (const material of materials) {
                const u = material?.uniforms;
                if (u?.['uInkWidth'] && u['uInk'])
                  drawn.inkRadius =
                    Number(u['uInk'].value) > 0
                      ? Math.ceil(Number(u['uInkWidth'].value) * (1 + 0.6 * Number(u['uBrush']?.value ?? 0)))
                      : 0;
              }
            }
          }
          render.call(this, scene, camera);
        };
      }
    });
    const w = window as Window & {
      __THREE_DEVTOOLS__?: EventTarget;
      __layoutPieces?: () => { name: string; box: Box }[];
      __playerBike?: () => Box | null;
      __playerParts?: (calibration?: boolean) => { kind: 'bike' | 'rider'; box: Box }[];
      __playerIdentityControl?: () => { planted: boolean; unchanged: boolean; maskBound?: boolean };
      __playerMaskEmptyControl?: (mode?: 'visibility' | 'straight' | 'premultiplied') => void;
      __playerDepthControl?: () => { negative: Piece[]; positive: Piece[]; w: number; h: number };
      __riderRaster?: (entityId: number) => RiderRaster;
      __game?: {
        playerId(): number;
        snapshot(): { entities?: { id: number; x: number; y: number; z: number; mode: string }[] } | null;
      };
    };
    w.__THREE_DEVTOOLS__ = hook;
    w.__riderRaster = (entityId) => {
      if (!drawn) throw new Error('rider observation has no actual race draw');
      const nodes: NodeLike[] = [];
      const visit = (node: NodeLike) => {
        nodes.push(node);
        node.children.forEach(visit);
      };
      drawn.scene.children?.forEach(visit);
      const rigs = nodes.filter(
        (node) => node.name === 'rig-mesh' && node.skeleton && node.userData.entityId === entityId,
      );
      if (rigs.length !== 1) throw new Error(`rider ${entityId}: expected one actual skinned rig`);
      const rig = rigs[0];
      if (!rig?.geometry) throw new Error('rider observation has no geometry');
      const attributes = {} as RiderRaster['attributes'];
      for (const key of ['position', 'normal', 'skinIndex', 'skinWeight'] as const) {
        const attribute = rig.geometry.attributes[key];
        if (!attribute) throw new Error(`rider observation has no ${key}`);
        attributes[key] = Array.from(attribute.array);
      }
      const own = [rig];
      const visibility = own.map((node) => node.visible);
      try {
        paintMask(drawn.renderer, drawn.scene, drawn.camera, drawn.render, false, entityId);
        const visible = raster.count;
        // Same actual entity hidden: a missing target is never silently a successful zero.
        own.forEach((node) => {
          node.visible = false;
        });
        let hidden: number;
        try {
          paintMask(drawn.renderer, drawn.scene, drawn.camera, drawn.render, false, entityId);
          hidden = raster.count;
        } finally {
          own.forEach((node, i) => {
            node.visible = visibility[i] ?? false;
          });
        }
        paintMask(drawn.renderer, drawn.scene, drawn.camera, drawn.render, true, entityId);
        return {
          entityId,
          visible,
          hidden,
          unobstructed: raster.count,
          width: raster.width,
          height: raster.height,
          attributes,
        };
      } finally {
        own.forEach((node, i) => {
          node.visible = visibility[i] ?? false;
        });
        // A rival's measurement must not satisfy the legacy followed-player cache.
        maskSerial = -1;
        paintMask(drawn.renderer, drawn.scene, drawn.camera, drawn.render);
      }
    };
    // The bike, then the rider on it, as boxes in the rider's frame: across, up from the ground,
    // along (metres; this is the check's own measure, fitted to the painted rider in CI's screenshots).
    const SHAPE: { min: [number, number, number]; max: [number, number, number] }[] = [
      { min: [-0.35, 0, -0.95], max: [0.35, 1.05, 0.95] },
      { min: [-0.45, 0.5, -0.45], max: [0.45, 1.75, 0.35] },
    ];
    w.__playerParts = (calibration = false) => {
      const canvas = seen.find((s) => s.isWebGLRenderer)?.domElement;
      const game = w.__game;
      if (!drawn || !canvas || !game) return [];
      const me = game.playerId();
      const self = game.snapshot()?.entities?.find((e) => e.id === me);
      const riders = drawn.scene.getObjectByName?.('entities')?.children ?? [];
      const best = riders.find(
        (r) => r.name === '' && r.rotation.order === 'YXZ' && r.userData.entityId === me,
      );
      if (!best || !self) return [];
      const m = best.matrixWorld.elements;
      const v = drawn.camera.matrixWorldInverse.elements;
      const p = drawn.camera.projectionMatrix.elements;
      const mul = (e: ArrayLike<number>, x: number, y: number, z: number, wv: number) =>
        [0, 1, 2, 3].map(
          (i) => (e[i] ?? 0) * x + (e[4 + i] ?? 0) * y + (e[8 + i] ?? 0) * z + (e[12 + i] ?? 0) * wv,
        ) as [number, number, number, number];
      const c = canvas.getBoundingClientRect();
      // Views.ts places the get-up/tumbling rider and bike independently. Riding rigs also
      // add wheelie/slip/whip transforms, so their actual vertices are the overlap oracle too.
      // riders/index.ts bakes each vertex to ONE bone (weight 1). Measure its actually posed
      // geometry per bone, rather than inventing a riding bike at the walker or unioning the
      // empty screen between detached bodies. SHAPE below remains an independent calibration.
      if (!calibration) {
        const all: NodeLike[] = [];
        const visit = (node: NodeLike) => {
          all.push(node);
          node.children.forEach(visit);
        };
        riders.forEach(visit);
        const belongs = (node: NodeLike, name: string): boolean => {
          for (let n: NodeLike | undefined = node; n; n = n.parent) if (n.name === name) return true;
          return false;
        };
        const mesh = all.find(
          (node) =>
            node.name === 'rig-mesh' && node.visible && node.skeleton && node.userData.entityId === me,
        );
        const boxes = new Map<number, { kind: 'bike' | 'rider'; box: Box }>();
        const add = (key: number, kind: 'bike' | 'rider', world: readonly number[]) => {
          const view = mul(v, world[0] ?? 0, world[1] ?? 0, world[2] ?? 0, 1);
          const [cx, cy, , cw] = mul(p, view[0], view[1], view[2], 1);
          if (!(cw > 0.05)) return;
          const sx = c.left + ((cx / cw + 1) / 2) * c.width;
          const sy = c.top + ((1 - cy / cw) / 2) * c.height;
          const entry = boxes.get(key) ?? {
            kind,
            box: { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
          };
          entry.box.left = Math.min(entry.box.left, sx);
          entry.box.right = Math.max(entry.box.right, sx);
          entry.box.top = Math.min(entry.box.top, sy);
          entry.box.bottom = Math.max(entry.box.bottom, sy);
          boxes.set(key, entry);
        };
        if (mesh?.geometry && mesh.skeleton) {
          const attrs = mesh.geometry.attributes;
          const pos = attrs['position'];
          const skin = attrs['skinIndex'];
          const weights = attrs['skinWeight'];
          if (!pos || !skin || !weights)
            throw new Error('posed player geometry has no rigid skin attributes');
          const count = Math.min(pos.count, mesh.geometry.drawRange.count);
          for (let i = 0; i < count; i++) {
            if (
              weights.array[i * weights.itemSize] !== 1 ||
              [1, 2, 3].some((j) => weights.array[i * weights.itemSize + j] !== 0)
            )
              throw new Error(`player vertex ${i} is not rigidly weighted to one bone`);
            const boneId = skin.array[i * skin.itemSize] ?? -1;
            const bone = mesh.skeleton.bones[boneId];
            const inverse = mesh.skeleton.boneInverses[boneId];
            if (!bone || !inverse) throw new Error('posed player vertex has no bone');
            const local = mul(
              inverse.elements,
              pos.array[i * 3] ?? 0,
              pos.array[i * 3 + 1] ?? 0,
              pos.array[i * 3 + 2] ?? 0,
              1,
            );
            add(
              boneId,
              belongs(bone, 'rig-bike') ? 'bike' : 'rider',
              mul(bone.matrixWorld.elements, local[0], local[1], local[2], 1),
            );
          }
        } else {
          // Before models load, the visible fallback meshes are the actual drawing too.
          // Views.riderView adds root, parked and tumbleBike consecutively to entities.
          // Their identity persists even when detached bodies separate far from the rider.
          const at = riders.indexOf(best);
          const paired = [riders[at + 1], riders[at + 2]].filter(
            (node): node is NodeLike =>
              !!node &&
              node.userData.entityId === me &&
              node.visible &&
              (node.name === 'views-parked-bike' || node.name === 'views-tumble-bike'),
          );
          const roots = [best, ...paired];
          roots.forEach((root, key) => {
            const walk = (node: NodeLike) => {
              if (!node.visible) return;
              const pos = node.geometry?.attributes['position'];
              if (pos)
                for (let i = 0; i < pos.count; i++)
                  add(
                    key,
                    root === best ? 'rider' : 'bike',
                    mul(
                      node.matrixWorld.elements,
                      pos.array[i * pos.itemSize] ?? 0,
                      pos.array[i * pos.itemSize + 1] ?? 0,
                      pos.array[i * pos.itemSize + 2] ?? 0,
                      1,
                    ),
                  );
              node.children.forEach(walk);
            };
            walk(root);
          });
        }
        return [...boxes.values()]
          .map(({ kind, box }) => ({
            kind,
            box: {
              left: Math.max(c.left, box.left),
              top: Math.max(c.top, box.top),
              right: Math.min(c.right, box.right),
              bottom: Math.min(c.bottom, box.bottom),
            },
          }))
          .filter(({ box }) => box.right > box.left && box.bottom > box.top);
      }
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
      if (!(box.right > box.left)) return [];
      // Only what is on screen is painted.
      return [
        {
          kind: 'bike',
          box: {
            left: Math.max(c.left, box.left),
            top: Math.max(c.top, box.top),
            right: Math.min(c.right, box.right),
            bottom: Math.min(c.bottom, box.bottom),
          },
        },
      ];
    };
    w.__playerBike = () => w.__playerParts?.(true).find((part) => part.kind === 'bike')?.box ?? null;
    w.__playerDepthControl = () => {
      if (!drawn) throw new Error('depth control has no actual race draw');
      w.__layoutPieces?.();
      const baseline = [...primaryPainted];
      const span = [...baseline].sort(
        (a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top),
      )[0];
      if (!span) throw new Error('depth control has no visible player span');
      const nodes: NodeLike[] = [];
      let playerMaterial: MaskMaterial | undefined;
      const visit = (n: NodeLike, entity?: number, visible = true) => {
        nodes.push(n);
        const id = n.userData.entityId ?? entity;
        const shown = visible && n.visible;
        if (shown && id === w.__game?.playerId() && n.material) {
          const materials = Array.isArray(n.material) ? n.material : [n.material];
          playerMaterial ??= materials.find((m) => !m.transparent && m.opacity === 1);
        }
        n.children.forEach((child) => visit(child, id, shown));
      };
      drawn.scene.children?.forEach((n) => visit(n));
      // views.ts builds this object from a solid box. Reuse its real geometry, with the player's
      // actual opaque material, as a small camera-facing environmental depth fixture.
      const box = nodes.find((n) => n.name === 'views-glint' && n.geometry);
      if (!box?.geometry || !playerMaterial)
        throw new Error('depth fixture needs the real box and opaque player material');
      const occluder = box.clone(false);
      occluder.name = 'layout-depth-fixture';
      occluder.userData = { entityId: -1 };
      occluder.visible = true;
      occluder.material = playerMaterial;
      occluder.matrixAutoUpdate = false;
      const a = box.geometry.attributes['position'];
      if (!a) throw new Error('depth fixture box has no vertices');
      const low = [Infinity, Infinity, Infinity],
        high = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < a.count; i++)
        for (let axis = 0; axis < 3; axis++) {
          const value = a.array[i * a.itemSize + axis] ?? 0;
          low[axis] = Math.min(low[axis] ?? Infinity, value);
          high[axis] = Math.max(high[axis] ?? -Infinity, value);
        }
      const rect = drawn.renderer.domElement?.getBoundingClientRect();
      if (!rect) throw new Error('depth fixture has no canvas');
      const p = drawn.camera.projectionMatrix.elements;
      const world = drawn.camera.matrixWorldInverse.clone().invert().elements;
      const width = Math.max(8, (span.right - span.left) * 0.6),
        height = Math.max(12, span.bottom - span.top + 8);
      const cx = (span.left + span.right) / 2,
        cy = (span.top + span.bottom) / 2;
      const tx = (((cx - rect.left) / rect.width) * 2 - 1) / (p[0] ?? 1);
      const ty = (1 - ((cy - rect.top) / rect.height) * 2) / (p[5] ?? 1);
      const sizes = [
        ((width / rect.width) * 2) / (p[0] ?? 1),
        ((height / rect.height) * 2) / (p[5] ?? 1),
        0.01,
      ];
      const scales = sizes.map((size, axis) => size / ((high[axis] ?? 0) - (low[axis] ?? 0)));
      const center = low.map((value, axis) => (value + (high[axis] ?? 0)) / 2);
      const local = [
        tx - (center[0] ?? 0) * (scales[0] ?? 1),
        ty - (center[1] ?? 0) * (scales[1] ?? 1),
        -1 - (center[2] ?? 0) * (scales[2] ?? 1),
      ];
      const matrix = new Array<number>(16).fill(0);
      for (let axis = 0; axis < 3; axis++)
        for (let row = 0; row < 3; row++)
          matrix[axis * 4 + row] = (world[axis * 4 + row] ?? 0) * (scales[axis] ?? 1);
      for (let row = 0; row < 3; row++)
        matrix[12 + row] =
          (world[12 + row] ?? 0) +
          local.reduce((sum, value, axis) => sum + value * (world[axis * 4 + row] ?? 0), 0);
      matrix[15] = 1;
      occluder.matrix.fromArray(matrix);
      const plates: HTMLElement[] = [];
      const plate = (id: string, b: Box) => {
        const d = document.createElement('div');
        d.id = id;
        Object.assign(d.style, {
          position: 'fixed',
          left: `${b.left}px`,
          top: `${b.top}px`,
          width: `${b.right - b.left}px`,
          height: `${b.bottom - b.top}px`,
          background: '#f0f',
          zIndex: '99',
        });
        document.getElementById('hud')?.append(d);
        plates.push(d);
      };
      const material = playerMaterial.clone();
      occluder.material = material;
      drawn.scene.add?.(occluder);
      try {
        paintMask(drawn.renderer, drawn.scene, drawn.camera, drawn.render);
        const normal = [...painted];
        const visiblePrimary = [...primaryPainted];
        if (!normal.length) throw new Error('partial depth fixture hid the entire player');
        paintMask(drawn.renderer, drawn.scene, drawn.camera, drawn.render, true);
        const intersects = (a: Box, b: Box) =>
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        let hidden: Box | undefined;
        for (const run of primaryPainted) {
          for (let y = run.top + 1; y < run.bottom - 2 && !hidden; y++)
            for (let x = run.left + 1; x < run.right - 2; x++) {
              const candidate = { left: x, right: x + 2, top: y, bottom: y + 2 };
              if (
                baseline.some(
                  (b) =>
                    b.left <= candidate.left &&
                    b.right >= candidate.right &&
                    b.top <= candidate.top &&
                    b.bottom >= candidate.bottom,
                ) &&
                !normal.some((b) => intersects(b, candidate))
              ) {
                hidden = candidate;
                break;
              }
            }
          if (hidden) break;
        }
        if (!hidden) throw new Error('controlled opaque fixture produced no occluded player pixels');
        painted = normal;
        maskSerial = drawn.serial;
        plate('planted-depth-hidden', hidden);
        const negative = w.__layoutPieces?.() ?? [];
        plates.forEach((d) => d.remove());
        plates.length = 0;
        const visible = visiblePrimary.sort(
          (a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top),
        )[0];
        if (!visible) throw new Error('depth fixture has no remaining visible player');
        plate('planted-depth-visible', visible);
        return { negative, positive: w.__layoutPieces?.() ?? [], w: innerWidth, h: innerHeight };
      } finally {
        plates.forEach((d) => d.remove());
        drawn.scene.remove?.(occluder);
        maskSerial = -1;
        try {
          paintMask(drawn.renderer, drawn.scene, drawn.camera, drawn.render);
        } finally {
          maskSerial = -1;
          maskMaterials.get(material)?.forEach((m) => m.dispose());
          maskMaterials.delete(material);
          material.dispose();
        }
      }
    };
    w.__playerMaskEmptyControl = (mode = 'visibility') => {
      if (!drawn) throw new Error('empty-mask control has no actual race draw');
      const me = w.__game?.playerId();
      const own: NodeLike[] = [];
      const visit = (node: NodeLike) => {
        if (node.userData.entityId === me) own.push(node);
        node.children.forEach(visit);
      };
      drawn.scene.children?.forEach(visit);
      if (!own.length) throw new Error('empty-mask control found no actual player nodes');
      const visible = own.map((node) => node.visible);
      const materials = new Set<MaskMaterial>();
      const collect = (node: NodeLike) => {
        if (node.material)
          (Array.isArray(node.material) ? node.material : [node.material]).forEach((m) => materials.add(m));
        node.children.forEach(collect);
      };
      own.forEach(collect);
      const saved = [...materials].map((m) => ({
        m,
        opacity: m.opacity,
        transparent: m.transparent,
        premultipliedAlpha: m.premultipliedAlpha,
      }));
      try {
        // Prime the cache first, then change actual fade/ghost material state on the same frame.
        if (mode !== 'visibility') {
          w.__layoutPieces?.();
          for (const m of materials) {
            m.opacity = 0;
            m.transparent = true;
            m.premultipliedAlpha = mode === 'premultiplied';
            m.needsUpdate = true;
          }
        } else
          own.forEach((node) => {
            node.visible = false;
          });
        maskSerial = -1;
        w.__layoutPieces?.();
      } finally {
        own.forEach((node, i) => {
          node.visible = visible[i] ?? false;
        });
        for (const { m, opacity, transparent, premultipliedAlpha } of saved) {
          m.opacity = opacity;
          m.transparent = transparent;
          m.premultipliedAlpha = premultipliedAlpha;
          m.needsUpdate = true;
        }
        maskSerial = -1;
      }
    };
    w.__playerIdentityControl = () => {
      const me = w.__game?.playerId();
      const nodes: NodeLike[] = [];
      const visit = (node: NodeLike) => {
        nodes.push(node);
        node.children.forEach(visit);
      };
      drawn?.scene.getObjectByName?.('entities')?.children.forEach(visit);
      const own = nodes.find(
        (n) => n.name === '' && n.rotation.order === 'YXZ' && n.userData.entityId === me,
      );
      const rival = nodes.find(
        (n) => n.name === 'rig-mesh' && n.visible && n.skeleton && n.userData.entityId !== me,
      );
      const rivalRoot = nodes.find(
        (n) =>
          n.name === '' && n.rotation.order === 'YXZ' && n.userData.entityId === rival?.userData.entityId,
      );
      const group = rival?.skeleton?.bones[0]?.parent;
      if (!own || !rival?.skeleton || !group || !rival.parent || !rivalRoot?.parent)
        return { planted: false, unchanged: false };
      const before = JSON.stringify(w.__playerParts?.());
      const moved = [group, rivalRoot, ...rival.skeleton.bones];
      const saved = moved.map((n) => Array.from(n.matrixWorld.elements));
      const delta = [12, 13, 14].map(
        (i) => (own.matrixWorld.elements[i] ?? 0) - (group.matrixWorld.elements[i] ?? 0),
      );
      const siblings = rival.parent.children;
      const order = [...siblings];
      const roots = rivalRoot.parent.children;
      const rootOrder = [...roots];
      try {
        for (const n of moved)
          for (const [j, i] of [12, 13, 14].entries())
            (n.matrixWorld.elements as number[])[i] = (n.matrixWorld.elements[i] ?? 0) + (delta[j] ?? 0);
        for (const i of [12, 13, 14])
          (rivalRoot.matrixWorld.elements as number[])[i] = own.matrixWorld.elements[i] ?? 0;
        // A rival planted exactly at the player and first in traversal defeats nearest-node selection.
        siblings.splice(siblings.indexOf(rival), 1);
        siblings.unshift(rival);
        roots.splice(roots.indexOf(rivalRoot), 1);
        roots.unshift(rivalRoot);
        const unchanged = before === JSON.stringify(w.__playerParts?.());
        if (!drawn) throw new Error('identity control has no actual race draw');
        paintMask(drawn.renderer, drawn.scene, drawn.camera, drawn.render);
        const maskBound =
          maskAssignments.some((a) => a.name === 'rig-mesh' && a.entity === me && a.white) &&
          maskAssignments.some(
            (a) => a.name === 'rig-mesh' && a.entity === rival.userData.entityId && !a.white,
          ) &&
          maskAssignments.filter((a) => a.entity !== undefined && a.entity !== me).every((a) => !a.white);
        return { planted: true, unchanged, maskBound };
      } finally {
        moved.forEach((n, i) =>
          saved[i]?.forEach((v, j) => {
            (n.matrixWorld.elements as number[])[j] = v;
          }),
        );
        siblings.splice(0, siblings.length, ...order);
        roots.splice(0, roots.length, ...rootOrder);
        maskSerial = -1;
      }
    };
    w.__layoutPieces = () => {
      if (!drawn) throw new Error('layout sample has no actual race draw');
      if (maskSerial !== drawn.serial) paintMask(drawn.renderer, drawn.scene, drawn.camera, drawn.render);
      if (painted.length === 0) throw new Error('layout sample has no painted player pixels');
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
      for (const box of painted) out.push({ name: 'player-bike', box });
      return out;
    };
  });
}

/** The career's first event's seed: its bot gets real air and some heat early. */
const CAREER_SEED = 4;

async function startRace(page: Page, opts: { mirror?: boolean; classic?: boolean; career?: boolean } = {}) {
  await installLayoutProbe(page);
  if (opts.classic || opts.mirror) {
    // The laptop is the biggest screen here, and software WebGL takes about half a second a frame
    // there in the default ink look's offscreen pass (W-P's busier roads tipped it over in CI three
    // times running). The layout does not depend on the look, so this case races in the Classic
    // look, chosen through the saved record as a player would (as tests/perf/perf.spec.ts does).
    // The mirror layout likewise loads from the saved record before the first menu and race draw.
    await page.addInitScript(
      ({ classic, mirror }) => {
        const record = {
          format: 'settings',
          version: 1,
          build: 'e2e',
          savedAt: '2026-10-02T00:00:00.000Z',
          data: { ...(classic ? { look: 'classic' } : {}), ...(mirror ? { mirror: true } : {}) },
        };
        localStorage.setItem('mbrawl:settings', JSON.stringify(record));
      },
      { classic: opts.classic ?? false, mirror: opts.mirror ?? false },
    );
  }
  await page.addInitScript(() => {
    (window as TestWindow).__GAME_TEST__ = true;
  });
  await page.goto('./');
  if (opts.career) {
    // The bot rides from the first tick, so every case rides the same race (the moments below come
    // at the same ticks whatever the screen or the renderer's speed).
    await page.evaluate((seed) => {
      const g = (window as TestWindow).__game;
      g?.setSeed(seed);
      g?.setBot(true);
    }, CAREER_SEED);
    // A new device reaches the career's first race the player's way: Start career, then Ride.
    await rideFirstCareerRace(page);
    await expect(page.locator('#hud-objective')).toBeVisible();
  } else {
    await page.locator('#start-screen').click();
    await expect(page.locator('#menu-quick-play')).toBeVisible();
    await page.evaluate(() => (window as TestWindow).__game?.setBot(true));
    await openQuickPlay(page);
    await page.locator('#menu-race').click();
  }
  await page.waitForFunction(() => ((window as TestWindow).__game?.snapshot()?.tick ?? 0) > 20);
  // The race's first bark is on the strip: the real pipeline (events, narrative, ticker) is live.
  await expect(page.locator('#hud-ticker[data-cls="bark"]')).toBeVisible({ timeout: 10_000 });
  if (opts.mirror) {
    const mirrored = await page.evaluate(() => {
      const attack = document.getElementById('touch-attack')?.getBoundingClientRect();
      const health = document.getElementById('hud-health')?.getBoundingClientRect();
      const middle = window.innerWidth / 2;
      return {
        attack: !!attack && attack.width > 0 && attack.right < middle,
        health: !!health && health.width > 0 && health.left > middle,
      };
    });
    expect(mirrored.attack, 'the attack button is painted on the mirrored left').toBe(true);
    expect(mirrored.health, 'the player health bar is painted on the mirrored right').toBe(true);
  }
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
        'touch-wheelie',
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

export {
  BIKE,
  CAREER_PROMPTS,
  LANDING_LINES,
  LONGEST_LINE,
  type Box,
  type Piece,
  type Measured,
  type TestWindow,
  LONGEST_BARK,
  WIDE_CHIP,
  NAME,
  LONGEST_ASK,
  LONGEST_LANDING,
  overlaps,
  layoutFindings,
  expectLayout,
  roundBox,
  logPieces,
  watchErrors,
  CAREER_SEED,
  startRace,
  tickerAndMeasure,
  expectClear,
  momentFindings,
  gaugeMoment,
  expectCompact,
  shot,
  KNOWN_LAYOUT_FINDINGS,
  KNOWN_LAYOUT_CAP,
  toastAndPrompts,
};
