import { Vector3, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, terrainAt, type BakedTerrain } from '../road';
import { Boards, type BoardCatalog } from './boards';
import { createFlatLook } from './look';

const height = (x: number, z: number) => -1 + x * 0.02 + z * 0.002;
const terrain: BakedTerrain = {
  patches: [
    {
      surface: 'grass',
      vertices: [
        [-40, height(-40, -400), -400],
        [-40, height(-40, 0), 0],
        [40, height(40, -400), -400],
        [40, height(40, 0), 0],
      ],
      triangles: [
        [0, 1, 2],
        [2, 1, 3],
      ],
    },
  ],
};

function build(kind: 'sign' | 'billboard', ground?: BakedTerrain) {
  const bundle = fixtureNetwork([{ id: 'street', lengthM: 400, kappa: 0 }]);
  const road = createRoadNetwork({
    ...bundle,
    network: { ...bundle.network, ...(ground ? { terrain: ground } : {}) },
  });
  const catalog: BoardCatalog = {
    items: { guide: { ref: 'base:region/test#guide', text: 'TURN AHEAD. Follow the street.', kind } },
  };
  const boards = new Boards(createFlatLook());
  boards.build(
    road,
    () => [{ kind: 'billboard', id: 'guide', s0: 200, s1: 200, d0: 9, d1: 13, item: 'guide' }],
    catalog,
  );
  const view = boards.all()[0];
  expect(view).toBeDefined();
  return { boards, view: view!, road };
}

describe('boards over authored ground', () => {
  it.each([
    ['sign', 0],
    ['billboard', 0],
    ['sign', 2],
    ['billboard', 2],
  ] as const)(
    'grounds both %s posts on terrain offset %sm while keeping its readable panel in place',
    (kind, lift) => {
      const ground: BakedTerrain = {
        patches: terrain.patches.map((p) => ({
          ...p,
          vertices: p.vertices.map(([x, y, z]) => [x, y + lift, z] as const),
        })),
      };
      const actual = build(kind, ground);
      const legacy = build(kind);
      try {
        expect(actual.view.group.matrixWorld.elements).toEqual(legacy.view.group.matrixWorld.elements);
        expect(actual.view.panel.position).toEqual(legacy.view.panel.position);
        const frame = actual.view.group.children.find((child) => child !== actual.view.panel) as Mesh;
        const positions = frame.geometry.getAttribute('position');
        for (const side of [-1, 1]) {
          const bottoms: Vector3[] = [];
          for (let i = 0; i < positions.count; i++) {
            const p = new Vector3().fromBufferAttribute(positions, i);
            // The low frame vertices are the feet, below the panel's lower cross rail.
            if (p.x * side > 0 && p.y < actual.view.panel.position.y - 0.2)
              bottoms.push(p.applyMatrix4(actual.view.group.matrixWorld));
          }
          expect(bottoms.length).toBeGreaterThan(0);
          const land = bottoms.map((p) => terrainAt(ground, p.x, p.z, Infinity, 'land')?.y);
          expect(land.every((y) => y !== undefined)).toBe(true);
          const minimum = Math.min(...land.filter((y): y is number => y !== undefined));
          for (const p of bottoms) expect(p.y).toBeCloseTo(minimum, 5);
        }
      } finally {
        actual.boards.clear();
        legacy.boards.clear();
      }
    },
  );

  it('does not invent a land floor from water or a missing authored patch', () => {
    const legacy = build('sign');
    try {
      const frameOf = (view: typeof legacy.view) =>
        (view.group.children.find((c) => c !== view.panel) as Mesh).geometry.getAttribute('position').array;
      for (const ground of [
        { patches: [] },
        {
          patches: terrain.patches.map((p) => ({
            ...p,
            surface: 'water' as const,
            vertices: p.vertices.map(([x, , z]) => [x, -2, z] as const),
          })),
        },
      ]) {
        const actual = build('sign', ground);
        try {
          expect(frameOf(actual.view)).toEqual(frameOf(legacy.view));
        } finally {
          actual.boards.clear();
        }
      }
    } finally {
      legacy.boards.clear();
    }
  });
});
