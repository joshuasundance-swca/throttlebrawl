/// <reference types="vite/client" />
// Iowa's roadside wildlife: whitetail deer and wild turkeys in authored zones beside IA 136 and the
// county dirt road. The zones name their own kinds (like Eagle Point's park visitors), so the
// region's animal pool stays empty and the county farmstead places keep spawning nobody.
// - every wildlife zone spawns its own kind, and nothing else spawns from them;
// - each spawn spot, its dive either way and the walk back stand on supported dry ground;
// - Eagle Point's routes carry none of it.
// Negative control: with the wildlife zones removed, no deer or turkey spawns.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createRoadNetwork } from '../../src/road';
import type { SimConfig } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { initialPedGround, supportedPedMove } from '../../src/sim/peds/ground';
import { PEDS, pedsState } from '../../src/sim/peds';
import { ISOLATED } from './batch';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const WILDLIFE = ['region-clinton:whitetail', 'region-clinton:wild-turkey'];

function configFor(route = 'osm-clinton-ia136-run'): SimConfig {
  return createHeadlessRace(
    {
      seed: 1,
      eventId: 'region-clinton:clinton-ia136-race',
      route: `region-clinton:${route}`,
      eventPatch: { riders: [] },
      tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1 },
    },
    { registry },
  ).config;
}

/** The wildlife zones: roadside zones whose own kinds are all wildlife. */
function zonesOf(c: SimConfig) {
  return c.road.edges.flatMap((e) =>
    c.road
      .featuresOf(e.index, 'roadsideZone')
      .filter((f) => {
        const kinds = f.params?.['kinds'];
        return Array.isArray(kinds) && kinds.length > 0 && kinds.every((k) => WILDLIFE.includes(String(k)));
      })
      .map((f) => ({ e, f })),
  );
}

function wildlifeSpawns(c: SimConfig) {
  const { world } = createSimWithWorld(c);
  const st = pedsState(world);
  return st.id.flatMap((id, k) => {
    const contentId = c.trafficTypes[st.type[k]!]!.contentId;
    return WILDLIFE.includes(contentId) ? [{ contentId, pos: { ...world.movers[id]!.pos } }] : [];
  });
}

describe('Iowa roadside wildlife', () => {
  it('spawns each kind only from its authored zones on IA 136 and the county road', () => {
    const c = configFor();
    const zones = zonesOf(c);
    expect(zones.length).toBeGreaterThan(0);
    expect(registry.regions['region-clinton:clinton-iowa']!.traffic.animals ?? []).toEqual([]);
    const spawns = wildlifeSpawns(c);
    for (const { contentId, pos } of spawns) {
      const home = zones.find(({ e, f }) => e.index === pos.edge && pos.s >= f.s0 && pos.s <= f.s1);
      expect(home, `${contentId} at ${JSON.stringify(pos)}`).toBeDefined();
      expect(home!.f.params?.['kinds']).toContain(contentId);
    }
    for (const { e, f } of zones)
      expect(
        spawns.some((s) => s.pos.edge === e.index && s.pos.s >= f.s0 && s.pos.s <= f.s1),
        f.id,
      ).toBe(true);
    for (const kind of WILDLIFE)
      expect(
        spawns.some((s) => s.contentId === kind),
        kind,
      ).toBe(true);
  });

  it('spawns none of it once the zones are gone, nor on the Eagle Point routes', () => {
    const c = configFor();
    const ids = new Set(zonesOf(c).map(({ f }) => f.id));
    const network = registry.networks['region-clinton:osm-clinton-ia136']!;
    const road = createRoadNetwork({
      network,
      roads: network.roads.map((id) => {
        const r = registry.roads[`region-clinton:${id}`]!;
        return { ...r, features: (r.features ?? []).filter((f) => !ids.has(f.id)) };
      }),
    });
    expect(wildlifeSpawns({ ...c, road })).toEqual([]);
    for (const route of ['osm-clinton-eagle-point-run', 'osm-clinton-eagle-north-run'])
      expect(wildlifeSpawns(configFor(route)), route).toEqual([]);
  });

  it('stands every spawn spot, dive and walk back on supported dry ground', () => {
    const c = configFor();
    const road = c.road;
    let probes = 0;
    for (const { e, f } of zonesOf(c)) {
      const types = (f.params!['kinds'] as string[]).map((k) =>
        c.trafficTypes.find((t) => t.contentId === k)!,
      );
      for (const t of types)
        for (let s = f.s0; s <= f.s1; s += 0.5)
          for (const d of [f.d0, f.d1]) {
            const at = { edge: e.index, s, d };
            const y = initialPedGround(road, at);
            expect(y, `${f.id} s=${s} d=${d}`).not.toBeNull();
            for (const endD of [d - PEDS.diveDistM, d + PEDS.diveDistM]) {
              const moved = supportedPedMove(road, at, { s, d: endD }, y!, t);
              expect(moved.d, `${f.id} s=${s} from=${d} to=${endD}`).toBeCloseTo(endD, 8);
              const back = supportedPedMove(road, { edge: e.index, ...moved }, { s, d }, moved.y, t);
              expect(back.d, `${f.id} back s=${s} from=${endD}`).toBeCloseTo(d, 8);
              probes++;
            }
          }
    }
    expect(probes).toBeGreaterThan(0);
  });
});
