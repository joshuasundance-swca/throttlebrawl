/// <reference types="vite/client" />
// The moving ramp truck (playtest 3, the maintainer, 2026-10-03: "The ramp trucks could be in
// motion"), as the packs ship it, forced in (chance 1) on a real route of each region. A car carrier
// drives ahead in the outermost lane; once a racer is close behind it, its ramp comes down and its
// whole box is a jump (a SimMovingDeck), ridden at the speed relative to it. Every other world
// system is off (ISOLATED, tests/sim/batch.ts) except the road events, so the field is the riders
// and the piece under test. What these protect, as rules: the carrier is an ordinary big vehicle
// until its ramp is down; a rider who catches it launches off its lip and lands past its front; one
// barely faster than it meets its body; the deck is the same box on both roads where it crosses a
// join; the carrier never makes the rival AI see every vehicle bigger. Driven by sim ticks only: the
// player is put where the test needs it and flown by a small controller, or the bot rides.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { clamp } from '../../src/core';
import type { SimConfig, SimEvent, SimModifierDef } from '../../src/sim/api';
import { vehicleSize } from '../../src/sim/ai/sense';
import { createSimWithWorld } from '../../src/sim/create';
import { setPieceState } from '../../src/sim/modifiers';
import { bypassedSpans, SET_PIECE } from '../../src/sim/modifiers/setpieces';
import { MOVING } from '../../src/sim/modifiers/moving';
import { riderState } from '../../src/sim/riders';
import { toCorridor, trafficState } from '../../src/sim/traffic';
import { fromCorridor, lanesAt } from '../../src/sim/traffic/corridor';
import { MOVING_DECKS_KEY, type SimMovingDecks } from '../../src/sim/types';
import type { Mover, World } from '../../src/sim/world';
import { ISOLATED } from './batch';

// With the drafts on, as dev and staging builds carry them: the carriers are draft in the packs until
// the traffic render draws their lowered ramp (a release build leaves them out), and these tests are
// about the sim, not about what a release build carries.
const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
  { includeDrafts: true },
);
const STREAMS = createStreamCache();
const ROAD_EVENTS_ONLY = { ...ISOLATED, 'modifiers.setPieceChance': 1 };

/**
 * Each region's moving-ramp modifier as the packs ship it, and a plain race of the region that
 * pools it (found, not named: the first classic race, in id order, that takes the region's road
 * events; the routes are searched too).
 */
function fixture(key: string, name: string) {
  const mod = Object.keys(REG.modifiers)
    .sort()
    .find((id) => {
      const m = REG.modifiers[id];
      return (
        m?.effects.some((e) => e['piece'] === 'moving-ramp') && (m.eligibility?.regions ?? []).includes(key)
      );
    });
  const event = Object.keys(REG.events)
    .sort()
    .find((id) => {
      const e = REG.events[id];
      return e?.region === key && e.kind === 'classic-race' && e.modifiers?.pool === 'region-default';
    });
  if (!mod || !event) throw new Error(`${name}: no moving-ramp modifier or no race that pools it`);
  return { name, event, mod };
}
const KEYS = fixture('florida-keys', 'the Keys');
const PNW = fixture('pacific-northwest', 'the Pacific Northwest');
const SF = fixture('san-francisco', 'San Francisco');
const REGIONS = [KEYS, PNW, SF] as const;

function config(
  event: string,
  seed: number,
  route?: string,
  tuning: Record<string, number> = ROAD_EVENTS_ONLY,
) {
  return buildSimConfig(REG, STREAMS.forEvent(REG, event, 'standard', route), {
    seed,
    eventId: event,
    length: 'standard',
    tuning,
    ...(route ? { route } : {}),
  });
}

/** The race with only the named shipped modifier, sure to fire, and no per-race cap. */
function forced(base: SimConfig, mod: string): SimConfig {
  const mods: SimModifierDef[] = base.modifiers
    .filter((m) => m.contentId === mod)
    .map((m) => ({ ...m, chance: 1 }));
  expect(mods, `${mod} is in the event's pool`).toHaveLength(1);
  const { modifiersPerRace: _cap, ...event } = base.event;
  return { ...base, event, modifiers: mods };
}

