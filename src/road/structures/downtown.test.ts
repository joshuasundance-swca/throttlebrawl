// The downtowns' structures (the physical world, the maintainer, 2026-10-06): San Francisco's towers and
// downtown Portland's blocks are planned from the network and the seed alone, fill the structure registry
// through their lazy layers, and come out the same every time (scripts/hitboxes.test.ts holds each to its
// drawn model; render/downtown-main.test.ts holds the picture to main's).
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '..';
import {
  ensureStructures,
  requireStructures,
  STRUCTURE_LAYERS,
  structureLayersFor,
  structuresAt,
  topAt,
} from '../structures';
import { planPdxDowntown, planSfDowntown, type DowntownLot } from './downtown';

const networkFiles = import.meta.glob<BakedNetwork>('../../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

/** A fresh network from its pack files (a new object each call, so nothing kept is shared). */
function networkOf(id: string): RoadNetwork {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  return createRoadNetwork({ network, roads });
}

/** A lot as plain numbers, rounded to the millimetre: what a replay of the plan must reproduce. */
const shape = (l: DowntownLot) =>
  [l.rule, l.variant, l.mids ?? 0, l.edge, l.s, l.d, l.p.x, l.p.y, l.p.z, l.turn, l.solid.baseY]
    .map((v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v))
    .join(' ');

describe('the downtowns as structures (road/structures/downtown.ts)', () => {
  it("fills the registry through each downtown's lazy layer, every lot one structure", async () => {
    for (const [id, layer, lotsOf] of [
      ['sf-downtown', 'downtown-sf', (r: RoadNetwork) => planSfDowntown(r, 7).lots],
      ['osm-pnw-portland', 'downtown-pdx', (r: RoadNetwork) => planPdxDowntown(r, 7).lots],
    ] as const) {
      const road = networkOf(id);
      expect(structureLayersFor(road)).toEqual([layer]);
      expect(() => requireStructures(road, 7), 'not planned yet').toThrow(/not planned/);
      const plan = await ensureStructures(road, 7);
      expect(requireStructures(road, 7)).toBe(plan);
      const lots = lotsOf(road);
      expect(plan.items.length, id).toBe(lots.length);
      expect(plan.items.length, id).toBeGreaterThan(400);
      plan.items.forEach((st, i) => {
        expect(st.layer).toBe(layer);
        expect(st.rule).toBe(lots[i]?.rule);
        expect(st.foot).toEqual(lots[i]?.solid.foot);
      });
      // A point on a building's roof finds it, and its top is the roof's height.
      const st = plan.items.find((s) => s.rule === 'tower' || s.rule === 'pdx-front');
      if (!st) throw new Error(`no building on ${id}`);
      expect(structuresAt(plan, st.foot.x, st.foot.z).map((s) => s.id)).toContain(st.id);
      expect(topAt(st, st.foot.x, st.foot.z)).toBeCloseTo(
        st.baseY + (st.roof.kind === 'flat' ? st.roof.topM : 0),
        9,
      );
    }
  });

  it('needs no downtown layer on a network without a downtown tag', () => {
    const road = networkOf('osm-pnw-chuckanut');
    expect(Object.keys(STRUCTURE_LAYERS)).toEqual(expect.arrayContaining(['downtown-pdx', 'downtown-sf']));
    expect(structureLayersFor(road).filter((l) => l.startsWith('downtown'))).toEqual([]);
  });

  it('is the same plan from a fresh network and the same seed, and another for another seed', () => {
    for (const plan of [planSfDowntown, planPdxDowntown]) {
      const a = plan(networkOf(plan === planSfDowntown ? 'sf-downtown' : 'osm-pnw-portland'), 3).lots.map(
        shape,
      );
      const b = plan(networkOf(plan === planSfDowntown ? 'sf-downtown' : 'osm-pnw-portland'), 3).lots.map(
        shape,
      );
      expect(b).toEqual(a);
      const c = plan(networkOf(plan === planSfDowntown ? 'sf-downtown' : 'osm-pnw-portland'), 4).lots.map(
        shape,
      );
      expect(c).not.toEqual(a);
    }
  });

  it('keeps one plan per network and seed', () => {
    const road = networkOf('sf-downtown');
    expect(planSfDowntown(road, 5)).toBe(planSfDowntown(road, 5));
    expect(planSfDowntown(road, 6)).not.toBe(planSfDowntown(road, 5));
  });
});
