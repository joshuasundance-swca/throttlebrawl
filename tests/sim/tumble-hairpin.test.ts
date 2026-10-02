/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// A crash on a hairpin hands the rider back facing the way the race goes (W-P verify of lane
// "traffic", mustFix). On the real Twin Peaks route, seed 2, the bot crashes at the foot of the
// twin-peaks-climb hairpin (tick 8703, edge 2, s 2.5) and its body slides about 30 m round the
// outside wall of the bend. The bend turns past 90 degrees within that slide, so the old hand-back,
// which read the direction from the world direction at the crash against the road's tangent where
// the body stopped, put the rider back on the road facing downhill (dir -1). The bot then rode the
// route backward and the race ran to the tick cap with no bust: a stall. On a route edge the
// hand-back now keeps the rider's sense against the route (with the race stays with the race).
//
// Harness: the race loads the way the game loads it, as tests/sim/region-sf.test.ts does, with
// the event's road events (speed traps, roadwork, parades) switched off. They roll from the seed, and
// with them on, seed 2 is busted at tick 8626, before it reaches the hairpin. The test checks that
// the player really goes down at the foot of the climb, so it notices if it stops reaching the bend.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const EVENT = 'region-sf:sf-hill-sprint';
const ROUTE = 'region-sf:osm-sf-twin-peaks-run';
/** Ten minutes: the cap the stalled race ran into. */
const MAX_TICKS = 60 * 60 * 10;

describe('tumble: the hand-back on a hairpin', () => {
  it('Twin Peaks seed 2: every hand-back faces the finish, and the bot finishes', () => {
    const config = {
      ...buildSimConfig(REG, createStreamCache().forEvent(REG, EVENT, undefined, ROUTE), {
        seed: 2,
        eventId: EVENT,
        route: ROUTE,
      }),
      modifiers: [],
    };
    const climb = config.road.edges.findIndex((e) => e.id === 'osm-sf-twin-peaks-climb');
    const route = config.route;
    const sim = createSim(config);
    const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
    const bot = createBot();
    /** The route's travel direction along an edge: +1 when the distance to finish falls with s. */
    const routeDir = (edge: number): number => {
      const a = route.distanceToFinish(edge, 0);
      const b = route.distanceToFinish(edge, route.edgeLength(edge));
      return Number.isFinite(a) && Number.isFinite(b) && a !== b ? (a > b ? 1 : -1) : 0;
    };
    let snap = sim.snapshot();
    const lastMode = snap.entities.map((e) => e.mode);
    const handBacks: string[] = [];
    const wrongWay: string[] = [];
    let finishTick = -1;
    /** Where the player went down at the foot of the climb's hairpin, if it did. */
    let hairpinCrash = '';
    while (!sim.isOver() && sim.tick < MAX_TICKS) {
      const actions = emptyActions();
      bot.drive(snap, playerId, route, actions);
      sim.step([toSimInput(actions)]);
      snap = sim.snapshot();
      if (finishTick < 0 && snap.race.finishOrder.includes(playerId)) finishTick = sim.tick;
      for (const e of snap.entities) {
        if (e.kind !== 'rider') continue;
        const was = lastMode[e.id];
        lastMode[e.id] = e.mode;
        const down = e.id === playerId && was !== 'Tumble' && e.mode === 'Tumble';
        if (down && e.road.edge === climb && e.road.s < 10) hairpinCrash ||= `tick ${sim.tick}`;
        // The hand-back (Tumble to OnFoot) and the remount (OnFoot to Road), every rider in the field.
        const handBack = was === 'Tumble' && e.mode === 'OnFoot';
        const remount = was === 'OnFoot' && e.mode === 'Road';
        if (!handBack && !remount) continue;
        const want = routeDir(e.road.edge);
        const line = `${e.name} tick ${sim.tick} ${e.mode} edge ${e.road.edge} s ${e.road.s.toFixed(1)} dir ${e.road.dir} route ${want}`;
        handBacks.push(line);
        if (want !== 0 && e.road.dir !== want) wrongWay.push(line);
      }
    }
    process.stdout.write(
      `[tumble-hairpin] ${handBacks.length} hand-backs and remounts; hairpin crash ${hairpinCrash || 'none'}; finish tick ${finishTick}\n`,
    );
    expect(climb, 'the climb is on the route').toBeGreaterThanOrEqual(0);
    expect(hairpinCrash, 'the player goes down at the foot of the hairpin').not.toBe('');
    expect(wrongWay, 'hand-backs or remounts facing away from the finish').toEqual([]);
    expect(finishTick, 'the bot finishes instead of stalling to the cap').toBeGreaterThan(0);
  }, 120_000);
});