/**
 * A race of the region where the carrier is placed: the first of the event's routes (its own, then
 * the real ones) that has a stretch for it. Placement is by the road, not the seed.
 */
function placedRace(region: (typeof REGIONS)[number], seed = 1): SimConfig {
  const routes = [undefined, ...realRoutes(REG, region.event)];
  for (const route of routes) {
    const cfg = forced(config(region.event, seed, route), region.mod);
    const { world } = createSimWithWorld(cfg);
    if (setPieceState(world).pieces.length > 0) return cfg;
  }
  throw new Error(`${region.name}: no route of ${region.event} has a stretch for the moving ramp`);
}

interface Scene {
  cfg: SimConfig;
  sim: ReturnType<typeof createSimWithWorld>['sim'];
  world: World;
  c: ReturnType<typeof trafficState>['corridor'];
  player: Mover;
  events: SimEvent[];
  /** The player's jumps, each with how far along the carrier's box it was (m from its rear). */
  jumps: { ev: SimEvent; into: number }[];
}

/** The race with the player alone on the road: the rivals' fights are not what these test. */
function scene(race: SimConfig): Scene {
  const cfg = { ...race, riders: race.riders.filter((r) => r.controller.kind === 'player') };
  const { sim, world } = createSimWithWorld(cfg);
  const player = world.movers.find((m) => cfg.riders[m.riderIndex]?.controller.kind === 'player');
  if (!player) throw new Error('no player');
  return { cfg, sim, world, c: trafficState(world).corridor, player, events: [], jumps: [] };
}

const pieceOf = (s: Scene) => {
  const p = setPieceState(s.world).pieces[0];
  if (!p) throw new Error('no moving-ramp piece placed');
  return p;
};

/** The outermost route-forward lane's centre at corridor u (where the carrier drives). */
function outerCd(s: Scene, u: number): number {
  const lanes = lanesAt(s.cfg.road, s.c, u, s.c.routeDir);
  const lane = lanes[lanes.length - 1];
  if (!lane) throw new Error('no forward lane');
  return lane.cd;
}

/** Puts the player on the road at corridor (u, cd), riding the route's way at `speed`. */
function putPlayer(s: Scene, u: number, cd: number, speed: number): void {
  fromCorridor(s.c, u, cd, s.c.routeDir, s.player.pos);
  s.player.speed = speed;
  s.player.yaw = 0;
  s.player.h = 0;
  s.player.mode = 'Road';
  // Put down fresh, as a remount is: its climb rate from where it was before is not this road's.
  riderState(s.world).lastTick[s.player.id] = -2;
}

/**
 * One tick: the player flat out, steering for the carrier's line. With `over`, its speed is held
 * that many m/s over the carrier's own (the carrier slows on a grade and behind traffic).
 */
function step(s: Scene, carrierId: number, over?: number): void {
  const car = s.world.movers[carrierId];
  const me = s.player;
  let steer = 0;
  if (car && car.pos.edge === me.pos.edge && car.kind === 'vehicle')
    steer = clamp(0.35 * (car.pos.d - me.pos.d) * me.pos.dir - 2.5 * me.yaw, -1, 1);
  if (over !== undefined && car && me.mode === 'Road') me.speed = car.speed + over;
  s.sim.step([{ steer: Math.round(steer * 127), throttle: 255, brake: 0, flags: 0 }]);
  const fresh = s.sim.events();
  s.events.push(...fresh);
  // Where along the carrier's box (from its rear, in the way it drives) the player was as it jumped.
  for (const e of fresh) {
    if (e.type !== 'jump' || e.actor !== me.id || !car) continue;
    const rear = (toCorridor(s.c, car.pos)?.u ?? 0) - s.c.routeDir * 3.75;
    s.jumps.push({ ev: e, into: s.c.routeDir * ((toCorridor(s.c, me.pos)?.u ?? 0) - rear) });
  }
}

const mine = (s: Scene, type: SimEvent['type']) =>
  s.events.filter((e) => e.type === type && e.actor === s.player.id);
const decks = (s: Scene) => (s.world.systems[MOVING_DECKS_KEY] as SimMovingDecks | undefined)?.live ?? [];

