import { describe, expect, it } from 'vitest';
import { buildSimConfig, createHeadlessRace, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { chooseSetPieces, loadPnwPlacesLayout, setPieceActive } from '../../src/road';
import type { SimEvent } from '../../src/sim/api';
import { input, riderHarness } from '../../src/sim/riders/testing';
import { riderState } from '../../src/sim/riders';
import { supportKindOf } from '../../src/sim/riders/supports';
import { firstSeed, ISOLATED, NO_ROAD_EVENTS, seedRange } from './batch';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const streams = createStreamCache();
const eventId = 'region-pnw:pnw-fogline-run';
const route = 'region-pnw:osm-longview-port-shift';
function setup(seed: number) {
  const config = buildSimConfig(registry, streams.forEvent(registry, eventId, undefined, route), {
    seed,
    eventId,
    route,
    tuning: {
      ...ISOLATED,
      'ground.offRoad': 1,
      'riders.supports': 1,
      'riders.structures': 1,
      'riders.courseEdges': 1,
    },
  });
  const player = config.riders.find((r) => r.role === 'player')!;
  return { ...config, riders: [player] };
}

function ride(seed: number, optional: boolean) {
  const config = setup(seed);
  const chosen = chooseSetPieces(config.road.edges, seed);
  const edge = config.road.edges.find((e) => e.features.some((f) => f.id.startsWith('port-carrier-')))!;
  const truck = edge?.features.find((f) => f.kind === 'rampTruck' && setPieceActive(f, chosen));
  if (!truck) throw new Error('no authored Longview carrier opportunity');
  const mid = (truck.d0 + truck.d1) / 2;
  const h = riderHarness(config, { edge: edge.index, s: truck.s0 - 130, d: 2, speed: 30 });
  const events: SimEvent[] = [];
  let deck = false,
    air = false,
    landed = false;
  let maxD = 0;
  for (let tick = 0; tick < 1600; tick++) {
    const p = h.rider.pos;
    const target = optional && p.s < truck.s1 + 110 ? mid : 2;
    const k = config.road.kappaAt(p.edge, p.s);
    const steer = Math.max(
      -1,
      Math.min(1, 0.35 * (target - p.d) - 2.5 * h.rider.yaw + (k * h.rider.speed * h.rider.speed) / 22),
    );
    const out = h.step(input(h.rider.speed < 42 ? 1 : 0, 0, steer));
    events.push(...out);
    maxD = Math.max(maxD, Math.abs(p.d));
    if (p.s > truck.s0 + 1 && p.s < truck.s0 + 10 && h.rider.h > 0.1 && h.rider.mode === 'Road') deck = true;
    if (h.rider.mode === 'Airborne' && h.rider.h > 2) air = true;
    if (out.some((e) => e.type === 'land' && e.data['quality'] === 'clean')) landed = true;
    if (p.s > truck.s1 + 150) break;
  }
  return {
    events,
    deck,
    air,
    landed,
    maxD,
    s: h.rider.pos.s,
    truck,
    state: JSON.stringify({ p: h.rider.pos, speed: h.rider.speed, mode: h.rider.mode, events }),
  };
}

describe('the authored Port Shift loading line is optional and repeatable', () => {
  it('rides from the ordinary verge onto each loading apron and stops without leaving the course', async () => {
    const config = setup(1);
    const { pnwPlacesLayout } = await loadPnwPlacesLayout();
    for (const yard of pnwPlacesLayout(config.road, 1).workyards) {
      const side = Math.sign(yard.d);
      const verge = config.road.vergeAt(yard.edge, yard.s, side < 0 ? 'left' : 'right');
      const h = riderHarness(config, {
        edge: yard.edge,
        s: yard.s - 6,
        d: verge.dOuter - side,
        speed: 5,
        yaw: side * 1.1,
      });
      const events: SimEvent[] = [];
      let entered = false;
      for (let tick = 0; tick < 240 && !entered; tick++) {
        events.push(...h.step(input(h.rider.speed < 6 ? 0.3 : 0, 0, side)));
        entered = Math.abs(h.rider.pos.d) >= Math.abs(verge.dOuter) + 1;
      }
      expect(entered, yard.kind).toBe(true);
      for (let tick = 0; tick < 60; tick++) events.push(...h.step(input(0, 1, 0)));
      expect(h.rider.mode, yard.kind).toBe('Road');
      expect(Math.abs(h.rider.pos.d), 'stopped beyond the old decorative-ground boundary').toBeGreaterThan(
        Math.abs(verge.dOuter) + 1,
      );
      expect(h.rider.speed).toBeLessThan(0.1);
      expect(events.filter((e) => e.type === 'crash')).toEqual([]);
    }
  });
  it('lands on the actual shed roof and meets its back wall below the roof, with an above-wall control', async () => {
    const config = setup(1);
    const { pnwPlacesLayout } = await loadPnwPlacesLayout();
    const yards = pnwPlacesLayout(config.road, 1).workyards.filter((y) => y.kind === 'freight-shed');
    expect(yards.length).toBeGreaterThan(0);
    for (const side of [-1, 1]) {
      const yard = yards.find((y) => Math.sign(y.d) === side)!;
      function fly(height: number, speed: number, yaw: number, ticks: number) {
        const h = riderHarness(config, { edge: yard.edge, s: yard.s - 5, d: yard.d, speed, yaw });
        const mode = () => h.rider.mode;
        h.rider.mode = 'Airborne';
        const st = riderState(h.world);
        st.yAbs[h.rider.id] = config.road.surfaceHeight(yard.edge, yard.s - 5, yard.d) + height;
        st.vy[h.rider.id] = 0;
        st.airTicks[h.rider.id] = 0;
        st.lastTick[h.rider.id] = -1;
        const events: SimEvent[] = [];
        let supported = 0;
        for (let tick = 0; tick < ticks; tick++) {
          events.push(...h.step(input(0, 0, yaw === 0 ? 0 : Math.sign(yaw) * 0.7)));
          if (supportKindOf(h.world, h.rider.id) === 'structure' && mode() === 'Road') {
            supported++;
            expect(h.rider.h).toBeGreaterThan(6);
          }
        }
        return { events, supported };
      }
      const roof = fly(8, 2, 0, 100);
      expect(roof.events.some((e) => e.type === 'land' && e.data['on'] === 'structure')).toBe(true);
      expect(roof.supported).toBeGreaterThan(15);
      const wall = fly(3, 12, side * 0.9, 45);
      expect(
        wall.events.some(
          (e) => (e.type === 'wobble' || e.type === 'crash') && e.data['structure'] !== undefined,
        ),
      ).toBe(true);
      const above = fly(12, 12, side * 0.9, 30);
      expect(
        above.events.some(
          (e) => (e.type === 'wobble' || e.type === 'crash') && e.data['structure'] !== undefined,
        ),
      ).toBe(false);
    }
  });
  it('rides onto a carrier deck, jumps and lands clean; a lateral miss gets neither boost nor jump', () => {
    const candidates = setup(1).road.edges.flatMap((e) =>
      e.features.filter((f) => f.kind === 'rampTruck' && f.id.startsWith('port-carrier-')),
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const found = firstSeed(
        `Longview active loading line ${candidate.id}`,
        seedRange(1, 12),
        (seed) => {
          const c = setup(seed);
          return chooseSetPieces(c.road.edges, seed).has(candidate.id);
        },
        Boolean,
      );
      expect(found.seed, found.summary).not.toBeNull();
      const seed = found.seed!;
      const r = ride(seed, true),
        miss = ride(seed, false);
      expect(r.deck).toBe(true);
      expect(r.air).toBe(true);
      expect(r.landed).toBe(true);
      expect(r.events.some((e) => e.type === 'boost')).toBe(true);
      expect(r.events.filter((e) => e.type === 'crash')).toEqual([]);
      expect(
        miss.events.filter((e) => e.type === 'boost' || e.type === 'jump' || e.type === 'crash'),
      ).toEqual([]);
      expect(r.s).toBeGreaterThan(r.truck.s1 + 140);
      expect(ride(seed, true).state).toBe(r.state);
      console.log(
        `[examined] seed ${seed}, ${r.truck.id}: deck support, boost, airborne, clean land, lateral miss, repeated state; max lateral ${r.maxD.toFixed(2)} m`,
      );
    }
  });

  it('varies the carrier candidate across bounded seeds without moving the workyards', () => {
    const ids = new Set<string>();
    for (const seed of seedRange(1, 12)) {
      const c = setup(seed);
      const active = [...chooseSetPieces(c.road.edges, seed)].filter((id) => id.startsWith('port-carrier-'));
      expect(active, 'one parked carrier per loading-line slot').toHaveLength(1);
      for (const id of active) ids.add(id);
    }
    expect(ids.size).toBeGreaterThan(1);
  });

  it('finishes the normal route with the real cast, both traffic directions and repeatable race hash', () => {
    function race(seed: number) {
      const {
        sim,
        route: progress,
        playerId,
        config: liveConfig,
      } = createHeadlessRace({ seed, eventId, route, tuning: NO_ROAD_EVENTS }, { registry });
      const bot = createBot();
      expect(liveConfig.riders.some((r) => r.role === 'rival')).toBe(true);
      expect(liveConfig.riders.some((r) => r.role === 'cop')).toBe(true);
      const directions = new Set<number>();
      const checkpoints = new Set<number>();
      while (!sim.isOver() && sim.tick < 60 * 60 * 8) {
        const snap = sim.snapshot();
        const actions = emptyActions();
        bot.drive(snap, playerId, progress, actions);
        sim.step([toSimInput(actions)]);
        for (const e of sim.snapshot().entities) if (e.kind === 'vehicle') directions.add(e.road.dir);
        for (const ev of sim.events())
          if (ev.actor === playerId && ev.type === 'lapOrCheckpoint') checkpoints.add(ev.tick);
      }
      return {
        finish: sim.snapshot().race.finishOrder.includes(playerId),
        hash: sim.hash(),
        directions: [...directions].sort(),
        checkpoints: checkpoints.size,
        ticks: sim.tick,
      };
    }
    const found = firstSeed('Longview normal race finish', seedRange(1, 4), race, (r) => r.finish);
    expect(found.result, found.summary).not.toBeNull();
    if (!found.result || found.seed === null) return;
    expect(found.result.directions).toEqual([-1, 1]);
    expect(found.result.checkpoints).toBeGreaterThan(0);
    expect(race(found.seed)).toEqual(found.result);
    console.log(
      `[examined] normal Longview seed ${found.seed}: finish tick ${found.result.ticks}, hash ${found.result.hash}, checkpoints ${found.result.checkpoints}, both traffic directions`,
    );
  }, 120_000);
});
