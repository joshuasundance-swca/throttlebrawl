import { beforeAll, describe, expect, it } from 'vitest';
import { createBot } from '../../../src/dev';
import { emptyActions, toSimInput } from '../../../src/input';
import { PEDS, pedThreatRangeM } from '../../../src/sim/peds';
import {
  trafficHeightM,
  type EntitySnapshot,
  type RoadNetwork,
  type SimConfig,
  type SimEvent,
  type SimSnapshot,
} from '../../../src/sim/api';
import { createBatchRace } from '../batch';
import { BATCH_HOOKS, type BatchRaceInfo } from './index';
import {
  PEDESTRIAN_HOOK_ID,
  pedestrianChecker,
  pedestrianCheckOf,
  pedestrianHook,
  selectedPedestrianChecks,
} from './pedestrian';

// Literal pre-migration snapshot oracle from traffic-peds.test.ts. Keep its geometry,
// state transitions, arithmetic order and ordered diagnostics independent of the hook.
/** Along-road offset (in the rider's travel direction) and side offset of p from r, or null. */
function relate(road: RoadNetwork, r: EntitySnapshot, p: EntitySnapshot, range: number) {
  let ps = p.road.s;
  let sign = 1;
  if (r.road.edge !== p.road.edge) {
    const n = road.neighbours(r.road.edge, r.road.s, range).find((q) => q.edge === p.road.edge);
    if (!n) return null;
    ps = n.sOffset + n.sSign * p.road.s;
    sign = n.sSign;
  }
  const along = (ps - r.road.s) * r.road.dir;
  if (Math.abs(along) > range) return null;
  return { along, side: sign * p.road.d - r.road.d };
}

interface TickCheck {
  /** Pedestrians seen going from off the road to on it, and those with a rider about to arrive. */
  stepOns: number;
  stepIns: string[];
  ticks: number;
  pairs: number;
  threatTicks: number;
  threatened: Set<number>;
  undived: string[];
  contacts: string[];
}

