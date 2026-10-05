// tumble-1's acceptance (docs/milestones/M1.md, "tumble-1 · Crash and run-back"):
//   - in 50 seeded races, every crash hands back within the timeout plus the run;
//   - after hand-back, the rider and the bike sit inside the drivable width;
//   - a skip remounts after 180 ticks, or sooner when running there would be quicker (2026-10-02);
//   - no NaN during a tumble, and a scripted crash gives the same hash every run.
// Crash sources (riders-1, combat-1, traffic-1) are other lanes' work, so these tests stand in a
// scripted crash injector for the combat phase, which runs before tumble in the tick order.
import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, nextU32 } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import { aiSystem } from '../ai';
import { copsSystem } from '../cops';
import { modifiersSystem } from '../modifiers';
import { pedsSystem } from '../peds';
import { gridPosition, raceState, raceSystem } from '../race';
import { riderState, ridersSystem } from '../riders';
import { trafficGhost, trafficSystem } from '../traffic';
import { InputFlag, type SimConfig, type SimInput } from '../types';
import {
  addMover,
  createWorld,
  emit,
  hashPlain,
  orderSystems,
  stepWorld,
  type Mover,
  type SimSystem,
  type World,
} from '../world';
import { drivableBand, isDown, parkedBike, TUMBLE_TUNING, tumbleRecord, tumbleSystem } from '.';

// ---- A small harness: the real systems, with a scripted crash injector in the combat phase ----

interface CrashOrder {
  tick: number;
  rider: number;
  sideMps?: number;
}

function fixtureConfig(seed = 1234): SimConfig {
  const road = createRoadNetwork(
    fixtureNetwork([
      { id: 'a', lengthM: 400, kappa: 0 },
      { id: 'b', lengthM: 500, kappa: 1 / 300, grade: 0.02 },
      { id: 'c', lengthM: 400, kappa: -1 / 400 },
    ]),
  );
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'c', s: 380 },
    mainPath: ['a', 'b', 'c'],
    allowedRoads: ['a', 'b', 'c'],
    closed: false,
  });
  const bike = {
    contentId: 'base:bike',
    topSpeedMps: 38,
    accelMps2: 4.2,
    brakeMps2: 9,
    steerRateMps: 5.5,
    massKg: 180,
  };
  return {
    seed,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100, 50],
      raceEndTimeoutTicks: 1800,
    },
    riders: [
      {
        contentId: 'base:rival',
        name: 'Rival',
        role: 'rival',
        faction: 'rider',
        controller: { kind: 'ai', style: 'racer' },
        bike,
        massKg: 90,
        healthMax: 100,
      },
      {
        contentId: 'base:player',
        name: 'You',
        role: 'player',
        faction: 'rider',
        controller: { kind: 'player', slot: 0 },
        bike,
        massKg: 80,
        healthMax: 100,
      },
    ],
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { 'riders.steerScale': 1 },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

function injector(orders: readonly CrashOrder[]): SimSystem {
  return {
    name: 'combat',
    init() {},
    step(world: World) {
      for (const o of orders) {
        if (o.tick !== world.tick) continue;
        emit(world, 'crash', o.rider, o.sideMps === undefined ? {} : { sideMps: o.sideMps });
      }
    },
  };
}

interface Harness {
  world: World;
  config: SimConfig;
  step(input?: SimInput): void;
  player: Mover;
  rival: Mover;
  hash(): number;
}

function harness(orders: readonly CrashOrder[], seed = 1234, config = fixtureConfig(seed)): Harness {
  const world = createWorld(config);
  config.riders.forEach((_d, i) => addMover(world, 'rider', gridPosition(config, i), i));
  const systems = orderSystems([
    aiSystem,
    ridersSystem,
    injector(orders),
    copsSystem,
    trafficSystem,
    pedsSystem,
    tumbleSystem,
    raceSystem,
    modifiersSystem,
  ]);
  for (const s of systems) s.init(world, config);
  const player = world.movers[1];
  const rival = world.movers[0];
  if (!player || !rival) throw new Error('harness: no riders');
  return {
    world,
    config,
    player,
    rival,
    step(input = full(player)) {
      stepWorld(world, config, systems, [input]);
    },
    hash() {
      const { tick, timeScale, params, movers, inputs, rng, systems: st } = world;
      return hashPlain(0x811c9dc5, { tick, timeScale, params, movers, inputs, rng, systems: st });
    },
  };
}

