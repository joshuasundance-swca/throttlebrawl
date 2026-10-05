/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Run W-U, the San Francisco real network (interview, 2026-10-02: "junction choices in races",
// "map-based networks"): Russian Hill is a `tbgis network` bake now, its streets joined at their
// real junctions, with one junction choice where the real grid offers one: Jones Street, right off
// Union one block before the crest, down the hill's 29% north face and back along Chestnut onto
// Leavenworth. This rides the choice end to end with the dev bot, which keeps right into the first
// split zone on its route (src/dev/bot): alone on the road (the isolation profile, tests/sim/batch.ts),
// so only the junctions and the turns are tested.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';
import { ISOLATED } from './batch';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENT = 'region-sf:sf-hill-sprint';
const ROUTE = 'region-sf:osm-sf-hills-run';
const MAX_TICKS = 60 * 60 * 8;
/** The choice in race order: off Union, Jones, Chestnut, back onto Leavenworth's north end. */
const CHOICE = [
  'osm-sf-union',
  'osm-sf-russian-hill-jones-in',
  'osm-sf-jones',
  'osm-sf-chestnut',
  'osm-sf-russian-hill-jones-out',
  'osm-sf-leavenworth-north',
];

function soloRace(seed: number) {
  const built = buildSimConfig(REG, STREAMS.forEvent(REG, EVENT, undefined, ROUTE), {
    seed,
    eventId: EVENT,
    route: ROUTE,
    tuning: ISOLATED,
  });
  const config = { ...built, riders: built.riders.filter((r) => r.controller.kind === 'player') };
  const sim = createSim(config);
  const route = config.route;
  const bot = createBot();
  const edges: string[] = [];
  const crashes: string[] = [];
  const found: Record<string, unknown>[] = [];
  const falls: string[] = [];
  const modes: string[] = [];
  let snap = sim.snapshot();
  let finishTick = -1;
  let problem: string | null = null;
  let offRoute = 0;
  let progressFell = 0;
  let prev = -Infinity;
  let prevRiding = false;
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, 0, route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    const me = snap.entities[0];
    if (!me) throw new Error('no player');
    problem ??= moverProblem(me, route);
    const name = config.road.edges[me.road.edge]?.id ?? '?';
    // Every edge the rider is on, riding or in the air (the turn-off is a launch: Union's crest
    // meets Jones's drop, so a fast rider flies over it); a tumbling body's nearest road flickers.
    const onBike = me.mode === 'Road' || me.mode === 'Airborne';
    if (onBike && edges[edges.length - 1] !== name) edges.push(name);
    const where = `${name}:${me.mode}`;
    if (modes[modes.length - 1] !== where) modes.push(where);
    if (finishTick < 0 && snap.race.finishOrder.includes(0)) finishTick = sim.tick;
    if (finishTick < 0) {
      if (!route.allows(me.road.edge)) offRoute++;
      // Riding, progress never falls along either way. On foot it may: the run-back walks back to a
      // bike that landed behind (Road Rash-style, interview 2026-10-02), so only riding counts.
      const riding = me.mode === 'Road' || me.mode === 'Airborne';
      if (riding && prevRiding && me.progress < prev - 1e-6) {
        progressFell++;
        falls.push(
          `${name} s ${me.road.s.toFixed(1)} ${me.mode} ${prev.toFixed(1)} -> ${me.progress.toFixed(1)}`,
        );
      }
      prev = me.progress;
      prevRiding = riding;
    }
    for (const e of sim.events()) {
      if (e.actor !== 0) continue;
      if (e.type === 'crash') crashes.push(`${name} s ${me.road.s.toFixed(0)}`);
      if (e.type === 'shortcutFound') found.push({ ...e.data });
    }
  }
  return { config, edges, modes, crashes, found, falls, finishTick, problem, offRoute, progressFell };
}

describe('the Russian Hill network: the Jones Street choice', () => {
  it("the route names the choice: an alternate, about the main way's length", () => {
    const config = buildSimConfig(REG, STREAMS.forEvent(REG, EVENT, undefined, ROUTE), {
      seed: 1,
      eventId: EVENT,
      route: ROUTE,
      tuning: ISOLATED,
    });
    const branch = config.route.branches.find((b) => b.id === 'osm-sf-jones');
    expect(branch?.kind).toBe('alternate');
    expect(branch?.marked).toBe(true);
    expect(branch?.sign).toMatch(/^JONES STREET: KEEP RIGHT\./);
    // One split on the route, on Union's right side (keep right to take it).
    expect(config.route.shortcuts).toHaveLength(1);
    const zone = config.route.shortcuts[0];
    expect(config.road.edges[zone?.edge ?? -1]?.id).toBe('osm-sf-union');
    expect(zone?.d0).toBeGreaterThan(2); // past the right lane's centre: lane-keeping riders stay on Union
    // The bake's numbers (tools/gis/reports/osm-sf-russian-hill.network.json): Jones and Chestnut are
    // about 100 m shorter than the Union crest and Leavenworth (its wide connectors, which a bike at
    // speed holds, cut the two street corners), so it is still an alternate, not a big shortcut.
    expect(zone?.gainM).toBeGreaterThan(10);
    expect(zone?.gainM).toBeLessThan(130);
  });

  it('a rider who keeps right takes Jones, rejoins Leavenworth and finishes, on the route all the way', () => {
    const run = soloRace(1);
    // The choice's roads, in order, among the roads ridden (a tumble may add a road between them).
    let next = 0;
    for (const e of run.edges) if (e === CHOICE[next]) next++;
    process.stdout.write(
      `[examined] ${ROUTE} seed 1, solo: ${run.edges.length} roads ridden (${run.edges.join(' > ')}); ` +
        `finish ${(run.finishTick / 60).toFixed(1)} s; crashes ${run.crashes.length}${run.crashes.length ? ` (${run.crashes.join('; ')})` : ''}; ` +
        `shortcutFound ${JSON.stringify(run.found)}; progress fell ${run.falls.join('; ') || 'never'}\n` +
        `[modes] ${run.modes.slice(run.modes.findIndex((m) => m.startsWith('osm-sf-union:'))).join(' > ')}\n`,
    );
    expect(run.problem).toBeNull();
    expect(run.finishTick).toBeGreaterThan(0);
    expect(run.offRoute).toBe(0);
    expect(run.progressFell).toBe(0);
    expect(CHOICE.slice(next), 'the choice roads not ridden, in order').toEqual([]);
    // The Union crest and the first stretch of Leavenworth are the main way the choice skips.
    expect(run.edges).not.toContain('osm-sf-union-crest');
    expect(run.edges).not.toContain('osm-sf-leavenworth');
    // The 'found it' stamp fires once, with the bake's saving.
    expect(run.found).toHaveLength(1);
    expect(Number(run.found[0]?.['gainM'])).toBeGreaterThan(10);
  }, 120_000);
});
