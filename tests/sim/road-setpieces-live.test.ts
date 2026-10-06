/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
// Playtest 1c item 2 ([decided] 2026-09-30: "I want randomness so you don't see the ... ramp truck in
// the same place"), and the integration skeptic's mustFix 1: #190 added the seeded slots, but no live
// track had any, so the truck and the pads sat in the same place every race. Every boost pad and ramp
// truck on keys-m1, pnw-c1 and sf-hills is now one of 2 or 3 candidates for its slot, and each race's
// seed picks one per slot (road/setpieces.ts). The real roads raced as routes (the maintainer,
// 2026-10-01: "Yes, add as routes") carry their own slots, checked the same way, the route picked
// with RaceSetup.route. This file checks the live data the game loads: the
// slots, that every candidate is a safe placement (a solo rider hits each one and lands clean, and
// no boosted approach feeds a truck), and the skeptic's repro (two seeds, two placements; one seed,
// one placement and one replay).
import { describe, expect, it } from 'vitest';
import {
  buildSimConfig,
  createStreamCache,
  realRoutes,
  regionChoices,
  type ActionState,
} from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { chooseSetPieces, rampTruckShape, setPieceSlots, type BakedFeature } from '../../src/road';
import {
  createSim,
  quantizeInput,
  type EntitySnapshot,
  type SimConfig,
  type SimEvent,
} from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();

interface Region {
  name: string;
  event: string;
  lengths: readonly [string, ...string[]];
  /** A real-road route raced instead of the lengths' (RaceSetup.route), with its own set pieces. */
  route?: string;
  /** The set-piece kinds the track has (a real road without a long straight has no truck). */
  kinds: readonly string[];
}

/**
 * Each region's event and its race lengths (the Keys event has one length), and the real roads
 * raced as routes (the maintainer, 2026-10-01: "Yes, add as routes"), each with its own slots.
 */
