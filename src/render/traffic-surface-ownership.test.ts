// Dedicated traffic movements can overlap a receiving road for tens of metres at a shallow angle.
// The receiving ribbon owns that shared asphalt where their fitted road surfaces agree, while the
// traffic ribbon must remain visible beside it and beneath a genuinely elevated crossing.
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import type { LaneInfo } from '../sim/api';
import { createFlatLook } from './look';
import { GroundTris } from './land-probe.test-util';
import { buildRoadScene } from './road-mesh';

const LENGTH_M = 100;
const DRIVE = [{ id: 'R1', dCenterM: 0, widthM: 4, direction: 1 as const, kind: 'drive' as const }];
const WIDE = [{ id: 'R1', dCenterM: 0, widthM: 6, direction: 1 as const, kind: 'drive' as const }];
const SHORTCUT = [{ id: 'S1', dCenterM: 0, widthM: 6, direction: 1 as const, kind: 'shortcut' as const }];

function straight(id: string, x: number, y: number, lanes: readonly LaneInfo[]): BakedRoad {
  const base = fixtureNetwork([{ id, lengthM: LENGTH_M, kappa: 0, lanes }]).roads[0];
  if (!base) throw new Error(`fixture did not make ${id}`);
  const data = base.samples.data;
  return {
    ...base,
    from: `${id}-from`,
    to: `${id}-to`,
    samples: {
      ...base.samples,
      data: {
        ...data,
        x: (data['x'] ?? []).map((v) => v + x),
        y: (data['y'] ?? []).map((v) => v + y),
      },
    },
  };
}

function ownershipFixture(): RoadNetwork {
  const roads = [
    straight('shortcut-host', 0, 0, SHORTCUT),
    straight('traffic-covered', 4, 0.04, DRIVE),
    straight('elevated-host', 20, 2, SHORTCUT),
    straight('traffic-under', 24, 0, DRIVE),
    straight('ordinary-host', 40, 0, WIDE),
    straight('ordinary-shortcut', 44, 0, SHORTCUT),
  ];
  const connector = (id: string, host: string) => ({
    id: `${id}-row`,
    road: id,
    from: { road: host, end: 'from' as const, lane: 'S1' },
    to: { road: host, end: 'to' as const, lane: 'S1' },
    trafficOnly: true,
  });
  const network: BakedNetwork = {
    id: 'traffic-surface-ownership',
    roads: roads.map((r) => r.id),
    junctions: [
      {
        id: 'rows',
        x: 0,
        y: 0,
        z: 0,
        ends: [],
        connectors: [
          connector('traffic-covered', 'shortcut-host'),
          connector('traffic-under', 'elevated-host'),
        ],
      },
    ],
  };
  return createRoadNetwork({ network, roads });
}

const SURFACES = /^road-(road|shortcut|shoulder)$/;

describe('shared junction asphalt', () => {
  const road = ownershipFixture();
  const scene = buildRoadScene(road, createFlatLook(), undefined, { postRoads: () => true });
  const ground = new GroundTris(scene.group, SURFACES);
  const namesAt = (roadId: string, d: number, top = 10): string[] => {
    const edge = road.edgeIndex(roadId);
    const p = road.toWorld(edge, LENGTH_M / 2, d, 0);
    return [...new Set(ground.allAt(p.x, p.z, top).map((h) => h.name))];
  };
  const across = Array.from({ length: 25 }, (_v, i) => -2.4 + i * 0.2);

  it('lets the receiving shortcut surface own the traffic ribbon only where they share asphalt', () => {
    expect(namesAt('traffic-covered', -2)).toEqual(['road-shortcut']);
    expect(namesAt('traffic-covered', 1)).toEqual(['road-road']);
    // At d -1 the ray lies exactly on the receiving shortcut lane's own shoulder seam. Epsilon
    // controls show that the two names are adjacent host surfaces, not an area of traffic overlap.
    expect(namesAt('traffic-covered', -1.02)).toEqual(['road-shortcut']);
    expect(namesAt('traffic-covered', -1)).toEqual(['road-shortcut', 'road-shoulder']);
    expect(namesAt('traffic-covered', -0.98)).toEqual(['road-shoulder']);
    // Every cross-section point still needs supporting asphalt. The junction sweep separately
    // rejects close stacked faces.
    expect(across.filter((d) => namesAt('traffic-covered', d).length === 0)).toEqual([]);
  });

  it('keeps the traffic ribbon beneath a height-separated crossing', () => {
    expect(namesAt('traffic-under', -2)).toEqual(['road-shortcut', 'road-road']);
    expect(namesAt('traffic-under', 1)).toEqual(['road-road']);
    expect(across.filter((d) => !namesAt('traffic-under', d).includes('road-road'))).toEqual([]);
  });

  it('preserves the existing clipping of an ordinary shortcut beneath a road', () => {
    expect(namesAt('ordinary-shortcut', -2)).toEqual(['road-road']);
    expect(namesAt('ordinary-shortcut', 1)).toEqual(['road-shortcut']);
  });
});
