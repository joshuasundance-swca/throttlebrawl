// Run W-T, the pitch deck's #4 part 2, "the road fights back": roadside smashables. Placement on
// a straight fixture road with a sand verge each side; riding through one (a wobble, never a crash);
// a kick into one (a crash, a `smash` naming the takedown, then combat's `scenery` takedown and its
// slow motion); and the switch off. Driven by sim ticks only.
import { describe, expect, it } from 'vitest';
import { createRng } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type BakedVerge } from '../../road';
import { F, flags, makeHarness, ofType, scriptOf } from '../combat/harness.test-util';
import { createSimWithWorld } from '../create';
import { OFF_ROAD_PARAM } from '../ground';
import { riderState } from '../riders';
import { input, STRAIGHT, testConfig } from '../riders/testing';
import type { SimConfig, SimEvent, SimSmashableDef } from '../types';
import { buildCorridor } from '../traffic';
import { worldHash, type SimSystem, type World } from '../world';
import { KIND_SPEC, SMASH, SMASH_DENSITY, smashState, withSmashables, type SmashState } from './index';

/** The fixture's lanes end at d ±4.9 (3.4 m drive lanes and 1.5 m shoulders each side). */
const LANE_EDGE = 4.9;
const BAND_M = 6;

const MAILBOX: SimSmashableDef = {
  contentId: 'base:region/test#return-to-sender',
  kind: 'mailbox',
  name: 'RETURN TO SENDER',
  weight: 2,
  tags: [],
};
/** Tagged for marinas: the fixture road has no tags, so it never stands there. */
const TRAPS: SimSmashableDef = {
  contentId: 'base:region/test#catch-of-the-day',
  kind: 'lobster-traps',
  name: 'CATCH OF THE DAY',
  weight: 3,
  tags: ['marina'],
};

function smashConfig(
  opts: { seed?: number; tuning?: Record<string, number>; band?: number } = {},
): SimConfig {
  const verge: BakedVerge = { widthM: opts.band ?? BAND_M, surface: 'sand', edge: 'soft' };
  const bundle = fixtureNetwork(STRAIGHT);
  const roads = bundle.roads.map((r) => ({
    ...r,
    laneSections: r.laneSections.map((sec) => ({ ...sec, verges: { left: verge, right: verge } })),
  }));
  const road = createRoadNetwork({ network: bundle.network, roads });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 2980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  const base = testConfig({ tuning: { [OFF_ROAD_PARAM]: 1, [SMASH_DENSITY]: 1, ...opts.tuning } });
  return { ...base, seed: opts.seed ?? base.seed, road, route, smashables: [MAILBOX, TRAPS] };
}

/** Builds a race and steps it once (placement happens on the first tick). */
function placed(config: SimConfig): { world: World; st: SmashState | null; step: (n: number) => SimEvent[] } {
  const { sim, world } = createSimWithWorld(config);
  const step = (n: number) => {
    const out: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
      sim.step([input(0)]);
      out.push(...sim.events());
    }
    return out;
  };
  step(1);
  return { world, st: smashState(world), step };
}

const layout = (st: SmashState | null) =>
  (st?.props ?? []).map((q) => `${q.def}@${q.u.toFixed(2)},${q.cd.toFixed(2)}`);

describe('smashables: placement beside the road', () => {
  it('stands rows on the verge band, clear of the lanes, of the kinds the road tags allow', () => {
    const { st } = placed(smashConfig());
    const props = st?.props ?? [];
    const clusters = new Set(props.map((q) => Math.round(q.u / 20))).size;
    console.log(`[examined] ${props.length} smashables in about ${clusters} clusters on 2940 m of route`);
    // A cluster every 75 to 225 m of the 2800 m between the grid and the finish clearances.
    expect(clusters).toBeGreaterThanOrEqual(10);
    expect(clusters).toBeLessThanOrEqual(30);
    const spec = KIND_SPEC.mailbox;
    for (const q of props) {
      expect(q.def).toBe(0); // mailboxes only: the traps want a marina
      const off = Math.abs(q.cd) - LANE_EDGE;
      expect(off).toBeCloseTo(SMASH.gapM + spec.halfAcross, 6);
      expect(off + spec.halfAcross).toBeLessThanOrEqual(BAND_M);
      expect(q.u).toBeGreaterThan(40 + SMASH.startClearM - 1);
      expect(q.smashedTick).toBe(-1);
    }
    expect(props.some((q) => q.cd < 0)).toBe(true);
    expect(props.some((q) => q.cd > 0)).toBe(true);
  });

  it('lays the same rows for the same seed, others for another, and more at a higher density', () => {
    const a = layout(placed(smashConfig({ seed: 11 })).st);
    expect(layout(placed(smashConfig({ seed: 11 })).st)).toEqual(a);
    expect(layout(placed(smashConfig({ seed: 12 })).st)).not.toEqual(a);
    const dense = placed(smashConfig({ seed: 11, tuning: { [SMASH_DENSITY]: 2 } })).st?.props.length ?? 0;
    console.log(`[examined] seed 11: ${a.length} at density 1, ${dense} at density 2`);
    expect(dense).toBeGreaterThan(a.length * 1.4);
  });

  it('puts none where the band is too narrow to stand one', () => {
    expect(placed(smashConfig({ band: 1 })).st?.props).toEqual([]);
  });

  it('is off at density 0 and when the tuning leaves the switch out (recordings made before)', () => {
    const off = smashConfig({ tuning: { [SMASH_DENSITY]: 0 } });
    expect(placed(off).st).toBeNull();
    const before = smashConfig();
    const tuning: Record<string, number> = { ...before.tuning };
    delete tuning[SMASH_DENSITY];
    const old = placed({ ...before, tuning });
    expect(old.st).toBeNull();
    const none = placed({ ...before, tuning, smashables: [] });
    old.step(300);
    none.step(300);
    expect(worldHash(old.world)).toBe(worldHash(none.world));
  });
});