const BOTH = ['boostPad', 'rampTruck'] as const;
const REGIONS: readonly [Region, ...Region[]] = [
  { name: 'keys-m1', event: 'base:m1-skeleton-sprint', lengths: ['standard'], kinds: BOTH },
  {
    name: 'pnw-c1',
    event: 'region-pnw:pnw-fogline-run',
    lengths: ['short', 'standard', 'long'],
    kinds: BOTH,
  },
  { name: 'sf-hills', event: 'region-sf:sf-hill-sprint', lengths: ['standard'], kinds: BOTH },
  {
    name: 'osm-pnw-chuckanut',
    event: 'region-pnw:pnw-fogline-run',
    lengths: ['standard'],
    route: 'region-pnw:osm-chuckanut-run',
    kinds: BOTH,
  },
  {
    name: 'osm-pnw-gorge',
    event: 'region-pnw:pnw-fogline-run',
    lengths: ['standard'],
    route: 'region-pnw:osm-gorge-run',
    kinds: BOTH,
  },
  {
    name: 'osm-sf-russian-hill',
    event: 'region-sf:sf-hill-sprint',
    lengths: ['standard'],
    route: 'region-sf:osm-sf-hills-run',
    kinds: BOTH,
  },
  {
    name: 'osm-sf-twin-peaks',
    event: 'region-sf:sf-hill-sprint',
    lengths: ['standard'],
    route: 'region-sf:osm-sf-twin-peaks-run',
    kinds: ['boostPad'],
  },
  // Run W-R: San Francisco's downtown (hand-made), its truck on Burn Rate Row's straight.
  {
    name: 'sf-downtown',
    event: 'region-sf:sf-hill-sprint',
    lengths: ['standard'],
    route: 'region-sf:sf-downtown-run',
    kinds: BOTH,
  },
  // Run W-U: San Francisco's waterfront (hand-made), its truck on Clocktower Reach's straight.
  {
    name: 'sf-waterfront',
    event: 'region-sf:sf-hill-sprint',
    lengths: ['standard'],
    route: 'region-sf:sf-waterfront-run',
    kinds: BOTH,
  },
  // Run W-U: San Francisco's Chinatown and North Beach (two pad slots, no straight long enough for
  // a truck) and the Mission's mural alleys (a truck on Semigloss Street). Both landed with slots
  // but off this list, so no solo rider had ridden their spots; the completeness check below now
  // names any route the packs ship whose slots are not here.
  {
    name: 'sf-chinatown-northbeach',
    event: 'region-sf:sf-hill-sprint',
    lengths: ['standard'],
    route: 'region-sf:sf-chinatown-northbeach-run',
    kinds: ['boostPad'],
  },
  {
    name: 'sf-mission',
    event: 'region-sf:sf-hill-sprint',
    lengths: ['standard'],
    route: 'region-sf:sf-mission-run',
    kinds: BOTH,
  },
  // Run W-S: the real-road networks, their pads on the main road (a solo ride keeps to it, so a
  // pad on a junction choice would never be met).
  {
    name: 'osm-keys-key-west',
    event: 'base:m1-skeleton-sprint',
    lengths: ['standard'],
    route: 'base:osm-key-west-run',
    kinds: ['boostPad'],
  },
  {
    name: 'osm-pnw-samish',
    event: 'region-pnw:pnw-fogline-run',
    lengths: ['standard'],
    route: 'region-pnw:osm-i5-samish-run',
    kinds: ['boostPad'],
  },
  // Playtest 3 (T9.2): Duval Street and the Seven Mile Bridge, their pads on the main road. The
  // Seven Mile's two ramp trucks stand on the old road's repair platforms with no slot (always
  // there); tools/gis/routes-keys-pt3.test.ts rides them, bike by bike.
  {
    name: 'osm-keys-duval',
    event: 'base:m1-skeleton-sprint',
    lengths: ['standard'],
    route: 'base:osm-duval-run',
    kinds: ['boostPad'],
  },
  {
    name: 'osm-keys-seven-mile',
    event: 'base:m1-skeleton-sprint',
    lengths: ['standard'],
    route: 'base:osm-seven-mile-run',
    kinds: ['boostPad'],
  },
  // Playtest 3, T9.4: Bridge City (downtown Portland). Pads only: its streets have no straight
  // long enough for a truck's flight, and both pad slots are on the main road (a solo ride keeps
  // to it, so a pad on the Morrison Bridge choice would never be met).
  {
    name: 'osm-pnw-portland',
    event: 'region-pnw:pnw-fogline-run',
    lengths: ['standard'],
    route: 'region-pnw:osm-bridge-city-run',
    kinds: ['boostPad'],
  },
  // Playtest 3 (T9.3): the Golden Gate (pads on Hawk Hill and Conzelman Road) and Lombard (a pad on
  // the flats past the crooked block). Pads only: neither has a straight long enough for a truck.
  {
    name: 'osm-sf-golden-gate',
    event: 'region-sf:sf-hill-sprint',
    lengths: ['standard'],
    route: 'region-sf:osm-sf-golden-gate-run',
    kinds: ['boostPad'],
  },
  {
    name: 'osm-sf-lombard',
    event: 'region-sf:sf-hill-sprint',
    lengths: ['standard'],
    route: 'region-sf:osm-sf-lombard-run',
    kinds: ['boostPad'],
  },
];

/** The skeptic's two browser seeds (skeptic-1c report, mustFix 1). */
const SKEPTIC_SEEDS = [1783423519, 2901547813] as const;
/** No boost pad may sit this close before a truck along any route: a boosted approach over-throws it. */
const FEED_CLEAR_M = 400;
/**
 * Pads within FEED_CLEAR_M before a truck spot on main when the Mission joined this file
 * (2026-10-03), as `<region> <length>: <pad> before <truck>`. A named list that may only shrink:
 * move the pad (or the truck) and take its line off in the same PR. Never add a line.
 */
const KNOWN_FED_TRUCKS: readonly string[] = [
  // Empty since 2026-10-03: the Mission's first Semigloss pad moved from s 80 (64 m before the early
  // truck) to s 400, after both truck spots.
];

function raceConfig(r: Region, length: string, seed: number): SimConfig {
  return buildSimConfig(REG, STREAMS.forEvent(REG, r.event, length, r.route), {
    seed,
    eventId: r.event,
    length,
    ...(r.route ? { route: r.route } : {}),
  });
}

