// Playtest 2 (2026-10-02, "I think I've only ever encountered cops once even though I've played a
// lot"; the maintainer's COPS answer: "Mix of 2 and 1 (reliable but rich)"): the patrol. An event
// with `patrolMax` sends 1 to patrolMax of the cops the cops-3 mix leaves in the lot up the road
// instead: each waits on the shoulder ahead, lights up as a player comes near and pulls out as he
// draws level. The mix's own starters still leave the lot as before. Only the cops system steps here (riders stand where
// a test puts them), so the rules are pinned, not the ride; tests/sim/cops-patrol.test.ts races
// every region and route.
import { describe, expect, it } from 'vitest';
import { nextFloat, tuningDefaults } from '../../core';
import {
  compileTrack,
  createRoadNetwork,
  createRouteProgress,
  fixtureBranchTrack,
  fixtureNetwork,
  type BakedNetworkBundle,
  type BakedRoute,
  type RoadPos,
} from '../../road';
import { SIM_TUNING, type SimConfig, type SimEvent, type SimEventCops, type SimRiderDef } from '../api';
import { ridersSystem } from '../riders';
import { addMover, createWorld, type World } from '../world';
import { COP_CHASING, COP_PARKED, copsState, copsSystem, PATROL, patrolSpots } from './index';

const bike = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};
const rider = (id: string, role: 'rival' | 'player'): SimRiderDef => ({
  contentId: `base:${id}`,
  name: id,
  role,
  faction: 'rider',
  controller: role === 'player' ? { kind: 'player', slot: 0 } : { kind: 'ai', style: 'racer' },
  bike,
  massKg: 80,
  healthMax: 100,
});
const cop = (id: string): SimRiderDef => ({
  contentId: `base:${id}`,
  name: id,
  role: 'cop',
  faction: 'law',
  controller: { kind: 'cop' },
  bike,
  massKg: 95,
  healthMax: 100,
  law: { agency: 'base:test-law', bustRadiusM: 14, bustDwellS: 1, fineCash: 400, pursuitSpeedScale: 1 },
});

const PLAYER_ID = 1;
const COPS = [2, 3, 4];
const PACE = 30;

/** Rival 0, player 1, cops 2-4 on a 2.4 km straight fixture road (start s 60 on `a`). */
function config(
  cops: SimEventCops | undefined,
  opts: { seed?: number; copFrequency?: number; tuning?: Record<string, number> } = {},
): SimConfig {
  const road = createRoadNetwork(
    fixtureNetwork([
      { id: 'a', lengthM: 800, kappa: 0 },
      { id: 'b', lengthM: 800, kappa: 0 },
      { id: 'c', lengthM: 800, kappa: 0 },
    ]),
  );
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 60, dir: 1 },
    finish: { road: 'c', s: 780 },
    mainPath: ['a', 'b', 'c'],
    allowedRoads: ['a', 'b', 'c'],
    closed: false,
  });
  return {
    seed: opts.seed ?? 5,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: PACE,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
      ...(cops ? { cops } : {}),
    },
    riders: [rider('rival', 'rival'), rider('player', 'player'), cop('c1'), cop('c2'), cop('c3')],
    weapons: [],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), ...opts.tuning },
    difficulty: {
      presetId: 'normal',
      riderAggression: 1,
      copFrequency: opts.copFrequency ?? 1,
      rubberBand: 1,
    },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

const patrol = (over: Partial<SimEventCops> = {}): SimEventCops => ({
  mode: 'every-race',
  baseCount: 1,
  tierScale: 0,
  chaosSummon: false,
  randomness: 0,
  patrolMax: 2,
  ...over,
});

