import { describe, expect, it } from 'vitest';
import region from '../../packs/region-pnw/regions/pacific-northwest/region.json';
import { trafficHeightM, type TrafficCategory } from '../sim/api';
import { EdgeLocator, laneExtentAt } from './overlap';
import { createFlatLook } from './look';
import { buildRoadScene } from './road-mesh';
import { floorOf, hitsIn, placeLine, placesOf, roadColumns, type RoadHit } from './road-clear.test-util';
import { print, track } from './scene-cost.test-util';

const traffic = import.meta.glob<{ id: string; category: TrafficCategory; heightM?: number }>(
  '../../packs/*/traffic/*.json',
  { eager: true, import: 'default' },
);

describe('Samish northbound access has upright traffic height clearance at its real crossings', () => {
  it('keeps the rendered deck, fascia, supports and terrain outside the allowed traffic envelope', () => {
    const kinds = new Set(
      [...region.traffic.mix, ...region.traffic.areas.flatMap((area) => area.mix)].map((entry) => entry.kind),
    );
    const heights = [...kinds].map((kind) => {
      const [pack, id] = kind.includes(':') ? kind.split(':') : ['region-pnw', kind];
      const entry = Object.entries(traffic).find(
        ([path, value]) => path.includes(`/packs/${pack}/`) && value.id === id,
      )?.[1];
      expect(entry, `allowed traffic ${kind}`).toBeDefined();
      return trafficHeightM(entry!);
    });
    const highM = Math.max(...heights);
    const { road, dressing } = track('osm-pnw-samish');
    const access = ['osm-samish-exit242-nb-off', 'osm-samish-exit246-nb-on'];
    const loc = new EdgeLocator(road);
    const lowerSpans = new Map<number, [number, number]>();
    const crossed = new Set<string>();
    for (const id of access) {
      const edge = road.edgeIndex(id);
      expect(edge, id).toBeGreaterThanOrEqual(0);
      const e = road.edges[edge]!;
      lowerSpans.set(edge, [0, e.length]);
      for (let s = 0; s <= e.length; s += 1) {
        const p = road.toWorld(edge, s, 0, 0);
        for (const hit of loc.at(p.x, p.z, edge)) {
          const [lo, hi] = laneExtentAt(road, hit.edge, hit.s);
          if (hit.d < lo || hit.d > hi) continue;
          const dy = road.surfaceHeight(hit.edge, hit.s, hit.d) - p.y;
          if (Math.abs(dy) <= 1.2) continue;
          crossed.add(id);
          if (dy < 0) {
            const span = lowerSpans.get(hit.edge) ?? [hit.s, hit.s];
            lowerSpans.set(hit.edge, [Math.min(span[0], hit.s - 10), Math.max(span[1], hit.s + 10)]);
          }
        }
      }
    }
    expect([...crossed].sort(), 'both access roads cross an actual road at another height').toEqual(
      [...access].sort(),
    );
    const cols = roadColumns(road, {
      highM,
      include: (edge, s, d) => {
        const span = lowerSpans.get(edge);
        return (
          !!span &&
          s >= span[0] &&
          s <= span[1] &&
          road
            .lanesAt(edge, s)
            .some(
              (lane) =>
                d >= lane.dCenterM - lane.widthM / 2 + 0.5 && d <= lane.dCenterM + lane.widthM / 2 - 0.5,
            )
        );
      },
    });
    expect(cols.count).toBeGreaterThan(0);
    const { group } = buildRoadScene(road, createFlatLook(), dressing, { trafficClearanceM: highM });
    const hits = new Map<string, RoadHit>();
    hitsIn(cols, group, floorOf, null, hits);
    const places = placesOf(hits.values());
    print(
      `[examined] Samish access: ${cols.count} lane columns, ${highM} m allowed body height, ${lowerSpans.size} lower-road spans`,
    );
    for (const place of places) print(placeLine(place));
    expect(places.map(placeLine)).toEqual([]);
  }, 120_000);
});
