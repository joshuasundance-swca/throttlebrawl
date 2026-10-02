// W-Q: the 'found it' stamp. The real sim on the branch fixture: road `a`'s last 40 m is a split
// zone (d 2.4 to 4.9) onto `c-in`, `cut` and `c-out`, a straight shortcut past `b`'s S-bend. The
// player rides into the zone and down the shortcut (or past it), steering by the snapshot.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureBranchNetwork } from '../../road';
import { createSim, quantizeInput, type SimConfig, type SimEvent, type SimRiderDef } from '../api';

const f = fixtureBranchNetwork();
const road = createRoadNetwork(f);
const route = createRouteProgress(road, f.route);
const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
const PLAYER: SimRiderDef = {
  contentId: 'base:player',
  name: 'You',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike,
  massKg: 80,
  healthMax: 100,
};
const RIVAL: SimRiderDef = {
  ...PLAYER,
  contentId: 'base:r',
  name: 'R',
  role: 'rival',
  controller: { kind: 'ai', style: 'racer' },
};

function config(riders: SimRiderDef[]): SimConfig {
  return {
    seed: 4,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [1],
      raceEndTimeoutTicks: 1800,
    },
    riders,
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { 'riders.steerScale': 1, 'ai.shortcutChance': 1 },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

/** Rides the route at `throttle`; on road `a` it holds `aLine` (3.3: the zone; 1.7: its lane). */
function ride(aLine: number, riders: SimRiderDef[] = [PLAYER], throttle = 1) {
  const sim = createSim(config(riders));
  const playerId = riders.indexOf(PLAYER);
  const a = road.edgeIndex('a');
  const events: SimEvent[] = [];
  for (let t = 0; t < 60 * 60 && !sim.isOver(); t++) {
    const me = sim.snapshot().entities[playerId];
    if (!me) break;
    const want = me.road.edge === a ? aLine : road.edges[me.road.edge]?.id === 'd' ? 1.7 : 0;
    const steer = Math.max(-1, Math.min(1, (want - me.road.d) * 0.3 - me.road.yaw * 2));
    sim.step([quantizeInput({ throttle, brake: 0, steer: steer * me.road.dir, flags: 0 })]);
    events.push(...sim.events());
  }
  return events.filter((e) => e.type === 'shortcutFound');
}

describe("W-Q: the 'found it' stamp", () => {
  it('down the shortcut: one stamp, with the metres it cut and the seconds that saved at your speed', () => {
    const found = ride(3.3);
    console.log(`[examined] found: ${JSON.stringify(found.map((e) => e.data))}`);
    expect(found).toHaveLength(1);
    const d = found[0]?.data ?? {};
    expect(d['toEdge']).toBe(road.edgeIndex('c-in'));
    expect(d['gainM']).toBeCloseTo(route.shortcuts[0]?.gainM ?? NaN, 0);
    const saved = Number(d['savedS']);
    const on = Number(d['shortcutS']);
    expect(saved).toBeGreaterThan(0);
    expect(on).toBeGreaterThan(0);
    // The seconds saved are the metres cut at the speed it was ridden: slower riding, more seconds.
    const slow = ride(3.3, [PLAYER], 0.45)[0]?.data ?? {};
    expect(Number(slow['savedS'])).toBeGreaterThan(saved);
  });

  it('past it on the main road: no stamp; and a rival down the shortcut stamps nothing', () => {
    expect(ride(1.7)).toEqual([]);
    expect(ride(1.7, [RIVAL, PLAYER])).toEqual([]);
  });
});
