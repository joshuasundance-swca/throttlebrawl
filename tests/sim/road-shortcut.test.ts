/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
import { describe, expect, it } from 'vitest';
import { buildSimConfig, DEFAULT_EVENT, type ActionState } from '../../src/app';
import { loadBasePack, lookup } from '../../src/content';
import { createSim, quantizeInput, type EntitySnapshot, type RouteProgress } from '../../src/sim/api';
import { activateRegion } from '../../src/stream';

// M1 road-2 acceptance, on the real baked track with the real riding model (riders-2 airtime):
// a rider who hugs the right edge before the split takes the boat-ramp cut, flies off its ramp,
// lands, rejoins at the bridge and finishes sooner than the same rider on the main path. Race
// progress never falls on the way, and no traffic vehicle ever enters a shortcut edge.

const blank = (): ActionState => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  attack: false,
  attackSide: 0,
  kick: false,
  lookBack: false,
  skipRunBack: false,
});

/** The stub bot's lane-keeping, with a target offset: the split zone's middle while approaching it. */
function drive(me: EntitySnapshot, route: RouteProgress, a: ActionState, takeShortcut: boolean): void {
  const { edge, s, d, dir, yaw } = me.road;
  const v = Math.max(me.speed, 5);
  const lanes = route.lanesAt(edge, s);
  const lane = lanes.find((l) => l.kind === 'drive' && l.direction === dir) ?? lanes[0];
  let target = lane?.dCenterM ?? 0;
  const zone = route.shortcuts[0];
  if (takeShortcut && zone && edge === zone.edge && s > zone.s0 - 150) target = (zone.d0 + zone.d1) / 2 - 0.3;
  const kappa = route.kappaAt(edge, s) * dir;
  const steer = 0.35 * (target - d) * dir - 2.5 * yaw + (kappa * v * v) / 22;
  a.throttle = 1;
  a.steer = Math.max(-1, Math.min(1, steer));
}

/**
 * The default event's race on the base pack (live content: the full field, traffic both ways and
 * pedestrians). The timing comparison runs without traffic and without the cop, as it did before
 * both were live: this lane-keeping rider never dodges, and the test compares the two paths only.
 * The traffic check keeps the traffic, so it has vehicles to watch.
 */
function setup(seed: number, withTraffic: boolean) {
  const reg = loadBasePack();
  const event = lookup(reg.events, DEFAULT_EVENT);
  const routeFile = lookup(reg.routes, event.lengths[0]?.route ?? '');
  const network = lookup(reg.networks, routeFile.network);
  const stream = activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
  // Rivals don't swing here (ai.aggressionScale 0): with the full field, fights would make the cut
  // run and the main-path run unlike for like.
  const quiet = withTraffic ? {} : { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 };
  const built = buildSimConfig(reg, stream, { seed, tuning: { 'ai.aggressionScale': 0, ...quiet } });
  // The cop rides last on the grid, so leaving him out moves no other id.
  const config = withTraffic ? built : { ...built, riders: built.riders.filter((r) => r.faction !== 'law') };
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  return { sim: createSim(config), config, route: config.route, playerId };
}

function race(seed: number, takeShortcut: boolean, withTraffic = false) {
  const { sim, route, playerId, config } = setup(seed, withTraffic);
  const shortcutEdges = new Set(
    ['c-boat-ramp-in', 'm1-boat-ramp-cut', 'c-boat-ramp-out'].map((id) => config.road.edgeIndex(id)),
  );
  const edges: string[] = [];
  const events: { type: string; edge: string; data: Record<string, unknown> }[] = [];
  let progressFell = 0;
  let prevProgress = -Infinity;
  let trafficOnShortcut = 0;
  let vehicleTicks = 0;
  let finishTick = -1;
  while (!sim.isOver() && sim.tick < 60 * 600) {
    const snap = sim.snapshot();
    const me = snap.entities[playerId];
    if (!me) throw new Error('no player');
    const name = config.road.edges[me.road.edge]?.id ?? '?';
    if (edges[edges.length - 1] !== name) edges.push(name);
    if (!me.finished) {
      if (me.progress < prevProgress - 1e-9) progressFell++;
      prevProgress = me.progress;
    } else if (finishTick < 0) finishTick = sim.tick;
    for (const e of snap.entities) {
      if (e.kind !== 'vehicle') continue;
      vehicleTicks++;
      if (shortcutEdges.has(e.road.edge)) trafficOnShortcut++;
    }
    const a = blank();
    drive(me, route, a, takeShortcut);
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    for (const ev of sim.events()) {
      if (ev.actor !== playerId) continue;
      if (ev.type === 'jump' || ev.type === 'land' || ev.type === 'crash' || ev.type === 'wobble') {
        const now = sim.snapshot().entities[playerId];
        events.push({
          type: ev.type,
          edge: config.road.edges[now?.road.edge ?? 0]?.id ?? '?',
          data: { ...ev.data },
        });
      }
    }
  }
  return { edges, events, progressFell, trafficOnShortcut, vehicleTicks, finishTick };
}

