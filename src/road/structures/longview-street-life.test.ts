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
  it('opts the Hudson dispatch court into a continuous open riding apron, with removal and relocation controls', async () => {
    const road = make('osm-pnw-longview-civic');
    const court = pnwPlacesLayout(road, 1).streetSites.find((s) => String(s.kind) === 'dispatch-court');
    expect(court, 'authored Hudson dispatch court').toBeDefined();
    if (!court) return;
    expect(road.edges[court.edge]?.id).toBe('osm-longview-civic-hudson');
    const plan = await ensureStructures(road, 1);
    const apron = court.specs.find((s) => s.rule.endsWith(':apron'))!;
    const controlRoad = make('osm-pnw-longview-civic');
    const noApron = planStructures(
      controlRoad,
      1,
      {
        control: {
          plan: (_r, _s, out) => {
            for (const st of plan.items) if (st.rule !== apron.rule) out.add(st);
          },
        },
      },
      { control: { tags: ['longview-street-life'], load: () => Promise.reject(new Error('unused')) } },
    );
    // A bike-width corridor crosses the whole court, including both connections to the verge.
    for (let s = court.s - 6; s <= court.s + 6; s += 0.5)
      for (let d = 10.8; d <= 16.2; d += 0.2) {
        const pos = { edge: court.edge, s, d };
        const y = road.surfaceHeight(pos.edge, s, d) + 0.15;
        expect(courseAt(road, plan, pos, y).kind, `supported ${s}/${d}`).not.toBe('out');
      }
    const gap = { edge: court.edge, s: court.s - 5, d: 13 };
    expect(
      courseAt(controlRoad, noApron, gap, controlRoad.surfaceHeight(gap.edge, gap.s, gap.d) + 0.15).kind,
    ).toBe('out');
    const network = Object.values(networks).find((n) => n.id === 'osm-pnw-longview-civic')!;
    const original = Object.values(files).filter((r) => network.roads.includes(r.id));
    for (const remove of ['zone', 'tag'] as const) {
      const control = createRoadNetwork({
        network,
        roads: original.map((r) => ({
          ...r,
          features:
            remove === 'zone'
              ? r.features?.filter((f) => f.params?.['place'] !== 'dispatch-court')
              : r.features,
          tags: remove === 'tag' ? r.tags?.filter((t) => t.tag !== 'longview-street-life') : r.tags,
        })),
      });
      expect(
        pnwPlacesLayout(control, 1).streetSites.filter((s) => String(s.kind) === 'dispatch-court'),
      ).toEqual([]);
      expect(
        (await ensureStructures(control, 1)).items.some((st) =>
          st.rule.startsWith(apron.rule.split(':')[0]!),
        ),
      ).toBe(false);
    }
    const moved = createRoadNetwork({
      network,
      roads: original.map((r) => ({
        ...r,
        features: r.features?.map((f) =>
          f.params?.['place'] === 'dispatch-court' ? { ...f, s0: f.s0 - 16, s1: f.s1 - 16 } : f,
        ),
      })),
    });
    const movedCourt = pnwPlacesLayout(moved, 1).streetSites.find(
      (s) => String(s.kind) === 'dispatch-court',
    )!;
    expect(movedCourt.s).toBe(court.s - 16);
    const movedApron = movedCourt.specs.find((st) => st.rule.endsWith(':apron'))!;
    expect(Math.hypot(movedApron.foot.x - apron.foot.x, movedApron.foot.z - apron.foot.z)).toBeGreaterThan(
      10,
    );
    expect(movedCourt.solids).toEqual(court.solids);
    const movedPlan = await ensureStructures(moved, 1);
    expect(
      courseAt(moved, movedPlan, gap, moved.surfaceHeight(gap.edge, gap.s, gap.d) + 0.15).kind,
      'relocation removes physical support from the old court',
    ).toBe('out');
    const movedGap = { ...gap, s: gap.s - 16 };
    expect(
      courseAt(moved, movedPlan, movedGap, moved.surfaceHeight(movedGap.edge, movedGap.s, movedGap.d) + 0.15)
        .kind,
      'relocation supplies physical support at the new court',
    ).toBe('top');
    for (const edge of road.edges.filter((e) => e.isConnector)) {
      expect(pnwPlacesLayout(road, 1).streetSites.some((site) => site.edge === edge.index)).toBe(false);
      expect(edge.features.some((f) => f.params?.['place'] === 'dispatch-court')).toBe(false);
    }
    expect(pnwPlacesLayout(road, 2).streetSites).toEqual(pnwPlacesLayout(road, 1).streetSites);
  });
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
    for (const id of ['osm-pnw-longview', 'pnw-c1'])
      expect(pnwPlacesLayout(make(id), 1).streetSites, id).toEqual([]);
    expect(
      pnwPlacesLayout(make('osm-pnw-longview-civic'), 1).streetSites.some(
        (s) => s.kind === 'civic-frontage' || s.kind === 'plant-market',
      ),
    ).toBe(false);
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
