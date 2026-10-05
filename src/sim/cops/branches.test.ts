// Playtest 3, T3.2 (round 3: "rivals and cops stay on the highway"): the law does not follow a rider
// onto a branch the route bars to it (`aiTake` 0, or a gap with no `aiTake`: sim/ai/branches.ts);
// it rides the main path on and meets the rider where the branch rejoins. The branch fixture: the
// split zone is the last 40 m of road `a` (d 2.4 to 4.9), onto `c-in`, `cut` and `c-out`.
//
// The scene: a rider stopped in the zone's outer lane, the cop alongside him (moved in), as a cop
// does after his spell on station. Alongside, his line is the man's d less 1.2 m, which lies inside
// the zone: where a cop that may follow rides on into the branch, and one that may not keeps out.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureBranchNetwork, type BakedRoute } from '../../road';
import { SIM_TUNING, type SimConfig, type SimRiderDef } from '../api';
import { ridersSystem } from '../riders';
import { addMover, createWorld } from '../world';
import { COP_DONE, copsState, copsSystem } from './index';

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
const COP: SimRiderDef = {
  contentId: 'base:sgt-pruitt',
  name: 'Sgt. Pruitt',
  role: 'cop',
  faction: 'law',
  controller: { kind: 'cop' },
  bike: { ...bike, topSpeedMps: 38 * 1.05 },
  massKg: 95,
  healthMax: 100,
  law: {
    agency: 'base:test-deputies',
    bustRadiusM: 14,
    bustDwellS: 1,
    fineCash: 400,
    pursuitSpeedScale: 1.05,
  },
};

interface Opts {
  gap?: boolean;
  aiTake?: number;
}

