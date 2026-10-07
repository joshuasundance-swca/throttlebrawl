// riders-3 acceptance (docs/milestones/M1.md, "riders-3 · Race: grid, placing and finish"): the
// placing order matches progress at every checkpoint, every rider ends finished, down or busted,
// the race always ends, and the rubber-band factor stays within its bounds.
import { describe, expect, it } from 'vitest';
import { createSim, quantizeInput, type EntitySnapshot, type SimConfig, type SimEvent } from '../api';
import { input, testConfig } from '../riders/testing';
import type { SimRiderDef } from '../types';
import { addMover, createWorld, type World } from '../world';
import {
  gridPosition,
  MAX_RACE_TICKS,
  raceState,
  raceSystem,
  RACE_TUNING,
  rubberBandBounds,
  rubberBandFactor,
  type RiderStatus,
} from './index';

const TRACK = [
  { id: 'a', lengthM: 500, kappa: 0 },
  { id: 'b', lengthM: 600, kappa: 1 / 300 },
  { id: 'c', lengthM: 500, kappa: -1 / 400 },
];

/** The world with riders on the grid and only the race system stepping; positions set by hand. */
function raceHarness(config: SimConfig) {
  const world = createWorld(config);
  config.riders.forEach((_d, i) => addMover(world, 'rider', gridPosition(config, i), i));
  raceSystem.init(world, config);
  return {
    world,
    step(inject: SimEvent[] = []): SimEvent[] {
      world.events = [...inject];
      raceSystem.step(world, config);
      world.tick++;
      const out = world.events.slice(inject.length);
      world.events = [];
      return out;
    },
  };
}

function withCop(config: SimConfig): SimConfig {
  const player = config.riders[config.riders.length - 1] as SimRiderDef;
  const cop: SimRiderDef = {
    ...player,
    contentId: 'base:cop',
    name: 'Cop',
    role: 'cop',
    faction: 'law',
    controller: { kind: 'cop' },
  };
  return { ...config, riders: [...config.riders, cop] };
}

/** A lane-keeping bot for the player slot, like the stub bot (steer to the travel lane centre). */
function botInput(me: EntitySnapshot | undefined, config: SimConfig) {
  if (!me) return input(0);
  const { edge, s, d, dir, yaw } = me.road;
  const lanes = config.road.lanesAt(edge, s);
  const lane = lanes.find((l) => l.kind === 'drive' && l.direction === dir);
  const kappa = config.road.kappaAt(edge, s) * dir;
  const v = Math.max(me.speed, 5);
  const steer = 0.35 * ((lane?.dCenterM ?? 0) - d) * dir - 2.5 * yaw + (kappa * v * v) / 22;
  return quantizeInput({ throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, steer)), flags: 0 });
}

const RACER_STATUSES: readonly RiderStatus[] = ['finished', 'down', 'busted'];

describe('riders-3: the start grid', () => {
  it('lays the grid out from the route: rows behind the line, across the travel lane', () => {
    const config = testConfig({
      edges: TRACK,
      rivals: 5,
      start: { road: 'a', s: 60, dir: 1 },
      startGrid: { rows: 3, perRow: 2, rowGapM: 10 },
    });
    const slots = config.riders.map((_r, i) => gridPosition(config, i));
    expect(slots.map((p) => p.s)).toEqual([60, 60, 50, 50, 40, 40]);
    // Two columns, inside the +1 drive lane (centre 1.7 m, width 3.4 m), left then right.
    expect(slots[0]?.d).toBeLessThan(slots[1]?.d ?? 0);
    for (const p of slots) {
      expect(p.d).toBeGreaterThan(0);
      expect(p.d).toBeLessThan(3.4);
      expect(p.dir).toBe(1);
    }
  });

  it('falls back to two per row, 8 m apart, and adds rows past the route grid', () => {
    const plain = testConfig({ edges: TRACK, rivals: 3, start: { road: 'a', s: 60, dir: 1 } });
    expect(plain.riders.map((_r, i) => gridPosition(plain, i).s)).toEqual([60, 60, 52, 52]);
    const small = testConfig({
      edges: TRACK,
      rivals: 4,
      start: { road: 'a', s: 60, dir: 1 },
      startGrid: { rows: 1, perRow: 3, rowGapM: 6 },
    });
    expect(small.riders.map((_r, i) => gridPosition(small, i).s)).toEqual([60, 60, 60, 54, 54]);
  });

  it('keeps the law off the racing grid, parked a row behind the last racer', () => {
    const config = withCop(testConfig({ edges: TRACK, rivals: 1, start: { road: 'a', s: 60, dir: 1 } }));
    const cop = gridPosition(config, 2);
    expect(cop.s).toBeLessThan(52);
  });
});

