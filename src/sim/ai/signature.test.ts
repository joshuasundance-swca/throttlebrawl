// Signature moves (interview, 2026-10-02: "Visible personalities"): one scripted scene per move on
// the fixture road, with only the controllers, riders and race phases running (as ai.test.ts).
// Each test pins the move's tell and its opening: what the rival does that you can read, and the
// window in which it cannot hurt you. Hits are injected as last tick's `hit` events, the way
// combat reports them, since combat does not run here.
import { describe, expect, it } from 'vitest';
import rustEvent from '../../../packs/base/events/keys-boss-mother-rust.json';
import rustRider from '../../../packs/base/riders/mother-rust.json';
import { nextFloat, streamSeed } from '../../core';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureBranchNetwork,
  fixtureNetwork,
  type RoadPos,
} from '../../road';
import { raceSystem } from '../race';
import { ridersSystem } from '../riders';
import {
  InputFlag,
  SIGNATURE_IDS,
  type SignatureId,
  type SignaturePhase,
  type SimAiPersonality,
  type SimConfig,
  type SimInput,
  type SimRiderDef,
} from '../types';
import {
  addMover,
  createWorld,
  orderSystems,
  stepWorld,
  TICK_ORDER,
  worldHash,
  type Mover,
  type SimSystem,
  type SystemName,
  type World,
} from '../world';
import { aiState, aiSystem } from './index';
import { see, weaponReach } from './sense';
import {
  BELL_TELL_TICKS,
  interruptSignature,
  signatureState,
  signatureView,
  stepSignature,
  type SignatureCtx,
} from './signature';

const noop = (name: SystemName): SimSystem => ({ name, init() {}, step() {} });
const SYSTEMS = orderSystems(
  TICK_ORDER.map((n) =>
    n === 'controllers' ? aiSystem : n === 'riders' ? ridersSystem : n === 'race' ? raceSystem : noop(n),
  ),
);

const road = createRoadNetwork(
  fixtureNetwork([
    { id: 'a', lengthM: 1600, kappa: 0 },
    { id: 'b', lengthM: 800, kappa: 0 },
  ]),
);
const route = createRouteProgress(road, {
  id: 'r',
  network: 'fixture',
  start: { road: 'a', s: 20, dir: 1 },
  finish: { road: 'b', s: 760 },
  mainPath: ['a', 'b'],
  allowedRoads: ['a', 'b'],
  closed: false,
});
const bike = {
  contentId: 'base:bike',
  topSpeedMps: 44.7,
  accelMps2: 4.9,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};

function rival(style: string, signature: SignatureId | undefined, own: SimAiPersonality = {}): SimRiderDef {
  const personality: SimAiPersonality = signature ? { ...own, signature } : own;
  return {
    contentId: `base:${signature ?? style}`,
    name: signature ?? style,
    role: 'rival',
    faction: 'rider',
    controller: { kind: 'ai', style, personality },
    bike,
    massKg: 90,
    healthMax: 100,
  };
}

const PLAYER: SimRiderDef = {
  contentId: 'base:player',
  name: 'You',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike,
  massKg: 80,
  healthMax: 100,
};

function config(riders: SimRiderDef[], signatures = 1): SimConfig {
  return {
    seed: 7,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [1],
      raceEndTimeoutTicks: 1800,
    },
    riders,
    weapons: [],
    trafficTypes: [
      {
        contentId: 'base:car',
        category: 'car',
        lengthM: 4.5,
        widthM: 1.9,
        cruiseMps: 24.6,
        hazard: 'normal',
      },
    ],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      'riders.steerScale': 1,
      'ai.paceScale': 1,
      'ai.aggressionScale': 1,
      'ai.styleQuirks': 1,
      'ai.signatures': signatures,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 0 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

interface Scene {
  world: World;
  config: SimConfig;
  riders: Mover[];
  vehicles: Mover[];
}

function scene(
  defs: SimRiderDef[],
  at: { s: number; d: number; v: number }[],
  opts: {
    signatures?: number;
    rule?: NonNullable<SimConfig['event']['grudgeRule']> | null;
    gapScale?: number;
    quirks?: number;
    vehicles?: { s: number; d: number; v: number; dir: 1 | -1 }[];
    event?: SimConfig['event'];
  } = {},
): Scene {
  const cfg = config(defs, opts.signatures ?? 1);
  if (opts.event) cfg.event = opts.event;
  if (opts.rule) cfg.event.grudgeRule = opts.rule;
  if (opts.gapScale !== undefined) cfg.event.level = { aggressionScale: 1, signatureGapScale: opts.gapScale };
  if (opts.quirks !== undefined) cfg.tuning = { ...cfg.tuning, 'ai.styleQuirks': opts.quirks };
  const world = createWorld(cfg);
  const riders = defs.map((_, i) => {
    const p = at[i] ?? { s: 30, d: 1.7, v: 0 };
    const pos: RoadPos = { edge: 0, s: p.s, d: p.d, dir: 1 };
    road.advance(pos);
    const m = addMover(world, 'rider', pos, i);
    m.speed = p.v;
    return m;
  });
  const vehicles = (opts.vehicles ?? []).map((c) => {
    const pos: RoadPos = { edge: 0, s: c.s, d: c.d, dir: c.dir };
    road.advance(pos);
    const m = addMover(world, 'vehicle', pos);
    m.speed = c.v;
    return m;
  });
  for (const s of SYSTEMS) s.init(world, cfg);
  return { world, config: cfg, riders, vehicles };
}

/** The player rides alongside `who` at `dd` metres across, matching its speed (a fight's distance). */
function shadow(sc: Scene, me: Mover, who: Mover, dd: number, lead = 0): SimInput {
  const ahead = route.progressAt(me.pos.edge, me.pos.s) - route.progressAt(who.pos.edge, who.pos.s) - lead;
  const want = who.speed - ahead * 0.8;
  const dErr = who.pos.d + dd - me.pos.d;
  return {
    steer: Math.round(Math.max(-1, Math.min(1, dErr * 0.35 - me.yaw * 2.5)) * 127),
    throttle: want > me.speed ? 255 : 60,
    brake: want < me.speed - 1.5 ? 120 : 0,
    flags: 0,
  };
}

/** The player holds its lane line at a steady speed. */
function cruise(me: Mover, d: number, v: number): SimInput {
  return {
    steer: Math.round(Math.max(-1, Math.min(1, (d - me.pos.d) * 0.3 - me.yaw * 2)) * 127),
    throttle: me.speed < v ? 220 : 90,
    brake: 0,
    flags: 0,
  };
}

function step(sc: Scene, input: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 }): void {
  for (const v of sc.vehicles) {
    v.pos.s += v.pos.dir * v.speed * (1 / 60);
    road.advance(v.pos);
  }
  stepWorld(sc.world, sc.config, SYSTEMS, [input]);
}

/** A landed hit by `actor` on `target`, as combat reports it, for the next step to read. */
function hit(sc: Scene, actor: number, target: number): void {
  sc.world.lastEvents = [
    ...sc.world.lastEvents,
    { tick: sc.world.tick - 1, type: 'hit', actor, target, data: {} },
  ];
}

