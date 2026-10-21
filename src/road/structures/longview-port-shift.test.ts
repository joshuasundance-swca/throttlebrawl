import { describe, expect, it } from 'vitest';
import { createRoadNetwork } from '../network';
import { ensureStructures, planStructures, structuresAt, topAt } from '../structures';
import type { BakedNetwork, BakedRoad } from '../types';
import { pnwPlacesLayout } from './pnw-places';
import { courseAt } from '../course';

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

describe('Longview freight places share the physical world plan', () => {
  it('joins each visible yard to the ordinary verge with a physical loading apron', async () => {
    const road = make('osm-pnw-longview');
    const plan = await ensureStructures(road, 1);
    for (const yard of pnwPlacesLayout(road, 1).workyards) {
      const apron = yard.specs.find((s) => s.rule.endsWith(':apron'));
      expect(apron, 'an inviting yard must not be separated by invisible out-of-bounds grass').toBeDefined();
      const side = Math.sign(yard.d);
      const verge = road.vergeAt(yard.edge, yard.s, side < 0 ? 'left' : 'right');
      const end = Math.abs(yard.d);
      for (let d = Math.abs(verge.dOuter) - 0.1; d <= end; d += 0.2) {
        const hit = courseAt(
          road,
          plan,
          { edge: yard.edge, s: yard.s - 3, d: side * d },
          road.surfaceHeight(yard.edge, yard.s, 0) + 0.1,
        );
        expect(hit.kind, 'continuous grounded approach').not.toBe('out');
      }
      const control = planStructures(
        make('osm-pnw-longview'),
        1,
        {
          'no-aprons': {
            plan: (_road, _seed, out) => {
              for (const spec of plan.items) if (!spec.rule.endsWith(':apron')) out.add(spec);
            },
          },
        },
        { 'no-aprons': { tags: ['longview-port-yard'], load: () => Promise.reject(new Error('unused')) } },
      );
      const gap = side * ((Math.abs(verge.dOuter) + end) / 2);
      expect(
        courseAt(
          road,
          control,
          { edge: yard.edge, s: yard.s - 3, d: gap },
          road.surfaceHeight(yard.edge, yard.s, 0) + 0.1,
        ).kind,
        'removing the apron exposes the old decorative-ground boundary',
      ).toBe('out');
    }
  });
  it('keeps core workyard placement across seeds and adds none to unchanged PNW routes', () => {
    const road = make('osm-pnw-longview');
    const layout = pnwPlacesLayout(road, 1);
    expect(layout.workyards.length).toBeGreaterThan(0);
    expect(pnwPlacesLayout(road, 2).workyards).toEqual(layout.workyards);
    for (const id of ['pnw-c1', 'osm-pnw-chuckanut', 'osm-pnw-longview-civic', 'osm-pnw-longview-diamond']) {
      expect(pnwPlacesLayout(make(id), 1).workyards, id).toEqual([]);
    }
  });

  it('registers roofs, back walls and posts on both sides with honest tops and open loading faces', async () => {
    const road = make('osm-pnw-longview');
    const layout = pnwPlacesLayout(road, 1);
    const plan = await ensureStructures(road, 1);
    const sheds = layout.workyards.filter((y) => y.kind === 'freight-shed');
    expect(sheds.length).toBeGreaterThan(0);
    expect(new Set(sheds.map((y) => Math.sign(y.d))).size).toBe(2);
    for (const shed of sheds) {
      for (const spec of shed.specs) {
        expect(
          plan.items.some(
            (s) => s.rule === spec.rule && s.foot.x === spec.foot.x && s.foot.z === spec.foot.z,
          ),
        ).toBe(true);
        expect(topAt(spec, spec.foot.x, spec.foot.z)).toBeGreaterThan(spec.baseY);
      }
      const roof = shed.specs.find((s) => s.rule.endsWith(':roof'))!;
      const back = shed.specs.find((s) => s.rule.endsWith(':back'))!;
      const centre = road.toWorld(shed.edge, shed.s, shed.d, 0);
      expect(structuresAt(plan, centre.x, centre.z).some((s) => s.rule === roof.rule)).toBe(true);
      const wallPos = road.project(back.foot.x, back.foot.z, shed.edge);
      expect(Math.abs(wallPos.d)).toBeGreaterThan(Math.abs(shed.d));
      // Middle of the near loading face is open below the canopy: no invisible wall across it.
      const face = road.toWorld(shed.edge, shed.s - 4, shed.d - Math.sign(shed.d) * 4.7, 0);
      expect(
        structuresAt(plan, face.x, face.z).filter(
          (s) => s.baseY < centre.y + 2 && (topAt(s, face.x, face.z) ?? -Infinity) > centre.y + 0.3,
        ).length,
      ).toBe(0);
    }
    console.log(
      `[examined] ${sheds.length} mirrored open sheds: registered roof/back/post geometry and loading-face clearance`,
    );
  });
});
