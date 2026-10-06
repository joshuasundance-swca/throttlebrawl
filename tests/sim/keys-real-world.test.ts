/// <reference types="vite/client" />
// The real world in the Keys career (playtest 3, wave C, T10.4; critic W1: "the real world never
// reaches the career"; the maintainer, round 1: "Duval St"; round 3: the Seven Mile's old bridge, "rivals
// and cops on the highway only"). Rules, not lists: where a real route's event sits, what the Seven Mile
// escape asks, what a roadside zone may name, where the Old Town's own people and vehicles may turn up,
// and that the tour of Duval Street meets them. The route and the old road themselves are
// tools/gis/routes-keys-pt3.test.ts; the field staying on the highway is ai-stay-on-highway.test.ts.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { BAR_STYLES } from '../../src/audio/soundscape';
import { bare, careerDefs, careerOf, createRaceLog, eventPlan, startCareer } from '../../src/career';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type SimConfig } from '../../src/sim/api';
import { vehicleSize } from '../../src/sim/ai/sense';
import { PEDS } from '../../src/sim/peds';
import { DEFAULT_PROFILE } from '../../src/save';
import { careerRace, onTierBike, REG } from './career-harness';

const print = (line: string) => process.stdout.write(`[keys-real-world] ${line}\n`);
const STREAMS = createStreamCache();
const KEYS = careerOf(careerDefs(REG), 'florida-keys');
if (!KEYS) throw new Error('no Keys career');
const NODES = KEYS.nodes;

/** The route an event rides (its first length), qualified, and its file. */
function routeOf(eventKey: string) {
  const plan = eventPlan(REG, eventKey);
  const key = plan.lengths[0]?.route ?? '';
  const file = REG.routes[key];
  if (!file) throw new Error(`no route ${key}`);
  return { key, file, plan };
}

describe('the real routes in the career', () => {
  it('each node of a real-road route stands on a road of that route (the pin is on the race it starts)', () => {
    const real = NODES.map((n) => ({ n, ...routeOf(n.event) })).filter((x) => bare(x.key).startsWith('osm-'));
    // Duval and the Seven Mile are among them (their events are the point of the task).
    const keys = new Set(real.map((x) => x.key));
    expect(keys.has('base:osm-duval-run')).toBe(true);
    expect(keys.has('base:osm-seven-mile-run')).toBe(true);
    for (const { n, file, key } of real)
      expect(file.allowedRoads, `${n.id} (${n.road}) on ${key}`).toContain(n.road);
    print(`real-road nodes: ${real.map((x) => `${x.n.id} on ${bare(x.key)}`).join(', ')}`);
  });

  it('Duval is a classic race at the sunset the region lists; the Seven Mile is a cop escape', () => {
    const duval = NODES.find((n) => routeOf(n.event).key === 'base:osm-duval-run');
    const seven = NODES.find((n) => routeOf(n.event).key === 'base:osm-seven-mile-run');
    expect(duval, 'a node on Duval').toBeDefined();
    expect(seven, 'a node on the Seven Mile').toBeDefined();
    const times = REG.regions['base:florida-keys']?.timeOfDayOptions.map((o) => o.id) ?? [];
    for (const n of [duval, seven]) {
      const plan = eventPlan(REG, n?.event ?? '');
      expect(times, `${n?.event}'s time of day is one the Keys list`).toContain(plan.timeOfDay);
    }
    expect(eventPlan(REG, duval?.event ?? '').kind).toBe('classic-race');
    expect(eventPlan(REG, duval?.event ?? '').timeOfDay).toBe('dusk');
    expect(eventPlan(REG, seven?.event ?? '').kind).toBe('cop-escape');
  });

  it('the Seven Mile escape is not over before the old road can be taken, and the law never takes it', () => {
    const seven = NODES.find((n) => routeOf(n.event).key === 'base:osm-seven-mile-run');
    const { key, plan } = routeOf(seven?.event ?? '');
    const cfg = buildSimConfig(REG, STREAMS.forRoute(REG, key), {
      seed: 1,
      eventId: seven?.event ?? '',
      route: key,
    });
    // The old road is a branch the field is never handed onto (aiTake 0); its first road starts at the
    // turn-off. An escape ridden by distance must ask more than the highway's length to that turn-off
    // and the repair platform's hop beyond it, or the old road is never the way out.
    const old = cfg.route.branches.find((b) => b.aiTake === 0);
    expect(old, 'a branch the AI never takes').toBeDefined();
    const turnOff = cfg.route.progressAt(old?.edges[0] ?? 0, 0);
    expect(plan.rules.escapeBy).toBe('distance');
    expect(plan.rules.escapeDistanceM ?? 0).toBeGreaterThan(turnOff + 300);
    // Law in every race: the chase is what the old road shakes.
    const cops = REG.events[seven?.event ?? '']?.cops;
    expect(cops?.mode).toBe('every-race');
    expect(cops?.baseCount ?? 0).toBeGreaterThan(0);
    print(
      `the old road's turn-off at ${turnOff.toFixed(0)} m; the escape asks ${plan.rules.escapeDistanceM} m`,
    );
  });
});

