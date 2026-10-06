/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 4, run C's live check: "after 2 of 8 other remounts, the dev bot rode the far oncoming lane
// for 191 and 217 of the next 240 ticks, while it started a fight". #568 fixed the Morrison cut's
// approach; the rest was the bot's own traffic pass (a car ahead in its lane put it in the nearer
// oncoming lane, even with a lane free on its own side, and at a walking pace the pass never finished)
// and its line-up on a rival across the centre line. A bot back on the bike now keeps to the lanes of
// its own direction for REMOUNT_OWN_SIDE_TICKS (src/dev/bot).
//
// The rule, over Bridge City races (the pacific northwest's two-way four-lane roads, the ISOLATED
// profile with traffic on, the bot in the player's seat): after every remount, the bot spends at most
// MAX_ONCOMING_TICKS of the next WINDOW_TICKS more than 0.5 m into a lane that runs the other way,
// read from the route's lanes. The seeds are the ones that crossed over before the fix (10, 9, 13,
// 14, 16, 21 on the pre-fix build, by 100 to 196 ticks); the fixed build measured 0 ticks over 52
// remounts on seeds 1 to 24. The bound is a quarter of the window, a band, not the measured rate.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';
import { ISOLATED } from './batch';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENT = 'region-pnw:pnw-t1-bridge-city';
const SEEDS = [9, 10, 13, 14, 16, 21];
const WINDOW_TICKS = 240;
const MAX_ONCOMING_TICKS = 60;
const MAX_TICKS = 60 * 60 * 6;

interface Remount {
  seed: number;
  tick: number;
  edge: number;
  s: number;
  oncoming: number;
}

/** One race with the bot; every remount of the player and the ticks of the next window spent oncoming. */
function remounts(seed: number): Remount[] {
  const tuning = { ...ISOLATED, 'traffic.density': 1 };
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, EVENT), { seed, eventId: EVENT, tuning });
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const open: Remount[] = [];
  const all: Remount[] = [];
  let snap = sim.snapshot();
  let was = snap.entities[playerId]?.mode ?? 'Road';
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, config.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    const me = snap.entities[playerId];
    if (!me) break;
    if (me.mode === 'Road' && (was === 'OnFoot' || was === 'Tumble')) {
      const r = { seed, tick: snap.tick, edge: me.road.edge, s: Math.round(me.road.s), oncoming: 0 };
      open.push(r);
      all.push(r);
    }
    was = me.mode;
    for (const r of open) {
      const lanes = config.route.lanesAt(me.road.edge, me.road.s);
      const oncoming = lanes.some(
        (l) =>
          (l.kind === 'drive' || l.kind === 'shoulder') &&
          l.direction === -me.road.dir &&
          Math.abs(me.road.d - l.dCenterM) < l.widthM / 2 - 0.5,
      );
      if (oncoming) r.oncoming++;
    }
    while (open[0] && snap.tick - open[0].tick >= WINDOW_TICKS) open.shift();
  }
  return all;
}

describe('the dev bot after a remount keeps to its own side (playtest 4, run C)', () => {
  it('spends at most a quarter of the next 4 s in the oncoming lanes, after every remount', () => {
    const all = SEEDS.flatMap((seed) => remounts(seed));
    const worst = all.reduce((m, r) => Math.max(m, r.oncoming), 0);
    console.log(
      `[examined] Bridge City seeds ${SEEDS.join(', ')}: ${all.length} remounts, the worst spent ${worst} of ` +
        `${WINDOW_TICKS} ticks oncoming (bound ${MAX_ONCOMING_TICKS})`,
    );
    expect(all.length).toBeGreaterThanOrEqual(8); // the check can see remounts at all
    for (const r of all)
      expect(
        r.oncoming,
        `seed ${r.seed} remount at tick ${r.tick} (edge ${r.edge}, s ${r.s})`,
      ).toBeLessThanOrEqual(MAX_ONCOMING_TICKS);
  }, 240_000);
});
