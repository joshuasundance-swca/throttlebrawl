import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { AirPays } from './air-pays';
import { FeelEffects } from './effects';
import { createFlatLook } from './look';
import { Rain } from './rain';
import { RiderRigs } from './riders';
import { fakeBike, fakeRider } from './riders/rig-fixtures.test-util';
import { riderLookOf } from './rider-looks';
import { SpeedLines } from './speed-lines';
import { defaultRenderParams } from './tuning';
import { VergeLayer } from './verge';
import { EntityViews } from './views';

describe('exact measurement-to-menu transient resets', () => {
  it('clears real particle/ring/reactor/tint clocks, line and rain phases with active positive controls', () => {
    const look = createFlatLook(),
      params = defaultRenderParams();
    const fx = new FeelEffects(look, params);
    fx.burst({ x: 0, y: 1, z: 0 }, 1);
    fx.paperwork({ x: 0, y: 1, z: 0 });
    fx.splash({ x: 0, y: 0, z: 0 }, 'gator', 1, 0);
    fx.update(0.01, 0.1, true);
    for (const value of Object.values(fx.counts())) expect(value).toBeGreaterThan(0);
    fx.resetTransient();
    expect(fx.counts()).toEqual({ sparks: 0, drops: 0, paper: 0, rings: 0, reactors: 0, tint: 0 });
    expect((fx as unknown as { now: number }).now).toBe(0);
    const lines = new SpeedLines(look, params);
    lines.update(100, 0.1, new PerspectiveCamera());
    expect(lines.counts().level).toBeGreaterThan(0);
    expect(lines.counts().lines).toBeGreaterThan(0);
    lines.resetTransient();
    expect(lines.counts()).toEqual({ level: 0, lines: 0 });
    expect(lines.lineAt(0)).toEqual({ x: 0, y: 0, z: 0 });
    const rain = new Rain(look, params);
    rain.set('#999999');
    rain.update(10, 0.1);
    expect(rain.count()).toBeGreaterThan(0);
    const state = rain as unknown as { drops: { x: number; y: number; z: number }[] };
    const before = structuredClone(state.drops);
    rain.set('#888888', true);
    expect(state.drops).toEqual(before);
    rain.resetTransient();
    expect(rain.count()).toBe(0);
    expect(state.drops.every((d) => d.x === 0 && d.y === 0 && d.z === 0)).toBe(true);
  });
  it('clears actual AirPays crashes/flying paper/mark/counts/clock and a queued verge burst', () => {
    const air = new AirPays();
    const me = {
      id: 0,
      kind: 'rider',
      slot: 0,
      mode: 'Airborne',
      trick: 'newspaper',
      x: 0,
      y: 1,
      z: 0,
      heading: 0,
      speed: 20,
      touchdown: { x: 0, y: 0, z: 0, heading: 0, inS: 1, crooked: false },
      road: { edge: 0, h: 0 },
    } as EntitySnapshot;
    const snap = { entities: [me], timeScale: 1 } as SimSnapshot;
    air.pushEvents([{ tick: 1, type: 'crash', actor: 0, data: { attempt: 'newspaper' } }]);
    air.update(null, snap, 1, 1);
    expect(air.stats().mark).toBe(true);
    expect(air.stats().paper).toBe(true);
    air.pushEvents([{ tick: 1, type: 'crash', actor: 0, data: { attempt: 'newspaper' } }]);
    air.resetTransient();
    expect(air.stats()).toEqual({ mark: false, crooked: false, paper: false });
    const state = air as unknown as { pendingCrash: unknown[]; flying: unknown; lastT: number };
    expect(state.pendingCrash).toEqual([]);
    expect(state.flying).toBeNull();
    expect(state.lastT).toBe(-1);
    expect(air.mark.visible).toBe(false);
    expect(air.paper.visible).toBe(false);
    const road = createRoadNetwork(fixtureNetwork([{ id: 'flat', lengthM: 10, kappa: 0 }]));
    const verge = new VergeLayer(road, createFlatLook(), { tags: new Set() });
    verge.pushEvents([{ tick: 1, type: 'wobble', actor: 0, data: { cause: 'fence' } }]);
    expect(verge.pendingEvents()).toHaveLength(1);
    const pending = verge.pendingEvents();
    const next = new VergeLayer(road, createFlatLook(), { tags: new Set() });
    next.pushEvents(pending);
    expect(next.pendingEvents()).toEqual(pending);
    next.resetTransient();
    expect(next.pendingEvents()).toEqual([]);
    verge.dispose();
    next.dispose();
  });
  it('clears real rider ghost/event pose timers and clocks while retaining loaded part assets', () => {
    const look = createFlatLook();
    const rigs = new RiderRigs(look, null, defaultRenderParams());
    const selected = riderLookOf({
      contentId: 'base:probe',
      role: 'rival',
      bikeId: 'base:probe',
      look: { riderModel: 'probe-rider', bikeModel: 'probe-bike' },
    });
    rigs.addPart(selected.riderModel, fakeRider());
    rigs.addPart(selected.bikeModel, fakeBike());
    rigs.setLooks([selected]);
    const me: EntitySnapshot = {
      id: 7,
      contentId: selected.contentId,
      kind: 'rider',
      mode: 'Road',
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      speed: 0,
      lean: 0,
      health: 100,
      healthMax: 100,
      road: { edge: 0, h: 0, d: 0, s: 0, dir: 1, yaw: 0 },
      slot: -1,
      attackPhase: 'idle',
      heldWeapon: null,
      name: 'probe',
      faction: 'rider',
      throttle: 0,
      rpm: 0,
      gear: 1,
      grounded: true,
      targetId: -1,
      lastAttackerId: -1,
      progress: 0,
      distanceToFinish: 10,
      place: 1,
      finished: false,
    };
    const snap: SimSnapshot = {
      entities: [me],
      tick: 1,
      timeScale: 1,
      race: { over: false, routeLength: 10, finishOrder: [] },
    };
    const views = new EntityViews(look);
    views.setRigs(rigs);
    views.sync(null, snap, 1, 1);
    rigs.pushEvents([
      { tick: 1, type: 'getUp', actor: 7, data: {} },
      { tick: 1, type: 'fistShake', actor: 7, data: {} },
      { tick: 1, type: 'kick', actor: 7, data: {} },
      { tick: 1, type: 'hit', actor: 7, target: 7, data: {} },
      { tick: 1, type: 'badConnection', actor: 7, data: { phase: 'drop' } },
    ]);
    const state = rigs as unknown as {
      rigs: Map<
        number,
        { fistUntil: number; flinchUntil: number; kicking: boolean; getUpUntil: number; squatAt: number }
      >;
      now: number;
      ghosts: { dropped: Set<number> };
    };
    const rig = state.rigs.get(7)!;
    expect(rig.fistUntil).toBeGreaterThan(1);
    expect(rig.kicking).toBe(true);
    expect(state.ghosts.dropped.size).toBe(1);
    const assets = rigs.counts().loaded;
    rigs.resetTransient();
    expect(rig.fistUntil).toBe(-1);
    expect(rig.flinchUntil).toBe(-1);
    expect(rig.getUpUntil).toBe(-1);
    expect(rig.squatAt).toBe(-10);
    expect(rig.kicking).toBe(false);
    expect(state.now).toBe(0);
    expect(state.ghosts.dropped.size).toBe(0);
    expect(rigs.counts().loaded).toEqual(assets);
  });
});