describe('the old road as the way out of the Seven Mile escape', () => {
  /** Enough seeds that one lucky cop does not decide it; the dev bot rides the old road each time. */
  const SEEDS = [1, 2, 3];
  /** The least time on the old road that counts as having taken it, s. */
  const TOOK_IT_S = 30;

  it('a rider who takes the old road wins the escape, is never busted, and the race still ends', () => {
    const defs = careerDefs(REG);
    const node = NODES.find((n) => n.id === 'speed-monitored');
    if (!node) throw new Error('no Seven Mile node');
    const profile = onTierBike(REG, KEYS, node, startCareer(defs, { ...DEFAULT_PROFILE }));
    for (const seed of SEEDS) {
      const { plan, length, config } = careerRace(KEYS, node, profile, seed);
      const sim = createSim(config);
      const me = config.riders.findIndex((r) => r.controller.kind === 'player');
      const log = createRaceLog({
        playerId: me,
        rules: plan.rules,
        objectives: plan.objectives,
        routeId: bare(length.route),
        roadIds: config.road.edges.map((e) => e.id),
        secrets: KEYS.secrets,
      });
      const branch = config.route.branches.find((b) => b.aiTake === 0);
      const zone = branch?.choice;
      if (!branch || !zone) throw new Error('no old road with a turn-off');
      const side = zone.d0 + zone.d1 >= 0 ? 1 : -1;
      const onOld = new Set(branch.edges);
      const bot = createBot();
      let snap = sim.snapshot();
      let ticksOnOld = 0;
      while (!sim.isOver() && sim.tick < 60 * 60 * 8) {
        const a = emptyActions();
        bot.drive(snap, me, config.route, a);
        const m = snap.entities[me];
        // Full lock toward the rail through the turn-off's lead-in, as a person taking the old road does.
        if (m && m.road.edge === zone.edge && m.road.s > zone.s0 - 90 && m.road.s <= zone.s1) a.steer = side;
        sim.step([toSimInput(a)]);
        snap = sim.snapshot();
        log.note(sim.events(), snap);
        if (onOld.has(snap.entities[me]?.road.edge ?? -1)) ticksOnOld++;
        if (log.status().endNow || log.tally().finished || log.tally().busted) break;
      }
      const status = log.status();
      print(
        `seed ${seed}: ${status.state} at ${(sim.tick / 60).toFixed(0)} s, ${(ticksOnOld / 60).toFixed(0)} s on the old road, busted ${log.tally().busted}`,
      );
      expect(ticksOnOld / 60, `seed ${seed}: took the old road`).toBeGreaterThan(TOOK_IT_S);
      expect(log.tally().busted, `seed ${seed}`).toBe(false);
      expect(status.state, `seed ${seed}`).toBe('won');
    }
  }, 900_000);
});

