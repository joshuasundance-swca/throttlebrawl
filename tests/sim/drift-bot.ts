/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// The drift bot, shared by tests/sim/drift-hairpins.test.ts (the G5 figure, printed) and
// tests/sim/drift-events.test.ts (every drift career event's target against the critic's C4 cap).
// A scripted rider rides a route alone: the dev bot's lane-keeping line, the brake and the bars
// together into every bend of 60 m radius or tighter (the drift's way in), the line held through it
// with the slide, and the bars let go after. It rides under the ISOLATED profile (every optional
// world system off), no rivals and no cop, so it measures the drift, not the field. Drift style cash
// is paid at `perDriftSecondCash`, which a case sets to 1 to scale straight to any event's rate
// (buildSimConfig's default is 3 x the event's perOncomingSecondCash), or leaves to the event's own.
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import type { RoadPos } from '../../src/road';
import { createSim, quantizeInput, type SimConfig, type SimInput, type SimSnapshot } from '../../src/sim/api';
import { ISOLATED } from './batch';

export const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
export const MAX_TICKS = 60 * 600;

/** The drift bot turns in on bends of this curvature or more (60 m radius, the spec's corner). */
export const CORNER_KAPPA = 1 / 60;
/** It slows for a bend to sqrt(HOLD_MARGIN × steer rate / κ): what the slide's reach can hold. */
const HOLD_MARGIN = 6;
/** It turns in only at up to this much over that speed; faster, it brakes straight first. */
const TURN_IN_OVER = 1.15;

/** The drift career events' routes (scratch progression.md §8), each with an event that races it. */
export const ROUTES = [
  {
    label: 'Crown Point loops (osm-gorge-run)',
    event: 'region-pnw:pnw-fogline-run',
    route: 'region-pnw:osm-gorge-run',
  },
  {
    label: 'Twin Peaks (osm-sf-twin-peaks-run)',
    event: 'region-sf:sf-hill-sprint',
    route: 'region-sf:osm-sf-twin-peaks-run',
  },
  { label: 'Switchback Street (sf-standard-run)', event: 'region-sf:sf-hill-sprint', route: undefined },
] as const;
/** A race to ride: an event, and the route to ride it on (left out, the event's own). */
export interface Route {
  readonly label: string;
  readonly event: string;
  readonly route: string | undefined;
}
export const GORGE: Route = ROUTES[0];

/** The race alone: the player only, every optional world system off, drift cash at 1 a second. */
export function soloConfig(
  c: Route,
  bike: string,
  seed: number,
  tuning: Record<string, number> = {},
  /** Drift cash a second: 1 for the G5 figure, null to keep the event's own rate. */
  perDriftSecondCash: number | null = 1,
): SimConfig {
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, c.event, undefined, c.route), {
    seed,
    eventId: c.event,
    ...(c.route ? { route: c.route } : {}),
    playerBike: bike,
    tuning: { ...ISOLATED, ...tuning },
  });
  const style = config.event.style;
  if (!style) throw new Error(`${c.event}: no style rewards`);
  return {
    ...config,
    riders: config.riders.filter((r) => r.controller.kind === 'player'),
    event: {
      ...config.event,
      style: perDriftSecondCash === null ? style : { ...style, perDriftSecondCash },
    },
  };
}

/** The sharpest bend within `lookM` ahead along the rider's travel (κ·dir: positive turns right). */
export function sharpestAhead(config: SimConfig, pos: RoadPos, lookM: number): number {
  const at: RoadPos = { ...pos };
  let best = 0;
  for (let a = 0; a <= lookM; a += 3) {
    if (a > 0) {
      at.s += at.dir * 3;
      if (config.road.advance(at) === 'deadEnd') break;
    }
    const k = config.road.kappaAt(at.edge, at.s) * at.dir;
    if (Math.abs(k) > Math.abs(best)) best = k;
  }
  return best;
}

/** The speed the slide can hold a bend of curvature k at (its reach must beat the road's pull). */
const holdMps = (steerRateMps: number, k: number) =>
  Math.sqrt((HOLD_MARGIN * steerRateMps) / Math.max(Math.abs(k), 1e-4));

