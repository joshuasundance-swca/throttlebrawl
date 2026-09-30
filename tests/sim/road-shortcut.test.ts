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
 * The default event's race on the base pack. With drafts, the M1 traffic types (drafts until they
 * are drawn) are in, so the traffic check has vehicles to watch; release builds leave them out.
 */
function setup(seed: number, withDrafts: boolean) {
  const reg = loadBasePack({ includeDrafts: withDrafts });
  const event = lookup(reg.events, DEFAULT_EVENT);
  const routeFile = lookup(reg.routes, event.lengths[0]?.route ?? '');
  const network = lookup(reg.networks, routeFile.network);
  const stream = activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
  // Rivals don't swing here (ai.aggressionScale 0): with the full field, fights would make the cut
  // run and the main-path run unlike for like, and this test compares the two paths only.
  const config = buildSimConfig(reg, stream, { seed, tuning: { 'ai.aggressionScale': 0 } });
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  return { sim: createSim(config), config, route: config.route, playerId };
}

function race(seed: number, takeShortcut: boolean, withDrafts = false) {
  const { sim, route, playerId, config } = setup(seed, withDrafts);
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
