import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { floorOf, hitsIn, roadColumns, type RoadHit } from './road-clear.test-util';

describe('ride columns follow the actual lanes', () => {
  for (const sign of [1, -1]) {
    it(`samples only the asphalt margin of a lane on side ${sign}`, () => {
      const road = createRoadNetwork(
        fixtureNetwork([
          {
            id: 'cut',
            lengthM: 10,
            kappa: 0,
            lanes: [{ id: 'S1', dCenterM: sign * 5, widthM: 8, direction: 1, kind: 'shortcut' }],
          },
        ]),
      );
      const cols = roadColumns(road);
      const ds = Array.from({ length: cols.count }, (_, q) => cols.pts[q * 7 + 5]!);
      expect(Math.min(...ds)).toBe(sign > 0 ? 1.5 : -8.5);
      expect(Math.max(...ds)).toBe(sign > 0 ? 8.5 : -1.5);
      const root = new Group();
      root.name = 'control';
      const plant = (name: string, d: number, width: number, height: number) => {
        const p = road.toWorld(0, 5, d, 0);
        const mesh = new Mesh(new BoxGeometry(width, height, 2), new MeshBasicMaterial());
        mesh.name = name;
        mesh.position.set(p.x, p.y + height / 2, p.z);
        root.add(mesh);
      };
      plant('road-deck', sign * 0.5, 0.1, 1.2);
      plant('road-posts', sign * 0.5, 0.1, 1.2);
      const hits = new Map<string, RoadHit>();
      hitsIn(cols, root, floorOf, null, hits);
      expect([...hits.values()]).toEqual([]);
      // The same real mesh names inside the asphalt remain obstructions. Ground 0.3 m
      // above it and a thin rail are also found; no part-name or height exception.
      plant('road-deck', sign * 5, 0.1, 1.2);
      plant('road-posts', sign * 5, 0.1, 1.2);
      plant('road-land', sign * 5, 1, 0.3);
      plant('rail', sign * 5, 0.1, 1.2);
      hitsIn(cols, root, floorOf, null, hits);
      expect([...new Set([...hits.values()].map((h) => h.part))].sort()).toEqual([
        'control/rail',
        'control/road-deck',
        'control/road-land',
        'control/road-posts',
      ]);
    });
  }

  it('does not invent asphalt columns for an empty lane section', () => {
    const road = createRoadNetwork(fixtureNetwork([{ id: 'empty', lengthM: 10, kappa: 0, lanes: [] }]));
    expect(roadColumns(road).count).toBe(0);
  });
});
