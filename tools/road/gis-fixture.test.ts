import { describe, expect, it } from 'vitest';
import { roadNetworkSchema, roadSchema, routeSchema } from '../../src/content/schema';
import {
  compileTrack,
  createRoadNetwork,
  createRouteProgress,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
  type TrackSource,
} from '../../src/road';

// The road lint runs on any file in the baked format, so the GIS side quest's output goes through
// the same rules (M1 road-1 acceptance). This fixture has the GIS output's shape: an `osm-`
// prefixed stretch with a real name, a 5 m sample spacing that does not divide its length, and
// a gis-pipeline provenance block with its sources. It must pass the lint and load as a route.

const SOURCE: TrackSource = {
  network: {
    id: 'osm-keys-fixture',
    name: 'GIS-shaped fixture',
    region: 'florida-keys',
    crs: { kind: 'tmerc', originLatDeg: 24.7, originLonDeg: -81.1, originElevM: 0 },
    notes: 'Test fixture in the GIS output shape.',
  },
  createdAt: '2026-11-02',
  points: [
    [0, 0],
    [60, -400],
    [300, -700],
    [700, -820],
    [1010, -1100],
  ],
  baseElevationM: 2,
  spacingM: 5,
  smoothingM: 40,
  lanes: [
    { id: 'L1', dCenterM: -1.8, widthM: 3.6, direction: -1, kind: 'drive' },
    { id: 'R1', dCenterM: 1.8, widthM: 3.6, direction: 1, kind: 'drive' },
  ],
  roads: [
    {
      id: 'osm-overseas-stretch',
      name: 'Overseas Highway (fixture stretch)',
      speedLimitMps: 24.6,
      surface: 'asphalt',
      humps: [{ centreM: 600, lengthM: 300, heightM: 3 }],
      tags: [{ s0: 0, s1: 'end', side: 'both', tag: 'bridge' }],
      features: [],
      barriers: [],
    },
  ],
  routes: [
    {
      id: 'osm-fixture-sprint',
      start: { road: 'osm-overseas-stretch', s: 20, dir: 1 },
      finish: { road: 'osm-overseas-stretch', s: -20 },
      checkpoints: [],
      startGrid: { rows: 2, perRow: 2, rowGapM: 8 },
    },
  ],
};

const GIS_PROVENANCE = {
  origin: 'gis-pipeline',
  author: 'tools/gis',
  createdAt: '2026-11-02',
  tool: {
    name: 'tools/gis/bake_road.py',
    version: '0.1.0',
    configRef: 'tools/gis/configs/keys-overseas.json',
  },
  sources: [
    {
      name: 'OpenStreetMap',
      spdx: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
      url: 'https://www.openstreetmap.org/copyright',
      retrievedAt: '2026-11-02T03:10:00Z',
      sha256: '<hash of the raw extract>',
    },
  ],
  modified: true,
  modifications: 'spline-smoothed, resampled at 5 m, elevation exaggerated x2',
};

function gisFiles() {
  const out = compileTrack(SOURCE);
  const first = out.roads[0];
  if (!first) throw new Error('the fixture compiles to one road');
  const road = {
    ...(first as unknown as BakedRoad),
    realName: 'Overseas Highway',
    provenance: GIS_PROVENANCE,
  };
  const network = { ...out.network, provenance: GIS_PROVENANCE };
  return { network, road, route: out.routes[0] };
}

describe('tools/road: a fixture in the GIS output shape', () => {
  it('has the GIS shape: a length that 5 m does not divide, and a provenance block', () => {
    const { road } = gisFiles();
    expect(road.lengthM % 5).not.toBe(0);
    expect(road.sampleSpacingM).not.toBe(5);
    expect(road.provenance.origin).toBe('gis-pipeline');
    expect(roadSchema.safeParse(road).success).toBe(true);
  });

  it('passes the content schemas and the road lint', () => {
    const { network, road, route } = gisFiles();
    expect(roadNetworkSchema.safeParse(network).success).toBe(true);
    expect(routeSchema.safeParse(route).success).toBe(true);
    const issues = lintRoadNetwork({
      network: network as unknown as BakedNetwork,
      roads: [road],
      routes: [route as unknown as BakedRoute],
    });
    expect(issues).toEqual([]);
  });

  it('loads as a network and a route', () => {
    const { network, road, route } = gisFiles();
    const net = createRoadNetwork({
      network: network as unknown as BakedNetwork,
      roads: [road],
    });
    const progress = createRouteProgress(net, route as unknown as BakedRoute);
    expect(progress.routeId).toBe('osm-fixture-sprint');
    expect(progress.length).toBeGreaterThan(1000);
    expect(progress.distanceToFinish(0, 20)).toBeCloseTo(progress.length, 6);
    expect(progress.allows(0)).toBe(true);
  });

  it('is still checked: a GIS stretch with broken samples fails the lint', () => {
    const { network, road, route } = gisFiles();
    const data = road.samples as unknown as { data: Record<string, number[]> };
    data.data['kappa'] = (data.data['kappa'] ?? []).map((k) => k * 3);
    const rules = lintRoadNetwork({
      network: network as unknown as BakedNetwork,
      roads: [road],
      routes: [route as unknown as BakedRoute],
    }).map((i) => i.rule);
    expect(rules).toContain('curvature');
  });
});