/** Full throttle with a gentle pull toward the right-hand lane centre. */
function full(me: Mover, flags = 0): SimInput {
  const steer = Math.max(-1, Math.min(1, (1.7 - me.pos.d) * 0.3 - me.yaw * 2));
  return { steer: Math.round(steer * 127), throttle: 255, brake: 0, flags };
}

function finiteMover(m: Mover, config: SimConfig): boolean {
  const len = config.road.edges[m.pos.edge]?.length ?? NaN;
  const nums = [m.pos.s, m.pos.d, m.h, m.yaw, m.speed];
  return nums.every(Number.isFinite) && Number.isInteger(m.pos.edge) && m.pos.s >= 0 && m.pos.s <= len;
}

function insideDrivable(config: SimConfig, pos: { edge: number; s: number; d: number }): boolean {
  const band = drivableBand(config.road, pos.edge, pos.s);
  return pos.d >= band.lo && pos.d <= band.hi;
}

const TIMEOUT = 210; // 3.5 s (interview, 2026-10-02: trim only the waiting)
const REST = 30;
const SKIP = 180;
const RUN_MPS = 7;

// ---- Tests -------------------------------------------------------------------------------------

describe('tumble: tuning declarations', () => {
  it('declares the starting numbers, which convert to 30, 210 and 180 ticks', () => {
    const byId = Object.fromEntries(TUMBLE_TUNING.map((d) => [d.id, d]));
    expect(byId['tumble.restS']?.default).toBe(0.5);
    expect(byId['tumble.timeoutS']?.default).toBe(3.5);
    expect(byId['tumble.restMps']?.default).toBe(1.5);
    expect(byId['tumble.remountMps']?.default).toBe(8);
    expect(byId['tumble.skipDelayS']?.default).toBe(3);
    expect(byId['tumble.runSpeedMps']?.default).toBe(RUN_MPS);
    for (const d of TUMBLE_TUNING) {
      expect(d.id.startsWith('tumble.')).toBe(true);
      expect(d.affectsSim).toBe(true);
      expect(d.default).toBeGreaterThanOrEqual(d.min);
      expect(d.default).toBeLessThanOrEqual(d.max);
    }
  });
});