/** A supported long alternative, with either a late rejoin or a long main-road tail after it. */
function forkConfig(safePrefix = true, rejoinEarly = false): SimConfig {
  const source = fixtureBranchTrack();
  source.points = [...source.points.slice(0, -1), [0, -3600]];
  if (rejoinEarly) source.roads = source.roads.map((r) => (r.id === 'b' ? { ...r, lengthM: 400 } : r));
  source.branches = source.branches!.map((b) => ({
    ...b,
    via: [{ x: 1500, z: -1500, headingDeg: 180, turnM: 80 }],
    named: { id: 'long-way', kind: 'detour' as const, marked: true, aiTake: 0.25 },
  }));
  const baked = compileTrack(source);
  const bundle = baked as unknown as BakedNetworkBundle;
  const routeFile = baked.routes[0] as unknown as BakedRoute;
  const roads = bundle.roads.map((r) =>
    safePrefix || r.id !== 'a'
      ? r
      : {
          ...r,
          laneSections: [
            {
              s0: 0,
              lanes: [{ id: 'R1', dCenterM: 0, widthM: 3, direction: 1 as const, kind: 'drive' as const }],
              verges: {
                left: { widthM: 0.5, surface: 'grass' as const, edge: 'soft' as const },
                right: { widthM: 0.5, surface: 'grass' as const, edge: 'soft' as const },
              },
            },
          ],
        },
  );
  const road = createRoadNetwork({ network: bundle.network, roads });
  const route = createRouteProgress(road, routeFile);
  return { ...config(patrol({ baseCount: 0 })), road, route };
}

function lawWorld(cfg: SimConfig) {
  const world: World = createWorld(cfg);
  const at = (s: number, d: number): RoadPos => ({ edge: 0, s, d, dir: 1 });
  addMover(world, 'rider', at(70, 1.7), 0);
  addMover(world, 'rider', at(60, 1.7), 1);
  for (const i of COPS) addMover(world, 'rider', at(40, 1.7), i);
  ridersSystem.init(world, cfg);
  copsSystem.init(world, cfg);
  const events: SimEvent[] = [];
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      world.events = [];
      copsSystem.step(world, cfg);
      events.push(...world.events);
      world.tick++;
    }
  };
  /** Puts the player `gap` metres short of a cop along the route (same edge layout as the route). */
  const playerShortOf = (copId: number, gap: number) => {
    const p = world.movers[PLAYER_ID];
    const at = copsState(world).patrolAt[copId] ?? 0;
    const progress = at - gap;
    const a = cfg.route.progressAt(0, 0);
    const edge = Math.min(2, Math.floor((progress - a) / 800));
    if (p) p.pos = { edge, s: progress - cfg.route.progressAt(edge, 0), d: 1.7, dir: 1 };
  };
  const sirens = () => events.filter((e) => e.type === 'siren' && e.data['on'] === true);
  return { world, cfg, step, events, sirens, playerShortOf };
}

const patrolCops = (w: World) => COPS.filter((id) => (copsState(w).patrolAt[id] ?? -1) >= 0);