describe('riders-3: placing, finish and race end', () => {
  it('orders the places by progress on every tick, and each finisher gets one finish event', () => {
    const config = testConfig({ edges: TRACK, rivals: 4, paceMps: 28 });
    const sim = createSim(config);
    const finishes: SimEvent[] = [];
    let ticks = 0;
    let checked = 0;
    while (!sim.isOver() && ticks < 60 * 240) {
      const me = sim.snapshot().entities.find((e) => e.slot === 0);
      sim.step([botInput(me, config)]);
      ticks++;
      finishes.push(...sim.events().filter((e) => e.type === 'finish'));
      const snap = sim.snapshot();
      const order = [...snap.race.finishOrder];
      const running = snap.entities
        .filter((e) => !order.includes(e.id))
        .sort((p, q) => p.distanceToFinish - q.distanceToFinish || p.id - q.id);
      const expected = [...order, ...running.map((e) => e.id)];
      const byPlace = [...snap.entities].sort((p, q) => p.place - q.place).map((e) => e.id);
      expect(byPlace).toEqual(expected);
      checked++;
    }
    expect(sim.isOver()).toBe(true);
    expect(checked).toBeGreaterThan(60 * 30);
    const ids = finishes.map((e) => e.actor);
    expect(new Set(ids).size).toBe(ids.length);
    finishes.forEach((e, i) => expect(e.data['place']).toBe(i + 1));
  });

  it("fires a checkpoint event per racer at each of the route's checkpoints, with places matching progress", () => {
    const config = testConfig({
      edges: TRACK,
      rivals: 4,
      paceMps: 28,
      checkpoints: [
        { road: 'a', s: 300 },
        { road: 'b', s: 300 },
        { road: 'c', s: 200 },
      ],
    });
    expect(config.route.checkpoints.map((c) => c.progress)).toEqual([
      300 - 40,
      500 + 300 - 40,
      1100 + 200 - 40,
    ]);
    const sim = createSim(config);
    const seen = new Map<number, number[]>();
    let atCheckpoint = 0;
    for (let t = 0; t < 60 * 240 && !sim.isOver(); t++) {
      const me = sim.snapshot().entities.find((e) => e.slot === 0);
      sim.step([botInput(me, config)]);
      const cps = sim.events().filter((e) => e.type === 'lapOrCheckpoint');
      if (cps.length === 0) continue;
      const snap = sim.snapshot();
      for (const e of cps) {
        seen.set(e.actor, [...(seen.get(e.actor) ?? []), Number(e.data['checkpoint'])]);
        const me2 = snap.entities.find((x) => x.id === e.actor);
        const cp = config.route.checkpoints[Number(e.data['checkpoint'])];
        expect(me2?.progress).toBeGreaterThanOrEqual(cp?.progress ?? Infinity);
      }
      // The placing matches progress at the checkpoint moment.
      const done = [...snap.race.finishOrder];
      const rest = snap.entities
        .filter((e) => !done.includes(e.id))
        .sort((p, q) => p.distanceToFinish - q.distanceToFinish || p.id - q.id)
        .map((e) => e.id);
      expect([...snap.entities].sort((p, q) => p.place - q.place).map((e) => e.id)).toEqual([
        ...done,
        ...rest,
      ]);
      atCheckpoint++;
    }
    expect(atCheckpoint).toBeGreaterThan(0);
    for (const id of sim.snapshot().race.finishOrder) expect(seen.get(id)).toEqual([0, 1, 2]);
  });

  it('ends every racer finished, down or busted, and says so in the raceEnd event', () => {
    const config = testConfig({ edges: TRACK, rivals: 4, paceMps: 28 });
    const sim = createSim(config);
    let end: SimEvent | undefined;
    for (let t = 0; t < 60 * 240 && !sim.isOver(); t++) {
      const me = sim.snapshot().entities.find((e) => e.slot === 0);
      sim.step([botInput(me, config)]);
      end ??= sim.events().find((e) => e.type === 'raceEnd');
    }
    expect(end).toBeDefined();
    const counts = ['finished', 'down', 'busted'].map((k) => Number(end?.data[k] ?? 0));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(config.riders.length);
  });

  it('a bust ends the race for the busted player: out of the running, placed last, race ends after the timeout', () => {
    const config = withCop(testConfig({ edges: TRACK, rivals: 2, raceEndTimeoutTicks: 120 }));
    const h = raceHarness(config);
    const player = 2;
    const cop = 3;
    // Everyone rolls forward a little; the player is ahead of both rivals.
    const moveTo = (id: number, s: number) => {
      const m = h.world.movers[id];
      if (m) m.pos.s = s;
    };
    moveTo(0, 100);
    moveTo(1, 90);
    moveTo(player, 120);
    h.step();
    expect(raceState(h.world).place[player]).toBe(1);
    expect(raceState(h.world).place[cop]).toBe(0);
    const bust: SimEvent = { tick: h.world.tick, type: 'bust', actor: cop, target: player, data: {} };
    h.step([bust]);
    const st = raceState(h.world);
    expect(st.status[player]).toBe('busted');
    expect(st.place[player]).toBe(3);
    expect(st.over).toBe(false);
    let ended = -1;
    for (let t = 0; t < 200 && ended < 0; t++) {
      if (h.step().some((e) => e.type === 'raceEnd')) ended = t + 1;
    }
    expect(ended).toBe(120);
    const finalStatus = raceState(h.world).status;
    for (const id of [0, 1, player]) expect(RACER_STATUSES).toContain(finalStatus[id]);
    expect(finalStatus[cop]).toBe('law');
  });

  it('classifies riders still running at the timeout by position, and riders down as down', () => {
    const config = testConfig({ edges: TRACK, rivals: 2, raceEndTimeoutTicks: 60 });
    const h = raceHarness(config);
    const player = 2;
    const finish = config.route.length;
    const mv = (id: number) => h.world.movers[id];
    // The player crosses the line; rival 0 is running, rival 1 is down in a tumble.
    const p = mv(player);
    const r0 = mv(0);
    const r1 = mv(1);
    if (!p || !r0 || !r1) throw new Error('movers missing');
    p.pos.edge = 2;
    p.pos.s = 490;
    r0.pos.edge = 2;
    r0.pos.s = 100;
    r1.pos.edge = 1;
    r1.pos.s = 300;
    r1.mode = 'Tumble';
    const events: SimEvent[] = [];
    for (let t = 0; t < 70; t++) events.push(...h.step());
    const st = raceState(h.world);
    expect(finish).toBeGreaterThan(0);
    expect(st.over).toBe(true);
    expect(st.status[player]).toBe('finished');
    expect(st.status[0]).toBe('finished');
    expect(st.status[1]).toBe('down');
    expect(st.finishOrder).toEqual([player, 0]);
    expect(st.place[1]).toBe(3);
    const classified = events.find((e) => e.type === 'finish' && e.actor === 0);
    expect(classified?.data['classified']).toBe(true);
    const end = events.find((e) => e.type === 'raceEnd');
    expect(end?.data).toMatchObject({ finished: 2, down: 1, busted: 0 });
  });

  it('always ends: a player who never moves hits the hard stop', () => {
    const config = testConfig({ edges: TRACK, rivals: 1 });
    const sim = createSim(config);
    let t = 0;
    while (!sim.isOver() && t < MAX_RACE_TICKS + 10) {
      sim.step([input(0)]);
      t++;
    }
    expect(sim.isOver()).toBe(true);
    expect(t).toBeLessThanOrEqual(MAX_RACE_TICKS + 1);
  });

  it('gives the same hash every run for a scripted race', () => {
    const run = () => {
      const config = testConfig({ edges: TRACK, rivals: 4 });
      const sim = createSim(config);
      const hashes: number[] = [];
      for (let t = 0; t < 900; t++) {
        const me = sim.snapshot().entities.find((e) => e.slot === 0);
        sim.step([botInput(me, config)]);
        hashes.push(sim.hash());
      }
      return hashes;
    };
    expect(run()).toEqual(run());
  });
});

