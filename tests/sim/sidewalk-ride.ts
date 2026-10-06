/// <reference types="vite/client" />
// The sidewalk-dodge harness (playtest 4, "most things on the sidewalks jump out of the way"): a
// scripted rider rides a real event's route fast up the verge, aiming at the nearest thing that
// lives there, and the harness records, per sidewalk thing, whether it got out of the way.
//
// "A thing" is every pedestrian and animal entity, and every kerb vehicle (cyclists, scooters, carts,
// pedicabs). It is in the rider's way when, as the rider closes to `TRACK_AHEAD_M`, its lane is
// within the two half widths plus `PATH_SLACK_M` of the rider's. It dodged when it moved sideways at least `DODGE_MOVE_M`,
// jumped (height), or the sim named it in a `pedDive` or `pedReact` event while the rider closed.
// It made contact when its box and the rider's box overlapped on the ground at some tick.
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type EntitySnapshot, type SimConfig } from '../../src/sim/api';

export const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
export const STREAMS = createStreamCache();

export const TRACK_AHEAD_M = 45;
/** In the way: lane centres within the two half widths plus this much (m) when first tracked, so a thing
 * the rider would only have brushed past a standing thing is not counted as dodging or not dodging. */
export const PATH_SLACK_M = 0;
export const DODGE_MOVE_M = 0.6;
export const RIDE_MPS = 22;
/** Only a rider closing this fast (m/s) at the moment a thing is first tracked makes it a thing 'in the way'. */
export const FAST_CLOSING_MPS = 12;

export interface Thing {
  id: number;
  kind: string;
  contentId: string;
  /** Its lane (d) when tracking began, and the farthest it moved from there. */
  d0: number;
  moved: number;
  jumped: boolean;
  evented: boolean;
  contact: boolean;
  /** The least side-to-side clearance (box edge to box edge) at the moment of passing, m. */
  clearance: number;
  /** The rider's lane when the clearance was least, and the thing's lane then. */
  riderD: number;
  thingD: number;
  inPath: boolean;
  done: boolean;
}

export interface RideOptions {
  seed: number;
  eventId: string;
  tuning?: Record<string, number>;
  maxTicks?: number;
  /** Brake to a stop when the nearest thing in the way is this close (m); 0 = never brake. */
  brakeAtM?: number;
}

export interface ThingHit {
  type: string;
  tick: number;
  thing: string;
}

export interface RideResult {
  things: Thing[];
  ticks: number;
  crashes: number;
  wobbles: number;
  /** The rider's crashes and wobbles whose cause was a pedestrian, an animal or a vehicle. */
  thingHits: ThingHit[];
  /** Rider-contact events with kerb things (crash or wobble naming a vehicle of a kerb type). */
  config: SimConfig;
}

