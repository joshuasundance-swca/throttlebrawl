import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../app';
import type { EntitySnapshot, RouteQueries } from '../../sim/api';
import { blankActions, createBot, STUCK_TICKS } from './index';

function scene(dir: 1 | -1 = 1, widthM = 5, moving = false, occupied = false) {
  const initial = createHeadlessRace().sim.snapshot();
  const template = initial.entities.find((e) => e.slot === 0)!;
  const me: EntitySnapshot = {
    ...template,
    id: 0,
    speed: 0,
    grounded: true,
    mode: 'Road',
    heading: dir > 0 ? 0 : Math.PI,
    footprintLengthM: 2,
    footprintWidthM: 0.8,
    x: dir * 1.4,
    y: 0,
    z: -100,
    road: { edge: 0, s: 100, d: dir * 1.4, dir, yaw: 0, h: 0 },
  };
  const vehicle = (id: number, ahead: number, d: number) => ({
    ...me,
    id,
    kind: 'vehicle' as const,
    slot: -1,
    heading: me.heading + Math.PI,
    footprintLengthM: 4.3,
    footprintWidthM: 1.8,
    x: dir * d,
    z: -(100 + dir * ahead),
    road: { ...me.road, s: 100 + dir * ahead, d: dir * d, dir: -dir as 1 | -1 },
  });
  const lead = { ...vehicle(1, 1, -0.25), speed: moving ? 5 : 0, footprintLengthM: 11, footprintWidthM: 2.6 };
  // The farther queue blocks the eventual passing line, but not the nearby lateral yield.
  const queue = vehicle(2, 12, 1);
  const occupiedEdge = vehicle(3, 3, 1.9);
  const snap = { ...initial, entities: [me, lead, queue, ...(occupied ? [occupiedEdge] : [])] };
  const route: RouteQueries = {
    lanesAt: () => [{ id: 'single', dCenterM: 0, widthM, direction: dir, kind: 'shortcut' }],
    kappaAt: () => 0,
    edgeLength: () => 1000,
    // The finish lies the way the bot rides, as on a real route (a bot riding away from it turns round).
    distanceToFinish: (_e, s) => (dir === 1 ? 1000 - s : s),
  };
  const bot = createBot();
  const drive = (tick: number) => {
    const actions = blankActions();
    bot.drive({ ...snap, tick }, 0, route, actions);
    return actions;
  };
  return { snap, me, drive, route };
}

