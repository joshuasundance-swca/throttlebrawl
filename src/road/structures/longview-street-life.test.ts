import { describe, expect, it } from 'vitest';
import { courseAt } from '../course';
import { createRoadNetwork } from '../network';
import { ensureStructures, planStructures, structuresAt, topAt } from '../structures';
import type { BakedNetwork, BakedRoad } from '../types';
import { pnwPlacesLayout } from './pnw-places';
const networks = import.meta.glob<BakedNetwork>('/packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const files = import.meta.glob<BakedRoad>('/packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
function make(id: string) {
  const network = Object.values(networks).find((n) => n.id === id)!;
  return createRoadNetwork({
    network,
    roads: Object.values(files).filter((r) => network.roads.includes(r.id)),
  });
}

describe('Street Diamond sites explicitly join the course with open physical aprons', () => {
  it('provides continuous low support from the existing verge to the open site, preserving other networks', async () => {
    const road = make('osm-pnw-longview-diamond'),
      layout = pnwPlacesLayout(road, 1);
    const sites = layout.streetSites ?? [];
    expect(sites.length).toBeGreaterThan(0);
    const plan = await ensureStructures(road, 1);
    const controlRoad = make('osm-pnw-longview-diamond');
    const controlPlan = planStructures(
      controlRoad,
      1,
      {
        'no-apron': {
          plan: (_r, _s, out) => {
            for (const st of plan.items) if (!st.rule.endsWith(':apron')) out.add(st);
          },
        },
      },
      { 'no-apron': { tags: ['longview-street-life'], load: () => Promise.reject(new Error('unused')) } },
    );
    for (const site of sites) {
      expect(site.specs.some((st) => st.rule.endsWith(':apron'))).toBe(true);
      const side = Math.sign(site.d),
        verge = road.vergeAt(site.edge, site.s, side < 0 ? 'left' : 'right');
      for (let d = Math.abs(verge.dOuter) - 0.1; d <= Math.abs(site.d); d += 0.2) {
        const pos = { edge: site.edge, s: site.s - 5, d: side * d };
        expect(
          courseAt(road, plan, pos, road.surfaceHeight(pos.edge, pos.s, pos.d) + 0.15).kind,
          'inviting site is ground',
        ).not.toBe('out');
      }
      const gap = { edge: site.edge, s: site.s - 5, d: side * (Math.abs(verge.dOuter) + 1) };
      expect(
        courseAt(controlRoad, controlPlan, gap, controlRoad.surfaceHeight(gap.edge, gap.s, gap.d) + 0.15)
          .kind,
        'removed apron restores the decorative-ground gap',
      ).toBe('out');
    }
    expect(pnwPlacesLayout(road, 2).streetSites).toEqual(sites);
    for (const id of ['osm-pnw-longview', 'osm-pnw-longview-civic', 'pnw-c1'])
      expect(pnwPlacesLayout(make(id), 1).streetSites, id).toEqual([]);
  });
  it('keeps a plant canopy open under its roof, with physical counter and posts', async () => {
    const road = make('osm-pnw-longview-diamond'),
      plan = await ensureStructures(road, 1);
    const market = pnwPlacesLayout(road, 1).streetSites?.find((s) => s.kind === 'plant-market');
    expect(market).toBeDefined();
    if (!market) return;
    const p = road.toWorld(market.edge, market.s - 5, market.d, 0);
    const at = structuresAt(plan, p.x, p.z);
    expect(at.some((st) => st.rule.endsWith(':canopy'))).toBe(true);
    expect(at.filter((st) => st.baseY < p.y + 1.6 && (topAt(st, p.x, p.z) ?? 0) > p.y + 0.3)).toEqual([]);
    expect(market.specs.some((st) => st.rule.endsWith(':counter'))).toBe(true);
    expect(market.specs.some((st) => st.rule.endsWith(':post'))).toBe(true);
  });
});