describe('road-2: the boat-ramp cut on the M1 track', () => {
  it('takes the cut, jumps the ramp, lands, rejoins and finishes sooner; progress never falls', () => {
    const cut = race(11, true);
    const main = race(11, false);
    const jump = cut.events.find((e) => e.type === 'jump');
    const land = cut.events.find((e) => e.type === 'land');
    console.log(
      `shortcut run: ${cut.edges.join('>')}; finish ${(cut.finishTick / 60).toFixed(1)} s vs main path ${(main.finishTick / 60).toFixed(1)} s; ` +
        `jump ${JSON.stringify(jump)}, land ${JSON.stringify(land)}; other rider events ${cut.events.filter((e) => e.type === 'crash' || e.type === 'wobble').length}`,
    );
    expect(cut.edges).toEqual([
      'm1-marina-run',
      'c-boat-ramp-in',
      'm1-boat-ramp-cut',
      'c-boat-ramp-out',
      'm1-pelican-bridge',
      'm1-sandbar-causeway',
    ]);
    expect(main.edges).not.toContain('m1-boat-ramp-cut');
    expect(jump?.edge).toBe('m1-boat-ramp-cut');
    expect(land?.edge).toBe('m1-boat-ramp-cut');
    expect(land?.data['quality']).toBe('clean');
    expect(Number(land?.data['airTicks'])).toBeGreaterThan(30); // half a second or more in the air
    expect(cut.progressFell).toBe(0);
    expect(main.progressFell).toBe(0);
    expect(cut.finishTick).toBeGreaterThan(0);
    expect(main.finishTick).toBeGreaterThan(0);
    expect(cut.finishTick).toBeLessThan(main.finishTick);
  }, 60_000);

  it('never lets a traffic vehicle onto a shortcut edge, in five seeded races', () => {
    let vehicleTicks = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = race(seed, seed % 2 === 0, true);
      expect(run.trafficOnShortcut, `seed ${seed}`).toBe(0);
      vehicleTicks += run.vehicleTicks;
    }
    console.log(`traffic: ${vehicleTicks} vehicle-ticks checked, 0 on a shortcut edge`);
    expect(vehicleTicks).toBeGreaterThan(1000);
  }, 120_000);
});

// Playtest 1b ([decided] 2026-09-30: "you've got to get way over to the right or you can't pass
// through onto it. you get forced away like it's a barrier"). The diagnosis (the run's
// diag-shortcut lane) found two walls: the split picks a branch at one instant, and past it the
// main connector and the shortcut's are drawn overlapping for about 58 m while each walls its own
// riders in. The fix is a rider-only handover between the overlapping edges, plus no steering-assist
// pushback inside split zones. These runs put the player alone on the road (no traffic, rivals or
// cop), holding the right lane's centre until a trigger point, then doing one of the moves below.

type Move = 'laneKeep' | 'holdRight' | 'aimCut';

const CUT_EDGES = ['c-boat-ramp-in', 'm1-boat-ramp-cut'];
const MAIN_AFTER_SPLIT = ['c-marina-split-main', 'm1-marina-bends'];

function soloSetup(steerAssist: 'off' | 'light' | 'strong' = 'off') {
  const reg = loadBasePack();
  const event = lookup(reg.events, DEFAULT_EVENT);
  const routeFile = lookup(reg.routes, event.lengths[0]?.route ?? '');
  const network = lookup(reg.networks, routeFile.network);
  const stream = activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
  const built = buildSimConfig(reg, stream, {
    seed: 7,
    tuning: { 'ai.aggressionScale': 0, 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 },
  });
  const config = {
    ...built,
    riders: built.riders.filter((r) => r.controller.kind === 'player'),
    slots: [{ assists: { steer: steerAssist, autoThrottle: false } }],
  };
  return { sim: createSim(config), config };
}

/**
 * Rides from the grid past the split: the right lane's centre (or `laneD`) on marina-run until
 * `triggerS`, then the move. `holdRight` holds full right lock until on a cut edge, then keeps the
 * cut's centre; `aimCut` steers at the drawn cut's centre (d 6 in the main road's frame, just past
 * the split) until on a cut edge. Stops 150 m down either branch.
 */
