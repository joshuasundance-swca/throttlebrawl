import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { raceStructures } from '../../src/road';
import { createSimWithWorld } from '../../src/sim/create';
import { raceState } from '../../src/sim/race';
import { input, riderHarness } from '../../src/sim/riders/testing';
import type { SimEvent, SimInput } from '../../src/sim/api';
import { NO_ROAD_EVENTS } from './batch';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const streams = createStreamCache();
const eventId = 'region-pnw:pnw-fogline-run',
  routeId = 'region-pnw:osm-longview-civic-triangle';
function config(seed: number) {
  const base = buildSimConfig(registry, streams.forEvent(registry, eventId, undefined, routeId), {
    seed,
    eventId,
    route: routeId,
    tuning: NO_ROAD_EVENTS,
  });
  // One controlled rider amid the event's ordinary traffic: no rival combat masks a court failure.
  return { ...base, riders: base.riders.filter((r) => r.role === 'player') };
}

describe('Hudson dispatch court is an optional broad riding sweep', () => {
  it.each([false, true])(
    'finishes the populated grid route, optional court=%s, and replays every input',
    (takeCourt) => {
      function run(replay?: readonly SimInput[]) {
        const c = config(1),
          { sim, world } = createSimWithWorld(c),
          road = c.road;
        const playerId = world.movers.find((m) => m.kind === 'rider')!.id;
        const me = () => sim.snapshot().entities.find((m) => m.id === playerId)!;
        const hudson = road.edges.find((e) =>
          e.features.some((f) => f.params?.['place'] === 'dispatch-court'),
        )!;
        expect(hudson, 'authored court fixture').toBeDefined();
        const feature = hudson.features.find((f) => f.params?.['place'] === 'dispatch-court')!;
        expect(c.riders[0]?.bike.contentId).toBe('base:rustbucket-400');
        const bot = createBot(),
          commands: SimInput[] = [],
          hashes: number[] = [],
          events: SimEvent[] = [],
          scopedEvents: SimEvent[] = [];
        const directions = new Set<number>(),
          visited = new Set<number>(),
          trace: { s: number; d: number; speed: number; mode: string }[] = [];
        const incoming = road.edgeIndex('osm-pnw-longview-civic-hudson-in');
        // A gentle lane-to-verge approach, broad sweep, then a long return. No position or yaw writes.
        const line = [
          [0, 2],
          [12, 3],
          [26, 9],
          [35, 10],
          [39, 10.5],
          [44, 14],
          [47, 14],
          [53, 10.5],
          [68, 2],
          [96, 2],
        ];
        const target = (s: number) => {
          const k = line.findIndex((p) => p[0]! >= s),
            a = line[Math.max(0, k - 1)]!,
            b = line[k < 0 ? line.length - 1 : k]!;
          return (
            a[1]! + (b[1]! - a[1]!) * Math.max(0, Math.min(1, (s - a[0]!) / Math.max(0.001, b[0]! - a[0]!)))
          );
        };
        for (let tick = 0; tick < 60 * 240 && !sim.isOver(); tick++) {
          const snap = sim.snapshot(),
            rider = me();
          let cmd = replay?.[tick];
          if (!cmd) {
            const a = emptyActions();
            bot.drive(snap, playerId, c.route, a);
            if (
              takeCourt &&
              rider.road.edge === incoming &&
              rider.road.s > road.edges[incoming]!.length - 75
            ) {
              a.throttle = rider.speed < 14 ? 0.5 : 0;
              a.brake = rider.speed > 15 ? 1 : 0;
            }
            if (takeCourt && rider.road.edge === hudson.index) {
              const p = rider.road,
                ahead = target(p.s + 1),
                yaw = Math.atan((target(p.s + 2) - target(p.s)) / 2);
              const maxYaw = c.riders[0]!.bike.steerRateMps / Math.max(6, rider.speed);
              a.steer = Math.max(
                -1,
                Math.min(
                  1,
                  0.7 * (ahead - p.d) +
                    yaw / maxYaw +
                    (yaw - p.yaw) +
                    (road.kappaAt(p.edge, p.s) * rider.speed * rider.speed) / 22,
                ),
              );
              a.throttle = rider.speed < 14 ? 0.5 : 0;
              a.brake = rider.speed > 15 ? 0.5 : 0;
            }
            cmd = toSimInput(a);
          }
          commands.push(cmd);
          sim.step([cmd]);
          const now = me();
          visited.add(now.road.edge);
          if (now.road.edge === hudson.index)
            trace.push({ s: now.road.s, d: now.road.d, speed: now.speed, mode: now.mode });
          for (const m of sim.snapshot().entities) if (m.kind === 'vehicle') directions.add(m.road.dir);
          for (const ev of sim.events())
            if (ev.actor === playerId) {
              events.push(ev);
              if (
                rider.road.edge === hudson.index ||
                now.road.edge === hudson.index ||
                (rider.road.edge === incoming && rider.road.s > road.edges[incoming]!.length - 75)
              )
                scopedEvents.push(ev);
            }
          if (sim.tick % 120 === 0) hashes.push(sim.hash());
        }
        const courtTrace = trace.filter(
          (p) =>
            p.s > feature.s0 + 1 &&
            p.s < feature.s1 - 1 &&
            p.d > road.vergeAt(hudson.index, p.s, 'right').dOuter + 0.6,
        );
        return {
          commands,
          hashes,
          hash: sim.hash(),
          finish: sim.snapshot().race.finishOrder.includes(playerId),
          checkpoints: raceState(world).checkpoint[playerId],
          expectedCheckpoints: c.route.checkpoints.length,
          events,
          scopedEvents,
          directions: [...directions].sort(),
          visitedHudson: visited.has(hudson.index),
          courtTrace,
          trace,
          ticks: sim.tick,
        };
      }
      const result = run();
      const courtDetail = result.courtTrace.length
        ? {
            minSpeedMps: Math.min(...result.courtTrace.map((p) => p.speed)),
            maxSpeedMps: Math.max(...result.courtTrace.map((p) => p.speed)),
            maxD: Math.max(...result.courtTrace.map((p) => p.d)),
            minS: Math.min(...result.courtTrace.map((p) => p.s)),
            maxS: Math.max(...result.courtTrace.map((p) => p.s)),
          }
        : null;
      process.stdout.write(
        `[examined] Hudson optional=${takeCourt} ticks=${result.ticks} hash=${result.hash} checkpoints=${result.checkpoints}/${result.expectedCheckpoints} directions=${result.directions.join(',')} court samples=${result.courtTrace.length} detail=${JSON.stringify(courtDetail)}; full-race crashes=${JSON.stringify(result.events.filter((e) => e.type === 'crash'))}; trace=${JSON.stringify(result.trace.filter((_, i) => i % 30 === 0))}\n`,
      );
      expect(result.finish).toBe(true);
      expect(result.checkpoints).toBe(result.expectedCheckpoints);
      expect(result.visitedHudson).toBe(true);
      expect(result.directions).toEqual([-1, 1]);
      expect(result.scopedEvents.filter((ev) => ['crash', 'jump', 'respawn'].includes(ev.type))).toEqual([]);
      expect(
        result.trace.every((p) => p.mode === 'Road'),
        'whole Hudson approach, court and return stays grounded',
      ).toBe(true);
      expect(result.courtTrace.length > 0).toBe(takeCourt);
      if (takeCourt) {
        expect(Math.max(...result.courtTrace.map((p) => p.d))).toBeGreaterThan(12.5);
        expect(Math.min(...result.courtTrace.map((p) => p.speed))).toBeGreaterThan(10);
        expect(result.courtTrace.every((p) => p.mode === 'Road')).toBe(true);
        expect(
          result.trace.some((p) => p.s > 75 && p.d < 5 && p.mode === 'Road'),
          'ordinary road recovery',
        ).toBe(true);
      }
      const replay = run(result.commands);
      expect(replay.hashes).toEqual(result.hashes);
      expect(replay.hash).toBe(result.hash);
      expect(replay.finish).toBe(true);
      expect(replay.courtTrace).toEqual(result.courtTrace);
      expect(replay.events).toEqual(result.events);
    },
    120_000,
  );

  it('deliberately meets the visible parked pickup; a separate road line can take or miss the unchanged exit pad', () => {
    const c = config(1),
      road = c.road;
    const hudson = road.edges.find((e) => e.features.some((f) => f.params?.['place'] === 'dispatch-court'))!;
    const f = hudson.features.find((f) => f.params?.['place'] === 'dispatch-court')!;
    // A separate contact fixture starts on the already-supported apron, pointed into the parked pickup.
    // The full-race test above proves the road-to-court entry without moving the rider into the site.
    const contact = riderHarness(c, {
      edge: hudson.index,
      s: (f.s0 + f.s1) / 2 - 5,
      d: 15,
      speed: 5,
      yaw: 1.1,
    });
    const contactEvents: SimEvent[] = [];
    for (
      let tick = 0;
      tick < 240 && !contactEvents.some((e) => e.type === 'crash' || e.data['structure'] !== undefined);
      tick++
    )
      contactEvents.push(...contact.step(input(contact.rider.speed < 5 ? 0.3 : 0, 0, 1)));
    const pickupIds = new Set(
      raceStructures(road, c.seed)
        .items.filter((st) => st.rule.startsWith(f.id + ':pickup-'))
        .map((st) => String(st.id)),
    );
    process.stdout.write(
      `[examined] pickup contact ${JSON.stringify(contactEvents)}, position=${JSON.stringify(contact.rider.pos)}\n`,
    );
    expect(
      contactEvents.some(
        (e) => (e.type === 'crash' || e.type === 'wobble') && pickupIds.has(String(e.data['structure'])),
      ),
    ).toBe(true);
    expect(contactEvents.some((e) => e.type === 'crash' && e.data['past'] === 'ground')).toBe(false);
    const exit = road.edges.find((e) => e.features.some((f) => f.id === 'civic-grid-exit-pad'))!;
    const pad = exit.features.find((f) => f.id === 'civic-grid-exit-pad')!;
    for (const take of [false, true]) {
      const d = take ? (pad.d0 + pad.d1) / 2 : -2;
      const h = riderHarness(c, { edge: exit.index, s: pad.s0 - 12, d, speed: 14 });
      const events: SimEvent[] = [];
      for (let tick = 0; tick < 300 && h.rider.pos.s < pad.s1 + 4; tick++) {
        const p = h.rider.pos,
          v = h.rider.speed;
        const steer = Math.max(
          -1,
          Math.min(1, 0.35 * (d - p.d) - 2.5 * h.rider.yaw + (road.kappaAt(p.edge, p.s) * v * v) / 22),
        );
        events.push(...h.step(input(v < 14 ? 0.4 : 0, 0, steer)));
      }
      expect(h.rider.pos.s).toBeGreaterThan(pad.s1);
      expect(events.some((e) => e.type === 'boost' && e.data['feature'] === pad.id)).toBe(take);
      expect(events.filter((e) => e.type === 'crash' || e.type === 'jump')).toEqual([]);
    }
  });
});