/** The player alone (no rivals, cop or traffic), so a ride meets only the road and its set pieces. */
function soloConfig(r: Region, length: string, seed: number): SimConfig {
  const built = buildSimConfig(REG, STREAMS.forEvent(REG, r.event, length, r.route), {
    seed,
    eventId: r.event,
    length,
    ...(r.route ? { route: r.route } : {}),
    // An empty road: no traffic and no road events (W-P set pieces bring their own vehicles).
    tuning: {
      'ai.aggressionScale': 0,
      'traffic.densitySame': 0,
      'traffic.densityOncoming': 0,
      'modifiers.setPieceChance': 0,
    },
  });
  return { ...built, riders: built.riders.filter((d) => d.controller.kind === 'player') };
}

interface Candidate {
  edge: number;
  edgeId: string;
  f: BakedFeature;
  slot: string;
}

function candidates(config: SimConfig): Candidate[] {
  const out: Candidate[] = [];
  for (const e of config.road.edges) {
    for (const f of e.features) {
      if (f.kind !== 'boostPad' && f.kind !== 'rampTruck') continue;
      const slot = f.params?.['slot'];
      // A pad or truck in no slot is a fixed piece of its road, there in every race (playtest 3, T5.2:
      // the static ramp trucks of the Pacific Northwest's Mill Yard Cut and San Francisco's Plaza Cut,
      // and the pad on each cut; T9.2: the Seven Mile's two repair-platform trucks). The seed has no
      // say in it, so it is no candidate; the cuts' own checks ride them (tools/road/truck-shortcuts.test.ts,
      // tools/gis/routes-keys-pt3.test.ts).
      if (typeof slot !== 'string') continue;
      out.push({ edge: e.index, edgeId: e.id, f, slot });
    }
  }
  return out;
}

const blank = (): ActionState => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  attack: false,
  attackSide: 0,
  kick: false,
  lookBack: false,
  skipRunBack: false,
});

/**
 * Rides the route solo at full throttle in the right lane's centre (d 2), holding `line` (d) on
 * `edgeId` between `from` and `to`, until 250 m past `to` on that edge (or the edge after it).
 */
function ride(config: SimConfig, edgeId: string, from: number, to: number, line: number) {
  const sim = createSim(config);
  const road = config.road;
  const name = (e: number) => road.edges[e]?.id ?? '?';
  const target = road.edgeIndex(edgeId);
  const events: { ev: SimEvent; edge: string; s: number }[] = [];
  let reached = false;
  let past = 0;
  // One snapshot a tick (the test-diet run, 2026-10-06): the one taken after a step places that
  // tick's events and is the next tick's view; the sim does not change between the two.
  let me = sim.snapshot().entities[0] as EntitySnapshot;
  // Up to 7 minutes: the real roads are 5 to 7.6 km, and a pad near the end of the Gorge sits
  // more than 6 km in (4 minutes at this ride's careful pace through the loops).
  for (let t = 0; t < 60 * 420; t++) {
    const { edge, s, d, dir, yaw } = me.road;
    if (edge === target && s >= to) reached = true;
    if (reached) past += me.speed / 60;
    if (reached && past > 250) break;
    const a = blank();
    // Full throttle, but slow for the bends in the next 80 m (SF's switchbacks), at 5 m/s² across.
    const len = road.edges[edge]?.length ?? 0;
    let bend = 0;
    for (let k = 0; k <= 16; k++) {
      const at = s + dir * k * 5;
      if (at >= 0 && at <= len) bend = Math.max(bend, Math.abs(road.kappaAt(edge, at)));
    }
    const vMax = bend > 0 ? Math.sqrt(5 / bend) : Infinity;
    if (me.speed > vMax + 1) a.brake = 0.6;
    else a.throttle = 1;
    const v = Math.max(me.speed, 5);
    const kappa = road.kappaAt(edge, s) * dir;
    const want = edge === target && s >= from && s <= to ? line : 2;
    a.steer = Math.max(-1, Math.min(1, 0.35 * (want - d) * dir - 2.5 * yaw + (kappa * v * v) / 22));
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    me = sim.snapshot().entities[0] as EntitySnapshot;
    for (const ev of sim.events())
      if (ev.actor === 0) events.push({ ev, edge: name(me.road.edge), s: me.road.s });
  }
  return { events, reached };
}