/**
 * Spawns the carrier by putting the player on its stretch, `behind` metres short of its spot, or
 * where the road last bends too tightly to ride at speed with no steering (the stretch itself is
 * straight, its run-up need not be: a Key West street may turn a corner just before it).
 */
function approach(s: Scene, behind: number, speed: number): { carrier: number; u0: number } {
  const p = pieceOf(s);
  const pos = { edge: 0, s: 0, d: 0, dir: 1 as 1 | -1 };
  let start = behind;
  for (let a = 0; a <= behind; a += 5) {
    fromCorridor(s.c, p.u - s.c.routeDir * a, 0, s.c.routeDir, pos);
    if (Math.abs(s.cfg.road.kappaAt(pos.edge, pos.s)) > MOVING.rampMaxKappa) {
      start = Math.max(0, a - 25);
      break;
    }
  }
  const u0 = p.u - s.c.routeDir * start;
  putPlayer(s, u0, outerCd(s, u0), speed);
  s.sim.step([{ steer: 0, throttle: 255, brake: 0, flags: 0 }]);
  s.events.push(...s.sim.events());
  const carrier = pieceOf(s).vehicles[0];
  if (carrier === undefined) throw new Error('the carrier was not placed');
  return { carrier, u0 };
}

describe.each(REGIONS)('the moving ramp truck in $name', (region) => {
  it('turns up on a straight, in the outermost lane, in the carrier its pack names', () => {
    const cfg = placedRace(region);
    const s = scene(cfg);
    const p = pieceOf(s);
    // Straight enough to land on, over the whole stretch it is kept for.
    const pos = { edge: 0, s: 0, d: 0, dir: 1 as 1 | -1 };
    for (let a = 0; a <= p.len; a += 10) {
      fromCorridor(s.c, p.u + s.c.routeDir * a, 0, s.c.routeDir, pos);
      expect(Math.abs(cfg.road.kappaAt(pos.edge, pos.s)), `${a} m along`).toBeLessThanOrEqual(
        MOVING.rampMaxKappa + 1e-9,
      );
    }
    // The carrier it names is the shipped one, a real traffic type.
    const named = String(REG.modifiers[region.mod]?.effects[0]?.['vehicle']);
    const typeId = `${region.mod.split(':')[0]}:${named}`;
    expect(
      cfg.trafficTypes.some((t) => t.contentId === typeId),
      `${typeId} is a traffic type`,
    ).toBe(true);
    // And it drives in the outermost forward lane.
    const { carrier, u0 } = approach(s, 290, 30);
    const at = toCorridor(s.c, s.world.movers[carrier]?.pos ?? s.player.pos);
    expect(at?.cd).toBeCloseTo(outerCd(s, p.u + s.c.routeDir * 40), 6);
    expect(u0).not.toBe(p.u);
  });

  it('is an ordinary big vehicle until its ramp is down: riding into it crashes you', () => {
    const s = scene(placedRace(region));
    const { carrier } = approach(s, 290, 30);
    const car = s.world.movers[carrier];
    expect(car).toBeDefined();
    if (!car) return;
    // The ramp comes down at the end of the tick a racer is within range, so a rider can only meet
    // it still up by arriving in one tick: put the player against its tail, ramp not yet down.
    expect(pieceOf(s).beat).toBe(0);
    expect(decks(s)).toEqual([]);
    const carU = toCorridor(s.c, car.pos)?.u ?? 0;
    putPlayer(s, carU - s.c.routeDir * 4, outerCd(s, carU), 12);
    step(s, carrier);
    const crash = mine(s, 'crash')[0];
    expect(crash?.data).toMatchObject({ cause: 'traffic', hazard: 'big' });
  });

  it('comes down with a racer close behind, and only then is it a deck for the riders', () => {
    const s = scene(placedRace(region));
    const { carrier } = approach(s, 290, 36);
    let beatTick = -1;
    let decksBefore = 0;
    let gap = Infinity;
    for (let t = 0; t < 60 * 40 && beatTick < 0; t++) {
      step(s, carrier);
      const e = s.events.find((x) => x.type === 'setPieceBeat' && x.data['beat'] === 'rampDown');
      if (!e) decksBefore += decks(s).length;
      else {
        beatTick = e.tick;
        const car = s.world.movers[e.actor];
        expect(e.actor, 'the carrier is the actor').toBe(carrier);
        gap =
          s.c.routeDir *
          ((toCorridor(s.c, car?.pos ?? s.player.pos)?.u ?? 0) - (toCorridor(s.c, s.player.pos)?.u ?? 0));
      }
    }
    expect(beatTick, 'the ramp came down').toBeGreaterThan(0);
    expect(decksBefore, 'no deck before the ramp is down').toBe(0);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(MOVING.rampDropM + 1);
    // From the tick it comes down, its deck is published, for the carrier.
    expect(decks(s).length).toBeGreaterThan(0);
    for (const d of decks(s)) expect(d.vehicle).toBe(carrier);
  });

  it.each([1, 2, 3])(
    'launches a rider who catches it, which lands clean past its front (seed %i)',
    (seed) => {
      const s = scene(placedRace(region, seed));
      const { carrier } = approach(s, 290, 36);
      // The jump off the carrier's lip: the one the player made as it left the ramp for the body
      // (the ramp is 5 m, the box 7.5). A crest's launch on a hill, which a road with grades has,
      // is not this one: the loop waits for the lip's own jump and the landing after it.
      const offTheLip = (j: Scene['jumps'][number]) => j.into >= MOVING.rampRunM && j.into <= 7.5 + 1;
      const landedAfterLip = () => {
        const off = s.jumps.find(offTheLip);
        return off !== undefined && mine(s, 'land').some((e) => e.tick > off.ev.tick);
      };
      for (let t = 0; t < 60 * 45 && !landedAfterLip() && mine(s, 'crash').length === 0; t++)
        step(s, carrier);
      const off = s.jumps.find(offTheLip);
      const land = mine(s, 'land').find((e) => e.tick > (off?.ev.tick ?? Infinity));
      const car = s.world.movers[carrier];
      const front = (toCorridor(s.c, car?.pos ?? s.player.pos)?.u ?? 0) + s.c.routeDir * 3.75;
      const landU = toCorridor(s.c, s.player.pos)?.u ?? 0;
      console.log(
        `[print] ${region.name} seed ${seed}: jump rise ${Number(off?.ev.data['vyMps']).toFixed(2)} m/s at ${Number(off?.ev.data['speed']).toFixed(1)} m/s; land ${String(land?.data['quality'])}, ${(s.c.routeDir * (landU - front)).toFixed(1)} m past the front`,
      );
      expect(mine(s, 'crash'), 'it did not crash').toEqual([]);
      expect(off, 'it jumped off the carrier').toBeDefined();
      expect(land?.data['quality']).toBe('clean');
      // Landed on the road, past the truck's front where it stands now.
      expect(s.c.routeDir * (landU - front)).toBeGreaterThan(0);
      // The carrier was never a traffic crash: its contacts are the riders' while the ramp is down.
      expect(s.events.filter((e) => e.type === 'crash' && e.data['cause'] === 'traffic')).toEqual([]);
    },
  );

  it('meets the rider who is barely faster than it: a crash into its body, not a jump', () => {
    const s = scene(placedRace(region));
    const { carrier } = approach(s, 290, 36);
    // Wait for the ramp, then hand the rider to it 12 m behind, held 2 m/s over the carrier's speed.
    for (let t = 0; t < 60 * 40 && decks(s).length === 0; t++) step(s, carrier);
    expect(decks(s).length).toBeGreaterThan(0);
    const car = s.world.movers[carrier];
    const carU = toCorridor(s.c, car?.pos ?? s.player.pos)?.u ?? 0;
    putPlayer(s, carU - s.c.routeDir * 12, outerCd(s, carU), (car?.speed ?? 20) + 2);
    for (let t = 0; t < 60 * 20 && mine(s, 'crash').length === 0; t++) step(s, carrier, 2);
    const crash = mine(s, 'crash')[0];
    expect(crash?.data).toMatchObject({ cause: 'barrier', object: 'rampTruck' });
    expect(String(crash?.data['feature'])).toMatch(/^moving:/);
    // A crest elsewhere on the road may launch it; the carrier's box must not.
    const inBox = s.jumps.filter((j) => j.into >= 0 && j.into <= 7.5 + 1);
    expect(inBox, 'it never left the carrier for a jump').toEqual([]);
  });
});

