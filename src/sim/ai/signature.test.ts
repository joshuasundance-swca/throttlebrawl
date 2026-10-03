// Signature moves (interview, 2026-10-02: "Visible personalities"): one scripted scene per move on
// the fixture road, with only the controllers, riders and race phases running (as ai.test.ts).
// Each test pins the move's tell and its opening: what the rival does that you can read, and the
// window in which it cannot hurt you. Hits are injected as last tick's `hit` events, the way
// combat reports them, since combat does not run here.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type RoadPos } from '../../road';
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
import { BELL_TELL_TICKS, signatureState, signatureView } from './signature';

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
  opts: { signatures?: number; vehicles?: { s: number; d: number; v: number; dir: 1 | -1 }[] } = {},
): Scene {
  const cfg = config(defs, opts.signatures ?? 1);
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
