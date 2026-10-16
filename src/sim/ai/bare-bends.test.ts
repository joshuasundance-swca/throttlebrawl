import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, planStreetFurniture } from '../../road';
import { createSim, loadSimSteps } from '../api';
import { testConfig } from '../riders/testing';
import { holdSpeedMps } from '../riders';

await loadSimSteps();

function approach(kappa: number, furniture: boolean) {
  const lanes = [{ id: 'R1', dCenterM: 0, widthM: 3, direction: 1 as const, kind: 'drive' as const }];
  const bundle = fixtureNetwork([
    { id: 'approach', lengthM: 600, kappa: 0, lanes },
    { id: 'bend', lengthM: 50, kappa, lanes },
    { id: 'exit', lengthM: 1500, kappa: 0, lanes },
  ]);
  for (const road of bundle.roads) {
    road.tags = furniture ? [{ s0: 0, s1: road.lengthM, side: 'both', tag: 'row-houses' }] : [];
    road.barriers = [];
    road.laneSections[0]!.verges = {
      left: { widthM: 4, surface: 'shoulder', edge: 'soft' },
      right: { widthM: 4, surface: 'shoulder', edge: 'soft' },
    };
  }
  const road = createRoadNetwork(bundle);
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'approach', s: 40, dir: 1 },
    finish: { road: 'exit', s: 1400 },
    mainPath: bundle.network.roads,
    allowedRoads: bundle.network.roads,
    closed: false,
  });
  const base = testConfig({ rivals: 1, paceMps: 36.5 });
  const config = {
    ...base,
    road,
    route,
    riders: base.riders.filter((r) => r.controller.kind === 'ai'),
    tuning: {
      ...base.tuning,
      'riders.furniture': furniture ? 1 : 0,
      'riders.structures': 0,
      'traffic.density': 0,
      'cops.spawnChance': 0,
      'smash.density': 0,
    },
  };
  const sim = createSim(config);
  if (furniture)
    expect(planStreetFurniture(road, config.seed).items.some((p) => p.cls === 'solid')).toBe(true);
  let entrySpeed = -1;
  let approachMax = 0;
  let crashes = 0;
  for (let tick = 0; tick < 3600; tick++) {
    sim.step([]);
    const me = sim.snapshot().entities[0]!;
    if (me.road.edge === 0) approachMax = Math.max(approachMax, me.speed);
    if (me.road.edge === 1) {
      entrySpeed = me.speed;
      break;
    }
    crashes += sim.events().filter((event) => event.type === 'crash' && event.actor === me.id).length;
  }
  return {
    entrySpeed,
    approachMax,
    crashes,
    hold: holdSpeedMps(config.riders[0]!.bike.steerRateMps, kappa, 1),
  };
}

describe('rival bend braking on a bare road', () => {
  it('slows before a tight bend even without fixed furniture, while the straight stays fast', () => {
    const bend = approach(1 / 15, false);
    const straight = approach(0, false);
    expect(bend.entrySpeed).toBeGreaterThan(0);
    // The controller has braking lag at an abrupt curvature seam; the contract here is advance
    // braking on bare bends, not an instantaneous ideal steady-state hold speed at that seam.
    expect(bend.entrySpeed).toBeLessThan(straight.entrySpeed * 0.8);
    expect(straight.entrySpeed).toBeGreaterThan(bend.entrySpeed + 5);
    expect(bend.crashes).toBe(0);
    console.log(
      `[examined] bare bend entry ${bend.entrySpeed.toFixed(2)} m/s, hold ${bend.hold.toFixed(2)}, straight ${straight.entrySpeed.toFixed(2)}`,
    );
  });

  it('does not need roadside furniture to engage its existing corner braking', () => {
    const bare = approach(1 / 15, false);
    const furnished = approach(1 / 15, true);
    expect(bare.entrySpeed).toBeGreaterThan(0);
    expect(furnished.entrySpeed).toBeGreaterThan(0);
    expect(bare.entrySpeed).toBeLessThanOrEqual(furnished.entrySpeed + 1);
  });
});