describe('a local yield to opposing stationary traffic', () => {
  it.each([1, -1] as const)('creeps toward a clear own-lane edge after waiting (%i)', (dir) => {
    const { snap, drive } = scene(dir);
    const saved = structuredClone(snap);
    expect(drive(1).throttle).toBe(0);
    let actions = blankActions();
    for (let tick = 2; tick <= STUCK_TICKS + 1; tick++) actions = drive(tick);
    expect(actions.steer).toBeGreaterThan(0);
    expect(actions.throttle).toBe(1);
    expect(snap).toEqual(saved);
  });

  it.each(['moving', 'occupied', 'narrow'] as const)('keeps waiting when the local yield is %s', (which) => {
    const { drive } = scene(1, which === 'narrow' ? 3.4 : 5, which === 'moving', which === 'occupied');
    let actions = blankActions();
    for (let tick = 1; tick <= STUCK_TICKS + 1; tick++) actions = drive(tick);
    expect(actions.throttle).toBe(0);
    expect(actions.steer).toBeLessThanOrEqual(0);
  });

  it('stops creeping before the farther body footprint, rather than forcing a pass', () => {
    const { snap, me, drive } = scene();
    // Bring the actual short body's front, bike and clearance only half a metre ahead.
    snap.entities[2]!.road.s = 103.75;
    snap.entities[2]!.z = -103.75;
    for (let tick = 1; tick <= STUCK_TICKS + 1; tick++) drive(tick);
    me.road.s += 0.6;
    me.z -= 0.6;
    const actions = drive(STUCK_TICKS + 2);
    expect(actions.throttle).toBe(0);
  });

  it('does not creep toward a long body whose centre lies outside the local centre window', () => {
    const { snap, drive } = scene();
    // A 20 m vehicle here reaches to half a metre ahead; the 2 m bike already reaches farther.
    // Its near edge occupies the proposed right yield, despite its centre being over 10 m away.
    snap.entities[2]!.road.s = 110.5;
    snap.entities[2]!.road.d = 1.9;
    snap.entities[2]!.x = 1.9;
    snap.entities[2]!.z = -110.5;
    snap.entities[2]!.footprintLengthM = 20;
    snap.entities[2]!.footprintWidthM = 2.6;
    let actions = blankActions();
    for (let tick = 1; tick <= STUCK_TICKS + 1; tick++) actions = drive(tick);
    expect(actions.throttle).toBe(0);
    expect(actions.steer).toBeLessThanOrEqual(0);
  });

  it('does not cross a touching body to reach an otherwise clear opposite edge', () => {
    const { drive } = scene(1, 7, false, true);
    let actions = blankActions();
    for (let tick = 1; tick <= STUCK_TICKS + 1; tick++) actions = drive(tick);
    expect(actions.throttle).toBe(0);
  });

  it('does not deepen a shallow rotated overlap before escaping through another side', () => {
    const { snap, me, drive } = scene(1, 6);
    me.x = 0;
    me.road.d = 0;
    me.footprintLengthM = 2.2;
    const touching = snap.entities[1]!;
    touching.x = -0.6;
    touching.z = -102.2;
    touching.road.s = 102.2;
    touching.road.d = -0.6;
    touching.heading = Math.PI / 6;
    touching.footprintLengthM = 2;
    touching.footprintWidthM = 2.6;
    // The right edge is occupied. Reaching the clear left edge would first push the bike
    // farther through the rotated body: a clear endpoint alone is not a safe escape.
    const right = snap.entities[2]!;
    right.x = 2;
    right.z = -101;
    right.road.s = 101;
    right.road.d = 2;
    let actions = blankActions();
    for (let tick = 1; tick <= STUCK_TICKS + 1; tick++) actions = drive(tick);
    expect(actions.throttle).toBe(0);
  });

  it.each(['missing vehicle', 'invalid vehicle', 'missing rider'] as const)(
    'refuses unknown geometry: %s',
    (which) => {
      const { snap, me, drive } = scene();
      if (which === 'missing vehicle') delete snap.entities[2]!.footprintLengthM;
      else if (which === 'invalid vehicle') snap.entities[2]!.footprintWidthM = NaN;
      else delete me.footprintWidthM;
      let actions = blankActions();
      for (let tick = 1; tick <= STUCK_TICKS + 1; tick++) actions = drive(tick);
      expect(actions.throttle).toBe(0);
    },
  );

  it('respects a projected long body transverse to the rider, rather than its narrow own-frame width', () => {
    const run = (heading: number) => {
      const { snap, route, drive } = scene();
      const body = snap.entities[2]!;
      body.road = { ...body.road, edge: 1, s: 1.5, d: 4 };
      body.heading = heading;
      body.x = 4;
      body.z = -101.5;
      body.footprintLengthM = 20;
      body.footprintWidthM = 2.4;
      route.projectPosition = (_a, b) => ({ ...b, edge: 0, s: 101.5 });
      const saved = structuredClone(snap);
      let actions = blankActions();
      for (let tick = 1; tick <= STUCK_TICKS + 1; tick++) actions = drive(tick);
      expect(snap).toEqual(saved);
      return actions;
    };
    expect(run(0).throttle).toBe(1); // Parallel, the long body stands beside the own-lane yield.
    expect(run(Math.PI / 2).throttle).toBe(0); // Transverse, its length closes the yield.
  });
});