const phase = (sc: Scene, id: number): SignaturePhase | null => signatureView(sc.world, id)?.phase ?? null;
const pressing = (sc: Scene, id: number): boolean =>
  ((sc.world.inputs[id]?.flags ?? 0) & InputFlag.attack) !== 0;
/** Lets the move start at once (its first roll is 10 to 20 s in). */
const now = (sc: Scene, id: number): void => {
  signatureState(sc.world).next[id] = 0;
};

describe('signature moves: the contract wire', () => {
  it('shows nothing for a rider without a move, and nothing with the switch off', () => {
    const sc = scene([rival('racer', undefined)], [{ s: 30, d: 1.7, v: 28 }]);
    for (let t = 0; t < 60 * 25; t++) step(sc);
    expect(signatureView(sc.world, 0)).toBeNull();
    const off = scene([rival('showboat', 'selfie')], [{ s: 30, d: 1.7, v: 28 }], { signatures: 0 });
    now(off, 0);
    for (let t = 0; t < 60 * 25; t++) {
      step(off);
      expect(signatureView(off.world, 0)).toBeNull();
    }
  });

  it('every move id has a scene below, and a seeded race with moves replays to the same hash', () => {
    expect(SIGNATURE_IDS.length).toBe(11);
    const run = (): number => {
      const sc = scene(
        [rival('weaver', 'lag'), rival('racer', 'pivot'), rival('showboat', 'selfie'), PLAYER],
        [
          { s: 30, d: 1.7, v: 28 },
          { s: 50, d: 0.8, v: 28 },
          { s: 70, d: 2.4, v: 28 },
          { s: 10, d: 1.7, v: 28 },
        ],
      );
      for (let t = 0; t < 60 * 40; t++) step(sc, cruise(sc.riders[3] as Mover, 1.7, 29));
      return worldHash(sc.world);
    };
    expect(run()).toBe(run());
  });
});

// Old Growth encounter spec, Automated acceptance 1–2: fixture timing and counterplay are
// deliberately separate from the authored career probe and the controller's traffic priorities.
function timberScene(opts: Parameters<typeof scene>[2] = {}): Scene {
  return scene(
    [rival('heavy-hitter', 'timber', { aggression: 0 }), PLAYER],
    [
      { s: 100, d: 1.7, v: 26 },
      { s: 120, d: 1.7, v: 26 },
    ],
    { rule: { rule: 'timber', rival: 'base:timber' }, ...opts },
  );
}

function timberTick(sc: Scene, tick: number, move: SignatureId = 'timber') {
  sc.world.tick = tick;
  const [m, me] = sc.riders as [Mover, Mover];
  const road = sc.config.road;
  const seen = see(road, m, me, 60);
  const c: SignatureCtx = {
    world: sc.world,
    road,
    m,
    riders: seen ? [seen] : [],
    obstacles: [],
    target: seen,
    players: [me.id],
    free: true,
    lastHitTick: -1,
    lastHitBy: -1,
    laneCentre: 1.7,
    laneWidth: 3.4,
    dLo: -4,
    dHi: 4,
    speedTarget: 30,
    punch: weaponReach(sc.config, 'punch'),
    kick: weaponReach(sc.config, 'kick'),
  };
  return stepSignature(c, move);
}

function pivotScene(
  opts: Parameters<typeof scene>[2] = {},
  contentId = 'region-sf:pivot',
  move: SignatureId = 'pivot',
) {
  return scene(
    [{ ...rival('racer', move, { aggression: 0, weave: 0 }), contentId }, PLAYER],
    [
      { s: 100, d: 2.4, v: 20 },
      { s: 80, d: 1, v: 20 },
    ],
    { event: { ...config([]).event, contentId: 'region-sf:sf-boss-pivot', kind: 'grudge-match' }, ...opts },
  );
}
const pivotTick = (sc: Scene, tick: number) => timberTick(sc, tick, 'pivot');

function rustScene(
  opts: Parameters<typeof scene>[2] = {},
  contentId = `base:${rustRider.id}`,
  move: SignatureId = 'ram',
) {
  return scene(
    [
      { ...rival('crew-boss', move, { aggression: rustRider.personality.aggression, weave: 0 }), contentId },
      PLAYER,
    ],
    [
      { s: 100, d: 2.8, v: 26 },
      { s: 99, d: 1, v: 26 },
    ],
    { event: { ...config([]).event, contentId: `base:${rustEvent.id}`, kind: 'grudge-match' }, ...opts },
  );
}
const rustTick = (sc: Scene, tick: number) => timberTick(sc, tick, 'ram');

