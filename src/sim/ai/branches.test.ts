// Playtest 3, T3.2 (round 3: "rivals and cops stay on the highway"): who takes a branch. The rule
// (branches.ts): a route's `aiTake` is the share of rivals that take it, for every rider; with none,
// a branch holding a `gap` is left to the bold (`riskTaking` >= BOLD_RISK) and shut to the rest;
// with none and no gap, `ai.shortcutChance` decides, as it always did. The law follows the same
// line: never onto a branch with `aiTake` 0, or a gap with no `aiTake`.
// The branch fixture: the split zone is the last 40 m of road `a`, onto `c-in`, `cut` and `c-out`.
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureBranchNetwork,
  type BakedRoute,
  type RouteBranch,
} from '../../road';
import { type SimConfig, type SimRiderDef } from '../api';
import { createSimWithWorld } from '../create';
import { aiState } from './index';
import {
  BOLD_RISK,
  branchHoldsGap,
  lawBarredZone,
  lawMayTake,
  lineOutsideZone,
  rivalTakeChance,
} from './branches';

const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
const rival = (n: number, riskTaking?: number): SimRiderDef => ({
  contentId: `base:r${n}`,
  name: `R${n}`,
  role: 'rival',
  faction: 'rider',
  controller: {
    kind: 'ai',
    style: 'racer',
    ...(riskTaking === undefined ? {} : { personality: { riskTaking } }),
  },
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

interface Opts {
  /** A `gap` feature on the branch's `cut` road. */
  gap?: boolean;
  /** The route file's `aiTake` for the branch (named `cut`). */
  aiTake?: number;
  /** `ai.shortcutChance`. */
  chance?: number;
  risks?: readonly number[];
}

/** The fixture world with the branch as the options make it. */
function world(opts: Opts = {}, seed = 5) {
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
  const risks = opts.risks ?? [0.3, 0.3, 0.3, 0.3];
  const config: SimConfig = {
    seed,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [1],
      raceEndTimeoutTicks: 1800,
    },
    riders: [...risks.map((r, i) => rival(i, r)), PLAYER],
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
      'ai.shortcutChance': opts.chance ?? 0.35,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
  return { config, road, route, ...createSimWithWorld(config) };
}

/** Which rivals picked the (one) shortcut at the start. */
function picks(opts: Opts, seed = 5): number[] {
  const w = world(opts, seed);
  const n = w.config.riders.length - 1;
  return Array.from({ length: n }, (_x, i) => i).filter(
    (id) => ((aiState(w.world).shortcuts[id] ?? 0) & 1) !== 0,
  );
}

/** The rivals that ride onto the `cut` road within 25 s. */
function rode(opts: Opts, seed = 5): number[] {
  const w = world(opts, seed);
  const cut = w.road.edgeIndex('cut');
  const took = new Set<number>();
  for (let t = 0; t < 60 * 25; t++) {
    w.sim.step([{ steer: 0, throttle: 0, brake: 255, flags: 0 }]);
    for (const e of w.sim.snapshot().entities) if (e.kind === 'rider' && e.road.edge === cut) took.add(e.id);
  }
  return [...took].filter((id) => id < w.config.riders.length - 1).sort();
}

describe('the fixture', () => {
  it('has the one branch, and sees its gap only when the road holds one', () => {
    for (const gap of [false, true]) {
      const w = world({ gap });
      expect(w.route.branches).toHaveLength(1);
      expect(branchHoldsGap(w.config, w.route.branches[0] as RouteBranch)).toBe(gap);
    }
  });
});

describe('the rivals take a branch by its aiTake, else by its gap, else by chance', () => {
  it('a branch with no gap and no aiTake is rolled as it always was: chance 1 takes it, 0 does not', () => {
    expect(picks({ chance: 1 })).toEqual([0, 1, 2, 3]);
    expect(picks({ chance: 0 })).toEqual([]);
  });

  it('a gap with no aiTake is shut to a rival below the bold line, and open to one at or above it', () => {
    const risks = [0.1, BOLD_RISK - 0.01, BOLD_RISK, 0.95];
    expect(picks({ gap: true, chance: 1, risks })).toEqual([2, 3]);
    // The bold follow the AI's own chance like any branch: at 0, not even they take it.
    expect(picks({ gap: true, chance: 0, risks })).toEqual([]);
  });

  it("a route's aiTake 0 shuts the branch to everyone, the bold too, gap or no gap", () => {
    for (const gap of [false, true]) {
      expect(picks({ gap, aiTake: 0, chance: 1, risks: [0.1, 0.9, 1, 0.8] })).toEqual([]);
    }
  });

  it("a route's aiTake 1 opens it to everyone, even over a gap, whatever the AI's own chance", () => {
    for (const gap of [false, true]) {
      expect(picks({ gap, aiTake: 1, chance: 0, risks: [0.1, 0.9, 1, 0.8] })).toEqual([0, 1, 2, 3]);
    }
  });

  it('an aiTake between is a share of riders, and the same seed picks the same riders', () => {
    // Over 12 seeds x 4 rivals, half of 48 is 24: a band, not a floor at the measured rate.
    let took = 0;
    for (let seed = 1; seed <= 12; seed++)
      took += picks({ aiTake: 0.5, chance: 0, risks: [0.3, 0.3, 0.3, 0.3] }, seed).length;
    expect(took).toBeGreaterThan(14);
    expect(took).toBeLessThan(34);
    expect(picks({ aiTake: 0.5 }, 7)).toEqual(picks({ aiTake: 0.5 }, 7));
  });

  it('a rival below the bold line, told the gap branch is open at chance 1, does not ride it; a control branch is ridden', () => {
    const control = rode({ chance: 1 });
    const gapped = rode({ gap: true, chance: 1 });
    const barred = rode({ aiTake: 0, chance: 1 });
    console.log(
      `[examined] rode the branch in 25 s: no gap ${control.length}/4, gap ${gapped.length}/4, aiTake 0 ${barred.length}/4`,
    );
    expect(control).toEqual([0, 1, 2, 3]);
    expect(gapped).toEqual([]);
    expect(barred).toEqual([]);
  });
});

describe('the rule as the pure function', () => {
  it('rivalTakeChance: aiTake wins, then the gap and the rider, then the base', () => {
    const open = world({ chance: 0.35 });
    const gapped = world({ gap: true });
    const zero = world({ aiTake: 0, gap: true });
    const half = world({ aiTake: 0.5, gap: true });
    const zone = (w: ReturnType<typeof world>) =>
      w.route.shortcuts[0] as NonNullable<(typeof w.route.shortcuts)[0]>;
    expect(rivalTakeChance(open.config, zone(open), 0.1, 0.35)).toBe(0.35);
    expect(rivalTakeChance(gapped.config, zone(gapped), 0.79, 0.35)).toBe(0);
    expect(rivalTakeChance(gapped.config, zone(gapped), 0.8, 0.35)).toBe(0.35);
    expect(rivalTakeChance(zero.config, zone(zero), 1, 0.35)).toBe(0);
    expect(rivalTakeChance(half.config, zone(half), 0, 0.35)).toBe(0.5);
  });
});

describe('the law stays on the highway', () => {
  it('may follow an open branch, and not one with aiTake 0 or a gap and no aiTake', () => {
    const z = (w: ReturnType<typeof world>) =>
      w.route.shortcuts[0] as NonNullable<(typeof w.route.shortcuts)[0]>;
    const open = world();
    const gapped = world({ gap: true });
    const zero = world({ aiTake: 0 });
    const gappedOpen = world({ gap: true, aiTake: 0.5 });
    const gappedOne = world({ gap: true, aiTake: 1 });
    expect(lawMayTake(open.config, z(open))).toBe(true);
    expect(lawMayTake(gapped.config, z(gapped))).toBe(false);
    expect(lawMayTake(zero.config, z(zero))).toBe(false);
    // The file says some take it: the law is not barred from a branch the file opens.
    expect(lawMayTake(gappedOpen.config, z(gappedOpen))).toBe(true);
    expect(lawMayTake(gappedOne.config, z(gappedOne))).toBe(true);
  });

  it('a barred zone is found approaching it (150 m out) and inside it, and not before, past it or on another edge', () => {
    const w = world({ aiTake: 0 });
    const z = w.route.shortcuts[0] as NonNullable<(typeof w.route.shortcuts)[0]>;
    expect(lawBarredZone(w.config, z.edge, z.s0 - 151, 1)).toBeNull();
    expect(lawBarredZone(w.config, z.edge, z.s0 - 149, 1)).toBe(z);
    expect(lawBarredZone(w.config, z.edge, z.s1 - 1, 1)).toBe(z);
    expect(lawBarredZone(w.config, z.edge, z.s1 + 1, 1)).toBeNull();
    expect(lawBarredZone(w.config, z.edge + 1, z.s0, 1)).toBeNull();
    // An open branch bars nobody.
    const open = world();
    expect(lawBarredZone(open.config, z.edge, z.s0, 1)).toBeNull();
  });

  it("the line keeps out of the zone's side, and leaves a line already clear of it alone", () => {
    const w = world({ aiTake: 0 });
    const z = w.route.shortcuts[0] as NonNullable<(typeof w.route.shortcuts)[0]>;
    const inner = Math.abs(z.d0) <= Math.abs(z.d1) ? z.d0 : z.d1;
    const side = Math.sign((inner === z.d0 ? z.d1 : z.d0) - inner);
    const mid = (z.d0 + z.d1) / 2;
    expect(lineOutsideZone(z, mid) * side).toBeLessThan(inner * side);
    expect(lineOutsideZone(z, inner - side * 3)).toBe(inner - side * 3);
  });
});