function ridePastSplit(
  move: Move,
  triggerS: number,
  opts: { laneD?: number; assist?: 'off' | 'strong' } = {},
) {
  const { sim, config } = soloSetup(opts.assist ?? 'off');
  const E = (id: string) => config.road.edgeIndex(id);
  const run = E('m1-marina-run');
  const cut = new Set(CUT_EDGES.map(E));
  const name = (e: number) => config.road.edges[e]?.id ?? '?';
  const edges: string[] = [];
  const walls: string[] = [];
  const progress: { edge: string; progress: number }[] = [];
  let dAtSplit = NaN;
  let lastRunD = NaN;
  for (let t = 0; t < 60 * 90; t++) {
    const me = sim.snapshot().entities[0] as EntitySnapshot;
    const { edge, s, d, dir, yaw } = me.road;
    if (edges[edges.length - 1] !== name(edge)) {
      if (edges[edges.length - 1] === 'm1-marina-run') dAtSplit = lastRunD;
      edges.push(name(edge));
    }
    if (edge === run) lastRunD = d;
    progress.push({ edge: name(edge), progress: me.progress });
    if ((edge === E('m1-marina-bends') || edge === E('m1-boat-ramp-cut')) && s > 150) break;
    const a = blank();
    a.throttle = 1;
    const v = Math.max(me.speed, 5);
    const kappa = config.road.kappaAt(edge, s) * dir;
    const keep = (target: number) =>
      Math.max(-1, Math.min(1, 0.35 * (target - d) * dir - 2.5 * yaw + (kappa * v * v) / 22));
    const triggered = edge !== run || s >= triggerS;
    if (!triggered || move === 'laneKeep') a.steer = keep(opts.laneD ?? 2);
    else if (cut.has(edge)) a.steer = keep(0);
    else if (move === 'holdRight') a.steer = 1;
    else a.steer = keep(edge === run ? 4 : 6);
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    for (const ev of sim.events()) {
      if (ev.actor !== 0 || (ev.type !== 'wobble' && ev.type !== 'crash')) continue;
      const now = sim.snapshot().entities[0] as EntitySnapshot;
      walls.push(`${ev.type}(${String(ev.data['cause'])})@${name(now.road.edge)} s=${now.road.s.toFixed(1)}`);
    }
  }
  return { edges, walls, dAtSplit, progress, gainM: config.route.shortcuts[0]?.gainM ?? NaN };
}

describe('playtest 1b: no invisible wall at the boat-ramp cut', () => {
  it('1. full right lock from 2 m before the split takes the cut, with no barrier wobble or crash', () => {
    const r = ridePastSplit('holdRight', 298);
    console.log(
      `hold right from s 298: ${r.edges.join('>')}; d at split ${r.dAtSplit.toFixed(2)}; ${r.walls.join(', ') || 'no walls'}`,
    );
    expect(r.edges[r.edges.length - 1]).toBe('m1-boat-ramp-cut');
    expect(r.walls).toEqual([]);
  });

  it('2. through the split in the right lane, then steering at the drawn cut, takes it with no barrier events', () => {
    const r = ridePastSplit('aimCut', 300);
    console.log(
      `aim at the drawn cut after the split: ${r.edges.join('>')}; ${r.walls.join(', ') || 'no walls'}`,
    );
    expect(r.edges).toContain('c-marina-split-main'); // it really did pass the split on the main road
    expect(r.edges[r.edges.length - 1]).toBe('m1-boat-ramp-cut');
    expect(r.walls).toEqual([]);
  });

  it('3. guard: a lane-keeper in the right lane stays on the main road, no walls', () => {
    const r = ridePastSplit('laneKeep', 0);
    expect(r.edges).toEqual(['m1-marina-run', ...MAIN_AFTER_SPLIT]);
    expect(r.walls).toEqual([]);
  });

  it('with the strong steering assist, holding d 4 through the split zone takes the cut', () => {
    const r = ridePastSplit('laneKeep', 0, { laneD: 4, assist: 'strong' });
    console.log(`strong assist holding d 4: ${r.edges.join('>')}; d at split ${r.dAtSplit.toFixed(2)}`);
    expect(r.dAtSplit).toBeGreaterThan(3);
    expect(r.edges).toContain('c-boat-ramp-in');
  });

  it('race progress: a handover onto the cut gains what the split gains, and never more', () => {
    const r = ridePastSplit('aimCut', 300);
    let jump = 0;
    for (let i = 1; i < r.progress.length; i++) {
      const a = r.progress[i - 1];
      const b = r.progress[i];
      if (a && b && a.edge !== b.edge && CUT_EDGES.includes(b.edge) && MAIN_AFTER_SPLIT.includes(a.edge)) {
        jump = b.progress - a.progress;
      }
    }
    console.log(
      `progress jump at the handover ${jump.toFixed(2)} m; the split's gain ${r.gainM.toFixed(2)} m`,
    );
    expect(jump).toBeGreaterThan(r.gainM - 3);
    expect(jump).toBeLessThan(r.gainM + 3);
  });
});
