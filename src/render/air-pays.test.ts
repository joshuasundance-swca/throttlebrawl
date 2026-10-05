// Air that pays (the pitch deck's #13, run W-T), render's part (air-pays.ts): the chalk mark where
// the player will touch down (red when crooked), the newspaper held up while reading it and thrown
// off on a newspaper crash, and that a surge landing's one-liner is no longer drawn here (the top
// ticker shows it).
// Driven by hand-built snapshots and events at fixed times (no wall clock, no frames).
import { Color, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot, TouchdownSnapshot } from '../sim/api';
import { AirPays, CHALK_CLEAN, CHALK_CROOKED, chalkMarkGeometry } from './air-pays';

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

describe('air that pays: the landing one-liner is not drawn here', () => {
  // Playtest 3: the line is a ticker item now (app/ticker-feed.ts), off the bike and off the road, so
  // a surge landing adds nothing to the scene and nothing to the screen-space pass.
  it("a surge landing, the player's or a rival's, leaves only the mark and the paper to draw", () => {
    const a = new AirPays();
    const s = snap([entity({}), entity({ id: 1, slot: -1 })]);
    a.pushEvents([surge(0), surge(1, 6)]);
    for (const t of [10, 10.5, 11, 12.1]) a.update(s, s, 1, t);
    expect(a.stats()).toEqual({ mark: false, crooked: false, paper: false });
    expect(a.root.children.map((c) => c.name).sort()).toEqual(['chalk-mark', 'newspaper']);
    expect(a.root.children.every((c) => !c.visible)).toBe(true);
  });
});