function config(opts: Opts): SimConfig {
  const f = fixtureBranchNetwork();
  const roads = f.roads.map((r) =>
    r.id === 'cut' && opts.gap
      ? {
          ...r,
          features: [
            ...(r.features ?? []),
            { kind: 'gap', id: 'moser', s0: 80, s1: 110, d0: -5, d1: 5, params: {} },
          ],
        }
      : r,
  );
  const road = createRoadNetwork({ network: f.network, roads });
  const branches: BakedRoute['branches'] =
    opts.aiTake === undefined ? undefined : [{ id: 'cut', roads: ['cut'], aiTake: opts.aiTake }];
  const route = createRouteProgress(road, { ...f.route, ...(branches ? { branches } : {}) });
  return {
    seed: 99,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
    },
    riders: [PLAYER, COP],
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
      'cops.sirenLeadS': 0,
      'cops.spawnDelayS': 0,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

/** Where the cop's line goes (road d), alongside a stopped rider in the zone's outer lane. */
function alongside(opts: Opts, atS: number) {
  const cfg = config(opts);
  const world = createWorld(cfg);
  const a = cfg.road.edgeIndex('a');
  addMover(world, 'rider', { edge: a, s: atS, d: 4.5, dir: 1 }, 0);
  addMover(world, 'rider', { edge: a, s: atS - 1, d: 3.2, dir: 1 }, 1);
  ridersSystem.init(world, cfg);
  copsSystem.init(world, cfg);
  // Rolling, both: a bike turns only as it moves.
  for (const m of world.movers) m.speed = 12;
  let closed = false;
  for (let t = 0; t < 100; t++) {
    ridersSystem.step(world, cfg);
    copsSystem.step(world, cfg);
    world.tick++;
    // Alongside, moved in: the cop's own timer (8 s on station) is stood in for.
    if (!closed && copsState(world).phase[1] === 1) {
      copsState(world).closing[1] = 1;
      closed = true;
    }
  }
  const cop = world.movers[1];
  return { d: cop?.pos.d ?? NaN, edge: cop?.pos.edge ?? -1, chasing: closed };
}

describe('the law and a branch', () => {
  it('rides alongside a rider in the zone, the control: nothing bars the branch, so his line is inside it', () => {
    const r = alongside({}, 150);
    console.log(`[examined] open branch, cop alongside at s 150: ${JSON.stringify(r)}`);
    expect(r.chasing).toBe(true);
    expect(r.d).toBeGreaterThan(2.4);
  });

  it('keeps out of the zone when the route says aiTake 0, or the branch holds a gap and says nothing', () => {
    for (const opts of [{ aiTake: 0 }, { gap: true }]) {
      const r = alongside(opts, 150);
      console.log(`[examined] ${JSON.stringify(opts)}, cop alongside at s 150: ${JSON.stringify(r)}`);
      expect(r.chasing).toBe(true);
      expect(r.d).toBeLessThan(2.4 - 0.9 + 0.3);
    }
  });

  it('is not held out of a branch the route opens (aiTake above 0), gap or none', () => {
    for (const opts of [{ aiTake: 0.5 }, { gap: true, aiTake: 1 }]) {
      expect(alongside(opts, 150).d).toBeGreaterThan(2.4);
    }
  });
});

// Wave C, G3 (T9.2: a cop was pushed onto the Seven Mile's old road): a cop put on a branch barred
// to the law, chasing a man who rides it. The fixture's `c-in` overlaps the main road's `c-split`
// just past the split; `cut` lies well clear of it.
describe('a cop put on a branch barred to the law', () => {
  /** The man rides `cut` ahead; the cop, chasing him, is put on `edgeId` at s, rolling at 20 m/s. */
  function put(opts: Opts, edgeId: string, s: number) {
    const cfg = config(opts);
    const world = createWorld(cfg);
    const cut = cfg.road.edgeIndex('cut');
    addMover(world, 'rider', { edge: cut, s: 120, d: 0, dir: 1 }, 0);
    addMover(world, 'rider', { edge: cfg.road.edgeIndex('a'), s: 20, d: 0, dir: 1 }, 1);
    ridersSystem.init(world, cfg);
    copsSystem.init(world, cfg);
    for (let t = 0; t < 30 && copsState(world).phase[1] !== 1; t++) {
      copsSystem.step(world, cfg);
      world.tick++;
    }
    const cop = world.movers[1];
    const man = world.movers[0];
    if (!cop || !man) throw new Error('no riders');
    cop.pos = { edge: cfg.road.edgeIndex(edgeId), s, d: 0, dir: 1 };
    cop.speed = 20;
    man.speed = 12;
    const roads: string[] = [];
    const chasing = copsState(world).phase[1] === 1;
    for (let t = 0; t < 60 * 8; t++) {
      ridersSystem.step(world, cfg);
      copsSystem.step(world, cfg);
      world.tick++;
      const id = cfg.road.edges[cop.pos.edge]?.id ?? '?';
      if (roads[roads.length - 1] !== id) roads.push(id);
    }
    return { roads, chasing, speed: cop.speed, s: cop.pos.s, phase: copsState(world).phase[1] };
  }

  it('heads back to the main road at the first legal point, and never follows his man on', () => {
    const back = put({ aiTake: 0 }, 'c-in', 1);
    // The control: a branch the route opens to the law, from the same spot, he follows on.
    const open = put({ aiTake: 1 }, 'c-in', 1);
    console.log(
      `[examined] cop from c-in at 20 m/s: aiTake 0 rode ${back.roads.join(' > ')}; aiTake 1 rode ${open.roads.join(' > ')}`,
    );
    expect(back.chasing && open.chasing).toBe(true);
    expect(open.roads).toContain('cut');
    expect(back.roads).not.toContain('cut');
    expect(back.roads[back.roads.length - 1]).not.toBe('c-in');
  });

  it('past the first legal point he stops where he is, and his chase is over', () => {
    const r = put({ gap: true }, 'cut', 40);
    console.log(`[examined] cop from cut s 40 (a gap, no aiTake): ${JSON.stringify(r)}`);
    expect(r.chasing).toBe(true);
    expect(r.roads).toEqual(['cut']);
    expect(r.speed).toBeLessThan(0.5);
    expect(r.s).toBeLessThan(80);
    expect(r.phase).toBe(COP_DONE);
  });
});
