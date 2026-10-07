/// <reference types="vite/client" />
// The ramp-truck shortcuts are makeable from their approach (the polish J live check, punch item 3: the
// Plaza Cut and the Mill Yard Cut are entered only by jumping a ramp truck over a 1.2 m wall; the dev
// bot never makes either, a scripted thumb made the Plaza Cut at about 48 m/s and never the Mill Yard
// Cut at about 34 m/s, crashing at the lip with the bike pressed against the wall). The maintainer's
// "a road race in a physical world with honest edges" (2026-10-06): a shortcut drawn and signed is one
// a rider can take. tools/road/truck-shortcuts.test.ts rides each from the truck's own line at set
// speeds; this file rides each from its approach, on the bike the race gives the player, at the speed
// that bike reaches there, and a control below the speed the jump needs, which does not make it.
//
// Every ramp-truck shortcut is found, not listed: a split zone whose whole d range lies past the
// lanes' edge (no rider on the ground reaches it) with a ramp truck before it on the same road.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import {
  createRoadNetwork,
  rampTruckShape,
  type BakedFeature,
  type BakedNetwork,
  type BakedRoad,
} from '../../src/road';
import type { SimConfig, SimEvent } from '../../src/sim/api';
import { stampShortcuts } from '../../src/sim/race/shortcuts';
import { input, riderHarness } from '../../src/sim/riders/testing';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const NETWORKS = import.meta.glob<BakedNetwork>('/packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const ROADS = import.meta.glob<BakedRoad>('/packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

/** A rider's centre keeps this far inside the lanes' edge on the ground (half a bike). */
const HALF_BIKE_M = 0.4;

interface Cut {
  network: string;
  avenue: string;
  truck: BakedFeature;
  /** The connector the zone picks. */
  into: string;
}

/** Every split zone no grounded rider can reach, with a ramp truck before it on its road. */
function truckCuts(): Cut[] {
  const out: Cut[] = [];
  for (const [file, n] of Object.entries(NETWORKS)) {
    const dir = file.replace(/networks\/[^/]+$/, 'roads/');
    const roads = n.roads.map((id) => ROADS[`${dir}${id}.json`]);
    if (roads.some((r) => !r)) throw new Error(`${n.id}: a road file is missing`);
    const road = createRoadNetwork({ network: n, roads: roads as BakedRoad[] });
    for (const z of road.splitZones()) {
      const lanes = road.lanesAt(z.edge, (z.s0 + z.s1) / 2);
      const hi = Math.max(...lanes.map((l) => l.dCenterM + l.widthM / 2));
      const lo = Math.min(...lanes.map((l) => l.dCenterM - l.widthM / 2));
      const past = Math.min(z.d0, z.d1) >= hi - HALF_BIKE_M || Math.max(z.d0, z.d1) <= lo + HALF_BIKE_M;
      if (!past) continue;
      const truck = road
        .featuresOf(z.edge, 'rampTruck')
        .filter((t) => t.s0 + rampTruckShape(t).run <= z.s0 + 1e-6)
        .at(-1);
      expect(
        truck,
        `${n.id}: the zone into ${road.edges[z.toEdge]?.id} is past the lanes with no truck`,
      ).toBeDefined();
      if (truck)
        out.push({
          network: n.id,
          avenue: road.edges[z.edge]?.id ?? '',
          truck,
          into: road.edges[z.toEdge]?.id ?? '',
        });
    }
  }
  return out.sort((a, b) => (a.network < b.network ? -1 : 1));
}

/** The race that rides each network's ramp-truck shortcut: its event and length. */
const RACES: Readonly<Record<string, { event: string; length: string; cut: readonly string[] }>> = {
  'pnw-c1': {
    event: 'region-pnw:pnw-fogline-run',
    length: 'long',
    cut: ['c-pnw-mill-in', 'pnw-mill-yard-cut', 'c-pnw-mill-out'],
  },
  'sf-downtown': {
    event: 'region-sf:sf-t1-burn-rate',
    length: 'standard',
    cut: ['c-dt-plaza-in', 'sf-dt-plaza-cut', 'c-dt-plaza-out'],
  },
};

/** The race's config with the player alone (the harness rides the last rider): its own bike and tuning. */
function playerConfig(event: string, length: string): SimConfig {
  const base = buildSimConfig(REG, STREAMS.forEvent(REG, event, length), { seed: 1, eventId: event, length });
  const player = base.riders.find((r) => r.role === 'player');
  if (!player) throw new Error('no player');
  return { ...base, riders: [player] };
}

interface Ride {
  /** The speed at the truck's foot and off its lip, m/s. */
  foot: number;
  lip: number;
  edges: string[];
  crashed: boolean;
  /** What the crash met (its `object`, else its `cause`), '' with none. */
  why: string;
}

/**
 * A ride from the approach: from `fromS` on the avenue in its right-hand lane at `speed`, the throttle
 * open up to `cap` m/s, a thumb lines the bike up with the truck's middle, then holds the stick right
 * from `pressAt` metres before the lip (negative: after it, in the air) until it is down again or is
 * handed over in the air to the road beyond (then it follows that road's lane, as after landing), and
 * then follows its lane to the end of the route. Since the course's honest edges (#672) a flight held
 * right all the way over the Plaza Cut's way in comes down past it, out of bounds, as it would for a
 * player who never let go of the stick.
 */
function ride(
  config: SimConfig,
  cut: Cut,
  opts: { fromS: number; speed: number; cap: number; pressAt: number },
): Ride {
  const road = config.road;
  const avenue = road.edgeIndex(cut.avenue);
  const lip = cut.truck.s0 + rampTruckShape(cut.truck).run;
  const mid = (cut.truck.d0 + cut.truck.d1) / 2;
  const lanes = road.lanesAt(avenue, opts.fromS).filter((l) => l.kind === 'drive');
  const right = lanes.reduce((a, l) => (l.dCenterM > a ? l.dCenterM : a), -Infinity);
  const h = riderHarness(config, { edge: avenue, s: opts.fromS, d: right, speed: opts.speed });
  const edges: string[] = [];
  let foot = 0;
  let lipSpeed = 0;
  let jumped = false;
  let crashed = false;
  let why = '';
  for (let t = 0; t < 4000; t++) {
    const p = h.rider.pos;
    const onAvenue = p.edge === avenue;
    const air = h.rider.mode === 'Airborne';
    if (onAvenue && p.s <= cut.truck.s0) foot = h.rider.speed;
    if (onAvenue && p.s <= lip) lipSpeed = h.rider.speed;
    let steer: number;
    if ((air && onAvenue) || (!jumped && onAvenue && p.s >= lip - opts.pressAt)) steer = 1;
    else if (!jumped) steer = Math.max(-1, Math.min(1, (mid - p.d) * 0.35 - h.rider.yaw * 1.5));
    else {
      const lane = road.lanesAt(p.edge, p.s)[0];
      steer = Math.max(-1, Math.min(1, ((lane?.dCenterM ?? 0) - p.d) * 0.35 - h.rider.yaw * 1.5));
    }
    const out: SimEvent[] = h.step(input(h.rider.speed < opts.cap ? 1 : 0, 0, steer));
    if (out.some((e) => e.type === 'jump')) jumped = true;
    const crash = out.find((e) => e.type === 'crash');
    if (crash) {
      crashed = true;
      why = String(crash.data['object'] ?? crash.data['cause'] ?? '');
    }
    const id = road.edges[h.rider.pos.edge]?.id ?? '';
    if (edges.at(-1) !== id) edges.push(id);
    if (crashed || (jumped && !onAvenue && edges.length > 4 && !air && t > 600)) break;
  }
  return { foot, lip: lipSpeed, edges, crashed, why };
}

const tookCut = (r: Ride, cut: readonly string[]) => cut.every((id) => r.edges.includes(id));

describe('every ramp-truck shortcut is makeable from its approach', () => {
  const cuts = truckCuts();

  it('finds the two the networks have (a new one needs its race here)', () => {
    expect(cuts.map((c) => `${c.network}: ${c.avenue} > ${c.into}`)).toEqual([
      'pnw-c1: pnw-sawmill-flats > c-pnw-mill-in',
      'sf-downtown: sf-dt-campus-way > c-dt-plaza-in',
    ]);
  });

  for (const cut of cuts) {
    const race = RACES[cut.network];
    it(`${cut.network}: from the approach on the player's bike, the jump lands on the cut; a control too slow for it does not`, () => {
      expect(race, 'its race').toBeDefined();
      if (!race) return;
      const config = playerConfig(race.event, race.length);
      const bike = config.riders[0]?.bike;
      // From 200 m short of the truck at a corner's exit speed, full throttle: the speed this bike
      // reaches there. Held right from the lip (in the air), and from 14 m before it (on the ramp,
      // against the wall: the live check's thumb).
      const fromS = Math.max(5, cut.truck.s0 - 200);
      const lines: string[] = [];
      for (const pressAt of [0, 14]) {
        const r = ride(config, cut, { fromS, speed: 15, cap: Infinity, pressAt });
        lines.push(
          `reachable, held right from ${pressAt} m before the lip: foot ${r.foot.toFixed(1)} m/s, lip ${r.lip.toFixed(1)} m/s; ${r.crashed ? 'CRASH ' : ''}${r.edges.join(' > ')}`,
        );
        expect(r.crashed, lines.at(-1)).toBe(false);
        expect(tookCut(r, race.cut), lines.at(-1)).toBe(true);
      }
      // The speed the jump needs: the slowest lip speed (the throttle held to a cap, 2 m/s steps) from
      // which the held-right jump lands on the cut. The reachable speed clears it with room to spare.
      const reach = ride(config, cut, { fromS, speed: 15, cap: Infinity, pressAt: 0 });
      let need: Ride | null = null;
      let below: Ride | null = null;
      for (let cap = 6; cap <= 40 && !need; cap += 2) {
        const r = ride(config, cut, { fromS, speed: Math.min(15, cap), cap, pressAt: 0 });
        if (tookCut(r, race.cut) && !r.crashed) need = r;
        else below = r;
      }
      expect(need, 'some capped speed makes it').not.toBeNull();
      expect(below, 'a control below that speed').not.toBeNull();
      if (!need || !below) return;
      lines.push(
        `the slowest that makes it: lip ${need.lip.toFixed(1)} m/s; the control below it: lip ${below.lip.toFixed(1)} m/s, ${below.crashed ? `CRASH (${below.why}) ` : ''}${below.edges.join(' > ')}`,
      );
      expect(reach.lip - need.lip, 'the reachable speed clears the need by 4 m/s').toBeGreaterThanOrEqual(4);
      expect(tookCut(below, race.cut), lines.at(-1)).toBe(false);
      console.log(
        `[examined] ${cut.network} ${cut.avenue}, truck ${cut.truck.id} (s ${cut.truck.s0}-${cut.truck.s1}, d ${cut.truck.d0}..${cut.truck.d1}), ${bike?.contentId} (top ${bike?.topSpeedMps} m/s)\n  ${lines.join('\n  ')}`,
      );
    });
  }
});

// Polish M's live check (punch items 1 and 2): every ride that took either cut was stamped `shortcutFound`
// with `gainM` -0.5 (the Plaza Cut) or -0.2 (the Mill Yard Cut) and `savedS` 0, and all 5 of 5 landings
// wobbled, so a made cut cost a wobble and saved nothing. Both cuts ran beside their avenue, as long as
// the stretch they stood beside. A shortcut that is hard to make must pay: each cut is shorter than the
// main road it skips (the avenue swings round the plaza or the mill yard while the cut goes straight
// through), a rider who flies it well (right off the lip, the stick let go before the bike is down)
// lands clean and reaches the finish well ahead of the same rider on the main road, and the race's own
// stamp says so; a rider who holds the stick over to the ground still pays for it: a wobble, or (since the
// course's honest edges, #672) a flight carried past the cut's far side and out of bounds.

/** The thumbs a rider takes the truck with. */
type Line =
  /** Off the lip, right until handed over onto the cut, then the stick let go before touch-down. */
  | 'cut-clean'
  /** Off the lip, right and held there until the bike is down: the live check's thumb. */
  | 'cut-held'
  /** The control: the main road in the outside lane's middle, past the truck. */
  | 'main'
  /** The other control: up the truck, no steering in the air, on along the main road. */
  | 'main-jump';

interface Timed {
  line: Line;
  lip: number;
  edges: string[];
  /** The first landing after the jump: its quality, sideways and downward speed. */
  landing: { quality: string; lateralMps: number; verticalMps: number } | null;
  wobbles: number;
  crashed: boolean;
  /** Ticks from the start until the route's progress reached the finish line. */
  ticks: number;
  /** The race's own stamp, if one was made. */
  found: { gainM: number; savedS: number } | null;
}

/** A thumb that holds `target` d on whatever road the bike is on: a lane's middle. */
function hold(h: ReturnType<typeof riderHarness>, target: number): number {
  return Math.max(-1, Math.min(1, (target - h.rider.pos.d) * 0.35 - h.rider.yaw * 1.5));
}

function timedRide(config: SimConfig, cut: Cut, line: Line): Timed {
  const road = config.road;
  const route = config.route;
  const avenue = road.edgeIndex(cut.avenue);
  const lip = cut.truck.s0 + rampTruckShape(cut.truck).run;
  const fromS = Math.max(5, cut.truck.s0 - 200);
  const drive = road.lanesAt(avenue, fromS).filter((l) => l.kind === 'drive' && l.direction === 1);
  const outside = drive.reduce((a, l) => (l.dCenterM > a ? l.dCenterM : a), -Infinity);
  const edge = Math.max(...drive.map((l) => l.dCenterM + l.widthM / 2));
  // The truck's line: half a metre in from the truck's inner side, and off the shoulder (and its drag)
  // where the truck reaches into the lane, taken from 100 m short of its foot; till then, the outside
  // lane's middle, as the main road's rider rides.
  const onTruck = Math.max(cut.truck.d0 + 0.5, (cut.truck.d0 + Math.min(edge, cut.truck.d1)) / 2);
  const h = riderHarness(config, { edge: avenue, s: fromS, d: outside, speed: 15 });
  const onAvenue = () => h.rider.pos.edge === avenue;
  const edges: string[] = [];
  let lipSpeed = 0;
  let jumped = false;
  let handed = false;
  let landing: Timed['landing'] = null;
  let wobbles = 0;
  let crashed = false;
  let found: Timed['found'] = null;
  let ticks = -1;
  for (let t = 0; t < 6000 && ticks < 0 && !crashed; t++) {
    const air = h.rider.mode === 'Airborne';
    if (onAvenue() && h.rider.pos.s <= lip) lipSpeed = h.rider.speed;
    if (jumped && road.edges[h.rider.pos.edge]?.id === cut.into) handed = true;
    let steer: number;
    if (line === 'main' && !jumped) steer = hold(h, outside);
    else if (!jumped) steer = hold(h, onAvenue() && h.rider.pos.s >= cut.truck.s0 - 100 ? onTruck : outside);
    else if (air) steer = line === 'cut-held' || (line === 'cut-clean' && !handed) ? 1 : 0;
    else {
      // Down again: the middle of the lane it is in (the cut's one lane, or the avenue's outside lane).
      const lanes = road.lanesAt(h.rider.pos.edge, h.rider.pos.s).filter((l) => l.direction === 1);
      const lane = lanes.find((l) => l.kind === 'shortcut') ?? lanes.find((l) => l.dCenterM === outside);
      steer = hold(h, lane?.dCenterM ?? outside);
    }
    const out: SimEvent[] = h.step(input(1, 0, steer));
    // The race's stamp, run after the riders as the race system runs it.
    h.world.events = out;
    stampShortcuts(h.world, config, () => true);
    for (const e of h.world.events) {
      if (e.type === 'jump') jumped = true;
      if (e.type === 'land' && jumped && landing === null)
        landing = {
          quality: String(e.data['quality']),
          lateralMps: Number(e.data['lateralMps']),
          verticalMps: Number(e.data['verticalMps']),
        };
      if (e.type === 'wobble') wobbles++;
      if (e.type === 'crash') crashed = true;
      if (e.type === 'shortcutFound')
        found = { gainM: Number(e.data['gainM']), savedS: Number(e.data['savedS']) };
    }
    h.world.events = [];
    const id = road.edges[h.rider.pos.edge]?.id ?? '';
    if (edges.at(-1) !== id) edges.push(id);
    if (route.progressAt(h.rider.pos.edge, h.rider.pos.s) >= route.length) ticks = t + 1;
  }
  return { line, lip: lipSpeed, edges, landing, wobbles, crashed, ticks, found };
}

/** The least a cut must save, on the route's table and against the same rider on the main road. [default] */
const PAYS_M = 20;
const PAYS_S = 0.5;

describe('every ramp-truck shortcut pays a rider who makes it cleanly', () => {
  const cuts = truckCuts();
  for (const cut of cuts) {
    const race = RACES[cut.network];
    it(`${cut.network}: shorter than the main road by ${PAYS_M} m or more; flown well it lands clean and finishes ${PAYS_S} s or more ahead of the main road; held over to the ground it wobbles or goes out of bounds`, () => {
      expect(race, 'its race').toBeDefined();
      if (!race) return;
      const config = playerConfig(race.event, race.length);
      const zone = config.route.shortcuts.find((z) => config.road.edges[z.toEdge]?.id === cut.into);
      expect(zone, 'the route offers it').toBeDefined();
      const rides = (['cut-clean', 'cut-held', 'main', 'main-jump'] as const).map((l) =>
        timedRide(config, cut, l),
      );
      const [clean, held, main, mainJump] = rides as [Timed, Timed, Timed, Timed];
      const lines = rides.map(
        (r) =>
          `${r.line}: lip ${r.lip.toFixed(1)} m/s, landing ${r.landing ? `${r.landing.quality} (lateral ${r.landing.lateralMps.toFixed(1)}, vertical ${r.landing.verticalMps.toFixed(1)} m/s)` : 'none'}, ${r.wobbles} wobbles${r.crashed ? ', CRASH' : ''}, at the finish in ${r.ticks} ticks${r.found ? `, stamped gain ${r.found.gainM} m saved ${r.found.savedS} s` : ''}; ${r.edges.join(' > ')}`,
      );
      console.log(
        `[examined] ${cut.network} ${cut.into}: the route's gain ${zone?.gainM.toFixed(1)} m\n  ${lines.join('\n  ')}`,
      );
      // The route's table: the cut is shorter than the main road it skips.
      expect(zone?.gainM ?? -Infinity, 'the gain on the route table').toBeGreaterThanOrEqual(PAYS_M);
      // Flown well: on the cut, a clean landing, no wobble, no crash, and the stamp says what it saved.
      expect(
        race.cut.every((id) => clean.edges.includes(id)),
        lines[0],
      ).toBe(true);
      expect(clean.crashed, lines[0]).toBe(false);
      expect(clean.landing?.quality, lines[0]).toBe('clean');
      expect(clean.wobbles, lines[0]).toBe(0);
      expect(clean.found?.gainM ?? -Infinity, lines[0]).toBeGreaterThanOrEqual(PAYS_M);
      expect(clean.found?.savedS ?? 0, lines[0]).toBeGreaterThanOrEqual(PAYS_S);
      // The controls stay on the main road and reach the finish later, by the stated saving or more.
      for (const [r, label] of [
        [main, lines[2]],
        [mainJump, lines[3]],
      ] as const) {
        for (const id of race.cut) expect(r.edges, label).not.toContain(id);
        expect(r.crashed, label).toBe(false);
        expect(r.ticks, label).toBeGreaterThan(0);
        expect(r.ticks - clean.ticks, label).toBeGreaterThanOrEqual(PAYS_S * 60);
      }
      // Sloppy: the stick held over to the ground still costs a wobble, or worse (out of bounds).
      expect(held.wobbles + (held.crashed ? 1 : 0), lines[1]).toBeGreaterThan(0);
    });
  }
});