describe('smashables: riding through one', () => {
  it('smashes it with a wobble and a little speed lost, never a crash, and the snapshot shows the wreck', () => {
    const config = smashConfig();
    const { sim, world } = createSimWithWorld(config);
    sim.step([input(0)]);
    const st = smashState(world);
    const q = st?.props.find((p) => p.cd > 0);
    if (!st || !q) throw new Error('no smashable on the right');
    const rider = world.movers[0];
    if (!rider) throw new Error('no rider');
    rider.pos = { edge: 0, s: q.u - 15, d: q.cd, dir: 1 };
    rider.speed = 20;
    const events: SimEvent[] = [];
    let speedBefore = 0;
    for (let t = 0; t < 90; t++) {
      speedBefore = rider.speed;
      sim.step([input(0.4)]);
      events.push(...sim.events());
      if (ofType(events, 'smash').length > 0) break;
    }
    const smash = ofType(events, 'smash')[0];
    expect(smash?.actor).toBe(rider.id);
    expect(smash?.data).toMatchObject({
      prop: q.id,
      kind: 'mailbox',
      name: 'RETURN TO SENDER',
      takedown: false,
    });
    expect(ofType(events, 'wobble').some((e) => e.data['cause'] === 'smash')).toBe(true);
    expect(rider.speed).toBeLessThan(speedBefore);
    for (let t = 0; t < 60; t++) {
      sim.step([input(0.4)]);
      events.push(...sim.events());
    }
    expect(ofType(events, 'crash')).toHaveLength(0);
    const snap = sim.snapshot().smashables?.find((p) => p.id === q.id);
    expect(snap?.smashedTick).toBe(q.smashedTick);
    expect(snap?.name).toBe('RETURN TO SENDER');
    expect(Math.hypot(snap?.hitVx ?? 0, snap?.hitVz ?? 0)).toBeGreaterThan(5);
    console.log(
      `[examined] rode through prop ${q.id}: ${ofType(events, 'smash').length} smashed, 0 crashes, speed ${speedBefore.toFixed(1)} -> ${rider.speed.toFixed(1)} m/s`,
    );
  });
});

describe('smashables: a rider in the air clears one only above its height (the hitbox audit)', () => {
  // In the air 3 m short of a mailbox (drawn 1.55 m tall), at `h`, level for the 0.15 s across it.
  const flyOver = (h: number) => {
    const config = smashConfig();
    const { sim, world } = createSimWithWorld(config);
    sim.step([input(0)]);
    const q = smashState(world)?.props.find((p) => p.cd > 0);
    const rider = world.movers[0];
    if (!q || !rider) throw new Error('no smashable or rider');
    rider.pos = { edge: 0, s: q.u - 3, d: q.cd, dir: 1 };
    rider.speed = 20;
    rider.mode = 'Airborne';
    rider.h = h;
    const rs = riderState(world);
    rs.yAbs[rider.id] = config.road.surfaceHeight(0, rider.pos.s, rider.pos.d) + h;
    rs.vy[rider.id] = 1.5;
    rs.airTicks[rider.id] = 0;
    const events: SimEvent[] = [];
    for (let t = 0; t < 12; t++) {
      sim.step([input(0)]);
      events.push(...sim.events());
    }
    return { events, q, h: rider.h };
  };

  it('at 1.2 m (above the old flat 0.8 m, under the mailbox’s 1.55 m) it smashes it', () => {
    const { events, q, h } = flyOver(1.2);
    console.log(`[examined] at 1.2 m: ${ofType(events, 'smash').length} smashed, ended at h ${h.toFixed(2)}`);
    expect(ofType(events, 'smash')[0]?.data).toMatchObject({ prop: q.id, kind: 'mailbox' });
  });

  it('control: at 1.7 m, above the mailbox, it flies over untouched', () => {
    const { events, q } = flyOver(1.7);
    expect(ofType(events, 'smash')).toEqual([]);
    expect(q.smashedTick).toBe(-1);
  });
});