/** The first seed from 1 whose placement picks `id`. */
function seedPicking(config: SimConfig, id: string): number {
  for (let seed = 1; seed <= 500; seed++) if (chooseSetPieces(config.road.edges, seed).has(id)) return seed;
  throw new Error(`no seed picks ${id}`);
}

/** The first race length whose route passes the edge. */
function lengthFor(r: Region, edge: number): string {
  for (const length of r.lengths) if (raceConfig(r, length, 1).route.allows(edge)) return length;
  throw new Error(`no length of ${r.event} passes edge ${edge}`);
}

/**
 * The races the packs ship with set-piece slots that REGIONS leaves out, from the packs (the quality
 * retro's recommendations 4 and 5): each region's free-play event and every route raced instead.
 */
function uncovered(regions: readonly Region[]): string[] {
  const out: string[] = [];
  for (const c of regionChoices(REG)) {
    for (const route of [undefined, ...realRoutes(REG, c.eventId)]) {
      const r: Region = {
        name: '',
        event: c.eventId,
        lengths: ['standard'],
        kinds: [],
        ...(route ? { route } : {}),
      };
      if (setPieceSlots(raceConfig(r, 'standard', 1).road.edges).size === 0) continue;
      const listed = regions.some((x) => x.event === c.eventId && x.route === route);
      if (!listed) out.push(route ?? c.eventId);
    }
  }
  return out.sort();
}

describe('playtest 1c item 2: every shipped race with set-piece slots is checked here', () => {
  it('REGIONS covers every race the packs ship that has slots', () => {
    expect(uncovered(REGIONS)).toEqual([]);
  });

  it('fires on a race left off the list', () => {
    expect(uncovered(REGIONS.filter((r) => r.name !== 'sf-mission'))).toEqual(['region-sf:sf-mission-run']);
  });
});

