/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 3: drift as a first-class move, on the real roads the drift career events race (scratch
// spec moves.md §4.2 test 7; the critic's G5: "Drift events need T2.3 (the `drift` style kind and the
// bot's cash figure)"). A scripted drift bot rides each route: the dev bot's lane-keeping line, the
// brake and the bars together into every bend of 60 m radius or tighter (the drift's way in), the
// line held through it with the slide, and the bars let go after. It rides alone: the ISOLATED
// profile (every optional world system off), no rivals and no cop, so it measures the drift, not the
// field. Drift style cash is paid at perDriftSecondCash 1, so its figure scales straight to any
// event's rate (buildSimConfig's default is 3 × the event's perOncomingSecondCash).
//
// The G5 figure: the bot's banked drift cash per route and bike, printed. A drift event's target is
// capped at 60 % of it at the event's own rate (the critic's C4), rounded to 50.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import type { RoadPos } from '../../src/road';
import { createSim, quantizeInput, type SimConfig, type SimInput, type SimSnapshot } from '../../src/sim/api';
import { ISOLATED } from './batch';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const MAX_TICKS = 60 * 600;

/** The drift bot turns in on bends of this curvature or more (60 m radius, the spec's corner). */
const CORNER_KAPPA = 1 / 60;
/** It slows for a bend to sqrt(HOLD_MARGIN × steer rate / κ): what the slide's reach can hold. */
const HOLD_MARGIN = 6;
/** It turns in only at up to this much over that speed; faster, it brakes straight first. */
const TURN_IN_OVER = 1.15;

/** The drift career events' routes (scratch progression.md §8), each with an event that races it. */
const ROUTES = [
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
type Route = (typeof ROUTES)[number];
const GORGE = ROUTES[0];

/** The race alone: the player only, every optional world system off, drift cash at 1 a second. */
function soloConfig(c: Route, bike: string, seed: number, tuning: Record<string, number> = {}): SimConfig {
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
    event: { ...config.event, style: { ...style, perDriftSecondCash: 1 } },
  };
}

/** The sharpest bend within `lookM` ahead along the rider's travel (κ·dir: positive turns right). */
function sharpestAhead(config: SimConfig, pos: RoadPos, lookM: number): number {
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
function driftBot(config: SimConfig, snap: SimSnapshot, id: number): SimInput {
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

interface BotRun {
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

function botRace(config: SimConfig): BotRun {
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

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

describe('drift on the real hairpins', () => {
  it('the drift bot rides the Crown Point loops: it banks drift cash and never crashes, 5 seeds', () => {
    const seeds = [1, 2, 3, 4, 5];
    const runs = seeds.map((seed) => botRace(soloConfig(GORGE, 'base:rustbucket-400', seed)));
    console.log(
      `[examined] ${GORGE.label}, Rustbucket 400: ` +
        runs
          .map(
            (r, i) =>
              `seed ${seeds[i]} ${r.seconds.toFixed(1)} s, ${r.drifts} drifts, ${r.banks} banked, ` +
              `$${r.driftCash}, ${r.crashes} crashes`,
          )
          .join('; '),
    );
    for (const r of runs) {
      expect(r.finished).toBe(true);
      expect(r.crashes).toBe(0);
      expect(r.drifts).toBeGreaterThanOrEqual(5);
      expect(r.driftCash).toBeGreaterThan(0);
    }
  }, 300_000);

  it('drifting through the bends is quicker than braking through them on the same line', () => {
    // The same bot with the drift off brakes for every bend it would have drifted (the turn-in is
    // the brake): the drift's reach, its exit boost and the tighter line must buy back more than the
    // slide's drag costs.
    const on = botRace(soloConfig(GORGE, 'base:rustbucket-400', 1));
    const off = botRace(soloConfig(GORGE, 'base:rustbucket-400', 1, { 'riders.drift': 0 }));
    console.log(
      `[examined] ${GORGE.label}, seed 1: drift on ${on.seconds.toFixed(1)} s (${on.drifts} drifts), ` +
        `off ${off.seconds.toFixed(1)} s`,
    );
    expect(on.finished && off.finished).toBe(true);
    expect(off.drifts).toBe(0);
    expect(on.seconds).toBeLessThan(off.seconds);
  }, 300_000);

  it('a drifting race replays to the same state hash from its recorded inputs', () => {
    const config = soloConfig(GORGE, 'base:rustbucket-400', 2);
    const first = botRace(config);
    const sim = createSim(config);
    for (const cmd of first.inputs) sim.step([cmd]);
    expect(first.drifts).toBeGreaterThan(0);
    expect(String(sim.hash())).toBe(first.hash);
  }, 300_000);

  it('prints the G5 figure: the bot banked drift cash per route and bike, at $1 a drift second', () => {
    // Alone on the road with every world system off, the seed changes next to nothing the bot meets
    // (the first test's five seeds bank the same cash), so two seeds a case keep the run short.
    const seeds = [1, 2];
    const bikes = ['base:rustbucket-400', 'base:streetfighter-750', 'base:superbike-1000'];
    const lines: string[] = [];
    let gorge = 0;
    for (const c of ROUTES) {
      for (const bike of bikes) {
        const runs = seeds.map((seed) => botRace(soloConfig(c, bike, seed)));
        const cash = runs.map((r) => r.driftCash);
        lines.push(
          `${c.label}, ${bike}: median $${median(cash)} (seeds ${seeds.join(', ')}: ` +
            `${cash.map((x) => `$${x}`).join(', ')}), ${median(runs.map((r) => r.drifts))} drifts, ` +
            `${runs.reduce((n, r) => n + r.crashes, 0)} crashes, median ${median(runs.map((r) => r.seconds)).toFixed(1)} s`,
        );
        if (c === GORGE && bike === 'base:rustbucket-400') gorge = median(cash);
      }
    }
    console.log(`[G5] drift bot, banked drift cash at perDriftSecondCash 1:\n${lines.join('\n')}`);
    expect(lines).toHaveLength(ROUTES.length * bikes.length);
    expect(gorge).toBeGreaterThan(0);
  }, 600_000);
});
