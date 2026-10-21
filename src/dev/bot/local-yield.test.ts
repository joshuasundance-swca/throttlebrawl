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
    road: { edge: 0, s: 100, d: dir * 1.4, dir, yaw: 0, h: 0 },
  };
  const vehicle = (id: number, ahead: number, d: number) => ({
    ...me,
    id,
    kind: 'vehicle' as const,
    slot: -1,
    road: { ...me.road, s: 100 + dir * ahead, d: dir * d, dir: -dir as 1 | -1 },
  });
  const lead = { ...vehicle(1, 1, -0.25), speed: moving ? 5 : 0 };
  // The farther queue blocks the eventual passing line, but not the nearby lateral yield.
  const queue = vehicle(2, 12, 1);
  const occupiedEdge = vehicle(3, 3, 1.9);
  const snap = { ...initial, entities: [me, lead, queue, ...(occupied ? [occupiedEdge] : [])] };
  const route: RouteQueries = {
    lanesAt: () => [{ id: 'single', dCenterM: 0, widthM, direction: dir, kind: 'shortcut' }],
    kappaAt: () => 0,
    edgeLength: () => 1000,
    distanceToFinish: (_e, s) => 1000 - s,
  };
  const bot = createBot();
  const drive = (tick: number) => {
    const actions = blankActions();
    bot.drive({ ...snap, tick }, 0, route, actions);
    return actions;
  };
  return { snap, me, drive };
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

  it('stops creeping before the conservative reach of the farther body, rather than forcing a pass', () => {
    const { snap, me, drive } = scene();
    // Bring that vehicle's conservative body envelope only half a metre ahead.
    snap.entities[2]!.road.s = 110.5;
    for (let tick = 1; tick <= STUCK_TICKS + 1; tick++) drive(tick);
    me.road.s += 0.6;
    const actions = drive(STUCK_TICKS + 2);
    expect(actions.throttle).toBe(0);
  });
});