function literalReference(seed: number, config: SimConfig) {
  const kinds = config.trafficTypes.filter((t) => t.category === 'pedestrian' || t.category === 'animal');
  const bigLength = Math.max(...kinds.map((t) => t.lengthM));
  const bigWidth = Math.max(...kinds.map((t) => t.widthM));
  const smallWidth = Math.min(...kinds.map((t) => t.widthM));
  // A rider clears a pedestrian or an animal only above its type's height (the hitbox audit's
  // contract; sim/peds), so each is judged by its own: a snapshot names its type (contentId).
  const tops = new Map(kinds.map((t) => [t.contentId, trafficHeightM(t)]));
  const topOf = (p: EntitySnapshot) => tops.get(p.contentId) ?? PEDS.maxContactH;
  const band = (PEDS.riderWidthM + smallWidth) / 2 + PEDS.lateralM;
  const diveTicks = Math.ceil(PEDS.diveS * 60) + 1;
  // Dive ages count scaled ticks (the sum of timeScale), as the sim's dive timer does: a hit-stop
  // freezes a dive in mid-air, so in raw ticks it lasts longer than diveTicks.
  let scaledTicks = 0;
  const lastDive = new Map<number, number>();
  const touching = new Set<string>();
  /** Riders whose crash went over a rail: falling to the water, not sliding along the deck. */
  const overboard = new Set<number>();
  /** Each rider's height in the last snapshot: what the peds step sees of a tumble this tick. */
  const prevH = new Map<number, number>();
  /** Each pedestrian's last snapshot: was it on the road, and how long ago did it dive. */
  const wasOn = new Map<number, boolean>();
  const out: TickCheck = {
    stepOns: 0,
    stepIns: [],
    ticks: 0,
    pairs: 0,
    threatTicks: 0,
    threatened: new Set(),
    undived: [],
    contacts: [],
  };
  return {
    onTick(snap: SimSnapshot, events: readonly SimEvent[]) {
      out.ticks++;
      scaledTicks += snap.timeScale;
      for (const e of events) if (e.type === 'pedDive') lastDive.set(e.actor, scaledTicks);
      for (const e of events) if (e.type === 'railOver') overboard.add(e.actor);
      for (const e of snap.entities) if (e.kind === 'rider' && e.mode !== 'Tumble') overboard.delete(e.id);
      const peds = snap.entities.filter((e) => e.kind === 'ped');
      for (const p of peds) {
        let lo = 0;
        let hi = 0;
        for (const lane of config.road.lanesAt(p.road.edge, p.road.s)) {
          lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
          hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
        }
        const on = p.road.d > lo && p.road.d < hi;
        const before = wasOn.get(p.id);
        wasOn.set(p.id, on);
        // A dive can land on the road (and the walk off it follows); only a walk onto it is a step.
        const diving = scaledTicks - (lastDive.get(p.id) ?? -1e9) <= diveTicks + 60 * PEDS.downS;
        if (before !== false || !on || diving) continue;
        out.stepOns++;
        for (const r of snap.entities) {
          if (r.kind !== 'rider' || !(r.mode === 'Road' || r.mode === 'Airborne' || r.mode === 'Tumble'))
            continue;
          if (r.speed < PEDS.threatMinMps + 0.5) continue;
          const rel = relate(config.road, r, p, PEDS.gapLookM);
          if (!rel || rel.along < 0) continue;
          const arrival = (rel.along - (PEDS.riderLengthM + bigLength) / 2) / r.speed;
          const sameHalf = Math.sign(r.road.d) === Math.sign(p.road.d) || Math.abs(r.road.d) <= 1;
          const level = r.road.h - p.road.h < topOf(p) && p.road.h - r.road.h < PEDS.maxContactH;
          if (arrival < PEDS.gapMarginS / 2 && sameHalf && level) {
            out.stepIns.push(
              `seed ${seed} tick ${snap.tick} rider ${r.id} ped ${p.id} arrival ${arrival.toFixed(2)} s`,
            );
          }
        }
      }
      for (const r of snap.entities) {
        if (r.kind !== 'rider' || !(r.mode === 'Road' || r.mode === 'Airborne' || r.mode === 'Tumble'))
          continue;
        for (const p of peds) {
          out.pairs++;
          const rel = relate(config.road, r, p, Math.max(10, pedThreatRangeM(r.speed)));
          const key = `${r.id}/${p.id}`;
          const overlap =
            rel !== null &&
            Math.abs(rel.along) < (PEDS.riderLengthM + bigLength) / 2 &&
            Math.abs(rel.side) < (PEDS.riderWidthM + bigWidth) / 2 &&
            r.road.h - p.road.h < topOf(p) &&
            p.road.h - r.road.h < PEDS.maxContactH;
          if (overlap && !touching.has(key)) {
            touching.add(key);
            out.contacts.push(`seed ${seed} tick ${snap.tick} rider ${r.id} (${r.mode}) ped ${p.id}`);
          } else if (!overlap) {
            touching.delete(key);
          }
          // One tick of travel as slack: a sliding crash moves in the tumble phase, after peds, so
          // the sim sees it one tick behind the snapshot.
          const slack = r.speed / 60 + 0.1;
          if (!rel || r.speed < PEDS.threatMinMps + 0.5) continue;
          // Over the rail and falling (its speed is the fall, its road spot the deck it left): no
          // threat to anyone on the road. Seed 1 met one once the 2026-10-02 run-back trim
          // reshuffled the race.
          if (overboard.has(r.id)) continue;
          // The height lags a tick too: a crash thrown high falls in the tumble phase, after peds, so
          // the sim judged last tick's height (seed 5 once #353's Keys traffic reshuffled the race:
          // a rival falling 0.16 m a tick read 1.36 m here and 1.52 m to the sim, over its 1.5).
          const seenH = r.mode === 'Tumble' ? Math.max(r.road.h, prevH.get(r.id) ?? r.road.h) : r.road.h;
          if (seenH - p.road.h >= topOf(p) - 0.1) continue;
          if (rel.along < -PEDS.threatBehindM + slack || rel.along > pedThreatRangeM(r.speed) - slack)
            continue;
          if (Math.abs(rel.side) >= band - 0.1) continue;
          out.threatTicks++;
          out.threatened.add(p.id);
          if (scaledTicks - (lastDive.get(p.id) ?? -1e9) > diveTicks) {
            out.undived.push(`seed ${seed} tick ${snap.tick} rider ${r.id} ped ${p.id}`);
          }
        }
      }
      for (const e of snap.entities) if (e.kind === 'rider') prevH.set(e.id, e.road.h);
    },
    result: () => out,
  };
}