describe('the Old Town on the map and in the roadside zones', () => {
  it("every roadside zone's `kinds` names a pedestrian or an animal the packs have", () => {
    // A bad name is skipped without a sound (docs/content-packs.md, a zone's params), so a typo would
    // leave a zone empty and nothing would say so.
    const types = new Map(Object.entries(REG.trafficTypes).map(([k, t]) => [k, t]));
    const checked: string[] = [];
    for (const [roadKey, road] of Object.entries(REG.roads)) {
      const pack = roadKey.slice(0, roadKey.indexOf(':'));
      for (const f of (
        road as { features?: { kind: string; id: string; params?: Record<string, unknown> }[] }
      ).features ?? []) {
        const kinds = f.kind === 'roadsideZone' ? f.params?.['kinds'] : undefined;
        if (!Array.isArray(kinds)) continue;
        for (const k of kinds as string[]) {
          const t = types.get(k.includes(':') ? k : `${pack}:${k}`);
          expect(t, `${roadKey} ${f.id}: kind ${k} is a traffic type`).toBeDefined();
          expect(['pedestrian', 'animal'], `${roadKey} ${f.id}: ${k}`).toContain(t?.category);
          checked.push(`${f.id}:${k}`);
        }
      }
    }
    print(
      `zone kinds checked: ${checked.length} (${[...new Set(checked.map((c) => c.split(':')[0]))].join(', ')})`,
    );
    expect(checked.length).toBeGreaterThan(0);
  });

  it("the Old Town's own kinds stay on its streets: in no region-wide list, and vehicles only in its area", () => {
    const region = REG.regions['base:florida-keys'];
    const oldTown = Object.entries(REG.trafficTypes)
      .filter(([k, t]) => k.startsWith('base:') && (t.tags ?? []).includes('key-oldtown'))
      .map(([k]) => bare(k));
    expect(oldTown.length).toBeGreaterThanOrEqual(5);
    const traffic = region?.traffic;
    const listed = (rows: readonly { kind: string }[] | undefined) => (rows ?? []).map((r) => r.kind);
    const area = traffic?.areas?.find((a) => a.tag === 'key-oldtown');
    expect(area, "the Old Town's traffic area").toBeDefined();
    for (const kind of oldTown) {
      const def = REG.trafficTypes[`base:${kind}`];
      const vehicle = !['pedestrian', 'animal'].includes(def?.category ?? '');
      // Its people and animals come from zones (`kinds`); its vehicles from the area only.
      for (const list of [traffic?.mix, traffic?.pedestrians, traffic?.animals])
        expect(listed(list), `${kind} is not in a region-wide list`).not.toContain(kind);
      if (vehicle) expect(listed(area?.mix), `${kind} is in the Old Town's area`).toContain(kind);
      for (const other of traffic?.areas ?? [])
        if (other.tag !== 'key-oldtown')
          expect(listed(other.mix), `${kind} in ${other.tag}`).not.toContain(kind);
    }
  });

  it("a crowd of the Old Town's people stands only on a road and a side the Old Town's tag covers", () => {
    // Playtest 4 (P4-19): Duval is a street of its own, and its people (bar hoppers, a birthday party, door
    // greeters, cruise day-trippers, buskers, roosters) belong to it. A zone on any other street that names
    // one would put the party on a beach road, so a zone naming an Old Town kind lies wholly inside a stretch
    // of its own road that carries `key-oldtown`, on the side the zone is on.
    interface Road {
      id: string;
      tags?: { tag: string; s0: number; s1: number; side?: string }[];
      features?: {
        kind: string;
        id: string;
        s0: number;
        s1: number;
        d0: number;
        d1: number;
        params?: Record<string, unknown>;
      }[];
    }
    const oldTown = new Set(
      Object.entries(REG.trafficTypes)
        .filter(([k, t]) => k.startsWith('base:') && (t.tags ?? []).includes('key-oldtown'))
        .map(([k]) => bare(k)),
    );
    const off = (roads: readonly Road[]) => {
      const out: string[] = [];
      let zones = 0;
      for (const r of roads) {
        for (const f of r.features ?? []) {
          const kinds = f.kind === 'roadsideZone' ? f.params?.['kinds'] : undefined;
          if (!Array.isArray(kinds) || !(kinds as string[]).some((k) => oldTown.has(bare(k)))) continue;
          zones++;
          const side = f.d0 + f.d1 < 0 ? 'left' : 'right';
          const covered = (r.tags ?? []).some(
            (t) =>
              t.tag === 'key-oldtown' &&
              t.s0 <= f.s0 &&
              t.s1 >= f.s1 &&
              (t.side === undefined || t.side === 'both' || t.side === side),
          );
          if (!covered) out.push(`${r.id} ${f.id}`);
        }
      }
      return { out, zones };
    };
    const roads = Object.entries(REG.roads)
      .filter(([k]) => k.startsWith('base:'))
      .map(([, r]) => r as unknown as Road);
    const { out, zones } = off(roads);
    print(`${zones} zones name an Old Town kind; ${out.length} are off the Old Town's tag`);
    expect(zones).toBeGreaterThanOrEqual(14);
    expect(out).toEqual([]);
    // The control: the same roads with the tag taken off Duval and Whitehead have every one of them off it.
    const bare0 = roads.map((r) => ({ ...r, tags: (r.tags ?? []).filter((t) => t.tag !== 'key-oldtown') }));
    expect(off(bare0).out).toHaveLength(zones);
  });

  it("every sign and billboard of the Old Town has a slot on the Old Town's streets, on its own tag", () => {
    // Boards stand in `billboard` slots the roads name (docs/content-packs.md, signs and billboards): a
    // sign tagged `key-oldtown` that no slot names is dead words. The Old Town's roads are the ones
    // that carry the tag.
    const region = REG.regions['base:florida-keys'];
    const words = [...(region?.signs ?? []), ...(region?.billboards ?? [])].filter((b) =>
      (b.tags ?? []).includes('key-oldtown'),
    );
    expect(words.length).toBeGreaterThanOrEqual(4);
    const roads = Object.entries(REG.roads)
      .filter(([k]) => k.startsWith('base:'))
      .map(
        ([, r]) =>
          r as { id: string; tags?: { tag: string }[]; features?: { kind: string; item?: string }[] },
      )
      .filter((r) => (r.tags ?? []).some((t) => t.tag === 'key-oldtown'));
    expect(roads.length).toBeGreaterThan(0);
    const named = new Set(roads.flatMap((r) => (r.features ?? []).map((f) => f.item)));
    for (const w of words) expect(named.has(w.id), `${w.id} has a slot on an Old Town road`).toBe(true);
    // And the slots name only boards that belong there.
    for (const r of roads)
      for (const f of r.features ?? [])
        if (f.kind === 'billboard' && f.item)
          expect(
            words.some((w) => w.id === f.item),
            `${r.id}: ${f.item} is an Old Town board`,
          ).toBe(true);
  });

  it('no Old Town vehicle makes the rival AI see every vehicle in the Keys bigger than before', () => {
    // sim/ai sizes every vehicle by the race's largest traffic type (see the moving ramp's own check).
    const cfg = buildSimConfig(REG, STREAMS.forRoute(REG, 'base:osm-duval-run'), {
      seed: 1,
      eventId: 'base:keys-t1-last-light-duval',
      route: 'base:osm-duval-run',
    });
    const own = cfg.trafficTypes.filter((t) =>
      (REG.trafficTypes[t.contentId]?.tags ?? []).includes('key-oldtown'),
    );
    expect(own.length).toBeGreaterThanOrEqual(5);
    const without = { ...cfg, trafficTypes: cfg.trafficTypes.filter((t) => !own.includes(t)) };
    expect(vehicleSize(cfg)).toEqual(vehicleSize(without));
  });
});

