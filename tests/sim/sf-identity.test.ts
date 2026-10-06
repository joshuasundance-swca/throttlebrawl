/// <reference types="vite/client" />
// San Francisco's identity (playtest 4, P4-19; the identity sheets' R1, "cable cars on the cable streets"):
// the cable car runs on the streets a cable-car line really runs along, Hyde and California on Russian
// Hill, and nowhere else. The product spec's rule is "cable cars only on the steep cable-line streets"
// [decided]; the invented cable-line grade of the old standard run stays free of them, because a
// 9 m/s big vehicle between its two walls held the bot behind it for 92 s once (tests/sim/region-sf.test.ts).
// The rules are checked on the packs' files and then on a seeded race: every cable car the sim spawns
// stands on a `cable-route` stretch, and the control (a region without the area) spawns none.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const HILLS_EVENT = 'region-sf:sf-t2-russian-hill';
const STANDARD_EVENT = 'region-sf:sf-hill-sprint';
const CABLE = 'region-sf:cable-car';

interface RoadFile {
  id: string;
  lengthM: number;
  tags: { s0: number; s1: number; tag: string }[];
}
const roadFiles = Object.entries(REG.roads).map(([id, r]) => ({ ...(r as unknown as RoadFile), id }));
const sfRoads = roadFiles.filter((r) => r.id.startsWith('region-sf:'));

type Config = ReturnType<typeof buildSimConfig>;
const configOf = (event: string, seed: number): Config =>
  buildSimConfig(REG, STREAMS.forEvent(REG, event), { seed, eventId: event });