/** The drift bot's command for this tick. */
export function driftBot(config: SimConfig, snap: SimSnapshot, id: number): SimInput {
  const me = snap.entities[id];
  const def = config.riders[id];
  if (!me || !def || me.mode !== 'Road') return quantizeInput({ steer: 0, throttle: 1, brake: 0, flags: 0 });
  const { edge, s, d, dir, yaw } = me.road;
  const v = Math.max(me.speed, 5);
  const lanes = config.route.lanesAt(edge, s);
  const lane = lanes.find((l) => l.kind === 'drive' && l.direction === dir) ?? lanes[0];
  // The dev bot's line: its lane's centre, the bend fed forward.
  const bend = config.route.kappaAt(edge, s) * dir;
  const law = 0.35 * ((lane?.dCenterM ?? 0) - d) * dir - 2.5 * yaw + (bend * v * v) / 22;
  const pos: RoadPos = { edge, s, d, dir };
  const rate = def.bike.steerRateMps;
  const far = sharpestAhead(config, pos, 30 + (me.speed * me.speed) / 12);
  const near = sharpestAhead(config, pos, 30);
  const here = sharpestAhead(config, pos, 12);
  const side = snap.moves?.driftSide ?? 0;
  let steer = law;
  let throttle = 1;
  let brake = 0;
  if (side !== 0) {
    // Sliding: hold the line, the bars kept into the bend while it lasts; then let go.
    if (Math.abs(here) >= 1 / 150 && Math.sign(here) === side) steer = side * Math.max(0.3, law * side);
    throttle = me.speed > holdMps(rate, here || near) ? 0 : 1;
    // A bend that tightens ahead of the slide: brake in it (the drift keeps going).
    if (me.speed > holdMps(rate, far)) brake = 1;
  } else if (
    Math.abs(near) >= CORNER_KAPPA &&
    me.speed >= 20 &&
    me.speed <= TURN_IN_OVER * holdMps(rate, far)
  ) {
    // Turn in on the brakes: the drift's way in.
    const want = Math.sign(near);
    brake = 1;
    throttle = 0;
    steer = want * Math.max(0.5, law * want);
  } else if (Math.abs(near) >= CORNER_KAPPA && me.speed >= 20) {
    // Still too fast to turn in: brake straight first.
    brake = 1;
    throttle = 0;
  } else if (me.speed > holdMps(rate, far)) {
    // Any bend ahead it could not hold at this speed: brake for it.
    brake = 1;
    throttle = 0;
  }
  return quantizeInput({ steer: Math.max(-1, Math.min(1, steer)), throttle, brake, flags: 0 });
}

export interface BotRun {
  finished: boolean;
  seconds: number;
  /** Banked drift style cash (sim/race's `style` events of kind `drift`), at 1 a second. */
  driftCash: number;
  drifts: number;
  banks: number;
  crashes: number;
  inputs: SimInput[];
  hash: string;
}

export function botRace(config: SimConfig): BotRun {
  const sim = createSim(config);
  const id = config.riders.findIndex((r) => r.controller.kind === 'player');
  const run: BotRun = {
    finished: false,
    seconds: 0,
    driftCash: 0,
    drifts: 0,
    banks: 0,
    crashes: 0,
    inputs: [],
    hash: '',
  };
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const cmd = driftBot(config, sim.snapshot(), id);
    run.inputs.push(cmd);
    sim.step([cmd]);
    for (const e of sim.events()) {
      if (e.actor !== id) continue;
      if (e.type === 'finish') {
        run.finished = true;
        run.seconds = e.tick / 60;
      } else if (e.type === 'driftStart') run.drifts++;
      else if (e.type === 'crash') run.crashes++;
      else if (e.type === 'style' && e.data['kind'] === 'drift') {
        run.driftCash += Number(e.data['points']);
        run.banks++;
      }
    }
  }
  run.hash = String(sim.hash());
  return run;
}

export const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};