// Playtest 4 (P4-16, "Duval St should be a party street"): the party zones are crowds with music and string
// lights; their people are the Old Town's own kinds; and the street's boards and pedicabs say the same.
describe('Duval as a party street', () => {
  interface Zone {
    id: string;
    s0: number;
    s1: number;
    d0: number;
    d1: number;
    kind: string;
    params?: Record<string, unknown>;
  }
  const duval = REG.roads['base:osm-duval-street'] as unknown as { lengthM: number; features: Zone[] };
  const zones = duval.features.filter((f) => f.kind === 'roadsideZone' && f.params?.['dressing'] === 'party');
  const sideOf = (z: Zone) => (z.d0 + z.d1 < 0 ? -1 : 1);

  it("every party zone is a crowd of the Old Town's people, with a style of music the street can play", () => {
    expect(zones.length).toBeGreaterThanOrEqual(6);
    for (const z of zones) {
      const kinds = z.params?.['kinds'] as string[] | undefined;
      expect(Array.isArray(kinds), `${z.id} names its kinds`).toBe(true);
      expect(kinds?.length ?? 0, `${z.id} has a mix`).toBeGreaterThanOrEqual(3);
      for (const k of kinds ?? []) {
        const t = REG.trafficTypes[`base:${k}`];
        expect(t?.category, `${z.id}: ${k} is a person`).toBe('pedestrian');
      }
      const every = z.params?.['everyM'];
      const most = z.params?.['maxPeds'];
      expect(
        typeof every === 'number' && every >= PEDS.crowdMinEveryM && every < PEDS.perZoneM,
        `${z.id} everyM`,
      ).toBe(true);
      expect(
        typeof most === 'number' && most > PEDS.maxPerZone && most <= PEDS.maxCrowd,
        `${z.id} maxPeds`,
      ).toBe(true);
      expect(BAR_STYLES as readonly string[], `${z.id} music`).toContain(z.params?.['music']);
    }
    // The party's own kinds are the Old Town's: tagged for it, so no other street meets them.
    for (const k of ['bar-hopper', 'birthday-party', 'door-greeter'])
      expect(REG.trafficTypes[`base:${k}`]?.tags, k).toContain('key-oldtown');
  });

  it('the party is on both sides of the street and over a good share of it, in blocks with gaps between', () => {
    const covered = (side: number) =>
      zones.filter((z) => sideOf(z) === side).reduce((n, z) => n + (z.s1 - z.s0), 0) / duval.lengthM;
    for (const side of [-1, 1]) expect(covered(side), `side ${side}`).toBeGreaterThan(0.3);
    // Gaps: the music fades between blocks and the crowd thins (no zone runs the whole street).
    for (const z of zones) expect(z.s1 - z.s0, z.id).toBeLessThan(duval.lengthM / 4);
    // A zone stands clear of the other zones and the boards of its own side (no crowd on top of a board).
    for (const z of zones)
      for (const f of duval.features) {
        if (f.id === z.id) continue;
        if (!['roadsideZone', 'billboard'].includes(f.kind) || (f.d0 + f.d1 < 0 ? -1 : 1) !== sideOf(z))
          continue;
        expect(f.s1 <= z.s0 || f.s0 >= z.s1, `${z.id} overlaps ${f.id}`).toBe(true);
      }
  });

  it('a race starts with the crowd already standing in each party zone', () => {
    const config = buildSimConfig(REG, STREAMS.forRoute(REG, 'base:osm-duval-run'), {
      seed: 1,
      eventId: 'base:keys-t1-last-light-duval',
      route: 'base:osm-duval-run',
    });
    const snap = createSim(config).snapshot();
    const edge = config.road.edgeIndex('osm-duval-street');
    const peds = snap.entities.filter((e) => e.kind === 'ped' && e.road.edge === edge);
    let total = 0;
    for (const z of zones) {
      const want = Math.min(
        z.params?.['maxPeds'] as number,
        Math.floor((z.s1 - z.s0) / (z.params?.['everyM'] as number)),
      );
      const here = peds.filter(
        (e) => e.road.s >= z.s0 && e.road.s <= z.s1 && Math.sign(e.road.d) === sideOf(z),
      );
      expect(here.length, z.id).toBeGreaterThanOrEqual(want);
      total += here.length;
    }
    print(`${zones.length} party zones, ${total} people standing in them at the start`);
    expect(total).toBeGreaterThan(50);
  });

  it('pedicabs are a main sight of the Old Town, and the street has boards of its own for the party', () => {
    const area = REG.regions['base:florida-keys']?.traffic?.areas?.find((a) => a.tag === 'key-oldtown');
    const weight = (k: string) => area?.mix.find((m) => m.kind === k)?.weight ?? 0;
    expect(weight('pedicab')).toBeGreaterThanOrEqual(2);
    const region = REG.regions['base:florida-keys'];
    const oldtown = [...(region?.signs ?? []), ...(region?.billboards ?? [])].filter((b) =>
      (b.tags ?? []).includes('key-oldtown'),
    );
    const slots = duval.features.filter((f) => f.kind === 'billboard');
    // The original boards (four on Duval), and the party's six.
    expect(slots.length).toBeGreaterThanOrEqual(9);
    expect(oldtown.length).toBeGreaterThanOrEqual(10);
  });
});