describe('tumble: a scripted crash', () => {
  it('sends the rider into Tumble on the crash tick, with finite state every tick', () => {
    const h = harness([{ tick: 450, rider: 1 }]);
    for (let t = 0; t < 450; t++) h.step();
    expect(h.player.mode).toBe('Road');
    const speedAtCrash = h.player.speed;
    expect(speedAtCrash).toBeGreaterThan(20);
    h.step();
    expect(h.player.mode).toBe('Tumble');
    expect(isDown(h.world, 1)).toBe(true);
    expect(isDown(h.world, 0)).toBe(false);
    const rec = tumbleRecord(h.world, 1);
    expect(rec?.crashTick).toBe(450);
    let maxH = 0;
    for (let t = 0; t < TIMEOUT + 200; t++) {
      h.step();
      expect(finiteMover(h.player, h.config)).toBe(true);
      const r = tumbleRecord(h.world, 1);
      if (r)
        for (const v of [r.rider.x, r.rider.y, r.rider.z, r.bike.x, r.bike.y, r.bike.z])
          expect(Number.isFinite(v)).toBe(true);
      maxH = Math.max(maxH, h.player.h);
    }
    expect(maxH).toBeGreaterThan(0.5); // the rider is thrown into the air: big and funny
  });

  it('hands back within the timeout, parks the bike and the rider inside the drivable width', () => {
    const h = harness([{ tick: 400, rider: 1 }]);
    for (let t = 0; t <= 400; t++) h.step();
    let handback = -1;
    for (let t = 0; t < TIMEOUT + 5 && handback < 0; t++) {
      h.step();
      if (h.player.mode === 'OnFoot') handback = h.world.tick - 1;
    }
    expect(handback).toBeGreaterThan(400);
    expect(handback - 400).toBeLessThanOrEqual(TIMEOUT);
    const bike = parkedBike(h.world, 1);
    expect(bike).not.toBeNull();
    if (!bike) return;
    expect(insideDrivable(h.config, bike)).toBe(true);
    expect(insideDrivable(h.config, h.player.pos)).toBe(true);
    expect(h.player.h).toBe(0);
  });

  it('hands back on rest detection well before the timeout for a slow crash', () => {
    const h = harness([{ tick: 60, rider: 1 }]);
    for (let t = 0; t < 60; t++) h.step();
    expect(h.player.speed).toBeLessThan(12);
    let handback = -1;
    for (let t = 0; t < TIMEOUT && handback < 0; t++) {
      h.step();
      if (h.player.mode === 'OnFoot') handback = h.world.tick - 1;
    }
    expect(handback).toBeGreaterThan(60 + REST);
    expect(handback - 60).toBeLessThan(TIMEOUT);
  });

  it('runs back to the bike and remounts within the run time, with health restored', () => {
    const h = harness([{ tick: 400, rider: 1 }]);
    for (let t = 0; t <= 400; t++) h.step();
    riderState(h.world).health[1] = 0; // knocked off at zero health
    until(h, () => h.player.mode === 'OnFoot');
    const handback = h.world.tick;
    const bike = parkedBike(h.world, 1);
    if (!bike) throw new Error('no parked bike');
    const bikeCopy = { ...bike };
    const w0 = h.config.road.toWorld(h.player.pos.edge, h.player.pos.s, h.player.pos.d, 0);
    const wb = h.config.road.toWorld(bike.edge, bike.s, bike.d, 0);
    const dist = Math.sqrt((w0.x - wb.x) * (w0.x - wb.x) + (w0.z - wb.z) * (w0.z - wb.z));
    const runTicks = Math.ceil((dist / RUN_MPS) * 60) + 5;
    while (h.player.mode === 'OnFoot' && h.world.tick < handback + runTicks + 60) {
      expect(insideDrivable(h.config, h.player.pos)).toBe(true);
      h.step();
    }
    expect(h.player.mode).toBe('Road');
    expect(h.world.tick - handback).toBeLessThanOrEqual(runTicks);
    expect(h.player.pos).toEqual(bikeCopy);
    expect(h.player.speed).toBe(8); // remounts rolling (interview, 2026-10-02)
    expect(trafficGhost(h.world, 1)).toBe(true); // rides through traffic for a moment (playtest 4)
    expect(riderState(h.world).health[1]).toBe(100);
    expect(isDown(h.world, 1)).toBe(false);
    expect(tumbleRecord(h.world, 1)).toBeNull();
    // Back on the bike, it rides again.
    for (let t = 0; t < 120; t++) h.step();
    expect(h.player.speed).toBeGreaterThan(5);
  });

  it('keeps the travel direction through a crash on a wrong-way rider', () => {
    const h = harness([{ tick: 5, rider: 1 }]);
    h.player.pos = { edge: 1, s: 250, d: -1.7, dir: -1 };
    h.player.speed = 25;
    for (let t = 0; t < 6; t++) h.step(neutral());
    expect(h.player.mode).toBe('Tumble');
    const startS = h.player.pos.s;
    until(h, () => h.player.mode !== 'Tumble', neutral);
    expect(h.player.pos.s).toBeLessThan(startS); // it slid on toward decreasing s
    expect(h.player.pos.dir).toBe(-1);
    until(h, () => h.player.mode === 'Road', neutral);
    expect(h.player.pos.dir).toBe(-1);
  });

  it('hands a route-forward rider back facing the route, even when the slide ends where the road has turned', () => {
    // At a hairpin the body can come to rest where the road's tangent points back the way the
    // rider came, so the crash's world travel direction reads as the wrong way there. On a real
    // road (Twin Peaks, seed 2) that handed the bot back facing backward, and with no U-turn it rode
    // the whole route back to the start. Stand-in: reverse the record's travel direction mid-slide.
    const h = harness([{ tick: 5, rider: 1 }]);
    h.player.pos = { edge: 0, s: 200, d: 1.7, dir: 1 };
    h.player.speed = 25;
    for (let t = 0; t < 6; t++) h.step(neutral());
    expect(h.player.mode).toBe('Tumble');
    const r = tumbleRecord(h.world, 1);
    if (!r) throw new Error('no tumble record');
    r.travelX = -r.travelX;
    r.travelZ = -r.travelZ;
    until(h, () => h.player.mode !== 'Tumble', neutral);
    expect(parkedBike(h.world, 1)?.dir).toBe(1);
    until(h, () => h.player.mode === 'Road', neutral);
    expect(h.player.pos.dir).toBe(1);
  });

  it('crosses an edge boundary: a crash just before a junction slides onto the next road', () => {
    const h = harness([{ tick: 3, rider: 1 }]);
    h.player.pos = { edge: 0, s: 390, d: 1.7, dir: 1 };
    h.player.speed = 34;
    const edges = new Set<number>();
    for (let t = 0; t < 4; t++) h.step(neutral());
    expect(h.player.mode).toBe('Tumble');
    for (let guard = 0; h.player.mode !== 'Road'; guard++) {
      if (guard > 2000) throw new Error('never remounted');
      edges.add(h.player.pos.edge);
      h.step(neutral());
      expect(finiteMover(h.player, h.config)).toBe(true);
    }
    expect(edges.has(0)).toBe(true);
    expect(edges.has(1)).toBe(true);
    expect(h.player.pos.edge).toBe(1);
  });

  it('keeps bodies inside the barriers under a big sideways shove', () => {
    const h = harness([{ tick: 300, rider: 1, sideMps: 25 }]);
    for (let t = 0; t <= 300; t++) h.step();
    let hitWall = false;
    for (let guard = 0; h.player.mode === 'Tumble' && guard < 2000; guard++) {
      h.step();
      const r = tumbleRecord(h.world, 1);
      if (!r) break;
      for (const b of [r.rider, r.bike]) {
        const p = h.config.road.project(b.x, b.z, b.edge);
        const e = h.config.road.edges[p.edge];
        if (!e) throw new Error('no edge');
        expect(p.d).toBeGreaterThanOrEqual(e.dMin - 1e-6);
        expect(p.d).toBeLessThanOrEqual(e.dMax + 1e-6);
        if (p.d > e.dMax - 0.6) hitWall = true;
      }
    }
    expect(hitWall).toBe(true);
  });

  it('ignores a second crash while the rider is already down', () => {
    const h = harness([
      { tick: 300, rider: 1 },
      { tick: 320, rider: 1 },
    ]);
    for (let t = 0; t <= 300; t++) h.step();
    const before = tumbleRecord(h.world, 1)?.crashTick;
    for (let t = 0; t < 30; t++) h.step();
    expect(tumbleRecord(h.world, 1)?.crashTick).toBe(before);
  });

  it('freezes bodies and timers while timeScale is 0 (hit-stop), and counts scaled time', () => {
    const h = harness([{ tick: 300, rider: 1 }]);
    for (let t = 0; t <= 310; t++) h.step();
    const r0 = tumbleRecord(h.world, 1);
    const snap = JSON.stringify(r0);
    h.world.timeScale = 0;
    for (let t = 0; t < 400; t++) h.step();
    const r1 = tumbleRecord(h.world, 1);
    expect(h.player.mode).toBe('Tumble'); // 400 raw ticks did not reach the 210-tick timeout
    expect(JSON.stringify({ ...r1, lastTick: 0 })).toBe(JSON.stringify({ ...JSON.parse(snap), lastTick: 0 }));
    h.world.timeScale = 1;
    h.step();
    expect(tumbleRecord(h.world, 1)?.elapsed).toBe((JSON.parse(snap) as { elapsed: number }).elapsed + 1);
  });
});