/**
 * Where the carrier is placed on one route, by seed: the piece (or null) of each race with the
 * region's moving-ramp event forced in, and the race's config.
 */
function placements(region: (typeof REGIONS)[number], route: string | undefined, seeds: readonly number[]) {
  return seeds.map((seed) => {
    const cfg = forced(config(region.event, seed, route), region.mod);
    const { world } = createSimWithWorld(cfg);
    const st = setPieceState(world);
    return { cfg, st, piece: st.pieces.find((p) => p.piece === 'moving-ramp') ?? null };
  });
}

describe('the moving ramp truck, everywhere', () => {
  const SEEDS = [1, 2, 3, 4, 5, 6];

  it('is placed by the road, not the seed: a route either has a stretch for it or never does', () => {
    for (const region of REGIONS) {
      for (const route of [undefined, ...realRoutes(REG, region.event)]) {
        const placed = placements(region, route, SEEDS).filter((p) => p.piece !== null).length;
        expect(
          [0, SEEDS.length],
          `${region.name}, ${route ?? 'its own route'}: placed on ${placed} of ${SEEDS.length} seeds`,
        ).toContain(placed);
      }
    }
  });

  it("keeps the last of its stretch clear of every shortcut's span, on every route", () => {
    let seen = 0;
    for (const region of REGIONS) {
      for (const route of [undefined, ...realRoutes(REG, region.event)]) {
        for (const { cfg, st, piece } of placements(region, route, SEEDS)) {
          if (!piece) continue;
          seen++;
          const label = `${region.name}, ${route ?? 'its own route'}`;
          // The part of the route's progress the last of its stretch covers (+ 10 m, as the rule reads it).
          const from = Math.abs(piece.u - st.u0) + piece.len - MOVING.rampTailM;
          const to = Math.abs(piece.u - st.u0) + piece.len + 10;
          // A long bypass is a junction choice between two real roads, not a shortcut: the rule keeps
          // only its two ends clear (SET_PIECE.longBranchM), and a rider on the other road misses
          // the truck as at any fork.
          const shortcuts = bypassedSpans(cfg).flatMap(([a, b]): [number, number][] =>
            Number.isFinite(b) && b - a > SET_PIECE.longBranchM
              ? [
                  [a, a + SET_PIECE.branchEndM],
                  [b - SET_PIECE.branchEndM, b],
                ]
              : [[a, b]],
          );
          for (const [a, b] of shortcuts) {
            expect(
              from < b && to > a,
              `${label}: its last ${MOVING.rampTailM} m is in the span [${a}, ${b}]`,
            ).toBe(false);
          }
        }
      }
    }
    expect(seen, 'at least one route has a stretch').toBeGreaterThan(0);
  });

  it("gives each region's own race a carrier whichever the seed (San Francisco's has its only straight beside a shortcut)", () => {
    for (const region of REGIONS) {
      const placed = placements(region, undefined, SEEDS).map((p) => p.piece !== null);
      expect(placed, `${region.name}: its own race, seeds ${SEEDS.join(', ')}`).toEqual(
        SEEDS.map(() => true),
      );
    }
  });

  it('never makes the rival AI see every vehicle bigger than it did', () => {
    // sim/ai sizes every vehicle by the race's largest traffic type, so a carrier longer than the
    // region's own largest would change how every rival rides there.
    for (const region of REGIONS) {
      const cfg = config(region.event, 1);
      const carriers = cfg.trafficTypes.filter((t) => t.contentId.endsWith(':event-car-carrier'));
      expect(carriers.length, `${region.name} has a carrier type`).toBeGreaterThan(0);
      const without = { ...cfg, trafficTypes: cfg.trafficTypes.filter((t) => !carriers.includes(t)) };
      expect(vehicleSize(cfg), region.name).toEqual(vehicleSize(without));
    }
  });

  it('puts the same deck on both roads where it crosses a join', () => {
    const s = scene(placedRace(KEYS));
    const { carrier } = approach(s, 290, 36);
    expect(s.c.edges.length, 'the route has a join to stand on').toBeGreaterThan(1);
    // Stand the carrier astride the first join of the route, its ramp down. Any join will do: the
    // rule is about the box, not the place.
    const tr = trafficState(s.world);
    const slot = tr.id.indexOf(carrier);
    expect(slot).toBeGreaterThanOrEqual(0);
    const length = s.cfg.trafficTypes[tr.type[slot] ?? 0]?.lengthM ?? 7.5;
    tr.u[slot] = (s.c.off[1] ?? 0) + s.c.routeDir;
    pieceOf(s).beat = 1;
    s.sim.step([{ steer: 0, throttle: 0, brake: 0, flags: 0 }]);
    const live = decks(s);
    expect(live.length).toBeGreaterThan(1);
    expect(new Set(live.map((d) => d.edge)).size, 'one entry for each road').toBe(live.length);
    // The parts of the box on each road add up to the box: it is the same box on both.
    let onRoads = 0;
    for (const d of live) {
      const len = s.cfg.road.edges[d.edge]?.length ?? 0;
      const a = d.s0;
      const b = d.s0 + d.dir * (d.rampLengthM + d.bodyM);
      onRoads += Math.max(0, Math.min(len, Math.max(a, b)) - Math.max(0, Math.min(a, b)));
    }
    expect(onRoads).toBeCloseTo(length, 1);
  });

  it('ends with its piece: the deck goes, and a race with no moving ramp never has a registry', () => {
    const s = scene(placedRace(PNW));
    const { carrier } = approach(s, 290, 36);
    expect('decks' in s.world.systems, 'none before the ramp is down').toBe(false);
    for (let t = 0; t < 60 * 120 && pieceOf(s).phase !== 2; t++) step(s, carrier);
    expect(pieceOf(s).phase).toBe(2);
    step(s, carrier);
    expect(decks(s)).toEqual([]);
    // A race where the piece is not placed: no registry at all, so it hashes as it always did.
    const bare = scene(config(KEYS.event, 1, undefined, ISOLATED));
    for (let t = 0; t < 120; t++) bare.sim.step([{ steer: 0, throttle: 255, brake: 0, flags: 0 }]);
    expect('decks' in bare.world.systems).toBe(false);
  });

  it('replays to the same hashes', () => {
    const run = () => {
      const s = scene(placedRace(KEYS));
      const { carrier } = approach(s, 290, 36);
      const hashes: number[] = [];
      for (let t = 0; t < 60 * 30; t++) {
        step(s, carrier);
        if (t % 60 === 0) hashes.push(s.sim.hash());
      }
      return hashes;
    };
    const a = run();
    expect(a.length).toBeGreaterThan(5);
    expect(run()).toEqual(a);
  });

  it('comes down with a racer in range when the field rides it as shipped (the bot, seeded bands)', () => {
    let placed = 0;
    let beats = 0;
    for (const region of REGIONS) {
      for (const seed of [1, 2]) {
        const cfg = placedRace(region, seed);
        const { sim, world } = createSimWithWorld({ ...cfg, tuning: { ...cfg.tuning, ...ROAD_EVENTS_ONLY } });
        const st = setPieceState(world);
        const playerId = cfg.riders.findIndex((r) => r.controller.kind === 'player');
        const bot = createBot();
        let snap = sim.snapshot();
        let beat = false;
        let decksBefore = 0;
        placed++;
        while (!sim.isOver() && sim.tick < 60 * 60 * 6 && (st.pieces[0]?.phase ?? 2) !== 2) {
          const actions = emptyActions();
          bot.drive(snap, playerId, cfg.route, actions);
          sim.step([toSimInput(actions)]);
          snap = sim.snapshot();
          const live = (world.systems[MOVING_DECKS_KEY] as SimMovingDecks | undefined)?.live ?? [];
          // The deck is published at the end of the tick the ramp comes down, not before.
          if (sim.events().some((e) => e.type === 'setPieceBeat' && e.data['beat'] === 'rampDown'))
            beat = true;
          if (!beat) decksBefore += live.length;
        }
        expect(decksBefore, `${region.name} seed ${seed}: no deck before the ramp is down`).toBe(0);
        if (beat) beats++;
      }
    }
    console.log(`[print] moving ramp: placed ${placed}, ramp down ${beats}`);
    expect(beats).toBeGreaterThanOrEqual(Math.ceil(placed * 0.8));
  }, 300_000);
});
