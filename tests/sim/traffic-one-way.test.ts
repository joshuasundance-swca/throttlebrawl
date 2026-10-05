/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 3, T10.6 (Lombard Street's crooked block is one lane, one way, downhill): a car that
// drives the other way must never ride into a stretch that has no lane in its direction. Before,
// an oncoming car left the two-way road beyond the block at 20 m/s or more, braked for the lane's
// end too late, rolled into the block and stopped there head-on with the cars coming down, so one
// seed in four left the bot (and so a player) stuck behind a wall of stopped cars for good. The rule
// is read from the road's own lanes, never from the route's name: any vehicle (a kerb rider keeps
// to the verge and is left out) must have a drive lane going its way under it, at every tick.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENT = 'region-sf:sf-hill-sprint';
const ROUTE = 'region-sf:osm-sf-lombard-run';
const SEEDS = [7919, 15838, 23757, 31676, 39595, 47514];
const TICKS = 60 * 50;

describe('traffic keeps to lanes that go its way', () => {
  it('on the Lombard route (a one-lane one-way block between two-way streets), no vehicle is ever on a stretch with no lane its way', () => {
    let checked = 0;
    let enteredOneWay = 0;
    for (const seed of SEEDS) {
      const config = buildSimConfig(REG, STREAMS.forEvent(REG, EVENT, undefined, ROUTE), {
        seed,
        eventId: EVENT,
        route: ROUTE,
      });
      const kerb = new Set(
        config.trafficTypes.filter((t) => t.behaviour?.kerb === true).map((t) => t.contentId),
      );
      const sim = createSim(config);
      for (let t = 0; t < TICKS; t++) {
        sim.step([toSimInput(emptyActions())]);
        for (const e of sim.snapshot().entities) {
          if (e.kind !== 'vehicle' || kerb.has(e.contentId)) continue;
          const lanes = config.road.lanesAt(e.road.edge, e.road.s);
          const mine = lanes.some((l) => l.kind === 'drive' && l.direction === e.road.dir);
          checked++;
          if (e.road.dir === -1 && !mine) enteredOneWay++;
          expect(
            mine,
            `seed ${seed} tick ${t}: ${e.contentId} heading ${e.road.dir} on edge ${e.road.edge} at s ${e.road.s.toFixed(1)} has no lane its way`,
          ).toBe(true);
        }
      }
    }
    console.log(
      `[examined] ${checked} vehicle-ticks on the Lombard route, ${SEEDS.length} seeds, ${enteredOneWay} wrong-way`,
    );
    expect(checked).toBeGreaterThan(1000);
  }, 300_000);
});
