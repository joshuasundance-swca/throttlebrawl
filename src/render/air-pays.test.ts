// Air that pays (the pitch deck's #13, run W-T), render's part (air-pays.ts): the chalk mark where
// the player will touch down (red when crooked), the newspaper held up while reading it and thrown
// off on a newspaper crash, and the region's one-liner on a surge landing, listed for "cut this".
// Driven by hand-built snapshots and events at fixed times (no wall clock, no frames).
import { Color, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot, TouchdownSnapshot } from '../sim/api';
import { AirPays, CHALK_CLEAN, CHALK_CROOKED, chalkMarkGeometry, nextLineIndex } from './air-pays';
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
