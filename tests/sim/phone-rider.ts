/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// A phone-like rider (playtest 4; the riding audit's model of a phone player: the thumb
// holds the throttle and the bars go to full lock in a bend, which the steering cap turns into a
// steady run wide above each bend's full-lock holding speed √(4·steer rate·R)). Two habits:
// - `line`: the dev bot's lane-keeping law toward a line across the road, fed the bend ahead,
//   saturating at full lock; the throttle held, no brake for a bend; the thumb 0.2 s behind;
// - `late`: straight until 1.5 m off its line, then full lock back until within 0.5 m, the throttle
//   held, the thumb 0.25 s behind.
// Both have eyes for cars (the brake at 0.6 for a vehicle close ahead in its path, as the drift
// room test's bot) and skip the run-back after a crash. It never fights and never takes a shortcut.
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import {
  createSim,
  InputFlag,
  quantizeInput,
  type SimConfig,
  type SimInput,
  type SimSnapshot,
} from '../../src/sim/api';

export const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();

export type PhoneHabit = 'line' | 'late';

export interface PhoneRider {
  habit: PhoneHabit;
  /** The line it keeps across the road, m (right of the centreline as it rides). */
  lineD: number;
}

interface Command {
  steer: number;
  throttle: number;
  brake: number;
  flags: number;
}

/** A race of an event on a route, with its whole field and world, the player on `bike`. */
export function raceConfig(
  event: string,
  route: string,
  seed: number,
  bike: string,
  tuning: Record<string, number> = {},
): SimConfig {
  return buildSimConfig(REG, STREAMS.forEvent(REG, event, undefined, route), {
    seed,
    eventId: event,
    route,
    playerBike: bike,
    tuning,
  });
}

function carAhead(snap: SimSnapshot, id: number): boolean {
  const me = snap.entities[id];
  if (!me) return false;
  const fx = -Math.sin(me.heading);
  const fz = -Math.cos(me.heading);
  for (const e of snap.entities) {
    if (e.kind !== 'vehicle') continue;
    const dx = e.x - me.x;
    const dz = e.z - me.z;
    const ahead = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    if (ahead > 0 && ahead < 8 + me.speed * 1.2 && side < 2.2 && me.speed > e.speed + 1) return true;
  }
  return false;
}

/** The rider's command for this tick (before the thumb's delay). `lock` keeps the late habit's state. */
function command(
  config: SimConfig,
  snap: SimSnapshot,
  id: number,
  r: PhoneRider,
  st: { lock: number },
): Command {
  const me = snap.entities[id];
  if (!me) return { steer: 0, throttle: 1, brake: 0, flags: 0 };
  if (me.mode === 'Tumble' || me.mode === 'OnFoot')
    return { steer: 0, throttle: 0, brake: 0, flags: InputFlag.skipRunBack };
  if (me.mode !== 'Road') return { steer: 0, throttle: 1, brake: 0, flags: 0 };
  const { edge, s, d, dir, yaw } = me.road;
  const v = Math.max(me.speed, 5);
  const target = r.lineD * dir;
  let steer: number;
  if (r.habit === 'late') {
    const off = (d - target) * dir;
    if (st.lock === 0 && Math.abs(off) > 1.5) st.lock = off > 0 ? -1 : 1;
    if (st.lock !== 0 && Math.abs(off) < 0.5) st.lock = 0;
    steer = st.lock;
  } else {
    const bend = config.road.kappaAt(edge, s) * dir;
    steer = 0.35 * (target - d) * dir - 2.5 * yaw + (bend * v * v) / 22;
  }
  const cmd = { steer: Math.max(-1, Math.min(1, steer)), throttle: 1, brake: 0, flags: 0 };
  return carAhead(snap, id) ? { ...cmd, throttle: 0, brake: 0.6 } : cmd;
}

export interface PhoneCrash {
  /** Metres along the route from the grid where it crashed. */
  atM: number;
  cause: string;
  speed: number;
}

export interface PhoneRun {
  crashes: PhoneCrash[];
  /** The rider's speed as it reached `markM` from the grid (NaN if it never did). */
  speedAtMark: number;
}

/**
 * Rides the player from the grid until `untilM` metres along its starting road (or a tick cap), and
 * returns its crashes on the way. The start road must be long enough (it is on the Gorge: 2970 m).
 */
export function phoneRide(config: SimConfig, r: PhoneRider, untilM: number, markM: number): PhoneRun {
  const sim = createSim(config);
  const id = config.riders.findIndex((x) => x.controller.kind === 'player');
  const start = sim.snapshot().entities[id]?.road;
  if (!start) throw new Error('no player');
  const delay = r.habit === 'late' ? 15 : 12;
  const queue: Command[] = [];
  const st = { lock: 0 };
  const run: PhoneRun = { crashes: [], speedAtMark: Number.NaN };
  let at = 0;
  while (!sim.isOver() && sim.tick < 60 * 120) {
    const snap = sim.snapshot();
    const me = snap.entities[id];
    if (!me) break;
    if (me.mode === 'Road' && me.road.edge === start.edge)
      at = Math.max(at, (me.road.s - start.s) * start.dir);
    if (Number.isNaN(run.speedAtMark) && at >= markM) run.speedAtMark = me.speed;
    if (at >= untilM) break;
    const now = command(config, snap, id, r, st);
    queue.push(now);
    const c = queue.length > delay ? (queue.shift() ?? now) : { steer: 0, throttle: 1, brake: 0, flags: 0 };
    sim.step([quantizeInput({ ...c, flags: now.flags })] as SimInput[]);
    for (const e of sim.events()) {
      if (e.actor !== id || e.type !== 'crash') continue;
      const data = e.data as Record<string, unknown>;
      const cause = data['cause'] ?? data['reason'];
      run.crashes.push({
        atM: Math.round(at),
        cause: typeof cause === 'string' ? cause : 'other',
        speed: Number(data['speed'] ?? me.speed),
      });
    }
  }
  return run;
}