let race: ReturnType<typeof createBatchRace>;
let config: SimConfig;
let base: SimSnapshot;
beforeAll(() => {
  race = createBatchRace(1);
  config = race.config;
  base = race.sim.snapshot();
});

function snapshot(tick: number, distance: number, side: number, mode: EntitySnapshot['mode'] = 'Road') {
  const rider: EntitySnapshot = {
    ...base.entities[0]!,
    id: 0,
    kind: 'rider',
    mode,
    speed: 20,
    road: { ...base.entities[0]!.road, s: 100, d: 0.5, h: 0, dir: 1 },
  };
  const ped: EntitySnapshot = {
    ...rider,
    id: 100,
    kind: 'ped',
    speed: 0,
    contentId: config.trafficTypes.find((t) => t.category === 'pedestrian')!.contentId,
    road: { ...rider.road, s: 100 + distance, d: side },
  };
  return { ...base, tick, timeScale: 1, entities: [rider, ped] };
}

function compareFrames(frames: readonly { snap: SimSnapshot; events: readonly SimEvent[] }[]) {
  const old = literalReference(1, config);
  const hook = pedestrianChecker(1, config);
  for (const { snap, events } of frames) {
    old.onTick(snap, events);
    hook.onTick(snap, events);
    expect(hook.result()).toEqual({ ...old.result(), seed: 1, threatened: [...old.result().threatened] });
  }
  return hook.result();
}

function cached(seed: number, threatened: number[] = [], stepOns = 0) {
  const result = { ...pedestrianChecker(seed, config).result(), ticks: 1, threatened, stepOns };
  return { seed, difficulty: 'normal' as const, ticks: 1, hooks: { [PEDESTRIAN_HOOK_ID]: result } };
}

