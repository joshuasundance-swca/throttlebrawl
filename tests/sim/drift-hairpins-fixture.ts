import type { RoadPos } from '../../src/road';
import { createSim, quantizeInput, type SimConfig, type SimInput, type SimSnapshot } from '../../src/sim/api';
import { CORNER_KAPPA, MAX_TICKS, sharpestAhead, soloConfig } from './drift-bot';

export const LOMBARD = {
  label: 'Lombard Street (osm-sf-lombard-run)',
  event: 'region-sf:sf-hill-sprint',
  route: 'region-sf:osm-sf-lombard-run',
} as const;
export const CROOKED = 'osm-sf-lombard-crooked';

export function hairpinApexes(config: SimConfig): number[] {
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

const HAIRPIN_KAPPA = 0.08;
const ENTRY_MARGIN_MPS = 1.5;
const HOLD_OVER_MPS = 3;

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

export interface CrookedRun {
  finished: boolean;
  crashes: number;
  held: number;
  apexes: number;
  drifts: number;
  clean: number;
  blockS: number;
  driftS: number;
  cash: number;
}

export function crookedRace(bike: string, floor: number, exit: number, drift = true): CrookedRun {
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