describe('canonical Mother Rust encounter', () => {
  it('selects the authored event/kind/rider/move, retaining ordinary and disabled controls', () => {
    expect(rustRider.personality.signature).toBe('ram');
    expect(rustEvent.kind).toBe('grudge-match');
    const on = rustScene();
    expect(signatureState(on.world).timing?.[0]).toMatchObject({
      first: 240,
      tell: 48,
      act: 36,
      open: 90,
      gap: 480,
      spread: 180,
    });
    for (const sc of [
      rustScene({ event: config([]).event }),
      rustScene({ event: { ...config([]).event, contentId: `base:${rustEvent.id}` } }),
      rustScene({}, 'base:other'),
      rustScene({}, `base:${rustRider.id}`, 'lag'),
    ]) {
      expect(signatureState(sc.world).timing).toBeUndefined();
      expect(signatureState(sc.world).next[0]).toBeGreaterThanOrEqual(600);
    }
    for (const opts of [{ signatures: 0 }, { quirks: 0 }]) {
      const off = rustScene(opts);
      now(off, 0);
      for (let t = 0; t < 180; t++) step(off);
      expect(signatureView(off.world, 0)).toBeNull();
    }
  });

  it.each([1, 0.5])(
    'commits at act and uses exact timer/contact recovery and RNG at scale %s',
    (gapScale) => {
      for (const contact of [false, true]) {
        const sc = rustScene({ gapScale });
        const sg = signatureState(sc.world),
          rng = { s: streamSeed(sc.config.seed, 'ai.signature', 0) };
        const at = 240 + Math.floor(nextFloat(rng) * Math.round(180 * gapScale));
        expect(sg.next[0]).toBe(at);
        expect(rustTick(sc, at)).toMatchObject({ dTarget: 4, noSwing: true });
        expect(signatureView(sc.world, 0)).toMatchObject({ phase: 'tell', left: 48 / 60, targetId: 1 });
        expect(rustTick(sc, at + 48)).toMatchObject({ dTarget: 1, noSwing: true });
        (sc.riders[1] as Mover).pos.d = -1.5;
        expect(rustTick(sc, at + 49).dTarget).toBe(1);
        const opening = at + (contact ? 50 : 84);
        if (contact) (sc.riders[1] as Mover).pos.d = 2.5;
        expect(rustTick(sc, opening)).toMatchObject({ speedTarget: 26 * 0.85, noSwing: true });
        expect(signatureView(sc.world, 0)).toMatchObject({ phase: 'open', left: 90 / 60 });
        (sc.riders[0] as Mover).speed = 40;
        (sc.riders[1] as Mover).pos.s = 300;
        const before = sg.rng[0];
        expect(rustTick(sc, opening + 1)).toMatchObject({ speedTarget: 26 * 0.85, noSwing: true });
        expect(sg.rng[0]).toBe(before);
        expect(signatureView(sc.world, 0)?.phase).toBe('open');
        rustTick(sc, opening + 90);
        expect(signatureView(sc.world, 0)).toBeNull();
        expect(sg.openSpeed?.[0]).toBeUndefined();
        expect(sg.next[0]).toBe(
          opening +
            90 +
            Math.round(480 * gapScale) +
            Math.floor(nextFloat(rng) * (Math.round(180 * gapScale) + 1)),
        );
        expect(sg.rng[0]).toBe(rng.s);
      }
    },
  );

  it('ordinary ram still tracks the live target and retains its contact duration and pace', () => {
    const sc = rustScene({ event: config([]).event });
    now(sc, 0);
    rustTick(sc, 0);
    rustTick(sc, 30);
    (sc.riders[1] as Mover).pos.d = -1.5;
    expect(rustTick(sc, 31).dTarget).toBe(-1.5);
    (sc.riders[1] as Mover).pos.d = 2.5;
    expect(rustTick(sc, 32)).toEqual({ noSwing: true });
    expect(signatureView(sc.world, 0)?.left).toBe(50 / 60);
    expect(rustTick(sc, 33).speedTarget).toBe(30 * 0.95);
    expect(signatureState(sc.world).openSpeed).toBeUndefined();
  });

  it('captures the ordinary target when it is lower than actual entry speed, only once', () => {
    const sc = rustScene();
    now(sc, 0);
    rustTick(sc, 0);
    rustTick(sc, 48);
    (sc.riders[0] as Mover).speed = 40;
    expect(rustTick(sc, 84).speedTarget).toBe(30 * 0.85);
    (sc.riders[0] as Mover).speed = 10;
    expect(rustTick(sc, 85).speedTarget).toBe(30 * 0.85);
  });

  it('suppresses new recovery swings with an aggressive in-reach ordinary positive control', () => {
    const run = (selected: boolean) => {
      const sc = rustScene(selected ? {} : { signatures: 0 });
      now(sc, 0);
      rustTick(sc, 120);
      rustTick(sc, 168);
      rustTick(sc, 204);
      let presses = 0;
      for (let t = 0; t < 40; t++) {
        const [rust, me] = sc.riders as [Mover, Mover];
        me.pos = { ...rust.pos, s: rust.pos.s - 0.5, d: rust.pos.d - 1.1 };
        me.speed = rust.speed;
        step(sc);
        if (pressing(sc, 0)) presses++;
      }
      return presses;
    };
    expect(run(true)).toBe(0);
    expect(run(false)).toBeGreaterThan(0);
  });

  it('rejects acquisition range and lateral offsets with an alongside positive control', () => {
    for (const [s, d] of [
      [104, 1],
      [100, 2.5],
      [100, -1],
      [100, 1],
    ]) {
      const sc = rustScene();
      now(sc, 0);
      (sc.riders[1] as Mover).pos.s = s!;
      (sc.riders[1] as Mover).pos.d = d!;
      rustTick(sc, 0);
      expect(signatureView(sc.world, 0)?.phase ?? null).toBe(s === 100 && d === 1 ? 'tell' : null);
    }
  });

  it.each(['tell', 'act'] as const)(
    'target loss before open in %s draws only rider-owned scheduling RNG',
    (phase) => {
      const sc = rustScene({ gapScale: 0.5 });
      now(sc, 0);
      rustTick(sc, 0);
      const at = phase === 'tell' ? 1 : 49;
      if (phase === 'act') rustTick(sc, 48);
      const sg = signatureState(sc.world),
        rng = { s: sg.rng[0]! },
        other = sc.world.rng.ai.s;
      (sc.riders[1] as Mover).pos.s = 300;
      rustTick(sc, at);
      expect(signatureView(sc.world, 0)).toBeNull();
      expect(sg.next[0]).toBe(at + 240 + Math.floor(nextFloat(rng) * 91));
      expect(sg.rng[0]).toBe(rng.s);
      expect(sc.world.rng.ai.s).toBe(other);
    },
  );

  it.each(['down', 'unsticking'] as const)(
    'interrupts %s with no draw and preserves later readiness',
    (reason) => {
      for (const ph of ['tell', 'act', 'open'])
        for (const later of [false, true]) {
          const sc = rustScene({ gapScale: 0.5 });
          now(sc, 0);
          rustTick(sc, 0);
          const at = ph === 'tell' ? 0 : ph === 'act' ? 48 : 84;
          if (ph === 'open') rustTick(sc, 48);
          if (at) rustTick(sc, at);
          expect(signatureView(sc.world, 0)?.phase).toBe(ph);
          const sg = signatureState(sc.world),
            rng = sg.rng[0];
          sg.next[0] = later ? at + 999 : 0;
          if (reason === 'down') (sc.riders[0] as Mover).mode = 'Tumble';
          else aiState(sc.world).unstickUntil[0] = at + 30;
          step(sc);
          expect(signatureView(sc.world, 0)).toBeNull();
          expect(sg.openSpeed?.[0]).toBeUndefined();
          expect(sg.next[0]).toBe(at + (later ? 999 : 240));
          expect(sg.rng[0]).toBe(rng);
        }
    },
  );

  it('physically brakes, offers a pass and resumes throttle, with deterministic inputs', () => {
    const run = () => {
      const sc = rustScene();
      now(sc, 0);
      const [rust, me] = sc.riders as [Mover, Mover];
      for (let t = 0; t < 100 && phase(sc, 0) !== 'open'; t++)
        step(sc, cruise(me, phase(sc, 0) === 'act' ? -1.5 : 1, 26));
      expect(phase(sc, 0)).toBe('open');
      const at = sc.world.tick,
        speed = rust.speed,
        gap = me.pos.s - rust.pos.s;
      let braked = false;
      while (phase(sc, 0) === 'open' && sc.world.tick < at + 91) {
        step(sc, cruise(me, -1.5, 32));
        braked ||= (sc.world.inputs[0]?.brake ?? 0) > 0;
        expect(pressing(sc, 0)).toBe(false);
      }
      expect(sc.world.tick - at).toBe(90);
      expect(braked).toBe(true);
      expect(rust.speed).toBeLessThan(speed - 1);
      expect(me.pos.s - rust.pos.s).toBeGreaterThan(Math.max(0, gap + 1));
      step(sc);
      expect(sc.world.inputs[0]?.throttle).toBeGreaterThan(0);
      return worldHash(sc.world);
    };
    expect(run()).toBe(run());
  });

  it('retains later obstacle priority while the acquired lifecycle remains finite', () => {
    const plain = rustScene(),
      blocked = rustScene({ vehicles: [{ s: 109, d: 2.8, v: 0, dir: 1 }] });
    for (const sc of [plain, blocked]) {
      now(sc, 0);
      rustTick(sc, 0);
      rustTick(sc, 48);
      step(sc);
      expect(phase(sc, 0)).toBe('act');
    }
    expect(blocked.world.inputs[0]?.brake).toBeGreaterThan(plain.world.inputs[0]?.brake ?? 0);
    for (let t = 0; t < 140 && phase(blocked, 0) !== null; t++) step(blocked);
    expect(phase(blocked, 0)).toBeNull();
  });

  it('keeps shortcut navigation ahead of the ram line with a matched no-shortcut control', () => {
    const f = fixtureBranchNetwork(),
      branchRoad = createRoadNetwork(f);
    const run = (takes: boolean) => {
      const cfg = rustScene().config;
      cfg.road = branchRoad;
      cfg.route = createRouteProgress(branchRoad, f.route);
      const world = createWorld(cfg);
      const riders = [160, 159].map((s, i) => {
        const m = addMover(
          world,
          'rider',
          { edge: branchRoad.edgeIndex('a'), s, d: i === 0 ? 2.8 : 1, dir: 1 },
          i,
        );
        m.speed = 26;
        return m;
      });
      for (const system of SYSTEMS) system.init(world, cfg);
      const sc = { world, config: cfg, riders, vehicles: [] };
      aiState(world).shortcuts[0] = takes ? 1 : 0;
      now(sc, 0);
      rustTick(sc, 0);
      rustTick(sc, 48);
      step(sc);
      expect(signatureView(world, 0)?.phase).toBe('act');
      expect(signatureState(world).lineD[0]).toBe(1);
      return world.inputs[0]?.steer ?? 0;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });
});

describe('canonical Pivot encounter', () => {
  it('scopes private timing to canonical event, grudge kind, rider and signature', () => {
    const on = pivotScene();
    const rng = { s: streamSeed(on.config.seed, 'ai.signature', 0) };
    expect(signatureState(on.world).next[0]).toBe(240 + Math.floor(nextFloat(rng) * 360));
    expect(signatureState(on.world).timing?.[0]).toMatchObject({ first: 240, tell: 48, act: 45, open: 120 });
    for (const sc of [
      pivotScene({ event: config([]).event }),
      pivotScene({ event: { ...config([]).event, contentId: 'region-sf:sf-boss-pivot' } }),
      pivotScene({}, 'region-sf:other'),
      pivotScene({}, 'region-sf:pivot', 'lag'),
    ]) {
      expect(signatureState(sc.world).timing).toBeUndefined();
      expect(signatureState(sc.world).next[0]).toBeGreaterThanOrEqual(600);
    }
    for (const opts of [{ signatures: 0 }, { quirks: 0 }]) {
      const off = pivotScene(opts);
      now(off, 0);
      for (let t = 0; t < 180; t++) step(off);
      expect(signatureView(off.world, 0)).toBeNull();
    }
  });

  it.each([1, 0.5])('keeps exact readiness, phase and completion formulas at gap scale %s', (gapScale) => {
    const sc = pivotScene({ gapScale });
    const sg = signatureState(sc.world);
    const rng = { s: streamSeed(sc.config.seed, 'ai.signature', 0) };
    const start = 240 + Math.floor(nextFloat(rng) * Math.round(360 * gapScale));
    expect(sg.next[0]).toBe(start);
    expect(pivotTick(sc, start)).toEqual({ noSwing: true });
    expect(signatureView(sc.world, 0)).toMatchObject({ phase: 'tell', left: 48 / 60, targetId: -1 });
    const line = sg.lineD[0];
    expect(pivotTick(sc, start + 48)).toMatchObject({ dTarget: line, speedTarget: 34.5 });
    (sc.riders[1] as Mover).pos.d = -2.8;
    expect(pivotTick(sc, start + 49).dTarget).toBe(line);
    expect(pivotTick(sc, start + 93)).toMatchObject({ speedTarget: 17, noSwing: true });
    expect(signatureView(sc.world, 0)).toMatchObject({ phase: 'open', left: 2 });
    (sc.riders[0] as Mover).speed = 40;
    expect(pivotTick(sc, start + 94).speedTarget).toBe(17);
    expect(pivotTick(sc, start + 213)).toEqual({});
    expect(signatureView(sc.world, 0)).toBeNull();
    expect(sg.openSpeed?.[0]).toBeUndefined();
    expect(sg.next[0]).toBe(
      start +
        213 +
        Math.round(540 * gapScale) +
        Math.floor(nextFloat(rng) * (Math.round(360 * gapScale) + 1)),
    );
  });

  it('retains busy suppression, with a clear-rider positive control', () => {
    const sc = pivotScene();
    now(sc, 0);
    (sc.riders[1] as Mover).pos.s = 99;
    expect(pivotTick(sc, 0)).toEqual({});
    expect(signatureView(sc.world, 0)).toBeNull();
    (sc.riders[1] as Mover).pos.s = 80;
    expect(pivotTick(sc, 1)).toEqual({ noSwing: true });
    expect(signatureView(sc.world, 0)?.phase).toBe('tell');
  });

  it('ordinary Pivot keeps its original tell and uncapped recovery target', () => {
    const sc = pivotScene({ event: config([]).event });
    now(sc, 0);
    expect(pivotTick(sc, 0)).toEqual({});
    expect(signatureView(sc.world, 0)).toMatchObject({ phase: 'tell', left: 0.5 });
    expect(pivotTick(sc, 30)).toMatchObject({ speedTarget: 34.5 });
    expect(pivotTick(sc, 75)).toMatchObject({ speedTarget: 25.5, noSwing: true });
    expect(signatureState(sc.world).openSpeed).toBeUndefined();
    pivotTick(sc, 195);
    expect(signatureView(sc.world, 0)).toBeNull();
  });

  it('the controller suppresses new swings in tell and sag even with an aggressive rider in reach', () => {
    const run = (encounter: boolean, phase: 'tell' | 'open') => {
      const sc = pivotScene(encounter ? {} : { signatures: 0 });
      const controller = sc.config.riders[0]!.controller;
      if (controller.kind !== 'ai') throw new Error('No AI controller');
      controller.personality = { ...controller.personality, aggression: 1 };
      controller.style = 'heavy-hitter';
      now(sc, 0);
      // Swing readiness starts at tick 120; remain inside the progress-watch timeout.
      pivotTick(sc, 120);
      if (phase === 'open') {
        pivotTick(sc, 168);
        pivotTick(sc, 213);
      }
      if (encounter) expect(signatureView(sc.world, 0)?.phase).toBe(phase);
      const [pv, me] = sc.riders as [Mover, Mover];
      let presses = 0;
      for (let t = 0; t < 40; t++) {
        me.pos = { ...pv.pos, s: pv.pos.s - 0.5, d: pv.pos.d - 1.1 };
        me.speed = pv.speed;
        step(sc);
        if (pressing(sc, 0)) presses++;
      }
      return presses;
    };
    for (const phase of ['tell', 'open'] as const) {
      expect(run(true, phase)).toBe(0);
      expect(run(false, phase), phase).toBeGreaterThan(0);
    }
  });

  it('ordinary controls actually brake an early sag, resume driving and replay', () => {
    const run = () => {
      const sc = pivotScene();
      now(sc, 0);
      const pv = sc.riders[0] as Mover;
      for (let t = 0; t < 100 && phase(sc, 0) !== 'open'; t++) step(sc);
      expect(phase(sc, 0)).toBe('open');
      const at = sc.world.tick,
        speed = pv.speed;
      expect(signatureState(sc.world).openSpeed?.[0]).toBeLessThan(speed);
      let braked = false;
      for (let t = 0; t < 121 && phase(sc, 0) === 'open'; t++) {
        step(sc);
        braked ||= (sc.world.inputs[0]?.brake ?? 0) > 0;
        expect(pressing(sc, 0)).toBe(false);
      }
      expect(sc.world.tick - at).toBe(120);
      expect(braked).toBe(true);
      expect(pv.speed).toBeLessThan(speed - 1);
      step(sc);
      expect(sc.world.inputs[0]?.throttle).toBeGreaterThan(0);
      return worldHash(sc.world);
    };
    expect(run()).toBe(run());
  });

  it.each(['down', 'unsticking'] as const)(
    'interrupts %s without a random draw and preserves a later readiness',
    (reason) => {
      for (const phase of ['tell', 'act', 'open'] as const) {
        for (const later of [false, true]) {
          const sc = pivotScene({ gapScale: 0.5 });
          now(sc, 0);
          pivotTick(sc, 0);
          const at = phase === 'tell' ? 0 : phase === 'act' ? 48 : 93;
          if (phase === 'open') pivotTick(sc, 48);
          if (at > 0) pivotTick(sc, at);
          expect(signatureView(sc.world, 0)?.phase).toBe(phase);
          const sg = signatureState(sc.world);
          if (phase === 'open') expect(sg.openSpeed?.[0]).toBe(17);
          const rng = sg.rng[0];
          sg.next[0] = later ? at + 999 : 0;
          if (reason === 'down') (sc.riders[0] as Mover).mode = 'Tumble';
          else aiState(sc.world).unstickUntil[0] = at + 30;
          step(sc);
          expect(signatureView(sc.world, 0)).toBeNull();
          expect(sg.next[0]).toBe(at + (later ? 999 : 270));
          expect(sg.rng[0]).toBe(rng);
          expect(sg.openSpeed?.[0]).toBeUndefined();
          expect(pressing(sc, 0)).toBe(false);
        }
      }
    },
  );

  it('retains obstacle avoidance priority without requiring a completed swap', () => {
    const plain = pivotScene();
    const blocked = pivotScene({ vehicles: [{ s: 109, d: 2.4, v: 0, dir: 1 }] });
    for (const sc of [plain, blocked]) {
      now(sc, 0);
      pivotTick(sc, 0);
      pivotTick(sc, 48);
      step(sc);
      expect(signatureView(sc.world, 0)?.phase).toBe('act');
    }
    expect(blocked.world.inputs[0]?.brake).toBeGreaterThan(plain.world.inputs[0]?.brake ?? 0);
    const line = signatureState(blocked.world).lineD[0];
    for (let t = 0; t < 166 && phase(blocked, 0) !== null; t++) step(blocked);
    expect(signatureView(blocked.world, 0)).toBeNull();
    expect(signatureState(blocked.world).lineD[0]).toBe(line);
    expect(signatureState(blocked.world).openSpeed?.[0]).toBeUndefined();
  });
});

describe('named Timber encounter timing and counterplay', () => {
  it('selects earlier readiness only for the named Timber rival, leaving switches effective', () => {
    const on = timberScene();
    expect(signatureState(on.world).next[0]).toBeGreaterThanOrEqual(240);
    expect(signatureState(on.world).next[0]).toBeLessThan(420);
    for (const opts of [
      { rule: null },
      { rule: { rule: 'audit' as const, rival: 'base:timber' } },
      { rule: { rule: 'timber' as const, rival: 'base:other' } },
    ]) {
      const ordinary = timberScene(opts);
      expect(signatureState(ordinary.world).next[0]).toBeGreaterThanOrEqual(600);
      expect(signatureState(ordinary.world).next[0]).toBeLessThan(960);
    }
    for (const opts of [{ signatures: 0 }, { quirks: 0 }]) {
      const off = timberScene(opts);
      now(off, 0);
      for (let t = 0; t < 180; t++) step(off);
      expect(signatureView(off.world, 0)).toBeNull();
    }
    const otherMove = scene([rival('weaver', 'lag')], [{ s: 100, d: 1.7, v: 26 }], {
      rule: { rule: 'timber', rival: 'base:lag' },
    });
    expect(signatureState(otherMove.world).next[0]).toBeGreaterThanOrEqual(600);
    expect(signatureState(otherMove.world).timing).toBeUndefined();
  });

  it.each([1, 0.5])('uses one spec for every scheduling path at gap scale %s', (gapScale) => {
    const start = (sc: Scene) => {
      const t = signatureState(sc.world).next[0] ?? -1;
      timberTick(sc, t);
      expect(signatureView(sc.world, 0)).toMatchObject({ phase: 'tell', left: 48 / 60 });
      timberTick(sc, t + 48);
      expect(signatureView(sc.world, 0)).toMatchObject({ phase: 'act', left: 90 / 60 });
      return t + 48;
    };
    const nextGap = (sc: Scene, tick: number) => {
      expect(signatureState(sc.world).next[0]).toBeGreaterThanOrEqual(tick + Math.round(360 * gapScale));
      expect(signatureState(sc.world).next[0]).toBeLessThanOrEqual(tick + Math.round(540 * gapScale));
    };
    const timed = timberScene({ gapScale });
    const act = start(timed);
    timberTick(timed, act + 90);
    expect(signatureView(timed.world, 0)).toMatchObject({ phase: 'open', left: 90 / 60 });
    expect(signatureState(timed.world).openSpeed?.[0]).toBeCloseTo(26 * 0.88);
    timberTick(timed, act + 180);
    expect(signatureView(timed.world, 0)).toBeNull();
    nextGap(timed, act + 180);
    for (const d of [1.7, -1.2]) {
      const early = timberScene({ gapScale });
      const at = start(early);
      const me = early.riders[1] as Mover;
      me.pos.d = d;
      if (d === 1.7) me.pos.s = 100.5; // contact, versus a real side escape
      timberTick(early, at + 1);
      expect(signatureView(early.world, 0)).toMatchObject({ phase: 'open', left: 90 / 60 });
      expect(signatureState(early.world).openSpeed?.[0]).toBeCloseTo(26 * 0.88);
      timberTick(early, at + 91);
      nextGap(early, at + 91);
    }
    const lost = timberScene({ gapScale });
    const lostAt = start(lost);
    (lost.riders[1] as Mover).pos.s = 300;
    timberTick(lost, lostAt + 1);
    expect(signatureView(lost.world, 0)).toBeNull();
    nextGap(lost, lostAt + 1);
    const interrupted = timberScene({ gapScale });
    const downAt = start(interrupted);
    interrupted.world.tick = downAt + 1;
    interruptSignature(interrupted.world, 0);
    expect(signatureState(interrupted.world).next[0]).toBe(downAt + 1 + Math.round(360 * gapScale));
    expect(signatureView(interrupted.world, 0)).toBeNull();
    // The initial grace stays 240; only seeded spread is scaled, using the same draw.
    const initial = signatureState(timberScene().world).next[0] ?? -1;
    const fastInitial = signatureState(timberScene({ gapScale: 0.5 }).world).next[0] ?? -1;
    expect(Math.abs((initial - 240) / 2 - (fastInitial - 240))).toBeLessThanOrEqual(1);
  });

  it('commits the act line, weakly steers, then a late sidestep opens a slower no-swing recovery', () => {
    const sc = timberScene();
    const t = signatureState(sc.world).next[0] ?? -1;
    timberTick(sc, t);
    const charge = timberTick(sc, t + 48);
    expect(charge).toMatchObject({ dTarget: 1.7, lateralMax: 0.6, speedTarget: 33, noSwing: true });
    const me = sc.riders[1] as Mover;
    me.pos.d = 0.2; // late dodge within the sidestep threshold cannot move the committed line
    expect(timberTick(sc, t + 49).dTarget).toBe(1.7);
    me.pos.d = -1.2;
    const opened = timberTick(sc, t + 50);
    expect(signatureView(sc.world, 0)).toMatchObject({ phase: 'open', left: 90 / 60 });
    expect(opened.noSwing).toBe(true);
    const recovery = timberTick(sc, t + 51);
    expect(recovery.noSwing).toBe(true);
    expect(recovery.speedTarget).toBeCloseTo(26 * 0.88);
    (sc.riders[0] as Mover).speed = 40;
    expect(timberTick(sc, t + 52).speedTarget).toBeCloseTo(26 * 0.88);
    timberTick(sc, t + 140);
    expect(signatureView(sc.world, 0)).toBeNull();
    expect(signatureState(sc.world).openSpeed?.[0]).toBeUndefined();
    for (const ahead of [4, 31, 200]) {
      const away = timberScene();
      (away.riders[1] as Mover).pos.s = 100 + ahead;
      timberTick(away, signatureState(away.world).next[0] ?? -1);
      expect(signatureView(away.world, 0)).toBeNull();
    }
  });

  it('ordinary Timber keeps its existing recovery pace without an encounter cap', () => {
    const sc = timberScene({ rule: null });
    now(sc, 0);
    timberTick(sc, 0);
    timberTick(sc, 40);
    timberTick(sc, 130);
    expect(timberTick(sc, 131)).toMatchObject({ speedTarget: 26.4, noSwing: true });
    expect(signatureState(sc.world).openSpeed).toBeUndefined();
  });

  it('lets the controller prioritize traffic over the charge line, separately from counterplay', () => {
    const plain = timberScene();
    const blocked = timberScene({ vehicles: [{ s: 109, d: 1.7, v: 0, dir: 1 }] });
    for (const sc of [plain, blocked]) {
      now(sc, 0);
      timberTick(sc, 0);
      timberTick(sc, 48);
      expect(signatureView(sc.world, 0)?.phase).toBe('act');
      step(sc, { steer: 0, throttle: 150, brake: 0, flags: 0 });
    }
    expect(Math.abs(blocked.world.inputs[0]?.steer ?? 0)).toBeGreaterThan(
      Math.abs(plain.world.inputs[0]?.steer ?? 0),
    );
    expect(blocked.world.inputs[0]?.brake).toBeGreaterThan(plain.world.inputs[0]?.brake ?? 0);
    expect(signatureState(blocked.world).lineD[0]).toBe(1.7);
    expect(signatureView(blocked.world, 0)?.phase).toBe('act');
  });

  it('keeps shortcut navigation ahead of a committed charge line', () => {
    const f = fixtureBranchNetwork();
    const branchRoad = createRoadNetwork(f);
    const cfg = config([rival('heavy-hitter', 'timber', { aggression: 0 }), PLAYER]);
    cfg.event.grudgeRule = { rule: 'timber', rival: 'base:timber' };
    cfg.road = branchRoad;
    cfg.route = createRouteProgress(branchRoad, f.route);
    const world = createWorld(cfg);
    const riders = [160, 180].map((s, i) => {
      const m = addMover(world, 'rider', { edge: branchRoad.edgeIndex('a'), s, d: 1.7, dir: 1 }, i);
      m.speed = 26;
      return m;
    });
    for (const s of SYSTEMS) s.init(world, cfg);
    const sc = { world, config: cfg, riders, vehicles: [] };
    aiState(world).shortcuts[0] = 1;
    now(sc, 0);
    timberTick(sc, 0);
    timberTick(sc, 48);
    expect(signatureState(world).lineD[0]).toBe(1.7);
    stepWorld(world, cfg, SYSTEMS, [{ steer: 0, throttle: 150, brake: 0, flags: 0 }]);
    expect(signatureView(world, 0)?.phase).toBe('act');
    expect(world.inputs[0]?.steer).toBeGreaterThan(0);
    // Taking the branch asks for its line (>2.4), while the stored charge line stays put.
    expect(signatureState(world).lineD[0]).toBe(1.7);
    aiState(world).shortcuts[0] = 0;
    (riders[0] as Mover).yaw = 0;
    (riders[0] as Mover).pos.d = 1.7;
    stepWorld(world, cfg, SYSTEMS, [{ steer: 0, throttle: 150, brake: 0, flags: 0 }]);
    expect(world.inputs[0]?.steer).toBeLessThanOrEqual(0);
  });

  it.each([
    ['down', 'act'],
    ['unsticking', 'act'],
    ['down', 'open'],
    ['unsticking', 'open'],
  ])('the controller interrupts %s during %s with the encounter gap', (reason, phase) => {
    const sc = timberScene({ gapScale: 0.5 });
    now(sc, 0);
    timberTick(sc, 0);
    timberTick(sc, 48);
    const tick = phase === 'open' ? 138 : 48;
    if (phase === 'open') {
      timberTick(sc, tick);
      expect(signatureState(sc.world).openSpeed?.[0]).toBeCloseTo(26 * 0.88);
    }
    if (reason === 'down') (sc.riders[0] as Mover).mode = 'Tumble';
    else aiState(sc.world).unstickUntil[0] = tick + 30;
    step(sc);
    expect(signatureView(sc.world, 0)).toBeNull();
    expect(signatureState(sc.world).next[0]).toBe(tick + 180);
    expect(signatureState(sc.world).openSpeed?.[0]).toBeUndefined();
    expect(pressing(sc, 0)).toBe(false);
  });
});

describe('signature moves: the tell and the opening', () => {
  it('Chad (selfie): phone up, then 3 s no-hands on a straight line, and no swing at a player alongside', () => {
    const on = scene(
      [rival('showboat', 'selfie'), PLAYER],
      [
        { s: 100, d: 1.7, v: 28 },
        { s: 40, d: 1.7, v: 28 },
      ],
    );
    const [chad, me] = on.riders as [Mover, Mover];
    now(on, 0);
    step(on);
    expect(phase(on, 0)).toBe('tell');
    while (phase(on, 0) === 'tell') step(on, cruise(me, 1.7, 28));
    expect(phase(on, 0)).toBe('act');
    // The player pulls up beside him (a metre back) while he films.
    me.pos = { ...chad.pos, s: chad.pos.s - 1, d: chad.pos.d - 1.1 };
    me.speed = chad.speed;
    const line = chad.pos.d;
    let actTicks = 0;
    let swings = 0;
    let drift = 0;
    while (phase(on, 0) === 'act') {
      step(on, shadow(on, me, chad, -1.1, -1));
      actTicks++;
      if (pressing(on, 0)) swings++;
      drift = Math.max(drift, Math.abs(chad.pos.d - line));
    }
    expect(actTicks).toBeGreaterThanOrEqual(170);
    expect(actTicks).toBeLessThanOrEqual(181);
    expect(swings).toBe(0);
    expect(drift).toBeLessThan(0.5);

    // The same beat with the moves off: he swings at the player beside him (a showboat never
    // swings at the race leader, so the player sits a metre behind).
    const off = scene(
      [rival('showboat', 'selfie'), PLAYER],
      [
        { s: 100, d: 1.7, v: 28 },
        { s: 99, d: 0.6, v: 28 },
      ],
      { signatures: 0 },
    );
    let offSwings = 0;
    for (let t = 0; t < 180; t++) {
      step(off, shadow(off, off.riders[1] as Mover, off.riders[0] as Mover, -1.1, -1));
      if (pressing(off, 0)) offSwings++;
    }
    expect(offSwings).toBeGreaterThan(0);
  });

  it('Chad (selfie): a hit drops the act early', () => {
    const sc = scene(
      [rival('showboat', 'selfie'), PLAYER],
      [
        { s: 100, d: 1.7, v: 28 },
        { s: 40, d: 1.7, v: 28 },
      ],
    );
    now(sc, 0);
    while (phase(sc, 0) !== 'act') step(sc, cruise(sc.riders[1] as Mover, 1.7, 28));
    for (let t = 0; t < 30; t++) step(sc, cruise(sc.riders[1] as Mover, 1.7, 28));
    hit(sc, 1, 0);
    step(sc, cruise(sc.riders[1] as Mover, 1.7, 28));
    expect(phase(sc, 0)).toBe('open');
  });

  it('the Mayor (wave): waves at traffic and drifts over the centre line, swinging at nobody', () => {
    const traffic = { vehicles: [{ s: 260, d: 1.7, v: 29, dir: 1 as const }] };
    const run = (signatures: number) => {
      const sc = scene([rival('crowd-pleaser', 'wave')], [{ s: 30, d: 1.7, v: 28 }], {
        ...traffic,
        signatures,
      });
      if (signatures) now(sc, 0);
      const [mayor] = sc.riders as [Mover];
      let minD = Infinity;
      let acts = 0;
      for (let t = 0; t < 60 * 5; t++) {
        step(sc);
        minD = Math.min(minD, mayor.pos.d);
        if (phase(sc, 0) === 'act') acts++;
        if (phase(sc, 0) !== null) expect(pressing(sc, 0)).toBe(false);
      }
      return { minD, acts };
    };
    const on = run(1);
    const off = run(0);
    expect(on.acts).toBeGreaterThan(100);
    expect(on.minD).toBeLessThan(0); // into the oncoming lane (d < 0 riding toward +s)
    expect(off.minD).toBeGreaterThan(0);
  });

  it('Gus (bell): the bell swings for 0.4 s before every swing he throws', () => {
    const sc = scene(
      [rival('heavy-hitter', 'bell'), PLAYER],
      [
        { s: 30, d: 1.7, v: 28 },
        { s: 60, d: 1.7, v: 28 },
      ],
    );
    const [, me] = sc.riders as [Mover, Mover];
    const st = aiState(sc.world);
    let lastPress = st.pressTick[0] ?? -1;
    let swings = 0;
    let tellRun = 0;
    for (let t = 0; t < 60 * 25; t++) {
      const before = phase(sc, 0);
      tellRun = before === 'tell' ? tellRun + 1 : 0;
      step(sc, cruise(me, 1.7, 28));
      const press = st.pressTick[0] ?? -1;
      if (press >= 0 && press !== lastPress) {
        swings++;
        // The swing is pressed on the tick the bell's tell runs out.
        expect(tellRun).toBe(BELL_TELL_TICKS);
        expect(phase(sc, 0)).toBe('act');
      }
      lastPress = press;
    }
    expect(swings).toBeGreaterThan(2);
  });

  it('Kevin (counter): hit him from behind and he brakes level, then counters', () => {
    const sc = scene(
      [rival('grudge-keeper', 'counter'), PLAYER],
      [
        { s: 104, d: 1.7, v: 28 },
        { s: 100, d: 0.6, v: 28 },
      ],
    );
    const [kevin, me] = sc.riders as [Mover, Mover];
    const st = aiState(sc.world);
    step(sc, cruise(me, 0.6, 28));
    hit(sc, 1, 0);
    step(sc, cruise(me, 0.6, 28));
    expect(phase(sc, 0)).toBe('tell');
    expect(signatureView(sc.world, 0)?.targetId).toBe(1);
    let braked = 0;
    let countered = -1;
    const presses0 = st.presses[0] ?? 0;
    for (let t = 0; t < 120 && countered < 0; t++) {
      step(sc, cruise(me, 0.6, 28));
      if ((sc.world.inputs[0]?.brake ?? 0) > 0) braked++;
      if ((st.presses[0] ?? 0) > presses0) countered = t;
    }
    expect(braked).toBeGreaterThan(0);
    expect(countered).toBeGreaterThanOrEqual(0);
    expect(countered).toBeLessThan(80);
    // Then the paperwork: an opening with no swings.
    while (phase(sc, 0) === 'act') step(sc, cruise(me, 0.6, kevin.speed));
    expect(phase(sc, 0)).toBe('open');
    while (phase(sc, 0) === 'open') {
      step(sc, cruise(me, 0.6, kevin.speed));
      expect(pressing(sc, 0) && st.pressTick[0] === sc.world.tick - 1).toBe(false);
    }
  });

  it('Dial-Up (lag): a twitch, then a dead throttle (no brake, no swing), then a lurch', () => {
    const sc = scene([rival('weaver', 'lag', { weave: 0 })], [{ s: 30, d: 1.7, v: 30 }]);
    const [dial] = sc.riders as [Mover];
    for (let t = 0; t < 120; t++) step(sc);
    now(sc, 0);
    step(sc);
    expect(phase(sc, 0)).toBe('tell');
    const d0 = dial.pos.d;
    let twitch = 0;
    while (phase(sc, 0) === 'tell') {
      step(sc);
      twitch = Math.max(twitch, Math.abs(dial.pos.d - d0));
    }
    expect(twitch).toBeGreaterThan(0.2);
    const v0 = dial.speed;
    let frozen = 0;
    while (phase(sc, 0) === 'act') {
      const input = sc.world.inputs[0];
      expect(input?.throttle).toBe(0);
      expect(input?.brake).toBe(0);
      expect(pressing(sc, 0)).toBe(false);
      frozen++;
      step(sc);
    }
    expect(frozen).toBeGreaterThan(40);
    expect(dial.speed).toBeLessThan(v0);
    expect(phase(sc, 0)).toBe('open');
    step(sc);
    expect(sc.world.inputs[0]?.throttle ?? 0).toBeGreaterThan(200);
  });

  it('Mother Rust (ram): swings wide from her target, then rams across into it', () => {
    const sc = scene(
      [rival('crew-boss', 'ram'), PLAYER],
      [
        { s: 100, d: 2.8, v: 28 },
        { s: 100, d: 1.0, v: 28 },
      ],
    );
    const [rust, me] = sc.riders as [Mover, Mover];
    for (let t = 0; t < 30; t++) step(sc, shadow(sc, me, rust, -1.8));
    now(sc, 0);
    let wide = 0;
    let closest = Infinity;
    let started = false;
    for (let t = 0; t < 240; t++) {
      step(sc, cruise(me, 1.0, rust.speed));
      const p = phase(sc, 0);
      if (p === 'tell') {
        started = true;
        wide = Math.max(wide, Math.abs(rust.pos.d - me.pos.d));
      }
      if (p === 'act') closest = Math.min(closest, Math.abs(rust.pos.d - me.pos.d));
      if (started && p === 'open') break;
    }
    expect(started).toBe(true);
    expect(wide).toBeGreaterThan(2);
    expect(closest).toBeLessThan(1.2);
  });

  it('Deacon (slow burn): calm until hit three times, then relentless', () => {
    const at = [
      { s: 100, d: 2.8, v: 28 },
      { s: 100, d: 1.7, v: 28 },
    ];
    const sc = scene([rival('heavy-hitter', 'slow-burn'), PLAYER], at);
    const [deacon, me] = sc.riders as [Mover, Mover];
    const st = aiState(sc.world);
    for (let t = 0; t < 60 * 6; t++) step(sc, shadow(sc, me, deacon, -1.1));
    expect(st.presses[0] ?? 0).toBe(0);
    expect(phase(sc, 0)).toBeNull();
    hit(sc, 1, 0);
    step(sc, shadow(sc, me, deacon, -1.1));
    expect(phase(sc, 0)).toBe('tell'); // simmering
    for (let t = 0; t < 60 * 3; t++) step(sc, shadow(sc, me, deacon, -1.1));
    expect(st.presses[0] ?? 0).toBe(0);
    hit(sc, 1, 0);
    step(sc, shadow(sc, me, deacon, -1.1));
    hit(sc, 1, 0);
    step(sc, shadow(sc, me, deacon, -1.1));
    expect(phase(sc, 0)).toBe('act'); // relentless
    expect(signatureView(sc.world, 0)?.left).toBe(-1);
    for (let t = 0; t < 60 * 6; t++) step(sc, shadow(sc, me, deacon, -1.1));
    expect(st.presses[0] ?? 0).toBeGreaterThan(2);

    // With the moves off, the same heavy hitter swings at a player beside him from the start.
    const off = scene([rival('heavy-hitter', 'slow-burn'), PLAYER], at, { signatures: 0 });
    for (let t = 0; t < 60 * 6; t++)
      step(off, shadow(off, off.riders[1] as Mover, off.riders[0] as Mover, -1.1));
    expect(aiState(off.world).presses[0] ?? 0).toBeGreaterThan(0);
  });

  it('Tammy (sweet talk): rides beside you being nice for 1.5 s, then shoves with a kick', () => {
    const sc = scene(
      [rival('scrapper', 'sweet-talk'), PLAYER],
      [
        { s: 96, d: 2.8, v: 28 },
        { s: 100, d: 1.2, v: 28 },
      ],
    );
    const [tammy, me] = sc.riders as [Mover, Mover];
    now(sc, 0);
    step(sc, cruise(me, 1.2, 28));
    expect(phase(sc, 0)).toBe('tell');
    let tellTicks = 0;
    while (phase(sc, 0) === 'tell') {
      expect(pressing(sc, 0)).toBe(false);
      step(sc, cruise(me, 1.2, 28));
      tellTicks++;
    }
    expect(tellTicks).toBeGreaterThanOrEqual(85);
    expect(Math.abs(tammy.pos.d - me.pos.d)).toBeLessThan(2.2);
    let kicked = false;
    for (let t = 0; t < 60 && !kicked; t++) {
      step(sc, cruise(me, 1.2, 28));
      const f = sc.world.inputs[0]?.flags ?? 0;
      if ((f & InputFlag.attack) !== 0 && (f & InputFlag.kick) !== 0) kicked = true;
    }
    expect(kicked).toBe(true);
  });

  it('Tammy (sweet talk): hit her mid-chat and she shoves at once', () => {
    const sc = scene(
      [rival('scrapper', 'sweet-talk'), PLAYER],
      [
        { s: 100, d: 2.6, v: 28 },
        { s: 100, d: 1.2, v: 28 },
      ],
    );
    const [, me] = sc.riders as [Mover, Mover];
    now(sc, 0);
    for (let t = 0; t < 20; t++) step(sc, cruise(me, 1.2, 28));
    expect(phase(sc, 0)).toBe('tell');
    hit(sc, 1, 0);
    step(sc, cruise(me, 1.2, 28));
    expect(phase(sc, 0)).toBe('act');
  });

  it('Juniper (cut-in): cuts into the line of the rider behind her, then brake-checks', () => {
    const sc = scene(
      [rival('weaver', 'cut-in', { weave: 0 }), PLAYER],
      [
        { s: 110, d: 3.0, v: 28 },
        { s: 100, d: 0.6, v: 28 },
      ],
    );
    const [jun, me] = sc.riders as [Mover, Mover];
    now(sc, 0);
    let inLineAhead = false;
    let braked = false;
    for (let t = 0; t < 200; t++) {
      step(sc, cruise(me, 0.6, 28));
      const p = phase(sc, 0);
      const ahead = route.progressAt(jun.pos.edge, jun.pos.s) - route.progressAt(me.pos.edge, me.pos.s);
      if (p === 'act' && Math.abs(jun.pos.d - me.pos.d) < 0.8 && ahead > 0) inLineAhead = true;
      if (p === 'act' && (sc.world.inputs[0]?.brake ?? 0) > 0) braked = true;
    }
    expect(inLineAhead).toBe(true);
    expect(braked).toBe(true);
  });

  it('Old Growth (timber): head down, then charges the rider ahead in his line, then is winded', () => {
    const sc = scene(
      [rival('heavy-hitter', 'timber', { aggression: 0 }), PLAYER],
      [
        { s: 100, d: 1.7, v: 26 },
        { s: 115, d: 1.7, v: 26 },
      ],
    );
    const [og, me] = sc.riders as [Mover, Mover];
    now(sc, 0);
    step(sc, cruise(me, 1.7, 26));
    expect(phase(sc, 0)).toBe('tell');
    let fastest = 0;
    let opened = false;
    for (let t = 0; t < 240 && !opened; t++) {
      step(sc, cruise(me, 1.7, 26));
      if (phase(sc, 0) === 'act') fastest = Math.max(fastest, og.speed - me.speed);
      opened = phase(sc, 0) === 'open';
    }
    expect(fastest).toBeGreaterThan(3);
    expect(opened).toBe(true);
  });

  it('Pivot (pivot): the blinker, a swap to the other side with a burst, then the battery sags', () => {
    const sc = scene([rival('racer', 'pivot', { weave: 0 })], [{ s: 30, d: 2.4, v: 30 }]);
    const [pv] = sc.riders as [Mover];
    for (let t = 0; t < 120; t++) step(sc);
    now(sc, 0);
    step(sc);
    expect(phase(sc, 0)).toBe('tell');
    while (phase(sc, 0) === 'tell') step(sc);
    const d0 = pv.pos.d;
    let swap = 0;
    let burst = 0;
    while (phase(sc, 0) === 'act') {
      step(sc);
      swap = Math.max(swap, Math.abs(pv.pos.d - d0));
      burst = Math.max(burst, pv.speed);
    }
    expect(swap).toBeGreaterThan(1.5);
    let sag = Infinity;
    while (phase(sc, 0) === 'open') {
      step(sc);
      sag = Math.min(sag, pv.speed);
    }
    expect(sag).toBeLessThan(burst - 2);
  });
});