export function ride(o: RideOptions): RideResult {
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, o.eventId), {
    seed: o.seed,
    eventId: o.eventId,
    ...(o.tuning ? { tuning: o.tuning } : {}),
  });
  const sim = createSim(config);
  const types = new Map(config.trafficTypes.map((t) => [t.contentId, t]));
  const isThing = (e: EntitySnapshot): boolean => {
    if (e.kind === 'ped') return true;
    if (e.kind !== 'vehicle') return false;
    return types.get(e.contentId)?.behaviour?.kerb === true;
  };
  const things = new Map<number, Thing>();
  const lastD = new Map<number, number>();
  let crashes = 0;
  const thingHits: ThingHit[] = [];
  let stoppedFor = 0;
  let wobbles = 0;
  let snap = sim.snapshot();
  const max = o.maxTicks ?? 60 * 140;
  const side = o.seed % 2 === 0 ? -1 : 1;
  let stopped = false;
  const locked = new Map<number, number>();
  for (let i = 0; i < max && !sim.isOver(); i++) {
    const me = snap.entities.find((e) => e.kind === 'rider' && e.slot === 0);
    const a = emptyActions();
    if (me) {
      const { edge, s, d, dir } = me.road;
      // The nearest thing ahead on this edge, in the rider's direction.
      let aim: EntitySnapshot | null = null;
      let aimAhead = Infinity;
      for (const e of snap.entities) {
        if (!isThing(e) || e.road.edge !== edge) continue;
        const ahead = (e.road.s - s) * dir;
        if (ahead < 4 || ahead > 70) continue;
        // Only a thing on the rider's side of the road is a sidewalk thing.
        if (Math.sign(e.road.d) !== side) continue;
        if (ahead < aimAhead) {
          aim = e;
          aimAhead = ahead;
        }
      }
      const v = config.road.vergeAt(edge, s, side < 0 ? 'left' : 'right');
      const inner = v.dInner + side * 0.9;
      const outer = v.dOuter - side * 0.6;
      const lim = (x: number) =>
        side > 0 ? Math.min(Math.max(x, inner), outer) : Math.max(Math.min(x, inner), outer);
      // The rider commits: it picks the lane of the thing it aims at once and holds it (a homing
      // rider that re-aims every tick would chase a thing that steps aside).
      if (aim && !locked.has(aim.id)) locked.set(aim.id, lim(aim.road.d));
      const target = aim ? (locked.get(aim.id) ?? inner) : inner;
      a.steer = Math.max(-1, Math.min(1, (target - d) * 0.6 * dir));
      a.throttle = me.speed < RIDE_MPS ? 1 : 0.3;
      if (o.brakeAtM && aim && aimAhead < o.brakeAtM + me.speed * 0.5) {
        stopped = true;
      }
      if (stopped) {
        a.throttle = 0;
        a.brake = 1;
        // Held at a stop for a while, then the ride is over.
        if (me.speed < 0.5 && ++stoppedFor > 600) break;
      }
      for (const e of snap.entities) {
        if (!isThing(e) || e.road.edge !== edge) continue;
        const ahead = (e.road.s - s) * dir;
        let t = things.get(e.id);
        if (!t && ahead <= TRACK_AHEAD_M && ahead > 0) {
          t = {
            id: e.id,
            kind: e.kind,
            contentId: e.contentId,
            d0: e.road.d,
            moved: 0,
            jumped: false,
            evented: false,
            contact: false,
            clearance: Infinity,
            riderD: NaN,
            thingD: NaN,
            inPath:
              Math.abs(e.road.d - d) <= (0.8 + (types.get(e.contentId)?.widthM ?? 0.5)) / 2 + PATH_SLACK_M &&
              Math.sign(e.road.d) === side &&
              me.speed - (e.kind === 'vehicle' ? e.speed : 0) >= FAST_CLOSING_MPS,
            done: false,
          };
          things.set(e.id, t);
        }
        if (!t || t.done) continue;
        t.moved = Math.max(t.moved, Math.abs(e.road.d - t.d0));
        if (e.road.h > 0.15) t.jumped = true;
        const lengthM = types.get(e.contentId)?.lengthM ?? 0.5;
        const widthM = types.get(e.contentId)?.widthM ?? 0.5;
        if (Math.abs(ahead) < (2 + lengthM) / 2) {
          const clr = Math.abs(e.road.d - d) - (0.8 + widthM) / 2;
          if (clr < t.clearance) {
            t.clearance = clr;
            t.riderD = d;
            t.thingD = e.road.d;
          }
          if (clr < 0 && me.road.h < 1.5 && e.road.h < 0.5) {
            const first = !t.contact;
            t.contact = true;
            if (first && process.env['PROBE_DEBUG'])
              process.stdout.write(
                `[contact] ${e.contentId} tick ${sim.tick} rider d ${d.toFixed(2)} spd ${me.speed.toFixed(1)} thing d0 ${t.d0.toFixed(2)} now ${e.road.d.toFixed(2)} ahead ${ahead.toFixed(1)} edge ${edge} s ${s.toFixed(0)} verge ${JSON.stringify([config.road.vergeAt(edge, s, side < 0 ? 'left' : 'right').dInner.toFixed(2), config.road.vergeAt(edge, s, side < 0 ? 'left' : 'right').dOuter.toFixed(2)])}
`,
              );
          }
        }
        if (ahead < -6) t.done = true;
      }
    }
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    for (const ev of sim.events()) {
      if (ev.type === 'crash' && ev.actor === me?.id) crashes++;
      if (ev.type === 'wobble' && ev.actor === me?.id) wobbles++;
      const cause = ev.data['cause'];
      if (
        (ev.type === 'crash' || ev.type === 'wobble') &&
        ev.actor === me?.id &&
        (cause === 'ped' || cause === 'traffic')
      )
        thingHits.push({
          type: ev.type,
          tick: sim.tick,
          thing: String(ev.data['vehicle'] ?? ev.data['kind'] ?? ''),
        });
      if (ev.type === 'pedDive' || ev.type === 'pedReact') {
        const t = things.get(ev.actor);
        if (t) t.evented = true;
      }
    }
    void lastD;
  }
  return { things: [...things.values()], ticks: sim.tick, crashes, wobbles, thingHits, config };
}

export const dodged = (t: Thing): boolean => t.moved >= DODGE_MOVE_M || t.jumped || t.evented;

export function tally(rows: readonly Thing[]): Map<string, { n: number; dodged: number; contact: number }> {
  const out = new Map<string, { n: number; dodged: number; contact: number }>();
  for (const t of rows) {
    if (!t.inPath) continue;
    const r = out.get(t.contentId) ?? { n: 0, dodged: 0, contact: 0 };
    r.n++;
    if (dodged(t)) r.dodged++;
    if (t.contact) r.contact++;
    out.set(t.contentId, r);
  }
  return out;
}