/** Tumble's hand-off, crudely (combat's own tests do the same): a crashed rider goes down. */
const tumble: SimSystem = {
  name: 'tumble',
  init() {},
  step(w) {
    for (const e of w.events) {
      const m = w.movers[e.actor];
      if (e.type === 'crash' && m && (m.mode === 'Road' || m.mode === 'Airborne')) m.mode = 'Tumble';
    }
  },
};
const peds = withSmashables({ name: 'peds', init() {}, step() {} });

/**
 * Player (0) left of rival (1), 1.2 m apart, standing; a kick on tick 0 lands on tick 13 and shoves
 * the rival 3.6 m right. A mailbox stands at d `boxD` beside him (hand-placed: the harness road has
 * no verge), or none.
 */
function kickInto(boxD: number | null, kick = true) {
  const h = makeHarness(
    [
      { s: 100, d: -3, role: 'player' },
      { s: 100, d: -1.8 },
    ],
    scriptOf({ 0: (t) => (kick && t === 0 ? flags(F.attack | F.kick) : undefined) }),
    { [SMASH_DENSITY]: 1 },
    [],
    { systems: { peds, tumble }, slowMo: true },
  );
  h.config.smashables = [MAILBOX];
  const st: SmashState = {
    rng: createRng(1),
    corridor: buildCorridor(h.config),
    props: [],
    struckBy: [-1, -1],
    struckTick: [-1, -1],
  };
  if (boxD !== null)
    st.props.push({
      id: 1,
      def: 0,
      u: 100,
      cd: boxD,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      smashedTick: -1,
      hitVx: 0,
      hitVz: 0,
    });
  h.world.systems['smash'] = st;
  const events = h.run(90);
  return { h, events, st };
}

describe('smashables: kicked into one (a named takedown)', () => {
  it('puts the rider down, names the takedown for the kicker, and combat credits it with the slow motion', () => {
    const { events, st } = kickInto(1.2);
    const crash = ofType(events, 'crash')[0];
    expect(crash?.actor).toBe(1);
    expect(crash?.data).toMatchObject({ cause: 'smash', object: 'mailbox' });
    expect(Number(crash?.data['sideMps'])).toBeGreaterThan(0); // thrown on toward the box, to his right
    const smash = ofType(events, 'smash')[0];
    expect(smash).toMatchObject({ actor: 0, target: 1, causeId: crash?.causeId });
    expect(smash?.data).toMatchObject({ name: 'RETURN TO SENDER', takedown: true, kind: 'mailbox' });
    const takedown = ofType(events, 'takedown')[0];
    expect(takedown).toMatchObject({ actor: 0, target: 1, causeId: crash?.causeId });
    expect(takedown?.data['kind']).toBe('scenery');
    expect(takedown?.tick).toBe((crash?.tick ?? 0) + 1);
    expect(ofType(events, 'slowmoStart')).toHaveLength(1);
    expect(st.props[0]?.smashedTick).toBe(crash?.tick);
    console.log(
      `[examined] kick on tick 0: crash tick ${crash?.tick}, smash '${smash?.data['name']}', takedown kind ${takedown?.data['kind']}, slow motion ${ofType(events, 'slowmoStart').length}`,
    );
  });

  it('with no kick nobody goes down, and with no box the kick is no takedown', () => {
    const still = kickInto(-1.2, false);
    expect(ofType(still.events, 'crash')).toHaveLength(0);
    expect(ofType(still.events, 'takedown')).toHaveLength(0);
    const open = kickInto(null);
    expect(ofType(open.events, 'kick')).toHaveLength(1);
    expect(ofType(open.events, 'crash')).toHaveLength(0);
    expect(ofType(open.events, 'smash')).toHaveLength(0);
  });

  it('forgets the kick after the knock window: met 1.5 s later, the box only wobbles him', () => {
    const { h, st } = kickInto(null);
    const rival = h.world.movers[1];
    if (!rival) throw new Error('no rival');
    // 90 ticks after the kick press (it landed on 13), a box turns up right where he stands.
    st.props.push({
      id: 2,
      def: 0,
      u: rival.pos.s,
      cd: rival.pos.d,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      smashedTick: -1,
      hitVx: 0,
      hitVz: 0,
    });
    const later = h.run(2);
    console.log(
      `[examined] a box met on tick ${h.world.tick}, after the kick: ${ofType(later, 'crash').length} crashes, ${ofType(later, 'wobble').length} wobbles`,
    );
    expect(ofType(later, 'crash')).toHaveLength(0);
    expect(ofType(later, 'smash')[0]?.data['takedown']).toBe(false);
    expect(ofType(later, 'wobble').some((e) => e.data['cause'] === 'smash')).toBe(true);
  });
});
