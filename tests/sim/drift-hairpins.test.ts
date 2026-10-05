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
//
// The last case (T2.6, the critic's C5) probes Lombard Street, whose hairpins sit below the drift's
// speed floors: it asks whether a drift holds there, and at which floors.
import { describe, expect, it } from 'vitest';
import type { RoadPos } from '../../src/road';
import { createSim, quantizeInput, type SimConfig, type SimInput, type SimSnapshot } from '../../src/sim/api';
import {
  botRace,
  CORNER_KAPPA,
  GORGE,
  MAX_TICKS,
  median,
  ROUTES,
  sharpestAhead,
  soloConfig,
} from './drift-bot';

/**
 * Lombard Street (playtest 3, T9.3): Polk, the crest at Hyde, the crooked block's eight hairpins (one
 * lane of red brick, about R 5 m), then the flats and Telegraph Hill. Not one of the drift events'
 * routes: the case below asks whether it could be (the critic's C5).
 */
const LOMBARD = {
  label: 'Lombard Street (osm-sf-lombard-run)',
  event: 'region-sf:sf-hill-sprint',
  route: 'region-sf:osm-sf-lombard-run',
} as const;
/** The road of Lombard's eight hairpins. */
const CROOKED = 'osm-sf-lombard-crooked';

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

// Lombard (the critic's C5, T2.6): can a drift hold in a block of hairpins about R 5 m? The drift
// starts at 18 m/s (`riders.driftMinMps`) and ends under 10 (`riders.driftExitMps`), and a hairpin
// that tight is ridden at 12 m/s or so. The probe rides the crooked block with a bot made for
// hairpins that follow each other 20 m apart (the Crown Point bot above reads one bend 30 m ahead,
// which in this block is always the next hairpin's) and counts the block's hairpin apexes the bike
// passes in a drift: the number that says whether the move holds there.

/** Where the block's hairpins peak: the sharpest points of its bends (R 8 m or tighter), by s. */
function hairpinApexes(config: SimConfig): number[] {
  const edge = config.road.edgeIndex(CROOKED);
  const length = config.road.edges[edge]?.length ?? 0;
  const apexes: number[] = [];
  for (let s = 2; s < length - 2; s++) {
    const k = Math.abs(config.road.kappaAt(edge, s));
    if (
      k >= 0.12 &&
      k >= Math.abs(config.road.kappaAt(edge, s - 1)) &&
      k > Math.abs(config.road.kappaAt(edge, s + 1))
    )
      apexes.push(s);
  }
  return apexes;
}

/** A bend this sharp (R 12.5 m) is a hairpin's core: the bot brakes and turns in there. */
const HAIRPIN_KAPPA = 0.08;
/** The brake held through the drift's 0.15 s entry gate sheds about 1.4 m/s, so enter this far over the floor. */
const ENTRY_MARGIN_MPS = 1.5;
/** The speed the bot holds between hairpins and through the slide: this far over the floor. */
const HOLD_OVER_MPS = 3;

/**
 * The hairpin bot. Between bends it holds `floor + HOLD_OVER_MPS`; in a hairpin's core it turns in
 * on the brake (once, at the speed the drift needs, so the entry gate is not reset by a brake that
 * chatters) and then lets the slide run on the throttle.
 */
