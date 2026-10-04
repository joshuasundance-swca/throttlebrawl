// Air that pays (the pitch deck's #13, run W-T), render's part (air-pays.ts): the chalk mark where
// the player will touch down (red when crooked), the newspaper held up while reading it and thrown
// off on a newspaper crash, and the region's one-liner on a surge landing, listed for "cut this".
// Driven by hand-built snapshots and events at fixed times (no wall clock, no frames).
import { Color, MeshBasicMaterial, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot, TouchdownSnapshot } from '../sim/api';
import {
  AirPays,
  BIKE_SHAPE,
  bikeScreenBox,
  CHALK_CLEAN,
  CHALK_CROOKED,
  chalkMarkGeometry,
  CORNER_REACH,
  landingLineLayout,
  LINE_MIN_FONT_PX,
  LINE_PLATE,
  LINE_PLATE_ALPHA,
  nextLineIndex,
  PORTRAIT_FOOT,
  ROAD_AHEAD_BOTTOM,
  ROAD_AHEAD_WIDTH,
  type ScreenBox,
} from './air-pays';
import type { BoardItem } from './boards';

const entity = (over: Partial<EntitySnapshot>): EntitySnapshot => ({
  id: 0,
  kind: 'rider',
  mode: 'Road',
  road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 },
  x: 10,
  y: 4,
  z: -100,
  heading: 0,
  speed: 30,
  lean: 0,
  contentId: 'base:player',
  name: 'You',
  faction: 'rider',
  slot: 0,
  throttle: 1,
  rpm: 0,
  gear: 5,
  grounded: true,
  health: 100,
  healthMax: 100,
  attackPhase: 'idle',
  heldWeapon: null,
  targetId: -1,
  lastAttackerId: -1,
  progress: 0,
  distanceToFinish: 1000,
  place: 1,
  finished: false,
  ...over,
});

const snap = (entities: EntitySnapshot[], tick = 1): SimSnapshot => ({
  tick,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 3500, finishOrder: [] },
});

const TD: TouchdownSnapshot = { x: 12, y: 3, z: -130, heading: 0.3, inS: 0.8, crooked: false };
const air = (over: Partial<EntitySnapshot> = {}) =>
  entity({
    mode: 'Airborne',
    grounded: false,
    y: 7,
    road: { edge: 0, s: 100, d: 0, h: 3, dir: 1, yaw: 0 },
    touchdown: TD,
    ...over,
  });

const LINES: BoardItem[] = [
  { ref: 'base:region/florida-keys#pelican', text: 'TEN OUT OF TEN, SAYS A PELICAN', kind: 'sign' },
  { ref: 'base:region/florida-keys#gator', text: 'THE GATOR WAS NOT IMPRESSED', kind: 'sign' },
];
const surge = (actor: number, tick = 5): SimEvent => ({
  tick,
  type: 'land',
  actor,
  data: { quality: 'clean', surge: true, surgeS: 1 },
});

describe('air that pays: the chalk mark', () => {
  it('sits flat on the forecast touch-down point, turned along the heading there, in chalk white', () => {
    const a = new AirPays();
    const s = snap([air()]);
    a.update(s, s, 1, 0);
    expect(a.mark.visible).toBe(true);
    expect(a.mark.position.x).toBeCloseTo(12);
    expect(a.mark.position.z).toBeCloseTo(-130);
    expect(a.mark.position.y).toBeGreaterThan(3);
    expect(a.mark.position.y).toBeLessThan(3.2);
    expect(a.mark.rotation.y).toBeCloseTo(0.3);
    expect((a.mark.material as MeshBasicMaterial).color.equals(new Color(CHALK_CLEAN))).toBe(true);
    expect(a.stats()).toMatchObject({ mark: true, crooked: false });
  });

  it('turns red when the landing would be crooked', () => {
    const a = new AirPays();
    const s = snap([air({ touchdown: { ...TD, crooked: true } })]);
    a.update(s, s, 1, 0);
    expect((a.mark.material as MeshBasicMaterial).color.equals(new Color(CHALK_CROOKED))).toBe(true);
    expect(a.stats().crooked).toBe(true);
  });

  it('is hidden on the ground, and for anyone but the player', () => {
    const a = new AirPays();
    a.update(null, snap([entity({})]), 1, 0);
    expect(a.mark.visible).toBe(false);
    a.update(null, snap([air({ slot: -1 })]), 1, 0.1);
    expect(a.mark.visible).toBe(false);
  });

  it('follows the forecast between two snapshots', () => {
    const a = new AirPays();
    const prev = snap([air({ touchdown: { ...TD, x: 10 } })]);
    const curr = snap([air({ touchdown: { ...TD, x: 14 } })], 2);
    a.update(prev, curr, 0.5, 0);
    expect(a.mark.position.x).toBeCloseTo(12);
  });

  it('is a handful of triangles: a ring, a cross and a heading tick', () => {
    const tris = (chalkMarkGeometry().getAttribute('position')?.count ?? 0) / 3;
    expect(tris).toBeGreaterThan(20);
    expect(tris).toBeLessThan(80);
  });
});

