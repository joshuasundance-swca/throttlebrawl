import { expect, it } from 'vitest';
import { InstancedMesh, Mesh, Raycaster, Vector3 } from 'three';
import {
  courseEdgeTopAt,
  createRoadNetwork,
  drawnEdgeAt,
  fixtureNetwork,
  lanesNear,
  type BakedRoad,
} from '../road';
import { EdgeLocator } from './overlap';
import { createFlatLook } from './look';
import { buildRoadScene } from './road-mesh';
import { VergeLayer } from './verge';

it('render clearance uses a one-sided lane extent, with visible lane and empty-reference controls', () => {
  const bundle = fixtureNetwork([{ id: 'cut', lengthM: 100, kappa: 0 }]);
  const r = bundle.roads[0] as BakedRoad;
  const road = createRoadNetwork({
    ...bundle,
    roads: [
      {
        ...r,
        laneSections: [
          { s0: 0, lanes: [{ id: 'S1', dCenterM: 5, widthM: 8, direction: 1, kind: 'shortcut' }] },
        ],
      },
    ],
  });
  const locator = new EdgeLocator(road);
  expect(locator.onLanes(0.55, -50, -1, 0.3)).toBe(false);
  expect(locator.onLanes(1.1, -50, -1, 0.3)).toBe(true);
  const empty = createRoadNetwork({ ...bundle, roads: [{ ...r, laneSections: [{ s0: 0, lanes: [] }] }] });
  expect(empty.lanesAt(0, 50)).toHaveLength(0);
  const emptyLocator = new EdgeLocator(empty);
  for (const [x, found] of [
    [0, true],
    [1, false],
  ] as const) {
    expect(emptyLocator.onLanes(x, -50, -1, 0.1)).toBe(found);
    expect(lanesNear(empty, x, -50, -1, 0.1)).toBe(found);
  }
});

it.each([true, false])(
  'partial interstate tags match actual static bands and per-panel looks (midpoint tagged: %s)',
  (midpointTagged) => {
    const a = fixtureNetwork([{ id: 'a', lengthM: 400, kappa: 0 }]);
    const b = fixtureNetwork([{ id: 'b', lengthM: 400, kappa: 0 }]);
    const first = a.roads[0]!;
    const raw = createRoadNetwork(a).edges[0]!;
    const shift = raw.dMax - raw.dMin + 0.45;
    const main: BakedRoad = {
      ...first,
      barriers: [{ s0: 0, s1: 400, side: 'right', kind: 'wall', heightM: 1.2 }],
      tags: [
        {
          s0: midpointTagged ? 100.1 : 0,
          s1: midpointTagged ? 300.1 : 99.5,
          side: 'right',
          tag: 'interstate',
        },
      ],
    };
    const original = b.roads[0]!;
    const other: BakedRoad = {
      ...original,
      from: `b-${original.from}`,
      to: `b-${original.to}`,
      barriers: [],
      samples: {
        ...original.samples,
        data: { ...original.samples.data, x: original.samples.data['x']!.map((x) => x + shift) },
      },
    };
    const roads = midpointTagged ? [main] : [main, other];
    const road = createRoadNetwork({
      network: {
        ...a.network,
        roads: roads.map((r) => r.id),
        junctions: midpointTagged
          ? a.network.junctions
          : [
              ...a.network.junctions,
              ...b.network.junctions.map((j) => ({ ...j, id: `b-${j.id}`, x: j.x + shift })),
            ],
      },
      roads,
    });
    const look = createFlatLook();
    const scene = buildRoadScene(road, look, Object.fromEntries(roads.map((r) => [r.id, r])));
    const verge = new VergeLayer(road, look, { tags: new Set(['interstate']) });
    const samples = midpointTagged
      ? ([
          [50, false],
          [101.1, false],
          [103, true],
          [301.1, true],
          [350, false],
        ] as const)
      : ([
          [50, true],
          [101.1, true],
          [350, true],
        ] as const);
    for (const [s, expected] of samples) {
      const p = road.toWorld(0, s, raw.dMax + 0.05, 0);
      const meshes: Mesh[] = [];
      scene.group.traverse((m) => {
        if (m instanceof Mesh && /^road-(rail|deck)$/.test(m.name)) meshes.push(m as Mesh);
      });
      verge.update(p.x, p.z, null, 0);
      verge.group.traverse((m) => {
        if (m instanceof InstancedMesh && m.name === 'verge-concrete' && m.count > 0) {
          m.computeBoundingSphere();
          meshes.push(m);
        }
      });
      scene.group.updateMatrixWorld(true);
      verge.group.updateMatrixWorld(true);
      const ray = new Raycaster(new Vector3(p.x - 0.35, p.y + 0.6, p.z), new Vector3(1, 0, 0), 0, 0.7);
      expect(ray.intersectObjects(meshes, false).length > 0, `actual triangles at s${s}`).toBe(expected);
      expect(drawnEdgeAt(road, 0, s, 'right'), `contact at s${s}`).toBe(expected ? 'barrier' : null);
      expect(courseEdgeTopAt(road, 0, s, 'right'), `top at s${s}`).toBe(expected ? 1.2 : 0);
    }
    scene.dispose();
    verge.dispose();
  },
);