describe('riders-3: the rubber band', () => {
  const place = (world: World, id: number, edge: number, s: number) => {
    const m = world.movers[id];
    if (m) {
      m.pos.edge = edge;
      m.pos.s = s;
    }
  };

  it('pulls a rival behind you forward and eases one ahead back, within its bounds', () => {
    const config = testConfig({ edges: TRACK, rivals: 2 });
    const h = raceHarness(config);
    const [lo, hi] = rubberBandBounds(config, h.world);
    expect(lo).toBeLessThan(1);
    expect(hi).toBeGreaterThan(1);
    expect(hi - 1).toBeLessThanOrEqual(0.1); // "slight"
    place(h.world, 2, 1, 300); // the player
    place(h.world, 0, 0, 100); // far behind
    place(h.world, 1, 2, 300); // far ahead
    h.step();
    expect(rubberBandFactor(h.world, 0)).toBe(hi);
    expect(rubberBandFactor(h.world, 1)).toBe(lo);
    expect(rubberBandFactor(h.world, 2)).toBe(1);
    place(h.world, 0, 1, 290); // just behind: a small push
    h.step();
    expect(rubberBandFactor(h.world, 0)).toBeGreaterThan(1);
    expect(rubberBandFactor(h.world, 0)).toBeLessThan(hi);
  });

  it('scales with SimConfig.difficulty.rubberBand and the tuning panel (non-default values)', () => {
    const at = (cfg: SimConfig) => {
      const h = raceHarness(cfg);
      place(h.world, 1, 1, 300);
      place(h.world, 0, 0, 100);
      h.step();
      return rubberBandFactor(h.world, 0) - 1;
    };
    const normal = at(testConfig({ edges: TRACK, rivals: 1 }));
    expect(at(testConfig({ edges: TRACK, rivals: 1, rubberBand: 2 }))).toBeCloseTo(normal * 2, 12);
    expect(at(testConfig({ edges: TRACK, rivals: 1, rubberBand: 0 }))).toBe(0);
    expect(
      at(testConfig({ edges: TRACK, rivals: 1, tuning: { 'race.rubberBandStrength': 0.1 } })),
    ).toBeCloseTo(0.1, 12);
  });

  it('stays within its bounds on every tick of a race, and switches off once the player is done', () => {
    const config = testConfig({ edges: TRACK, rivals: 4 });
    const sim = createSim(config);
    const bounds = rubberBandBounds(config, { params: { ...config.tuning } });
    const seen = new Set<number>();
    let t = 0;
    // The snapshot does not carry the factors, so a race-only world mirrors the sim's positions.
    const h = raceHarness(config);
    while (!sim.isOver() && t < 60 * 240) {
      const snap = sim.snapshot();
      const me = snap.entities.find((e) => e.slot === 0);
      sim.step([botInput(me, config)]);
      // Mirror the sim's positions into the harness world and step its race system.
      for (const e of sim.snapshot().entities) {
        const m = h.world.movers[e.id];
        if (m) {
          m.pos.edge = e.road.edge;
          m.pos.s = e.road.s;
        }
      }
      h.step();
      for (let id = 0; id < config.riders.length; id++) {
        const f = rubberBandFactor(h.world, id);
        expect(f).toBeGreaterThanOrEqual(bounds[0]);
        expect(f).toBeLessThanOrEqual(bounds[1]);
        seen.add(Math.round(f * 1000));
      }
      t++;
    }
    expect(seen.size).toBeGreaterThan(5);
    const st = raceState(h.world);
    if (st.status[config.riders.length - 1] === 'finished') {
      for (let id = 0; id < config.riders.length; id++) expect(rubberBandFactor(h.world, id)).toBe(1);
    }
  });

  it('declares its tuning parameters inside their ranges', () => {
    expect(RACE_TUNING.map((d) => d.id)).toEqual([
      'race.rubberBandStrength',
      'race.rubberBandRangeM',
      'race.styleAirtimeMinS',
      'race.styleOncomingMinS',
      'race.styleOncomingSpeedShare',
      'race.styleComboWindowS',
      'race.styleSplitScale',
      'race.styleTrickScale',
      'race.styleWheelieMinS',
      'race.styleHoodScale',
      'race.styleRoofScale',
      'race.styleRoofMinS',
    ]);
    for (const d of RACE_TUNING) {
      expect(d.affectsSim).toBe(true);
      expect(d.default).toBeGreaterThanOrEqual(d.min);
      expect(d.default).toBeLessThanOrEqual(d.max);
    }
  });
});