describe('air that pays: the newspaper', () => {
  it('is held up in front of the rider while he reads it', () => {
    const a = new AirPays();
    a.update(null, snap([air({ trick: 'newspaper' })]), 1, 0);
    expect(a.paper.visible).toBe(true);
    // In front (models face -z with heading 0) and up at chest height.
    expect(a.paper.position.z).toBeLessThan(-100);
    expect(a.paper.position.y).toBeGreaterThan(7 + 1);
    a.update(null, snap([air({ trick: null })]), 1, 0.1);
    expect(a.paper.visible).toBe(false);
  });

  it('landing with it, the paper flies off down the road and comes to rest on the ground', () => {
    const a = new AirPays();
    a.update(null, snap([air({ trick: 'newspaper' })]), 1, 0);
    a.pushEvents([{ tick: 3, type: 'crash', actor: 0, data: { cause: 'landing', attempt: 'newspaper' } }]);
    const down = entity({ mode: 'Tumble', y: 4 });
    a.update(null, snap([down]), 1, 0.05);
    expect(a.paper.visible).toBe(true);
    const z0 = a.paper.position.z;
    for (let i = 1; i <= 40; i++) a.update(null, snap([down]), 1, 0.05 + i * 0.05);
    expect(a.paper.position.z).toBeLessThan(z0 - 5);
    expect(a.paper.position.y).toBeCloseTo(4.05, 1);
    for (let i = 41; i <= 120; i++) a.update(null, snap([down]), 1, 0.05 + i * 0.05);
    expect(a.paper.visible).toBe(false);
  });
});

describe('air that pays: the landing one-liner', () => {
  it("pops one of the region's lines on the player's surge landing, listed for cut this, then goes", () => {
    const a = new AirPays();
    a.setLines(LINES);
    const s = snap([entity({})]);
    a.pushEvents([surge(0)]);
    a.update(s, s, 1, 10);
    const shown = a.stats().line;
    expect(LINES.map((l) => l.text)).toContain(shown);
    expect(a.visibleRefs()).toHaveLength(1);
    a.update(s, s, 1, 11);
    expect(a.stats().line).toBe(shown);
    a.update(s, s, 1, 12.1);
    expect(a.stats().line).toBeNull();
    expect(a.visibleRefs()).toEqual([]);
  });

  it("a rival's surge pops nothing, and nor does a region with no lines", () => {
    const a = new AirPays();
    a.setLines(LINES);
    const s = snap([entity({}), entity({ id: 1, slot: -1 })]);
    a.pushEvents([surge(1)]);
    a.update(s, s, 1, 0);
    expect(a.stats().line).toBeNull();
    const none = new AirPays();
    none.pushEvents([surge(0)]);
    none.update(s, s, 1, 0);
    expect(none.stats().line).toBeNull();
  });

  it('a cut line comes off the screen and never shows again', () => {
    const a = new AirPays();
    a.setLines(LINES);
    const s = snap([entity({})]);
    a.pushEvents([surge(0)]);
    a.update(s, s, 1, 0);
    const ref = a.visibleRefs()[0] ?? '';
    a.hide([ref]);
    expect(a.stats().line).toBeNull();
    for (let k = 0; k < 6; k++) {
      a.pushEvents([surge(0, 10 + k)]);
      a.update(s, s, 1, 5 * (k + 1));
      expect(a.visibleRefs()).not.toContain(ref);
    }
  });

  it('never shows the same line twice running when there is another', () => {
    for (let n = 2; n <= 6; n++) {
      let last = -1;
      for (let tick = 0; tick < 40; tick++) {
        const i = nextLineIndex(n, last, tick * 7 + 3);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(n);
        expect(i).not.toBe(last);
        last = i;
      }
    }
    expect(nextLineIndex(0, -1, 5)).toBe(-1);
    expect(nextLineIndex(1, 0, 5)).toBe(0);
  });
});

