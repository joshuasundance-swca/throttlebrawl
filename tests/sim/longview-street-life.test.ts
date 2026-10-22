import { describe, expect, it } from 'vitest';
import fastBike from '../../packs/base/bikes/superbike-1000.json';
import diamondRoute from '../../packs/region-pnw/regions/pacific-northwest/routes/osm-longview-street-diamond.json';
import { buildSimConfig, createHeadlessRace, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { SimConfig, SimEvent, SimInput } from '../../src/sim/api';
import { input, riderHarness } from '../../src/sim/riders/testing';
import { firstSeed, ISOLATED, NO_ROAD_EVENTS, seedRange } from './batch';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const streams = createStreamCache();
const eventId = 'region-pnw:pnw-fogline-run',
  routeId = 'region-pnw:osm-longview-street-diamond';
function solo(fast = false): SimConfig {
  const base = buildSimConfig(registry, streams.forEvent(registry, eventId, undefined, routeId), {
    seed: 1,
    eventId,
    route: routeId,
    tuning: {
      ...ISOLATED,
      'ground.offRoad': 1,
      'riders.structures': 1,
      'riders.supports': 1,
      'riders.courseEdges': 1,
    },
  });
  const player = base.riders.find((r) => r.role === 'player')!;
  return {
    ...base,
    riders: [fast ? { ...player, bike: { contentId: 'base:' + fastBike.id, ...fastBike.handling } } : player],
  };
}

describe('Street Diamond local places are usable and their riding payoff is optional', () => {
  it('enters each apron grounded, stops and returns to the verge; a separate approach meets visible frontage or posts', () => {
    const config = solo(),
      road = config.road;
    const sites = road.edges.flatMap((e) =>
      e.features
        .filter((f) => f.params?.['place'] === 'civic-frontage' || f.params?.['place'] === 'plant-market')
        .map((f) => ({ e, f })),
    );
    expect(sites.length).toBeGreaterThan(0);
    for (const { e, f } of sites) {
      const s = (f.s0 + f.s1) / 2,
        side = Math.sign(f.d0 + f.d1),
        verge = road.vergeAt(e.index, s, side < 0 ? 'left' : 'right');
      const from = s - (f.params?.['place'] === 'civic-frontage' ? 10 : 5);
      const h = riderHarness(config, {
        edge: e.index,
        s: from,
        d: verge.dInner - side,
        speed: 5,
        yaw: side * 1.1,
      });
      const events: SimEvent[] = [];
      let entered = false;
      for (let tick = 0; tick < 240 && !entered; tick++) {
        events.push(...h.step(input(h.rider.speed < 6 ? 0.3 : 0, 0, side)));
        entered = Math.abs(h.rider.pos.d) > Math.abs(verge.dOuter) + 1;
      }
      expect(entered, f.id).toBe(true);
      for (let tick = 0; tick < 60; tick++) events.push(...h.step(input(0, 1, 0)));
      expect(h.rider.mode, 'grounded stop on apron').toBe('Road');
      expect(h.rider.speed).toBeLessThan(0.1);
      let returned = false;
      for (let tick = 0; tick < 300 && !returned; tick++) {
        events.push(...h.step(input(h.rider.speed < 5 ? 0.35 : 0, 0, -side)));
        returned = Math.abs(h.rider.pos.d) < Math.abs(verge.dOuter) - 0.6;
      }
      expect(returned, `${f.id} return from visible apron`).toBe(true);
      expect(events.filter((ev) => ev.type === 'crash' || ev.type === 'jump')).toEqual([]);
      const wall = riderHarness(config, {
        edge: e.index,
        s: s - (f.params?.['place'] === 'civic-frontage' ? 6 : 12),
        d: verge.dOuter - side,
        speed: 5,
        yaw: side * 1.1,
      });
      const contact: SimEvent[] = [];
      for (
        let tick = 0;
        tick < 300 &&
        !contact.some(
          (ev) => (ev.type === 'wobble' || ev.type === 'crash') && ev.data['structure'] !== undefined,
        );
        tick++
      )
        // Off-road steering changes world heading; hold the authored approach heading instead
        // of continually turning in a circle before reaching the visible solid.
        contact.push(...wall.step(input(wall.rider.speed < 6 ? 0.35 : 0, 0, 0)));
      expect(
        contact.some(
          (ev) => (ev.type === 'wobble' || ev.type === 'crash') && ev.data['structure'] !== undefined,
        ),
        `${f.id} visible solid contact`,
      ).toBe(true);
      expect(contact.some((ev) => ev.type === 'crash' && ev.data['past'] === 'ground')).toBe(false);
    }
  });

  it.each([false, true])(
    'takes or misses the grounded market boost and safely rejoins, fast bike=%s',
    (fast) => {
      const config = solo(fast),
        road = config.road;
      const e = road.edges.find((e) => e.features.some((f) => f.id === 'street-market-boost'))!;
      const pad = e?.features.find((f) => f.id === 'street-market-boost');
      expect(pad).toBeDefined();
      if (!pad) return;
      function ride(take: boolean) {
        const h = riderHarness(config, { edge: e.index, s: pad!.s0 - 160, d: 2, speed: fast ? 55 : 35 });
        const events: SimEvent[] = [];
        let groundedBoost = false,
          padAirborne = false,
          returned = false;
        for (let tick = 0; tick < 1800; tick++) {
          const p = h.rider.pos;
          const target = take && p.s > pad!.s0 - 100 && p.s < pad!.s1 + 20 ? (pad!.d0 + pad!.d1) / 2 : 2;
          const k = road.kappaAt(p.edge, p.s),
            v = h.rider.speed;
          // Terrain holds world heading after steering is released. Dampen that heading so
          // this take trajectory aims through the pad rather than overshooting beside it.
          const steer = Math.max(-1, Math.min(1, 0.35 * (target - p.d) - 6 * h.rider.yaw + (k * v * v) / 22));
          const emitted = h.step(input(v < (fast ? 60 : 42) ? 1 : 0, 0, steer));
          events.push(...emitted);
          if (emitted.some((ev) => ev.type === 'boost' && ev.data['feature'] === pad!.id))
            groundedBoost = h.rider.mode === 'Road';
          if (h.rider.pos.s >= pad!.s0 && h.rider.pos.s <= pad!.s1)
            padAirborne ||= h.rider.mode === 'Airborne';
          if (p.s > pad!.s1 + 30 && p.d < 4) returned = true;
          if (p.s > pad!.s1 + 140) break;
        }
        return { events, groundedBoost, padAirborne, returned, s: h.rider.pos.s, d: h.rider.pos.d };
      }
      const taken = ride(true),
        miss = ride(false);
      expect(taken.events.filter((ev) => ev.type === 'boost' && ev.data['feature'] === pad.id)).toHaveLength(
        1,
      );
      expect(taken.returned).toBe(true);
      // The real bank can give a brief clean hop on the fast approach. The pad itself is a
      // grounded boost, and must not launch the rider or require an airborne pickup.
      expect(taken.groundedBoost).toBe(true);
      expect(taken.padAirborne).toBe(false);
      expect(
        taken.events.filter((ev) => ev.type === 'land').every((ev) => ev.data['quality'] === 'clean'),
      ).toBe(true);
      expect(taken.events.filter((ev) => ev.type === 'crash')).toEqual([]);
      expect(taken.s).toBeGreaterThan(pad.s1 + 130);
      expect(miss.events.filter((ev) => ev.type === 'boost' || ev.type === 'crash')).toEqual([]);
    },
  );

  it.each(['inner', 'outer'] as const)(
    'finishes the normal populated %s route, checkpoints intact, and replays the same race hashes',
    (choice) => {
      function run(seed: number, replay?: SimInput[]) {
        const { sim, route, playerId, config } = createHeadlessRace(
          { seed, eventId, route: routeId, tuning: NO_ROAD_EVENTS },
          { registry },
        );
        const navigation = choice === 'inner' ? { ...route, shortcuts: [] } : route;
        const outer = new Set(
          diamondRoute.branches.flatMap((b) => b.roads).map((id) => config.road.edgeIndex(id)),
        );
        const bot = createBot(),
          commands: SimInput[] = [],
          hashes: number[] = [],
          directions = new Set<number>();
        let visitedOuter = false;
        expect(config.riders.some((r) => r.role === 'rival')).toBe(true);
        expect(config.riders.some((r) => r.role === 'cop')).toBe(true);
        for (let tick = 0; !sim.isOver() && tick < 60 * 60 * 7; tick++) {
          const snap = sim.snapshot(),
            me = snap.entities.find((e) => e.id === playerId)!;
          visitedOuter ||= outer.has(me.road.edge);
          let cmd = replay?.[tick];
          if (!cmd) {
            const a = emptyActions();
            bot.drive(snap, playerId, navigation, a);
            cmd = toSimInput(a);
          }
          commands.push(cmd);
          sim.step([cmd]);
          for (const e of sim.snapshot().entities) if (e.kind === 'vehicle') directions.add(e.road.dir);
          if (sim.tick % 120 === 0) hashes.push(sim.hash());
        }
        return {
          finish: sim.snapshot().race.finishOrder.includes(playerId),
          visitedOuter,
          directions: [...directions].sort(),
          hash: sim.hash(),
          hashes,
          commands,
        };
      }
      const found = firstSeed(
        `Street Diamond ${choice} finish`,
        seedRange(1, 3),
        (seed) => run(seed),
        (r) => r.finish && r.visitedOuter === (choice === 'outer'),
      );
      expect(found.result, found.summary).not.toBeNull();
      if (!found.result || found.seed === null) return;
      expect(found.result.directions).toEqual([-1, 1]);
      const replay = run(found.seed, found.result.commands);
      expect(replay.hashes).toEqual(found.result.hashes);
      expect(replay.hash).toBe(found.result.hash);
      expect(replay.finish).toBe(true);
    },
    120_000,
  );
});