/** Steps a race with the bot for `seconds` and returns every place a cable car stood: its edge and s. */
function cableCarsSeen(
  event: string,
  seed: number,
  seconds: number,
): { id: number; edge: number; s: number }[] {
  const config = configOf(event, seed);
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const actions = emptyActions();
  let snap = sim.snapshot();
  const seen: { id: number; edge: number; s: number }[] = [];
  for (let tick = 0; tick < seconds * 60 && !sim.isOver(); tick++) {
    bot.drive(snap, playerId, config.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    for (const e of snap.entities)
      if (e.kind === 'vehicle' && e.contentId === CABLE)
        seen.push({ id: e.id, edge: e.road.edge, s: e.road.s });
  }
  return seen;
}

describe('the cable car runs on the cable-route streets and nowhere else', () => {
  it('is in no region-wide mix, and in the cable-route area alone', () => {
    const config = configOf(HILLS_EVENT, 1);
    const type = config.trafficTypes.find((t) => t.contentId === CABLE);
    expect(type, 'the cable car is a traffic type of the race').toBeDefined();
    expect(type?.weight ?? 0, 'outside the area').toBe(0);
    expect(Object.keys(type?.areaWeights ?? {})).toEqual(['cable-route']);
    expect(type?.areaWeights?.['cable-route'] ?? 0).toBeGreaterThan(0);
  });

  it('marks only streets that carry the cable-line tag, over the same stretches, and not the invented grade', () => {
    const routes = sfRoads.filter((r) => r.tags.some((t) => t.tag === 'cable-route'));
    expect(routes.map((r) => r.id).sort()).toEqual(['region-sf:osm-sf-california', 'region-sf:osm-sf-hyde']);
    for (const r of routes) {
      const line = r.tags.filter((t) => t.tag === 'cable-line');
      for (const t of r.tags.filter((x) => x.tag === 'cable-route'))
        expect(
          line.some((l) => l.s0 <= t.s0 && l.s1 >= t.s1),
          `${r.id}: cable-route ${t.s0} to ${t.s1} lies on a cable-line stretch`,
        ).toBe(true);
    }
    const grade = sfRoads.find((r) => r.id === 'region-sf:sf-cable-line-grade');
    expect(grade?.tags.some((t) => t.tag === 'cable-line')).toBe(true);
    expect(grade?.tags.some((t) => t.tag === 'cable-route')).toBe(false);
  });

  it('spawns on Hyde and California in a seeded race, never anywhere else', () => {
    const config = configOf(HILLS_EVENT, 1);
    const onRoute = (edge: number, s: number): boolean => {
      const tags = config.road.edges[edge]?.tags ?? [];
      return tags.some((t) => t.tag === 'cable-route' && s >= t.s0 && s <= t.s1);
    };
    let total = 0;
    const cars = new Set<string>();
    const where = new Set<string>();
    for (const seed of [1, 2, 3]) {
      for (const at of cableCarsSeen(HILLS_EVENT, seed, 45)) {
        total++;
        cars.add(`${seed}:${at.id}`);
        where.add(config.road.edges[at.edge]?.id ?? '?');
        expect(onRoute(at.edge, at.s), `seed ${seed}: a cable car at edge ${at.edge}, s ${at.s}`).toBe(true);
      }
    }
    stdout.write(
      `[examined] Russian Hill, seeds 1 to 3, 45 s each: ${cars.size} cable cars (${total} sightings, one a tick) on ${[...where].join(', ')}\n`,
    );
    // The control: the same detector finds them (a race that never saw one would pass the loop above).
    expect(total, 'cable cars seen').toBeGreaterThan(0);
  }, 300_000);

  it('spawns none in the standard run, which rides the invented cable-line grade', () => {
    const config = configOf(STANDARD_EVENT, 1);
    expect(config.road.edges.some((e) => e.tags.some((t) => t.tag === 'cable-line'))).toBe(true);
    const seen = cableCarsSeen(STANDARD_EVENT, 1, 60);
    expect(seen).toEqual([]);
  }, 300_000);
});

// Lombard's crowd (the sheets' L1): the crooked block's tourists wait on the outer side of each hairpin,
// behind the planter and its hedge, because the inner side of a 5 m radius turn has no room to stand and
// a zone there would fold through the road's own centre of curvature.
describe("Lombard's crowd of phone photographers", () => {
  const LOMBARD_EVENT = 'region-sf:sf-t4-crooked-mile';
  const PHOTOGRAPHER = 'region-sf:lombard-photographer';
  interface LaneFile {
    lanes: { dCenterM: number; widthM: number }[];
    verges?: { left?: { widthM: number }; right?: { widthM: number } };
  }
  interface RoadWithZones extends RoadFile {
    sampleSpacingM: number;
    laneSections: LaneFile[];
    samples: { data: { kappa: number[] } };
    features: {
      kind: string;
      id: string;
      s0: number;
      s1: number;
      d0: number;
      d1: number;
      params?: { kinds?: string[] };
    }[];
  }
  const lombard = (id: string): RoadWithZones => {
    const r = REG.roads[`region-sf:${id}`];
    if (!r) throw new Error(`no road ${id}`);
    return r as unknown as RoadWithZones;
  };
  const crowdZones = (r: RoadWithZones) =>
    r.features.filter((f) => f.kind === 'roadsideZone' && f.params?.kinds?.includes('lombard-photographer'));

  it('is a person who paces the kerb and never crosses, in no region-wide list', () => {
    const config = configOf(LOMBARD_EVENT, 1);
    const type = config.trafficTypes.find((t) => t.contentId === PHOTOGRAPHER);
    expect(type, 'a traffic type of the race').toBeDefined();
    expect(type?.category).toBe('pedestrian');
    expect(type?.weight ?? 0, 'it spawns only where a zone names it').toBe(0);
    const def = REG.trafficTypes[PHOTOGRAPHER] as unknown as {
      behaviour: { strolls?: boolean; dives?: boolean };
    };
    expect(def.behaviour.strolls, 'walks along its zone').toBe(true);
    expect(def.behaviour.dives, 'dives like everyone').toBe(true);
  });

  it("stands each hairpin's crowd on the outer side, past the planter band, off the lanes", () => {
    const road = lombard('osm-sf-lombard-crooked');
    const zones = crowdZones(road);
    expect(zones.length, 'a crowd at each of the eight hairpins').toBe(8);
    const sec = road.laneSections[0];
    if (!sec) throw new Error('no lane section');
    const laneHalf = Math.max(...sec.lanes.map((l) => Math.abs(l.dCenterM) + l.widthM / 2));
    const band = (side: 'left' | 'right') => sec.verges?.[side]?.widthM ?? 0;
    const sp = road.sampleSpacingM;
    for (const z of zones) {
      let turn = 0; // the sign of the sharpest bend over the zone (kappa > 0 turns right, toward +d)
      let sharpest = 0;
      const kappa = road.samples.data.kappa;
      for (let i = Math.floor(z.s0 / sp); i <= Math.min(kappa.length - 1, Math.ceil(z.s1 / sp)); i++) {
        const k = kappa[i] ?? 0;
        if (Math.abs(k) > sharpest) {
          sharpest = Math.abs(k);
          turn = Math.sign(k);
        }
      }
      expect(sharpest, `${z.id}: a hairpin`).toBeGreaterThan(0.1);
      // The centre of the bend is on the +d side when it turns right: the crowd stands on the other.
      const side = z.d0 < 0 ? -1 : 1;
      expect(side, `${z.id}: the outer side`).toBe(-turn);
      const near = Math.min(Math.abs(z.d0), Math.abs(z.d1));
      expect(near, `${z.id}: past the planter band`).toBeGreaterThanOrEqual(
        laneHalf + band(side < 0 ? 'left' : 'right'),
      );
    }
  });

  it('spawns photographers at the start of a seeded race, each inside a crowd zone of its road', () => {
    const config = configOf(LOMBARD_EVENT, 1);
    const sim = createSim(config);
    sim.step([toSimInput(emptyActions())]);
    const snap = sim.snapshot();
    const people = snap.entities.filter((e) => e.kind === 'ped' && e.contentId === PHOTOGRAPHER);
    const byEdge = new Map<number, RoadWithZones['features']>();
    let outside = 0;
    for (const e of people) {
      const edgeId = config.road.edges[e.road.edge]?.id ?? '';
      const zones = byEdge.get(e.road.edge) ?? crowdZones(lombard(edgeId));
      byEdge.set(e.road.edge, zones);
      const inZone = zones.some(
        (z) =>
          e.road.s >= z.s0 - 1 &&
          e.road.s <= z.s1 + 1 &&
          e.road.d >= Math.min(z.d0, z.d1) - 1 &&
          e.road.d <= Math.max(z.d0, z.d1) + 1,
      );
      if (!inZone) outside++;
    }
    const roads = new Set(people.map((e) => config.road.edges[e.road.edge]?.id));
    stdout.write(
      `[examined] Lombard, seed 1: ${people.length} photographers on ${[...roads].join(', ')}; ${outside} outside their zones
`,
    );
    expect(people.length, 'photographers at the start').toBeGreaterThan(20);
    expect(outside).toBe(0);
    expect(roads.has('osm-sf-lombard-crooked'), 'on the crooked block').toBe(true);
  });
});

// The Twin Peaks summit's tourists (playtest 4, run C's live check, the sheets' T2: "a dense zone of tourists"):
// the climb's one zone stands on the summit lot, at its rail, and a seeded race spawns its people there, each
// inside the zone; the control is a race on a road with no such zone.
describe("the Twin Peaks summit's tourists", () => {
  const PEAKS_EVENT = 'region-sf:sf-t3-twin-peaks';
  const PHOTOGRAPHER = 'region-sf:lombard-photographer';
  interface Zone {
    s0: number;
    s1: number;
    d0: number;
    d1: number;
  }
  const climb = REG.roads['region-sf:osm-sf-twin-peaks-climb'] as unknown as {
    features: ({ kind: string; id: string } & Zone)[];
  };
  const zone = climb.features.find((f) => f.kind === 'roadsideZone' && f.id === 'summit-lookout');

  it('spawns a few phone photographers at the start of a seeded race, each inside the summit zone', () => {
    expect(zone, 'the climb has its summit zone').toBeDefined();
    if (!zone) return;
    const config = configOf(PEAKS_EVENT, 1);
    const sim = createSim(config);
    sim.step([toSimInput(emptyActions())]);
    const snap = sim.snapshot();
    const people = snap.entities.filter((e) => e.kind === 'ped' && e.contentId === PHOTOGRAPHER);
    let outside = 0;
    for (const e of people) {
      const onClimb = config.road.edges[e.road.edge]?.id === 'osm-sf-twin-peaks-climb';
      const inZone =
        onClimb &&
        e.road.s >= zone.s0 - 1 &&
        e.road.s <= zone.s1 + 1 &&
        e.road.d >= Math.min(zone.d0, zone.d1) - 1 &&
        e.road.d <= Math.max(zone.d0, zone.d1) + 1;
      if (!inZone) outside++;
    }
    stdout.write(
      `[examined] Twin Peaks, seed 1: ${people.length} phone photographers, ${outside} outside the summit zone\n`,
    );
    expect(people.length, 'a few tourists at the summit').toBeGreaterThanOrEqual(3);
    expect(people.length).toBeLessThanOrEqual(8);
    expect(outside).toBe(0);
  });

  it('control: the Golden Gate event, with no such zone, has no phone photographers', () => {
    const config = configOf('region-sf:sf-t4-golden-gate', 1);
    const sim = createSim(config);
    sim.step([toSimInput(emptyActions())]);
    const people = sim.snapshot().entities.filter((e) => e.kind === 'ped' && e.contentId === PHOTOGRAPHER);
    expect(people).toHaveLength(0);
  });
});