describe('tumble: dodging on foot', () => {
  /** A rider on foot on the straight, with the bike planted 30 m further up the road. */
  function farBike() {
    const h = harness([{ tick: 5, rider: 1 }]);
    h.player.pos = { edge: 0, s: 200, d: 1.7, dir: 1 };
    h.player.speed = 12;
    for (let t = 0; t < 6; t++) h.step(neutral());
    until(h, () => h.player.mode === 'OnFoot', neutral);
    const r = tumbleRecord(h.world, 1);
    if (!r) throw new Error('no record');
    r.parked = { edge: 0, s: h.player.pos.s + 30, d: 1.7, dir: 1 };
    return h;
  }

  it('runs straight to a far bike in about distance / run speed', () => {
    const h = farBike();
    const start = h.world.tick;
    until(h, () => h.player.mode === 'Road', neutral, 600);
    const ideal = Math.ceil((29 / RUN_MPS) * 60); // 30 m less the 1 m remount reach
    expect(h.world.tick - start).toBeGreaterThanOrEqual(ideal);
    expect(h.world.tick - start).toBeLessThanOrEqual(ideal + 20);
  });

  it('moves the runner sideways under steering, and the run still ends', () => {
    const h = farBike();
    const d0 = h.player.pos.d;
    const start = h.world.tick;
    for (let t = 0; t < 30; t++) h.step({ ...neutral(), steer: -127 }); // running up s: left is −d
    expect(h.player.pos.d).toBeLessThan(d0 - 1);
    until(
      h,
      () => h.player.mode === 'Road',
      () => ({ ...neutral(), steer: -127 }),
      900,
    );
    const ideal = Math.ceil((29 / RUN_MPS) * 60);
    expect(h.world.tick - start).toBeLessThanOrEqual(ideal + 120);
  });
});

