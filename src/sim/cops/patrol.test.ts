// Playtest 2 (2026-10-02, "I think I've only ever encountered cops once even though I've played a
// lot"; the maintainer's COPS answer: "Mix of 2 and 1 (reliable but rich)"): the patrol. An event
// with `patrolMax` sends 1 to patrolMax of the cops the cops-3 mix leaves in the lot up the road
// instead: each waits on the shoulder ahead, lights up as a player comes near and pulls out as he
// draws level. The mix's own starters still leave the lot as before. Only the cops system steps here (riders stand where
// a test puts them), so the rules are pinned, not the ride; tests/sim/cops-patrol.test.ts races
// every region and route.
import { describe, expect, it } from 'vitest';
import { tuningDefaults } from '../../core';
import { createRoadNetwork, createRouteProgress, fixtureNetwork, type RoadPos } from '../../road';
import { SIM_TUNING, type SimConfig, type SimEvent, type SimEventCops, type SimRiderDef } from '../api';
import { ridersSystem } from '../riders';
import { addMover, createWorld, type World } from '../world';
import { COP_CHASING, COP_PARKED, copsState, copsSystem, PATROL } from './index';

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
  opts: { seed?: number; copFrequency?: number } = {},
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
    tuning: tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
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
    w.step(60 * 25);
    expect(w.sirens().map((e) => e.data['cause'])).toEqual(['every-race']);
  });
});