describe('pedestrian shared-batch snapshot oracle', () => {
  it('detects contact, missed threat and an unsafe road entry, with safe controls', () => {
    const contact = compareFrames([{ snap: snapshot(1, 0, 0.5), events: [] }]);
    expect(contact.contacts).toEqual(['seed 1 tick 1 rider 0 (Road) ped 100']);
    expect(contact.undived).toEqual(['seed 1 tick 1 rider 0 ped 100']);
    expect(contact.threatened).toEqual([100]);
    const threat = compareFrames([{ snap: snapshot(1, 8, 0.5), events: [] }]);
    expect(threat.contacts).toEqual([]);
    expect(threat.undived).toHaveLength(1);
    const edge = base.entities[0]!.road.edge;
    const outside = Math.max(...config.road.lanesAt(edge, 108).map((l) => l.dCenterM + l.widthM / 2)) + 1;
    const step = compareFrames([
      { snap: snapshot(1, 8, outside), events: [] },
      { snap: snapshot(2, 8, 0.5), events: [] },
    ]);
    expect(step.stepOns).toBe(1);
    expect(step.stepIns).toHaveLength(1);
    const safe = compareFrames([{ snap: snapshot(1, 80, outside), events: [] }]);
    expect(safe.pairs).toBe(1);
    expect(safe.contacts).toEqual([]);
    expect(safe.undived).toEqual([]);
    expect(safe.stepIns).toEqual([]);
    const dived = compareFrames([
      {
        snap: snapshot(1, 8, 0.5),
        events: [{ tick: 1, type: 'pedDive', actor: 100, data: {} }],
      },
    ]);
    expect(dived.threatTicks).toBe(1);
    expect(dived.undived).toEqual([]);
  });

  it('retains contact episodes, rail exclusion and tumble height history', () => {
    const far = snapshot(4, 80, 0.5);
    const frames = [
      { snap: snapshot(1, 0, 0.5), events: [] },
      { snap: snapshot(2, 0, 0.5), events: [] },
      { snap: far, events: [] },
      { snap: snapshot(5, 0, 0.5), events: [] },
      {
        snap: snapshot(6, 8, 0.5, 'Tumble'),
        events: [{ tick: 6, type: 'railOver' as const, actor: 0, data: {} }],
      },
      { snap: snapshot(7, 8, 0.5, 'Tumble'), events: [] },
      { snap: snapshot(8, 8, 0.5), events: [{ tick: 8, type: 'pedDive' as const, actor: 100, data: {} }] },
      { snap: { ...snapshot(9, 8, 0.5), timeScale: 0 }, events: [] },
    ];
    const out = compareFrames(frames);
    expect(out.contacts).toHaveLength(2);
    expect(out.threatTicks).toBe(5);
    expect(out.undived).toHaveLength(3);
    const high = snapshot(1, 8, 0.5, 'Tumble');
    const low = snapshot(2, 8, 0.5, 'Tumble');
    const top = trafficHeightM(config.trafficTypes.find((t) => t.contentId === high.entities[1]!.contentId)!);
    high.entities[0]!.road.h = top + 1;
    expect(
      compareFrames([
        { snap: high, events: [] },
        { snap: low, events: [] },
      ]).threatTicks,
    ).toBe(0);
  });

  it('ages dives in scaled time, including a freeze longer than a dive in raw ticks', () => {
    const length = Math.ceil(PEDS.diveS * 60) + 4;
    const frames = Array.from({ length }, (_, i) => ({
      snap: { ...snapshot(i + 1, 8, 0.5), timeScale: i === 0 ? 1 : 0 },
      events: i === 0 ? [{ tick: 1, type: 'pedDive' as const, actor: 100, data: {} }] : [],
    }));
    expect(compareFrames(frames).undived).toEqual([]);
    expect(
      compareFrames(frames.map((f) => ({ ...f, snap: { ...f.snap, timeScale: 1 } }))).undived.length,
    ).toBeGreaterThan(0);
  });

  it('registers only original Normal seeds 1 through 16 and otherwise reads no snapshots', () => {
    expect(BATCH_HOOKS).toContain(pedestrianHook);
    const info: BatchRaceInfo = { seed: 1, difficulty: 'normal', playerId: race.playerId, config };
    for (let seed = 1; seed <= 16; seed++) {
      const hook = pedestrianHook.create({ ...info, seed });
      hook.onTick(snapshot(1, 8, 0.5), []);
      expect(
        pedestrianCheckOf({
          seed,
          difficulty: 'normal',
          ticks: 1,
          hooks: { [PEDESTRIAN_HOOK_ID]: hook.result() },
        }).pairs,
      ).toBe(1);
    }
    const unreadable = new Proxy({} as SimSnapshot, {
      get() {
        throw new Error('inactive hook read');
      },
    });
    for (const difficulty of ['easy', 'hard', 'normal'] as const) {
      for (const seed of [0, 1, 16, 17, 50, 1.5]) {
        if (difficulty === 'normal' && (seed === 1 || seed === 16)) continue;
        const hook = pedestrianHook.create({ ...info, difficulty, seed });
        hook.onTick(unreadable, []);
        expect(hook.result()).toBeNull();
      }
    }
  });

  it('round-trips JSON and rejects missing or malformed cache payloads explicitly', () => {
    const entry = cached(1, [100], 1);
    const cold = pedestrianCheckOf(entry);
    expect(pedestrianCheckOf(JSON.parse(JSON.stringify(entry)) as typeof entry)).toEqual(cold);
    for (const bad of [
      undefined,
      null,
      {},
      { ...cold, seed: 2 },
      { ...cold, ticks: 0 },
      { ...cold, pairs: NaN },
      { ...cold, ticks: -1 },
      { ...cold, stepOns: 0.5 },
      { ...cold, contacts: [4] },
      { ...cold, threatened: [100, 100] },
      { ...cold, threatened: new Set([100]) },
      { ...cold, threatened: [-1] },
    ]) {
      expect(() => pedestrianCheckOf({ ...entry, hooks: { [PEDESTRIAN_HOOK_ID]: bad } })).toThrow(
        /pedestrian.*seed 1/i,
      );
    }
    expect(() => pedestrianCheckOf({ ...entry, hooks: {} })).toThrow(/pedestrian.*seed 1/i);
    expect(() => pedestrianCheckOf({ ...entry, hooks: undefined! })).toThrow(/pedestrian.*seed 1/i);
  });

  it('consumes all first five seeds, then only consecutive extra seeds until both witnesses exist', () => {
    const five = Array.from({ length: 5 }, (_, i) => cached(i + 1, i === 4 ? [100] : [], i === 4 ? 1 : 0));
    expect(selectedPedestrianChecks(five).map((c) => c.seed)).toEqual([1, 2, 3, 4, 5]);
    const early = five.map((r) => cached(r.seed, r.seed === 1 ? [100] : [], r.seed === 1 ? 1 : 0));
    expect(selectedPedestrianChecks(early)).toHaveLength(5);
    expect(() => selectedPedestrianChecks(five.slice(0, 4))).toThrow(/seed 5/);
    const extra = Array.from({ length: 16 }, (_, i) => cached(i + 1, i === 5 ? [100] : [], i === 6 ? 1 : 0));
    expect(selectedPedestrianChecks(extra).map((c) => c.seed)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(selectedPedestrianChecks(extra.map((r) => cached(r.seed)))).toHaveLength(16);
    expect(() => selectedPedestrianChecks(extra.filter((r) => r.seed !== 6))).toThrow(/seed 6/);
  });

  it('matches the literal oracle each tick and leaves bounded real inputs, events and hashes unchanged', () => {
    const control = createBatchRace(1);
    const active = createBatchRace(1);
    const bots = [createBot(), createBot()];
    const hook = pedestrianHook.create({
      seed: 1,
      difficulty: 'normal',
      playerId: active.playerId,
      config: active.config,
    });
    const old = literalReference(1, active.config);
    let oldResult = old.result();
    for (let tick = 0; tick < 120; tick++) {
      const inputs = [control, active].map((r, i) => {
        const actions = emptyActions();
        bots[i]!.drive(r.sim.snapshot(), r.playerId, r.route, actions);
        return toSimInput(actions);
      });
      expect(inputs[1]).toEqual(inputs[0]);
      control.sim.step([inputs[0]!]);
      active.sim.step([inputs[1]!]);
      const snap = active.sim.snapshot();
      const events = active.sim.events();
      hook.onTick(snap, events);
      old.onTick(snap, events);
      oldResult = old.result();
      expect(hook.result()).toEqual({ ...oldResult, seed: 1, threatened: [...oldResult.threatened] });
      expect(snap).toEqual(control.sim.snapshot());
      expect(events).toEqual(control.sim.events());
      expect(active.sim.hash()).toBe(control.sim.hash());
    }
    expect(oldResult.ticks).toBe(120);
    expect(oldResult.pairs).toBeGreaterThan(0);
  });
});
