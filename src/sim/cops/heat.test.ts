// Playtest 2's heat meter (the maintainer's COPS answer, "Mix of 2 and 1 (reliable but rich)"):
// the contract first. The snapshot carries the law view for the player in slot 0 (heat 0..1, its
// tier, and whether a chase was shaken off), clean at the start of every race.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import { createSim, SIM_TUNING, type SimConfig, type SimRiderDef } from '../api';
import { HEAT_MAX } from './index';

const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
const player: SimRiderDef = {
  contentId: 'base:player',
  name: 'player',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike,
  massKg: 80,
  healthMax: 100,
};

function config(): SimConfig {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 900, kappa: 0 }]));
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 60, dir: 1 },
    finish: { road: 'a', s: 880 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return {
    seed: 1,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
    },
    riders: [player],
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

describe('playtest 2: the law in the snapshot', () => {
  it('carries a clean heat meter for the player at the start, and after a quiet stretch', () => {
    const sim = createSim(config());
    expect(sim.snapshot().law).toEqual({ heat: 0, tier: 0, lost: false, citations: 0, citationCash: 0 });
    for (let t = 0; t < 120; t++) sim.step([]);
    expect(sim.snapshot().law).toEqual({ heat: 0, tier: 0, lost: false, citations: 0, citationCash: 0 });
  });

  it('measures heat out of HEAT_MAX points', () => {
    expect(HEAT_MAX).toBe(100);
  });
});