describe('tumble: skipping the run-back', () => {
  it('remounts 180 ticks after the skip on a far bike, at the bike', () => {
    const h = harness([{ tick: 400, rider: 1 }]);
    for (let t = 0; t <= 400; t++) h.step();
    until(h, () => h.player.mode === 'OnFoot');
    const r = tumbleRecord(h.world, 1);
    if (!r) throw new Error('no record');
    r.parked = { edge: h.player.pos.edge, s: h.player.pos.s + 40, d: h.player.pos.d, dir: 1 }; // 39 m of run
    const bike = { ...r.parked };
    const pressTick = h.world.tick;
    h.step(full(h.player, InputFlag.skipRunBack));
    expect(h.player.pos).toEqual(bike); // teleported to the bike
    let remount = -1;
    for (let t = 0; t < SKIP + 20 && remount < 0; t++) {
      expect(h.player.mode).toBe('OnFoot');
      h.step(full(h.player, t % 2 === 0 ? InputFlag.skipRunBack : 0)); // mashing changes nothing
      if (h.player.mode === 'Road') remount = h.world.tick - 1;
    }
    expect(remount - pressTick).toBe(SKIP);
    expect(h.player.pos).toEqual(bike);
    expect(riderState(h.world).health[1]).toBe(100);
  });

  it('remembers a skip pressed during the tumble and starts it at the hand-back', () => {
    const h = harness([{ tick: 400, rider: 1 }]);
    for (let t = 0; t <= 400; t++) h.step();
    h.step(full(h.player, InputFlag.skipRunBack));
    until(h, () => h.player.mode !== 'Tumble');
    const handback = h.world.tick - 1;
    const bike = parkedBike(h.world, 1);
    const waits = tumbleRecord(h.world, 1)?.skipTicks ?? -1;
    expect(waits).toBeGreaterThanOrEqual(0);
    expect(waits).toBeLessThanOrEqual(SKIP);
    expect(h.player.pos).toEqual(bike);
    until(h, () => h.player.mode === 'Road');
    expect(h.world.tick - 1 - handback).toBe(Math.max(1, waits));
  });

  it('is never slower than running: a skip 7 m from the bike remounts when the run would have', () => {
    const h = harness([{ tick: 5, rider: 1 }]);
    h.player.pos = { edge: 0, s: 200, d: 1.7, dir: 1 };
    h.player.speed = 12;
    for (let t = 0; t < 6; t++) h.step(neutral());
    until(h, () => h.player.mode === 'OnFoot', neutral);
    const r = tumbleRecord(h.world, 1);
    if (!r) throw new Error('no record');
    r.parked = { edge: 0, s: h.player.pos.s + 7, d: h.player.pos.d, dir: 1 };
    const runTicks = Math.ceil((6 / RUN_MPS) * 60); // 7 m less the 1 m remount reach: 52 ticks
    const pressTick = h.world.tick;
    h.step({ ...neutral(), flags: InputFlag.skipRunBack });
    until(h, () => h.player.mode === 'Road', neutral, SKIP);
    const took = h.world.tick - 1 - pressTick;
    console.log(
      `[examined] skip 7 m from the bike: back on in ${took} ticks (run ${runTicks}, old skip ${SKIP})`,
    );
    expect(took).toBeLessThanOrEqual(runTicks);
    expect(took).toBeLessThan(SKIP);
  });

  it('never lets an AI rider skip (its inputs have no skip flag)', () => {
    const h = harness([{ tick: 300, rider: 0 }]);
    for (let t = 0; t <= 300; t++) h.step(full(h.player, InputFlag.skipRunBack));
    expect(h.rival.mode).toBe('Tumble');
    until(
      h,
      () => h.rival.mode === 'OnFoot',
      () => full(h.player, InputFlag.skipRunBack),
    );
    expect(tumbleRecord(h.world, 0)?.skip).toBe(-1);
    h.step(full(h.player, InputFlag.skipRunBack));
    // Still running, or already remounted (tumble-2's bike may stop right beside the rider).
    expect(tumbleRecord(h.world, 0)?.skip ?? -1).toBe(-1);
  });
});

