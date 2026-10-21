import { describe, expect, it } from 'vitest';
import { buildRegistry, lookup } from '../content';
import { streamForRoute } from './config';

const terrain = {
  patches: [
    {
      surface: 'grass',
      vertices: [
        [0, 2, 0],
        [0, 3.1, 10],
        [10, 4, 0],
      ],
      triangles: [[0, 1, 2]],
    },
  ],
};

function registry(withTerrain: boolean) {
  return buildRegistry([
    {
      path: 'pack.json',
      json: {
        type: 'pack',
        id: 'fixture',
        name: 'Fixture',
        version: '1.0.0',
        formatVersion: 1,
        license: 'MIT',
        defaults: { tuning: 'registry', hud: 'fixture' },
      },
    },
    {
      path: 'regions/fixture/networks/fixture.json',
      json: {
        id: 'fixture',
        roads: ['road'],
        junctions: [],
        type: 'road-network',
        region: 'fixture',
        crs: { kind: 'tmerc', originLatDeg: 0, originLonDeg: 0 },
        ...(withTerrain ? { terrain } : {}),
      },
    },
    {
      path: 'regions/fixture/roads/road.json',
      json: {
        id: 'road',
        type: 'road',
        network: 'fixture',
        from: 'start',
        to: 'finish',
        lengthM: 100,
        sampleSpacingM: 10,
        laneSections: [
          { s0: 0, lanes: [{ id: 'lane', dCenterM: 0, widthM: 4, direction: 1, kind: 'drive' }] },
        ],
        samples: {
          encoding: 'json-columns',
          columns: ['x', 'y', 'z', 'kappa', 'grade', 'bankRad'],
          data: Object.fromEntries(
            ['x', 'y', 'z', 'kappa', 'grade', 'bankRad'].map((column) => [
              column,
              Array.from({ length: 11 }, (_, i) => (column === 'z' ? -i * 10 : 0)),
            ]),
          ),
        },
      },
    },
    {
      path: 'regions/fixture/routes/route.json',
      json: {
        type: 'route',
        id: 'route',
        network: 'fixture',
        start: { road: 'road', s: 0, dir: 1 },
        finish: { road: 'road', s: 100 },
        mainPath: ['road'],
        allowedRoads: ['road'],
        closed: false,
      },
    },
  ]);
}

describe('terrain through the application region stream', () => {
  it('keeps the frozen physical source shared by simulation, camera and rendering', () => {
    const reg = registry(true);
    const stream = streamForRoute(reg, 'fixture:route');
    const source = lookup(reg.networks, 'fixture:fixture').terrain;
    expect(source).toStrictEqual(terrain);
    expect(stream.road.terrain).toBe(source);
    expect(Object.isFrozen(source?.patches[0]?.vertices[0])).toBe(true);
    expect(stream.road.terrain?.patches[0]?.vertices[1]?.[1]).toBe(3.1);
    stream.update([{ x: 1e6, z: -1e6 }]);
    expect(stream.road.terrain).toBe(source);
    expect(stream.isReady()).toBe(true);
  });

  it('keeps omitted coverage absent through the same application path', () => {
    const stream = streamForRoute(registry(false), 'fixture:route');
    expect(stream.road).not.toHaveProperty('terrain');
    expect(stream.road.terrain).toBeUndefined();
    expect(streamForRoute(registry(true), 'fixture:route').road.terrain).toStrictEqual(terrain);
  });
});