describe('playtest 1c item 2: the live tracks place their set pieces from the race seed', () => {
  for (const r of REGIONS) {
    it(`${r.name}: every pad and truck is one of 2 or 3 candidates for a slot of one kind`, () => {
      const config = raceConfig(r, r.lengths[0], 1);
      const all = candidates(config);
      expect(all.length).toBeGreaterThan(0);
      for (const c of all) expect(c.slot, c.f.id).not.toBe('');
      const slots = setPieceSlots(config.road.edges);
      const rows: string[] = [];
      for (const [slot, ids] of slots) {
        const kinds = new Set(all.filter((c) => c.slot === slot).map((c) => c.f.kind));
        rows.push(`${slot}: ${ids.join(', ')}`);
        expect(ids.length, slot).toBeGreaterThanOrEqual(2);
        expect(ids.length, slot).toBeLessThanOrEqual(3);
        expect(kinds.size, slot).toBe(1);
      }
      expect([...new Set(all.map((c) => c.f.kind))].sort()).toEqual([...r.kinds]);
      process.stdout.write(`[set pieces] ${r.name}: ${rows.join('; ')}\n`);
    });

    it(`${r.name}: a slot's candidates are on the same race lengths, so a seed never drops one`, () => {
      for (const length of r.lengths) {
        const config = raceConfig(r, length, 1);
        const all = candidates(config);
        for (const slot of new Set(all.map((c) => c.slot))) {
          const on = all.filter((c) => c.slot === slot).map((c) => config.route.allows(c.edge));
          expect(new Set(on).size, `${slot} on ${length}`).toBe(1);
        }
      }
    });

    it(`${r.name}: every truck spot is straight to its landing, with no pad within ${FEED_CLEAR_M} m before it`, () => {
      const fed: string[] = [];
      for (const length of r.lengths) {
        const config = raceConfig(r, length, 1);
        const all = candidates(config);
        const route = config.route;
        for (const t of all.filter((c) => c.f.kind === 'rampTruck')) {
          const len = config.road.edges[t.edge]?.length ?? 0;
          for (let s = t.f.s0; s <= Math.min(len, t.f.s1 + 100); s += 2)
            expect(Math.abs(config.road.kappaAt(t.edge, s)), `${t.f.id} at s ${s}`).toBeLessThanOrEqual(
              0.002,
            );
          if (!route.allows(t.edge)) continue;
          const at = route.progressAt(t.edge, t.f.s0);
          for (const p of all.filter((c) => c.f.kind === 'boostPad' && route.allows(c.edge))) {
            const gap = at - route.progressAt(p.edge, p.f.s1);
            if (gap > 0 && gap <= FEED_CLEAR_M) fed.push(`${r.name} ${length}: ${p.f.id} before ${t.f.id}`);
          }
        }
      }
      const known = KNOWN_FED_TRUCKS.filter((k) => k.startsWith(`${r.name} `));
      expect(
        fed.filter((f) => !known.includes(f)),
        'pads feeding a truck',
      ).toEqual([]);
      expect(
        known.filter((k) => !fed.includes(k)),
        'fixed: take these off KNOWN_FED_TRUCKS',
      ).toEqual([]);
    });

    it(`${r.name}: different seeds move the pieces; every candidate gets its turn`, () => {
      const config = raceConfig(r, r.lengths[0], 1);
      const seen = new Map<string, number>();
      const placements = new Set<string>();
      for (let seed = 1; seed <= 60; seed++) {
        const chosen = [...chooseSetPieces(config.road.edges, seed)].sort();
        placements.add(chosen.join(','));
        for (const id of chosen) seen.set(id, (seen.get(id) ?? 0) + 1);
      }
      process.stdout.write(
        `[set pieces] ${r.name} over 60 seeds: ${placements.size} placements; ${JSON.stringify([...seen].sort())}\n`,
      );
      for (const c of candidates(config)) expect(seen.get(c.f.id) ?? 0, c.f.id).toBeGreaterThan(5);
      // At least four placements, or every one the slots allow when they allow fewer (playtest 3,
      // T9.3: Lombard's single slot has two spots, so two placements is all of them).
      const perSlot = new Map<string, number>();
      for (const c of candidates(config)) perSlot.set(c.slot, (perSlot.get(c.slot) ?? 0) + 1);
      const possible = [...perSlot.values()].reduce((a, n) => a * n, 1);
      expect(placements.size).toBeGreaterThanOrEqual(Math.min(4, possible));
    });
  }

  it("the skeptic's repro: the two browser seeds place the Keys truck and pads differently", () => {
    const rows: string[] = [];
    let differ = 0;
    for (const r of REGIONS) {
      const config = raceConfig(r, r.lengths[0], 1);
      const [a, b] = SKEPTIC_SEEDS.map((seed) =>
        [...chooseSetPieces(config.road.edges, seed)].sort().join(','),
      );
      rows.push(`${r.name}: ${a} | ${b}`);
      if (a !== b) differ++;
      if (r.name === 'keys-m1') expect(a).not.toBe(b);
    }
    process.stdout.write(`[set pieces] skeptic seeds ${SKEPTIC_SEEDS.join(' and ')}: ${rows.join('; ')}\n`);
    expect(differ).toBeGreaterThanOrEqual(2);
  });

  it('the same seed gives the same placement and the same replay hashes; another seed does not', () => {
    const r = REGIONS[0];
    const run = (seed: number) => {
      const sim = createSim(raceConfig(r, r.lengths[0], seed));
      const hashes: number[] = [];
      const boosts: string[] = [];
      for (let t = 0; t < 60 * 40; t++) {
        const a = blank();
        a.throttle = 1;
        const me = sim.snapshot().entities.find((e) => e.slot === 0);
        // Ride the pads' side of the lane (d 3), so a run meets whichever marina pad is picked.
        if (me) a.steer = Math.max(-1, Math.min(1, 0.35 * (3 - me.road.d) - 2.5 * me.road.yaw));
        sim.step([quantizeInput({ ...a, flags: 0 })]);
        hashes.push(sim.hash());
        for (const e of sim.events()) if (e.type === 'boost') boosts.push(String(e.data['feature']));
      }
      return { hashes, boosts };
    };
    const [s1, s2] = SKEPTIC_SEEDS;
    const a = run(s1);
    const again = run(s1);
    expect(again.hashes).toEqual(a.hashes);
    expect(again.boosts).toEqual(a.boosts);
    const b = run(s2);
    expect(b.hashes).not.toEqual(a.hashes);
    process.stdout.write(
      `[set pieces] boosts with seed ${s1}: ${a.boosts.join(', ')}; seed ${s2}: ${b.boosts.join(', ')}\n`,
    );
  }, 120_000);
});

