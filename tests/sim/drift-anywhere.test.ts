/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 4 (P4-8, "Anywhere"; riding audit F8a): a drift starts wherever you brake hard and steer
// hard above the drift floor, not only where the road bends. Until then no drift could start on the
// Seven Mile or in San Francisco's downtown, whose roads never bend that sharply. This rides each
// of those two routes alone (the drift bot's setup: the ISOLATED profile, no rivals, no cop),
// keeps the line and the throttle on until the road ahead is dead straight at speed, then brakes
// and turns hard, and asks for the `driftStart` the rule promises.
import { describe, expect, it } from 'vitest';
import { createSim, quantizeInput, type SimInput } from '../../src/sim/api';
import { DRIFT_GATE_TICKS } from '../../src/sim/riders/drift';
import { driftBot, MAX_TICKS, sharpestAhead, soloConfig, type Route } from './drift-bot';

const SEVEN_MILE: Route = {
  label: 'the Seven Mile (osm-seven-mile-run)',
  event: 'base:keys-t3-speed-monitored',
  route: 'base:osm-seven-mile-run',
};
const SF_DOWNTOWN: Route = {
  label: 'San Francisco downtown (sf-downtown-run)',
  event: 'region-sf:sf-t1-burn-rate',
  route: 'region-sf:sf-downtown-run',
};
/** The road is "straight" here when it bends under a 400 m radius for the next 60 m. */
const STRAIGHT_KAPPA = 1 / 400;
/** The old bend gate's sensitivity (a 150 m radius): the bend a drift used to need. */
const OLD_BEND_KAPPA = 1 / 150;
const TURN_IN_SPEED_MPS = 24;

describe('drift anywhere (playtest 4, P4-8)', () => {
  for (const route of [SEVEN_MILE, SF_DOWNTOWN]) {
    for (const side of [1, -1]) {
      it(`a hard brake and hard bars on a straight start a drift on ${route.label}, to the ${side > 0 ? 'right' : 'left'}`, () => {
        const config = soloConfig(route, 'base:rustbucket-400', 1);
        const sim = createSim(config);
        const id = config.riders.findIndex((r) => r.controller.kind === 'player');
        let turnedInAt: number | undefined;
        let bendAtTurnIn = Number.NaN;
        let starts = 0;
        let startSide = 0;
        for (let t = 0; t < MAX_TICKS && !sim.isOver(); t++) {
          const snap = sim.snapshot();
          const me = snap.entities[id];
          let cmd: SimInput = driftBot(config, snap, id);
          if (me && me.mode === 'Road') {
            const bend = sharpestAhead(config, { ...me.road }, 60);
            if (
              turnedInAt === undefined &&
              me.speed >= TURN_IN_SPEED_MPS &&
              Math.abs(bend) < STRAIGHT_KAPPA
            ) {
              turnedInAt = t;
              bendAtTurnIn = bend;
            }
            if (turnedInAt !== undefined && t < turnedInAt + DRIFT_GATE_TICKS + 12) {
              cmd = quantizeInput({ steer: side * 0.9, throttle: 0, brake: 1, flags: 0 });
            } else if (turnedInAt !== undefined) {
              break;
            }
          }
          sim.step([cmd]);
          for (const e of sim.events()) {
            if (e.actor === id && e.type === 'driftStart') {
              starts++;
              startSide = Number(e.data['side']);
            }
          }
        }
        console.log(
          `[examined] ${route.label}: braked and turned ${side > 0 ? 'right' : 'left'} at tick ${turnedInAt}, ` +
            `sharpest bend within 60 m ${bendAtTurnIn.toExponential(2)} /m, ${starts} driftStart`,
        );
        expect(turnedInAt).toBeDefined();
        // The test's own premise: a stretch the old rule would have refused.
        expect(Math.abs(bendAtTurnIn)).toBeLessThan(OLD_BEND_KAPPA);
        expect(starts).toBe(1);
        expect(startSide).toBe(side);
      }, 120_000);
    }
  }
});