function hairpinBot(config: SimConfig, snap: SimSnapshot, id: number, floor: number): SimInput {
  const me = snap.entities[id];
  const def = config.riders[id];
  if (!me || !def || me.mode !== 'Road') return quantizeInput({ steer: 0, throttle: 1, brake: 0, flags: 0 });
  const { edge, s, d, dir, yaw } = me.road;
  const v = Math.max(me.speed, 3);
  const roadId = config.road.edges[edge]?.id ?? '';
  const roadLength = config.road.edges[edge]?.length ?? 0;
  const lanes = config.route.lanesAt(edge, s);
  const lane = lanes.find((l) => l.kind === 'drive' && l.direction === dir) ?? lanes[0];
  // The line: the lane's centre, but the middle of the road for the block and the 45 m before it (the
  // climb is two-way and four lanes wide, the block one lane: from the climb's right-hand lane the
  // first tick in the block is the block's wall).
  const middle = roadId.endsWith('-crooked') || (roadId.endsWith('-climb') && s > roadLength - 45);
  const bend = config.route.kappaAt(edge, s) * dir;
  const law = 0.35 * ((middle ? 0 : (lane?.dCenterM ?? 0)) - d) * dir - 2.5 * yaw + (bend * v * v) / 22;
  const pos: RoadPos = { edge, s, d, dir };
  const hold = floor + HOLD_OVER_MPS;
  const here = sharpestAhead(config, pos, 3);
  const ahead = sharpestAhead(config, pos, 10 + Math.max(0, (me.speed * me.speed - hold * hold) / 16));
  const sliding = (snap.moves?.driftSide ?? 0) !== 0;
  let steer = law;
  let throttle = 1;
  let brake = 0;
  if (Math.abs(here) >= HAIRPIN_KAPPA) {
    const want = Math.sign(here);
    steer = want * Math.max(0.6, law * want);
    if (!sliding && me.speed >= floor + ENTRY_MARGIN_MPS) {
      brake = 1;
      throttle = 0;
    } else if (sliding && me.speed > hold) throttle = 0;
  } else if (Math.abs(ahead) >= CORNER_KAPPA) {
    if (me.speed > hold) {
      brake = 1;
      throttle = 0;
    }
  } else if (me.speed > hold + 2) throttle = 0;
  return quantizeInput({ steer: Math.max(-1, Math.min(1, steer)), throttle, brake, flags: 0 });
}

interface CrookedRun {
  finished: boolean;
  crashes: number;
  /** How many of the block's hairpin apexes the bike passed in a drift, of `apexes`. */
  held: number;
  apexes: number;
  drifts: number;
  /** Drifts that ended clean (pointing down the road, 0.8 s or more: the ones that boost). */
  clean: number;
  /** Seconds the bike spent on the crooked block. */
  blockS: number;
  /** Seconds of drift over the whole route, and the drift cash banked at $1 a second. */
  driftS: number;
  cash: number;
}

/** The Lombard route alone with the bot, the drift's two floors set (or the drift off). */
function crookedRace(bike: string, floor: number, exit: number, drift = true): CrookedRun {
  const config = soloConfig(LOMBARD, bike, 1, {
    'riders.driftMinMps': floor,
    'riders.driftExitMps': exit,
    'riders.drift': drift ? 1 : 0,
  });
  const edge = config.road.edgeIndex(CROOKED);
  const apexes = hairpinApexes(config);
  const passed = apexes.map(() => false);
  const sim = createSim(config);
  const id = config.riders.findIndex((r) => r.controller.kind === 'player');
  const run: CrookedRun = {
    finished: false,
    crashes: 0,
    held: 0,
    apexes: apexes.length,
    drifts: 0,
    clean: 0,
    blockS: 0,
    driftS: 0,
    cash: 0,
  };
  let lastS = -1;
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const snap = sim.snapshot();
    const me = snap.entities[id];
    if (me?.mode === 'Road' && me.road.edge === edge) {
      run.blockS += 1 / 60;
      const side = snap.moves?.driftSide ?? 0;
      apexes.forEach((a, i) => {
        if (lastS < a && me.road.s >= a && side !== 0) passed[i] = true;
      });
      lastS = me.road.s;
    } else lastS = -1;
    sim.step([hairpinBot(config, snap, id, floor)]);
    for (const e of sim.events()) {
      if (e.actor !== id) continue;
      if (e.type === 'finish') run.finished = true;
      else if (e.type === 'crash') run.crashes++;
      else if (e.type === 'driftStart') run.drifts++;
      else if (e.type === 'driftEnd' && e.data['bank'] !== true) {
        run.driftS += Number(e.data['seconds']);
        if (e.data['clean'] === true) run.clean++;
      } else if (e.type === 'style' && e.data['kind'] === 'drift') run.cash += Number(e.data['points']);
    }
  }
  run.held = passed.filter(Boolean).length;
  return run;
}