describe('a tour of Duval Street', () => {
  /** Seeds enough for a rare vehicle to turn up in at least one (a band, not a lucky seed). */
  const SEEDS = [1, 2, 3, 4];

  function tour(seed: number): Set<string> {
    const built = buildSimConfig(REG, STREAMS.forRoute(REG, 'base:osm-duval-run'), {
      seed,
      eventId: 'base:keys-t1-last-light-duval',
      route: 'base:osm-duval-run',
    });
    // No law: the dev bot never evades it, and the tour is about who is on the street.
    const config: SimConfig = { ...built, riders: built.riders.filter((r) => r.faction !== 'law') };
    const sim = createSim(config);
    const player = config.riders.findIndex((r) => r.controller.kind === 'player');
    const bot = createBot();
    const seen = new Set<string>();
    let snap = sim.snapshot();
    while (!sim.isOver() && sim.tick < 60 * 60 * 6) {
      const a = emptyActions();
      bot.drive(snap, player, config.route, a);
      sim.step([toSimInput(a)]);
      snap = sim.snapshot();
      for (const e of snap.entities)
        if (e.contentId && (e.kind === 'vehicle' || e.kind === 'ped')) seen.add(bare(e.contentId));
    }
    return seen;
  }

  it('meets the Old Town: roosters, the crowd, the performers, pedicabs and the tour tram', () => {
    const all = new Set<string>();
    for (const seed of SEEDS) for (const k of tour(seed)) all.add(k);
    print(`kinds met over seeds ${SEEDS.join(', ')}: ${[...all].sort().join(', ')}`);
    for (const kind of [
      'rooster',
      'cruise-day-tripper',
      'street-performer',
      'pedicab',
      'island-tram',
      // Playtest 4 (P4-16): the party street's crowd.
      'bar-hopper',
      'birthday-party',
      'door-greeter',
    ])
      expect(all, kind).toContain(kind);
  }, 600_000);
});