describe('tumble: trim only the waiting (interview, 2026-10-02)', () => {
  /** Ticks from a top-speed crash to the hand-back, and the remount speed, under these tuning keys. */
  function crashAndRemount(tuning: Record<string, number>) {
    const config = fixtureConfig();
    config.tuning = { ...config.tuning, ...tuning };
    const h = harness([{ tick: 400, rider: 1 }], 1234, config);
    for (let t = 0; t <= 400; t++) h.step();
    until(h, () => h.player.mode === 'OnFoot');
    const handback = h.world.tick - 1 - 400;
    until(h, () => h.player.mode === 'Road', neutral, 3000);
    return { handback, speed: h.player.speed };
  }

  it('hands back sooner once nearly stopped, and remounts rolling; both are sliders', () => {
    const now = crashAndRemount({});
    const old = crashAndRemount({ 'tumble.restMps': 0.5, 'tumble.timeoutS': 5, 'tumble.remountMps': 0 });
    console.log(
      `[examined] top-speed crash: hand-back ${now.handback} ticks (old rule ${old.handback}), remount ${now.speed} m/s (old ${old.speed})`,
    );
    expect(now.handback).toBeLessThanOrEqual(TIMEOUT);
    expect(now.handback).toBeLessThanOrEqual(old.handback);
    expect(now.speed).toBe(8);
    expect(old.speed).toBe(0);
    expect(crashAndRemount({ 'tumble.remountMps': 12 }).speed).toBe(12);
  });

  it('never remounts faster than the bike can go', () => {
    const config = fixtureConfig();
    config.tuning = { ...config.tuning, 'tumble.remountMps': 20 };
    config.riders = config.riders.map((d) => ({ ...d, bike: { ...d.bike, topSpeedMps: 6 } }));
    const h = harness([{ tick: 200, rider: 1 }], 1234, config);
    for (let t = 0; t <= 200; t++) h.step();
    until(h, () => h.player.mode === 'Road', neutral, 3000);
    expect(h.player.speed).toBe(6);
  });
});

describe('tumble: determinism', () => {
  it('gives the same hash every run for a scripted crash, and differs from no crash', () => {
    const run = (orders: readonly CrashOrder[]) => {
      const h = harness(orders, 99);
      const hashes: number[] = [];
      for (let t = 0; t < 1200; t++) {
        h.step(full(h.player, t === 700 ? InputFlag.skipRunBack : 0));
        hashes.push(h.hash());
      }
      return hashes;
    };
    const orders = [
      { tick: 250, rider: 1, sideMps: -6 },
      { tick: 400, rider: 0 },
    ];
    const a = run(orders);
    expect(run(orders)).toEqual(a);
    expect(run([])[1100]).not.toBe(a[1100]);
  });
});