describe('playtest 1c item 2: every candidate is a safe placement (a solo rider rides each one)', () => {
  for (const r of REGIONS) {
    const probe = raceConfig(r, r.lengths[0], 1);
    for (const c of candidates(probe)) {
      it(`${r.name} ${c.f.kind} ${c.f.id} (${c.edgeId} s ${c.f.s0}): picked, it works and is safe; not picked, it is open road`, () => {
        const length = lengthFor(r, c.edge);
        const seed = seedPicking(probe, c.f.id);
        const config = soloConfig(r, length, seed);
        const crashes = (rideOut: ReturnType<typeof ride>) =>
          rideOut.events.filter((e) => e.ev.type === 'crash').map((e) => `${e.edge} s ${e.s.toFixed(0)}`);
        if (c.f.kind === 'boostPad') {
          const line = (c.f.d0 + c.f.d1) / 2;
          const out = ride(config, c.edgeId, c.f.s0 - 120, c.f.s1, line);
          expect(out.reached).toBe(true);
          const boosts = out.events.filter((e) => e.ev.type === 'boost' && e.ev.data['feature'] === c.f.id);
          expect(boosts, 'boosted once').toHaveLength(1);
          expect(crashes(out)).toEqual([]);
          // Not picked: the same line rides straight over the spot.
          const other = soloConfig(r, length, seedNotPicking(probe, c.f.id));
          const none = ride(other, c.edgeId, c.f.s0 - 120, c.f.s1, line);
          expect(none.events.filter((e) => e.ev.type === 'boost' && e.ev.data['feature'] === c.f.id)).toEqual(
            [],
          );
        } else {
          const { run } = rampTruckShape(c.f);
          const lip = c.f.s0 + run;
          // Up the middle of the deck (4.4 on every one-lane road's truck at d 3.4 to 5.4; run W-R's
          // downtown parks its truck in the kerb lane of a four-lane avenue, d 7.2 to 9.2).
          const out = ride(config, c.edgeId, c.f.s0 - 200, lip, (c.f.d0 + c.f.d1) / 2);
          expect(out.reached).toBe(true);
          const jump = out.events.find(
            (e) => e.ev.type === 'jump' && e.edge === c.edgeId && Math.abs(e.s - lip) < 3,
          );
          const land = out.events.find(
            (e) => e.ev.type === 'land' && (jump ? e.ev.tick > jump.ev.tick : false),
          );
          process.stdout.write(
            `[set pieces] ${c.f.id}: jump at ${jump?.edge} s ${jump?.s.toFixed(1)} (${Number(jump?.ev.data['speed']).toFixed(1)} m/s), ` +
              `landed ${land?.ev.data['quality']} at ${land?.edge} s ${land?.s.toFixed(1)}\n`,
          );
          expect(jump, 'jumped off the lip').toBeDefined();
          expect(land?.ev.data['quality']).toBe('clean');
          expect(crashes(out)).toEqual([]);
          expect(out.events.filter((e) => e.ev.data['object'] === 'rampTruck')).toEqual([]);
          // Not picked: the same line is open road, with no jump and no truck to hit.
          const other = soloConfig(r, length, seedNotPicking(probe, c.f.id));
          const none = ride(other, c.edgeId, c.f.s0 - 200, lip, 4.4);
          expect(
            none.events.filter((e) => e.ev.type === 'jump' && e.edge === c.edgeId && Math.abs(e.s - lip) < 3),
          ).toEqual([]);
          expect(none.events.filter((e) => e.ev.data['object'] === 'rampTruck')).toEqual([]);
        }
      }, 120_000);
    }
  }
});

function seedNotPicking(config: SimConfig, id: string): number {
  for (let seed = 1; seed <= 500; seed++) if (!chooseSetPieces(config.road.edges, seed).has(id)) return seed;
  throw new Error(`every seed picks ${id}`);
}
