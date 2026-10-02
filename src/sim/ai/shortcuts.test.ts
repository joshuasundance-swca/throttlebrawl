// W-Q (the pitch deck's item 9, "Rivals use the shortcuts"): rivals sometimes take a route's
// shortcut. The real sim on the branch fixture (the split zone is the last 40 m of road `a`, d 2.4
// to 4.9, onto `c-in`, `cut` and `c-out`), four rivals racing, the player idle on the grid.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureBranchNetwork } from '../../road';
import { createSim, quantizeInput, type SimConfig, type SimRiderDef } from '../api';
import { aiState } from './index';
import { createSimWithWorld } from '../create';

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
const rival = (n: number): SimRiderDef => ({
  contentId: `base:r${n}`,
  name: `R${n}`,
  role: 'rival',
  faction: 'rider',
  controller: { kind: 'ai', style: 'racer' },
  bike,
  massKg: 90,
  healthMax: 100,
});
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

function config(seed: number, chance?: number): SimConfig {
  return {
    seed,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [1],
      raceEndTimeoutTicks: 1800,
    },
    riders: [rival(0), rival(1), rival(2), rival(3), PLAYER],
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      'riders.steerScale': 1,
      'ai.paceScale': 1,
      'ai.aggressionScale': 0,
      ...(chance === undefined ? {} : { 'ai.shortcutChance': chance }),
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

/** Which rivals rode onto the shortcut, and which ones it said would. */
function race(seed: number, chance?: number) {
  const cfg = config(seed, chance);
  const { sim, world } = createSimWithWorld(cfg);
  const cut = road.edgeIndex('cut');
  const took = new Set<number>();
  for (let t = 0; t < 60 * 25; t++) {
    sim.step([{ steer: 0, throttle: 0, brake: 255, flags: 0 }]);
    for (const e of sim.snapshot().entities) if (e.kind === 'rider' && e.road.edge === cut) took.add(e.id);
  }
  const meant = [0, 1, 2, 3].filter((id) => ((aiState(world).shortcuts[id] ?? 0) & 1) !== 0);
  return { took: [...took].sort(), meant };
}

describe('W-Q: rivals sometimes take the shortcut', () => {
  it('the fixture route has the one shortcut', () => {
    expect(route.shortcuts).toHaveLength(1);
    expect(road.edges[route.shortcuts[0]?.toEdge ?? -1]?.id).toBe('c-in');
  });

  it('at chance 1 every rival rides the shortcut; at 0 none does', () => {
    expect(race(5, 1).took).toEqual([0, 1, 2, 3]);
    expect(race(5, 0).took).toEqual([]);
  });

  it('at the default, the riders it picks mostly take it, the others mostly do not, and the picks vary by seed', () => {
    // Riders bump (they never overlap), so a rider lining up can be crowded out of the zone, and a
    // bump can carry one that did not pick it in: the shortcut is open to anyone in the zone.
    const picks: string[] = [];
    let meant = 0;
    let meantRode = 0;
    let others = 0;
    let othersRode = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = race(seed);
      picks.push(r.meant.join(','));
      meant += r.meant.length;
      meantRode += r.meant.filter((id) => r.took.includes(id)).length;
      others += 4 - r.meant.length;
      othersRode += r.took.filter((id) => !r.meant.includes(id)).length;
    }
    console.log(
      `[examined] shortcut over 10 seeds x 4 rivals: ${meant} picked it (${meantRode} rode it), ` +
        `${others} did not (${othersRode} rode it anyway); picks ${picks.join(' | ')}`,
    );
    expect(new Set(picks).size).toBeGreaterThan(1);
    expect(meant).toBeGreaterThan(4);
    expect(meant).toBeLessThan(30);
    expect(meantRode / meant).toBeGreaterThanOrEqual(0.75);
    expect(othersRode / others).toBeLessThanOrEqual(0.15);
  });

  it('a rival lining up for it does not shove a rider alongside into it: it drops in behind and crosses after', () => {
    // The bundle merge with #325's stamp test: side by side from the grid, the rival (zone line 3.3)
    // barged the player (holding 1.7, between them) into the zone and rode the main road itself.
    const shortcutEdges = new Set(['c-in', 'cut', 'c-out'].map((id) => road.edgeIndex(id)));
    const a = road.edgeIndex('a');
    const cut = road.edgeIndex('cut');
    const rows: string[] = [];
    for (const seed of [4, 5, 6]) {
      const cfg: SimConfig = { ...config(seed, 1), riders: [rival(0), PLAYER] };
      const sim = createSim(cfg);
      let rivalRode = false;
      let playerOff = false;
      for (let t = 0; t < 60 * 25 && !sim.isOver(); t++) {
        const snap = sim.snapshot();
        const me = snap.entities[1];
        if (!me) break;
        const want = me.road.edge === a ? 1.7 : 0;
        const steer = Math.max(-1, Math.min(1, (want - me.road.d) * 0.3 - me.road.yaw * 2));
        sim.step([quantizeInput({ throttle: 1, brake: 0, steer: steer * me.road.dir, flags: 0 })]);
        const after = sim.snapshot().entities;
        if (after[0]?.road.edge === cut) rivalRode = true;
        if (shortcutEdges.has(after[1]?.road.edge ?? -1)) playerOff = true;
      }
      rows.push(`seed ${seed}: rival rode it ${rivalRode}, player carried in ${playerOff}`);
      expect(playerOff).toBe(false);
      expect(rivalRode).toBe(true);
    }
    console.log(`[examined] ${rows.join('; ')}`);
  });

  it('is deterministic: the same seed races the same', () => {
    const run = () => {
      const sim = createSim(config(3));
      for (let t = 0; t < 600; t++) sim.step([{ steer: 0, throttle: 0, brake: 255, flags: 0 }]);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