describe('tumble: 50 seeded races with scripted crashes', () => {
  it('hands every crash back within the timeout plus the run, inside the drivable width', () => {
    let crashes = 0;
    let remounts = 0;
    let skips = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const rng = createRng(seed * 7919);
      const orders: CrashOrder[] = [];
      for (let k = 0; k < 3; k++) {
        const tick = 200 + k * 1100 + (nextU32(rng) % 600);
        const side = (nextFloat(rng) - 0.5) * 20;
        orders.push({ tick, rider: nextU32(rng) % 2, sideMps: side });
      }
      const skipWanted = seed % 3 === 0;
      const h = harness(orders, seed);
      const phase: ('none' | 'tumble' | 'onFoot')[] = ['none', 'none'];
      const crashTick = [0, 0];
      const handTick = [0, 0];
      const runBudget = [0, 0];
      let skipPress = -1;
      // Run to the race end, and on until nobody is down (a rider may crash after finishing).
      const down = () => phase[0] !== 'none' || phase[1] !== 'none';
      while ((!raceState(h.world).over || down()) && h.world.tick < 60 * 400) {
        // On foot, the stand-in player runs straight (no dodge) and, in every third race, skips.
        const onFoot = phase[1] === 'onFoot';
        const skip = skipWanted && onFoot ? InputFlag.skipRunBack : 0;
        if (skip && skipPress < 0) skipPress = h.world.tick;
        h.step(onFoot ? { ...neutral(), flags: skip } : full(h.player));
        const tick = h.world.tick - 1;
        for (const m of [h.rival, h.player]) {
          expect(finiteMover(m, h.config)).toBe(true);
          const id = m.id;
          const was = phase[id];
          if (m.mode === 'Tumble' && was !== 'tumble') {
            expect(was).toBe('none');
            phase[id] = 'tumble';
            crashTick[id] = tick;
            crashes++;
          } else if (m.mode === 'OnFoot' && was === 'tumble') {
            phase[id] = 'onFoot';
            handTick[id] = tick;
            expect(tick - (crashTick[id] ?? 0)).toBeLessThanOrEqual(TIMEOUT);
            const bike = parkedBike(h.world, id);
            if (!bike) throw new Error('no parked bike');
            expect(insideDrivable(h.config, bike)).toBe(true);
            expect(insideDrivable(h.config, m.pos)).toBe(true);
            const a = h.config.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, 0);
            const b = h.config.road.toWorld(bike.edge, bike.s, bike.d, 0);
            const dist = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));
            // A rival someone knocked off (tumble-2) stands and shakes a fist before running.
            const getUp = tumbleRecord(h.world, id)?.getUpTotal ?? 0;
            runBudget[id] = Math.ceil((dist / RUN_MPS) * 60) + 5 + getUp;
          } else if (m.mode === 'Road' && was === 'onFoot') {
            phase[id] = 'none';
            remounts++;
            if (id === 1 && skipPress >= 0) {
              // A skip remounts at most 180 ticks after the press, sooner when the run is shorter.
              skips++;
              expect(tick - skipPress).toBeGreaterThanOrEqual(0);
              expect(tick - skipPress).toBeLessThanOrEqual(SKIP);
              skipPress = -1;
            } else {
              expect(tick - (handTick[id] ?? 0), `seed ${seed} rider ${id}`).toBeLessThanOrEqual(
                runBudget[id] ?? 0,
              );
            }
            expect(insideDrivable(h.config, m.pos)).toBe(true);
          } else if (m.mode === 'OnFoot') {
            expect(insideDrivable(h.config, m.pos)).toBe(true);
          }
        }
      }
      expect(raceState(h.world).over).toBe(true);
      expect(phase).toEqual(['none', 'none']); // nobody is left down at the end
    }
    expect(crashes).toBeGreaterThanOrEqual(100);
    expect(remounts).toBe(crashes);
    expect(skips).toBeGreaterThan(0);
  }, 120_000);
});

/** Steps until `done` holds; fails instead of hanging after `max` ticks. */
function until(h: Harness, done: () => boolean, input?: () => SimInput, max = 3000): void {
  for (let t = 0; !done(); t++) {
    if (t >= max) throw new Error(`condition not reached in ${max} ticks`);
    h.step(input ? input() : undefined);
  }
}

function neutral(): SimInput {
  return { steer: 0, throttle: 0, brake: 0, flags: 0 };
}