// The live check (run W-T, wt-check mustFix 1): in the default Ink + 60s look the line never painted,
// because the film pass paints the sky wherever the depth buffer is clear and the line (no depth
// write) sat over the sky; in classic its letters were about 6 px tall. It now draws on a screen-space
// overlay after the film pass, in CSS pixels, on a dark plate, at a minimum size.
describe('air that pays: the landing one-liner reads on a phone in every look', () => {
  // The worst case the content lint allows (40 characters), measured as bold sans capitals (about
  // 0.7 em each: wider than the real font, so the fit is conservative).
  const LONGEST = 'BEST THING CAUGHT ON THE CHARTER, BY FAR';
  const measure = (t: string, px: number) => t.length * px * 0.7;
  // Phone landscape and portrait (CSS px), a small phone, and a laptop.
  const VIEWS: [number, number][] = [
    [800, 360],
    [360, 740],
    [320, 568],
    [1280, 720],
  ];

  it('draws on the overlay after the film pass, never in the 3D scene the pass paints over', () => {
    const a = new AirPays();
    let inScene = false;
    a.root.traverse((o) => {
      if (o === a.line) inScene = true;
    });
    expect(inScene).toBe(false);
    let inOverlay = false;
    a.overlay.traverse((o) => {
      if (o === a.line) inOverlay = true;
    });
    expect(inOverlay).toBe(true);
    // Not inked, graded, fogged or tone-mapped: the chalk stays chalk.
    expect(a.line.material.depthTest).toBe(false);
    expect(a.line.material.fog).toBe(false);
    expect(a.line.material.toneMapped).toBe(false);
  });

  it('is at least LINE_MIN_FONT_PX tall and fits the screen, on a phone either way up', () => {
    expect(LINE_MIN_FONT_PX).toBeGreaterThanOrEqual(16);
    for (const [w, h] of VIEWS) {
      const l = landingLineLayout(LONGEST, w, h, measure);
      expect(l.fontPx, `${w}x${h}`).toBeGreaterThanOrEqual(LINE_MIN_FONT_PX);
      expect(l.plateW, `${w}x${h}`).toBeLessThanOrEqual(w - 16);
      // Landscape: no wider than the road ahead, so the bottom corners' HUD stays clear.
      if (w >= h) expect(l.plateW, `${w}x${h}`).toBeLessThanOrEqual(w * ROAD_AHEAD_WIDTH - 16);
      for (const row of l.rows) expect(measure(row, l.fontPx)).toBeLessThanOrEqual(l.plateW);
      expect(l.rows.join(' ')).toBe(LONGEST);
      expect(l.plateH).toBeGreaterThanOrEqual(l.rows.length * l.fontPx);
    }
    // Wide enough, it is one row; the longest wraps into two rather than shrinking, either way up.
    // (Inside the bottom corners' reach, a 1920x1080 screen's band is 608 px: that line takes two.)
    expect(landingLineLayout('TEN OUT OF TEN, SAYS A PELICAN', 2560, 1440, measure).rows).toHaveLength(1);
    expect(landingLineLayout('TEN OUT OF TEN, SAYS A PELICAN', 1920, 1080, measure).rows).toHaveLength(2);
    expect(landingLineLayout(LONGEST, 1280, 720, measure).rows).toHaveLength(2);
    expect(landingLineLayout(LONGEST, 360, 740, measure).rows).toHaveLength(2);
  });

  it('chalk on a dark plate: at least 7:1 contrast over the brightest sky and the darkest sea', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
    };
    const over = (bg: number) =>
      '#' +
      [1, 3, 5]
        .map((i) => {
          const p = parseInt(LINE_PLATE.slice(i, i + 2), 16);
          const v = Math.round(p * LINE_PLATE_ALPHA + bg * (1 - LINE_PLATE_ALPHA));
          return v.toString(16).padStart(2, '0');
        })
        .join('');
    const text = lum(CHALK_CLEAN);
    for (const bg of [255, 0]) {
      const ratio = (text + 0.05) / (lum(over(bg)) + 0.05);
      expect(ratio, `over ${bg}`).toBeGreaterThanOrEqual(7);
    }
  });

  it('sits centred under the road ahead and the bike, inside the bottom corners, at its laid-out size', () => {
    // Playtest 3: "The black and white text pop-ups block the actual game". The road ahead is the
    // middle half across, 25-65 % down; the plate sits wholly below it and below the player's bike
    // (the live check after #430: just under the road ahead it covered the bike in the Keys), inside
    // the bottom corners' HUD across, above the speed and health on an upright screen.
    const a = new AirPays();
    a.setLines([{ ref: 'base:region/florida-keys#long', text: LONGEST, kind: 'sign' }]);
    const s = snap([entity({ x: 0, y: 0, z: 0 })]);
    // The bike boxes CI measured (ui-style-popups.spec.ts), and none.
    const cases: [number, number, ScreenBox | null][] = [
      [915, 412, { left: 437, top: 221, right: 478, bottom: 309 }],
      [412, 915, { left: 150, top: 480, right: 262, bottom: 712 }],
      [1366, 768, { left: 639, top: 394, right: 728, bottom: 576 }],
      [800, 360, null],
    ];
    for (const [w, h, bike] of cases) {
      a.pushEvents([surge(0)]);
      a.update(s, s, 1, 10);
      expect(a.fitOverlay(w, h, 1.5, bike)).toBe(true);
      const plateW = a.line.scale.x;
      const plateH = a.line.scale.y;
      const where = `${w}x${h}`;
      expect(a.line.position.x, `${where}: centred`).toBeCloseTo(w / 2, 0);
      // The overlay camera has y up: the plate's top, CSS px from the screen's top.
      const top = h - (a.line.position.y + plateH / 2);
      expect(top, `${where}: under the road ahead`).toBeGreaterThanOrEqual(h * ROAD_AHEAD_BOTTOM);
      if (bike) expect(top, `${where}: under the bike`).toBeGreaterThanOrEqual(bike.bottom);
      const foot = h > w ? h - PORTRAIT_FOOT * w : h;
      expect(top + plateH, `${where}: above the HUD at the foot`).toBeLessThanOrEqual(foot);
      if (w > h)
        expect(plateW, `${where}: inside the bottom corners`).toBeLessThanOrEqual(w - 2 * CORNER_REACH * h);
      const l = landingLineLayout(LONGEST, w, h);
      expect(plateH, `${where}: never taller than its free layout`).toBeLessThanOrEqual(l.plateH);
      a.update(s, s, 1, 13); // the line goes
    }
  });

  it('leaves a settling bike room under it when the screen has the room', () => {
    // A CI race on #446: the plate was placed under the bike on the landing frame, then the bike
    // sank 12 to 14 px (0.16 of its height) into it. A short line on a phone held sideways has room.
    const a = new AirPays();
    a.setLines([{ ref: 'base:region/florida-keys#short', text: 'NICE.', kind: 'sign' }]);
    const s = snap([entity({ x: 0, y: 0, z: 0 })]);
    a.pushEvents([surge(0)]);
    a.update(s, s, 1, 10);
    const bike = { left: 441, top: 215, right: 474, bottom: 292 };
    a.fitOverlay(915, 412, 1, bike);
    const top = 412 - (a.line.position.y + a.line.scale.y / 2);
    const sunk = bike.bottom + 0.16 * (bike.bottom - bike.top);
    expect(top, 'clear of the bike after it settles').toBeGreaterThan(sunk);
    expect(top + a.line.scale.y, 'still on screen').toBeLessThanOrEqual(412);
  });

  it('holds still while it shows, and rises over the bike only when the room under it is too short', () => {
    const a = new AirPays();
    a.setLines([{ ref: 'base:region/florida-keys#long', text: LONGEST, kind: 'sign' }]);
    const s = snap([entity({ x: 0, y: 0, z: 0 })]);
    a.pushEvents([surge(0)]);
    a.update(s, s, 1, 10);
    const bike = { left: 440, top: 220, right: 480, bottom: 310 };
    a.fitOverlay(915, 412, 1, bike);
    const y = a.line.position.y;
    a.fitOverlay(915, 412, 1, { ...bike, top: 240, bottom: 330 });
    expect(a.line.position.y, 'the bike bobs, the plate holds').toBe(y);
    a.update(s, s, 1, 13);
    // A bike so low that even the smallest plate cannot fit under it: the plate keeps out of the road
    // ahead and on the screen, at its smallest letters.
    a.pushEvents([surge(0, 9)]);
    a.update(s, s, 1, 20);
    a.fitOverlay(915, 412, 1, { ...bike, bottom: 400 });
    const top = 412 - (a.line.position.y + a.line.scale.y / 2);
    expect(top).toBeGreaterThanOrEqual(412 * ROAD_AHEAD_BOTTOM);
    expect(top + a.line.scale.y).toBeLessThanOrEqual(412);
    // Nothing shown: nothing to draw.
    a.update(s, s, 1, 23);
    expect(a.fitOverlay(800, 360, 1.5)).toBe(false);
  });

  it("measures the bike's screen box through the camera as three.js projects it", () => {
    const camera = new PerspectiveCamera(60, 915 / 412, 0.3, 700);
    camera.position.set(0.3, 2.6, 5);
    camera.lookAt(0, 0.9, -18);
    camera.updateMatrixWorld();
    const frame = new Object3D();
    frame.position.set(0.2, 0, 0);
    frame.rotation.set(0, 0.2, -0.3, 'YXZ');
    frame.updateMatrixWorld();
    const box = bikeScreenBox(
      frame.matrixWorld.elements,
      camera.matrixWorldInverse.elements,
      camera.projectionMatrix.elements,
      915,
      412,
    );
    expect(box).not.toBeNull();
    const want = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const b of BIKE_SHAPE)
      for (const x of [b.min[0], b.max[0]])
        for (const y of [b.min[1], b.max[1]])
          for (const z of [b.min[2], b.max[2]]) {
            const v = new Vector3(x, y, z).applyMatrix4(frame.matrixWorld).project(camera);
            const sx = ((v.x + 1) / 2) * 915;
            const sy = ((1 - v.y) / 2) * 412;
            want.left = Math.min(want.left, sx);
            want.right = Math.max(want.right, sx);
            want.top = Math.min(want.top, sy);
            want.bottom = Math.max(want.bottom, sy);
          }
    for (const k of ['left', 'top', 'right', 'bottom'] as const) expect(box?.[k]).toBeCloseTo(want[k], 3);
    // Low in the middle of the screen, as the chase camera shows the bike.
    expect(((box?.left ?? 0) + (box?.right ?? 0)) / 2).toBeGreaterThan(915 * 0.3);
    expect(box?.bottom ?? 0).toBeGreaterThan(412 * 0.5);
    // Behind the camera: no box.
    frame.position.set(0, 0, 20);
    frame.updateMatrixWorld();
    expect(
      bikeScreenBox(
        frame.matrixWorld.elements,
        camera.matrixWorldInverse.elements,
        camera.projectionMatrix.elements,
        915,
        412,
      ),
    ).toBeNull();
  });
});