describe('playtest 2: the patrol', () => {
  it('places the first patrol before an early long fork, with safe fallback when the shared prefix has no parking', () => {
    const safe = forkConfig();
    const branch = safe.route.branches.find((b) => b.id === 'long-way')!;
    const choice = branch.choice!;
    const forkAt = safe.route.progressAt(choice.edge, choice.s0);
    expect(branch.edges.reduce((n, i) => n + safe.road.edges[i]!.length, 0)).toBeGreaterThan(
      PATROL.longBranchM,
    );
    expect(forkAt).toBeLessThan(PATROL.minProgress * safe.route.length);
    const world = createWorld(safe);
    const spots = patrolSpots(world, safe, 2);
    const streamControl = createWorld(safe);
    nextFloat(streamControl.rng.cops);
    nextFloat(streamControl.rng.cops);
    expect(world.rng.cops).toEqual(streamControl.rng.cops);
    expect(spots.length).toBeGreaterThanOrEqual(1);
    expect(spots[0]!.at).toBeGreaterThanOrEqual(0);
    expect(spots[0]!.at).toBeLessThan(forkAt - 60);
    expect(spots[0]!.pos.edge).toBe(choice.edge);
    expect(
      safe.road
        .lanesAt(spots[0]!.pos.edge, spots[0]!.pos.s)
        .some((l) => l.kind === 'shoulder' && l.dCenterM === spots[0]!.pos.d),
    ).toBe(true);
    if (spots.length > 1) expect(spots[1]!.at - spots[0]!.at).toBeGreaterThanOrEqual(PATROL.spacingM);
    const unsafe = forkConfig(false);
    const fallback = patrolSpots(createWorld(unsafe), unsafe, 2);
    expect(fallback.length).toBeGreaterThanOrEqual(1);
    expect(fallback.every((s) => s.pos.edge !== choice.edge)).toBe(true);
    expect(
      fallback.every((s) =>
        unsafe.road.lanesAt(s.pos.edge, s.pos.s).some((l) => l.kind === 'shoulder' && l.dCenterM === s.pos.d),
      ),
    ).toBe(true);
  });
  it('keeps normal placement when a long branch rejoins before the first patrol', () => {
    const cfg = forkConfig(true, true);
    const branch = cfg.route.branches.find((b) => b.id === 'long-way')!;
    const after = Math.max(
      ...branch.edges.map((edge) => cfg.route.progressAt(edge, cfg.road.edges[edge]!.length)),
    );
    // Removing choice metadata only disables prefix relocation; the road, route and safe-space
    // exclusions remain the same, so this is the ordinary timed placement control.
    const timed = { ...cfg, route: { ...cfg.route, branches: [] } };
    const ordinary = patrolSpots(createWorld(timed), timed, 2);
    expect(ordinary[0]!.at).toBeGreaterThan(after);
    expect(patrolSpots(createWorld(cfg), cfg, 2)).toEqual(ordinary);
  });
  it('keeps escape patrol timing because its opening pursuit already meets the rider before a fork', () => {
    const fixture = forkConfig();
    const escape: SimConfig = { ...fixture, event: { ...fixture.event, kind: 'cop-escape' } };
    const timed = { ...escape, route: { ...escape.route, branches: [] } };
    const ordinary = patrolSpots(createWorld(timed), timed, 2);
    const choice = escape.route.branches.find((b) => b.id === 'long-way')!.choice!;
    expect(ordinary[0]!.at).toBeGreaterThan(escape.route.progressAt(choice.edge, choice.s0));
    expect(patrolSpots(createWorld(escape), escape, 2)).toEqual(ordinary);
  });
  it('uses an earlier safe shoulder when the timed window has no parking, without parking in narrow lanes', () => {
    const cfg = config(patrol({ baseCount: 0 }));
    const oneWay = [{ id: 'R1', dCenterM: 0, widthM: 3, direction: 1 as const, kind: 'drive' as const }];
    const make = (shoulder: boolean) => {
      const bundle = fixtureNetwork([
        { id: 'entry', lengthM: 300, kappa: 0, ...(shoulder ? {} : { lanes: oneWay }) },
        { id: 'narrow', lengthM: 1500, kappa: 0, lanes: oneWay },
      ]);
      for (const r of bundle.roads)
        for (const section of r.laneSections)
          section.verges = {
            left: { widthM: 0.5, surface: 'grass', edge: 'soft' },
            right: { widthM: 0.5, surface: 'grass', edge: 'soft' },
          };
      const road = createRoadNetwork(bundle);
      const route = createRouteProgress(road, {
        id: 'narrow',
        network: bundle.network.id,
        start: { road: 'entry', s: 60, dir: 1 },
        finish: { road: 'narrow', s: 1480 },
        mainPath: ['entry', 'narrow'],
        allowedRoads: ['entry', 'narrow'],
        closed: false,
      });
      return { ...cfg, road, route };
    };
    const safe = make(true);
    const spots = patrolSpots(createWorld(safe), safe, 2);
    expect(spots).toHaveLength(1);
    expect(spots[0]!.pos.edge).toBe(safe.road.edgeIndex('entry'));
    expect(spots[0]!.at).toBeGreaterThanOrEqual(PATROL.minProgress * safe.route.length);
    expect(
      safe.road
        .lanesAt(spots[0]!.pos.edge, spots[0]!.pos.s)
        .some((lane) => lane.kind === 'shoulder' && lane.dCenterM === spots[0]!.pos.d),
    ).toBe(true);
    const unsafe = make(false);
    expect(patrolSpots(createWorld(unsafe), unsafe, 2)).toEqual([]);
  });
  it('rolls one or two patrol cops (both occur over seeds 1-20) beside the lot starter; the rest wait in the lot', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const w = lawWorld(config(patrol(), { seed }));
      const ids = patrolCops(w.world);
      counts.add(ids.length);
      expect(ids.length).toBeGreaterThanOrEqual(1);
      expect(ids.length).toBeLessThanOrEqual(2);
      expect(ids).not.toContain(2); // baseCount 1: the first cop still leaves the lot (cops-3)
      const st = copsState(w.world);
      expect(st.cause[2]).toBe('every-race');
      for (const id of COPS) expect(st.spawns[id]).toBe(id === 2 || ids.includes(id) ? 1 : 0);
    }
    expect([...counts].sort()).toEqual([1, 2]);
  });

  it('waits on the shoulder ahead, about 25-45 s (then 50-75 s) into the race at 0.7 x the pace', () => {
    for (let seed = 1; seed <= 20; seed++) {
      // No lot starter, and a cop frequency that always rolls the most.
      const w = lawWorld(config(patrol({ baseCount: 0 }), { seed, copFrequency: 100 }));
      const st = copsState(w.world);
      const ids = patrolCops(w.world);
      expect(ids).toHaveLength(2);
      const speed = PACE * PATROL.paceShare;
      ids.forEach((id, k) => {
        const m = w.world.movers[id];
        const window = PATROL.windowsS[k] ?? [0, 0];
        const at = st.patrolAt[id] ?? 0;
        // A clear straight: the spot is the drawn progress itself (the second keeps 250 m spacing).
        expect(at).toBeGreaterThanOrEqual(window[0] * speed - 1e-6);
        expect(at).toBeLessThanOrEqual(
          Math.max(window[1] * speed, (st.patrolAt[ids[0] ?? -1] ?? 0) + 250) + 1e-6,
        );
        expect(m?.pos.d).toBe(4.15); // the route-forward shoulder's centre
        expect(m?.speed).toBe(0);
        expect(w.cfg.route.progressAt(m?.pos.edge ?? -1, m?.pos.s ?? 0)).toBeCloseTo(at, 6);
      });
      expect((st.patrolAt[ids[1] ?? -1] ?? 0) - (st.patrolAt[ids[0] ?? -1] ?? 0)).toBeGreaterThanOrEqual(250);
    }
  });

  it('stays dark until a player is within 220 m, lights up (cause patrol), and pulls out for a stopped one within 45 m', () => {
    const w = lawWorld(config(patrol({ baseCount: 0, patrolMax: 1 })));
    const [id] = patrolCops(w.world);
    if (id === undefined) throw new Error('no patrol cop');
    const st = copsState(w.world);
    w.step(60 * 40); // a long wait: nobody comes near
    expect(w.sirens()).toHaveLength(0);
    expect(st.phase[id]).toBe(COP_PARKED);
    w.playerShortOf(id, PATROL.wakeM + 10);
    w.step(5);
    expect(w.sirens()).toHaveLength(0);
    w.playerShortOf(id, PATROL.wakeM - 10);
    w.step(1);
    expect(w.sirens().map((e) => [e.actor, e.data['cause']])).toEqual([[id, 'patrol']]);
    w.step(30);
    expect(st.phase[id]).toBe(COP_PARKED);
    w.playerShortOf(id, PATROL.pullOutM - 5);
    w.step(1);
    expect(st.phase[id]).toBe(COP_CHASING);
    expect(st.target[id]).toBe(PLAYER_ID);
  });

  it('a moving player brings him out as he draws level', () => {
    const w = lawWorld(config(patrol({ baseCount: 0, patrolMax: 1 })));
    const [id] = patrolCops(w.world);
    if (id === undefined) throw new Error('no patrol cop');
    const st = copsState(w.world);
    const p = w.world.movers[PLAYER_ID];
    if (p) p.speed = 30;
    w.playerShortOf(id, 100);
    w.step(1);
    w.playerShortOf(id, 10);
    w.step(1);
    expect(st.phase[id]).toBe(COP_PARKED);
    w.playerShortOf(id, -1);
    w.step(1);
    expect(st.phase[id]).toBe(COP_CHASING);
  });

  it('a player who arrives past him (at most 45 m) still brings him out', () => {
    const w = lawWorld(config(patrol({ baseCount: 0, patrolMax: 1 })));
    const [id] = patrolCops(w.world);
    if (id === undefined) throw new Error('no patrol cop');
    w.playerShortOf(id, -20);
    w.step(1);
    expect(copsState(w.world).phase[id]).toBe(COP_CHASING);
  });

  it('a fast rider wakes him sooner, so the siren still leads his pull-out by the full lead and a second', () => {
    const w = lawWorld(config(patrol({ baseCount: 0, patrolMax: 1 })));
    const [id] = patrolCops(w.world);
    if (id === undefined) throw new Error('no patrol cop');
    const p = w.world.movers[PLAYER_ID];
    if (p) p.speed = 60;
    const wake = PATROL.pullOutM + 60 * (3 + 1); // the default 3 s siren lead
    w.playerShortOf(id, wake + 5);
    w.step(1);
    expect(w.sirens()).toHaveLength(0);
    w.playerShortOf(id, wake - 5);
    w.step(1);
    expect(w.sirens()).toHaveLength(1);
  });

  it('the chase runs out after PATROL.chaseS (siren off, he pulls over), but not while his man is down', () => {
    for (const down of [false, true]) {
      const w = lawWorld(config(patrol({ baseCount: 0, patrolMax: 1 })));
      const [id] = patrolCops(w.world);
      if (id === undefined) throw new Error('no patrol cop');
      w.playerShortOf(id, 10);
      w.step(1);
      const st = copsState(w.world);
      expect(st.phase[id]).toBe(COP_CHASING);
      const p = w.world.movers[PLAYER_ID];
      // Far from him, so a downed player is not busted meanwhile.
      w.playerShortOf(id, -40);
      if (p && down) p.mode = 'Tumble';
      w.step(PATROL.chaseS * 60 - 2);
      expect(st.phase[id]).toBe(COP_CHASING);
      w.step(2);
      expect(st.phase[id] === COP_CHASING).toBe(down);
      const offs = w.events.filter((e) => e.type === 'siren' && e.data['on'] === false);
      expect(offs.map((e) => e.actor)).toEqual(down ? [] : [id]);
    }
  });

  it('the difficulty scales the count: Easy one, Hard two more often than Normal (seeds 1-40, printed)', () => {
    const twos = (copFrequency: number) =>
      Array.from({ length: 40 }, (_, i) => lawWorld(config(patrol(), { seed: i + 1, copFrequency })))
        .map((w) => patrolCops(w.world).length)
        .filter((n) => n === 2).length;
    const [easy = -1, normal = -1, hard = -1] = [0.5, 1, 1.5].map(twos);
    console.log(`[patrol] two-cop patrols in 40 seeds: Easy ${easy}, Normal ${normal}, Hard ${hard}`);
    expect(easy).toBe(0);
    expect(normal).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(normal);
  });

  it('the same seed places the same patrol; at cop frequency 0 nobody patrols', () => {
    const spots = (seed: number) => {
      const w = lawWorld(config(patrol(), { seed }));
      return COPS.map((id) => copsState(w.world).patrolAt[id]);
    };
    expect(spots(9)).toEqual(spots(9));
    expect(new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(spots(s)))).size).toBeGreaterThan(1);
    const off = lawWorld(config(patrol(), { copFrequency: 0 }));
    expect(patrolCops(off.world)).toEqual([]);
  });

  it('cops.patrolScale 0 sends nobody on patrol; 2 doubles the most (patrolMax 1 brings up to 2)', () => {
    const none = lawWorld(config(patrol(), { seed: 3, tuning: { 'cops.patrolScale': 0 } }));
    expect(patrolCops(none.world)).toEqual([]);
    const most = lawWorld(
      config(patrol({ baseCount: 0, patrolMax: 1 }), {
        seed: 3,
        copFrequency: 100,
        tuning: { 'cops.patrolScale': 2 },
      }),
    );
    expect(patrolCops(most.world)).toHaveLength(2);
  });

  it('without patrolMax the lot rule alone holds: the starting cop pulls out at the spawn delay', () => {
    const lot: SimEventCops = {
      mode: 'every-race',
      baseCount: 1,
      tierScale: 0,
      chaosSummon: false,
      randomness: 0,
    };
    const w = lawWorld(config(lot));
    expect(patrolCops(w.world)).toEqual([]);
    w.step(60 * 25); // past the 20 s spawn delay
    expect(w.sirens().map((e) => e.data['cause'])).toEqual(['every-race']);
  });
});
