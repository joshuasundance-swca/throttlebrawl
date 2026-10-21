// Independent snapshot-only contact/threat/gap oracle reused by the original Normal batch.
// The public geometry and per-tick state transitions are retained from traffic-peds.test.ts.
import { PEDS, pedThreatRangeM } from '../../../src/sim/peds';
import {
  trafficHeightM,
  type EntitySnapshot,
  type RoadNetwork,
  type SimConfig,
  type SimEvent,
  type SimSnapshot,
} from '../../../src/sim/api';
import type { RaceResult } from '../batch';
import type { BatchHook } from './index';

export const PEDESTRIAN_HOOK_ID = 'traffic-peds';
/** Mandatory coverage, even when the first seed already supplies both witnesses. */
const PER_TICK_SEEDS = [1, 2, 3, 4, 5];
/** Continue in seed order until threats and road-entry steps have both been observed. */
const PER_TICK_LAST_SEED = 16;

/** Plain JSON: unique threatened ids retain their first-observed order across disk caching. */
export interface PedestrianCheck extends Omit<TickCheck, 'threatened'> {
  seed: number;
  threatened: number[];
}

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

export function pedestrianChecker(seed: number, config: SimConfig) {
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
    result: (): PedestrianCheck => ({ ...out, seed, threatened: [...out.threatened] }),
  };
}

export const pedestrianHook: BatchHook = {
  id: PEDESTRIAN_HOOK_ID,
  create({ seed, difficulty, config }) {
    if (difficulty === 'normal' && Number.isInteger(seed) && seed >= 1 && seed <= PER_TICK_LAST_SEED)
      return pedestrianChecker(seed, config);
    return { onTick() {}, result: () => null };
  },
};

type CachedRace = Pick<RaceResult, 'seed' | 'difficulty' | 'ticks' | 'hooks'>;

/** Missing/stale/corrupt results must fail rather than silently erase coverage or rerun races. */
export function pedestrianCheckOf(race: CachedRace): PedestrianCheck {
  const value = race.hooks?.[PEDESTRIAN_HOOK_ID];
  const bad = () => new Error(`Invalid pedestrian hook result for seed ${race.seed}`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad();
  const r = value as Record<string, unknown>;
  if (race.difficulty !== 'normal' || r['seed'] !== race.seed || r['ticks'] !== race.ticks) throw bad();
  for (const key of ['stepOns', 'ticks', 'pairs', 'threatTicks']) {
    const n = r[key];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) throw bad();
  }
  for (const key of ['stepIns', 'undived', 'contacts']) {
    const a = r[key];
    if (!Array.isArray(a) || !a.every((s: unknown) => typeof s === 'string')) throw bad();
  }
  const ids = r['threatened'];
  if (
    !Array.isArray(ids) ||
    !ids.every((n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) ||
    new Set(ids).size !== ids.length
  )
    throw bad();
  return value as PedestrianCheck;
}

/** Preserve the old mandatory five, then conditional sequential extension through seed 16. */
export function selectedPedestrianChecks(races: readonly CachedRace[]): PedestrianCheck[] {
  const read = (seed: number) => {
    const race = races.find((r) => r.seed === seed && r.difficulty === 'normal');
    if (!race) throw new Error(`Missing pedestrian batch race for seed ${seed}`);
    return pedestrianCheckOf(race);
  };
  const checks = PER_TICK_SEEDS.map(read);
  const total = (f: (c: PedestrianCheck) => number) => checks.reduce((n, c) => n + f(c), 0);
  for (let seed = Math.max(...PER_TICK_SEEDS) + 1; seed <= PER_TICK_LAST_SEED; seed++) {
    if (total((c) => c.threatened.length) > 0 && total((c) => c.stepOns) > 0) break;
    checks.push(read(seed));
  }
  return checks;
}