describe('drift on Lombard (the critic C5)', () => {
  const BIKES = ['base:rustbucket-400', 'base:streetfighter-750', 'base:superbike-1000'];
  /** The shipped floors (`riders.driftMinMps`, `riders.driftExitMps`) and the lowered pair the probe proposes. */
  const DEFAULT = { min: 18, exit: 10 };
  const LOWERED = { min: 12, exit: 6 };

  it('the premise holds: the block has eight hairpins and the drift floors default to 18 and 10 m/s', () => {
    const config = soloConfig(LOMBARD, BIKES[0] ?? '', 1);
    expect(hairpinApexes(config).length).toBeGreaterThanOrEqual(8);
    expect(config.tuning['riders.driftMinMps']).toBe(DEFAULT.min);
    expect(config.tuning['riders.driftExitMps']).toBe(DEFAULT.exit);
  });

  it('a drift holds through most of the crooked block at lowered floors, and not at the defaults', () => {
    const lines: string[] = [];
    for (const bike of BIKES) {
      const normal = crookedRace(bike, DEFAULT.min, DEFAULT.exit);
      const lowered = crookedRace(bike, LOWERED.min, LOWERED.exit);
      const loweredOff = crookedRace(bike, LOWERED.min, LOWERED.exit, false);
      lines.push(
        `${bike}: defaults ${DEFAULT.min}/${DEFAULT.exit} hold ${normal.held} of ${normal.apexes} hairpins, ` +
          `${normal.crashes} crashes; lowered ${LOWERED.min}/${LOWERED.exit} hold ${lowered.held} of ` +
          `${lowered.apexes}, ${lowered.clean} clean exits, ${lowered.crashes} crashes, the block in ` +
          `${lowered.blockS.toFixed(1)} s (drift off: ${loweredOff.blockS.toFixed(1)} s)`,
      );
      // At the shipped floors the bot crashes into the wall at 18 m/s or never reaches the speed: the
      // slide holds through under half of the hairpins.
      expect(normal.held).toBeLessThan(normal.apexes / 2);
      // Lowered, it holds through most of them without a crash, from every bike's own handling.
      expect(lowered.finished).toBe(true);
      expect(lowered.crashes).toBe(0);
      expect(lowered.held).toBeGreaterThanOrEqual(4);
      expect(lowered.held).toBeGreaterThanOrEqual(normal.held + 2);
      expect(lowered.clean).toBeGreaterThanOrEqual(1);
      // And it pays as it does on Crown Point: through the block quicker than the same bot without it.
      expect(loweredOff.drifts).toBe(0);
      expect(lowered.blockS).toBeLessThan(loweredOff.blockS);
    }
    console.log(`[examined] Lombard, the drift bot alone:\n${lines.join('\n')}`);
  }, 300_000);

  it('prints the floors that work: the bot per floor pair and bike, at $1 a drift second', () => {
    const pairs = [
      DEFAULT,
      { min: 14, exit: 7 },
      LOWERED,
      { min: 10, exit: 5 },
      { min: 8, exit: 4 },
      { min: 6, exit: 3 },
    ];
    const lines: string[] = [];
    for (const { min, exit } of pairs) {
      for (const bike of BIKES) {
        const r = crookedRace(bike, min, exit);
        lines.push(
          `floors ${min}/${exit}, ${bike}: ${r.held} of ${r.apexes} hairpins held, ${r.drifts} drifts ` +
            `(${r.driftS.toFixed(1)} s, ${r.clean} clean), ${r.crashes} crashes, banked $${Math.round(r.cash)}, ` +
            `the block in ${r.blockS.toFixed(1)} s`,
        );
      }
    }
    console.log(
      `[T2.6] ${LOMBARD.label}, drift bot, banked drift cash at perDriftSecondCash 1:\n${lines.join('\n')}`,
    );
    expect(lines).toHaveLength(pairs.length * BIKES.length);
  }, 600_000);
});
