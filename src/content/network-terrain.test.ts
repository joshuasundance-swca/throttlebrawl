import { describe, expect, it } from 'vitest';
import { GROUND_SURFACES } from '../core';
import { type PackFile } from './parse';
import { preParsePackFile } from './pre-parse';
import { buildRegistry, buildRegistryWith, contentHashes, lookup } from './registry';
import { roadNetworkSchema } from './schema/entries';
import * as prebuilt from './validate-prebuilt';

const patch = () => ({
  surface: 'grass',
  vertices: [
    [0, 2, 0],
    [0, 3.1, 10],
    [10, 4, 0],
  ],
  triangles: [[0, 1, 2]],
});
const terrain = () => ({ patches: [patch()] });
const network = (ground?: unknown) => ({
  id: 'terrain-fixture',
  roads: ['road'],
  junctions: [],
  type: 'road-network',
  region: 'fixture',
  crs: { kind: 'tmerc', originLatDeg: 0, originLonDeg: 0 },
  ...(ground === undefined ? {} : { terrain: ground }),
});

function files(ground: unknown = terrain(), provenance = 'original'): PackFile[] {
  return [
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
      path: 'regions/fixture/networks/terrain-fixture.json',
      json: { ...network(ground), provenance: { source: provenance } },
    },
  ];
}

describe('network terrain contract', () => {
  it('preserves omitted terrain and accepts every existing ground surface plus water', () => {
    const omitted = roadNetworkSchema.parse(network());
    expect(omitted).not.toHaveProperty('terrain');
    for (const surface of [...GROUND_SURFACES, 'water']) {
      const p = patch();
      p.surface = surface;
      if (surface === 'water') p.vertices = p.vertices.map(([x, , z]) => [x ?? 0, 8, z ?? 0]);
      expect(roadNetworkSchema.safeParse(network({ patches: [p] })).success, surface).toBe(true);
    }
  });

  it.each([
    ['not an object', []],
    ['missing patches', {}],
    ['empty patches', { patches: [] }],
    ['missing physical fields', { patches: [{ surface: 'grass' }] }],
    ['unknown surface', { patches: [{ ...patch(), surface: 'lava' }] }],
    [
      'too few vertices',
      {
        patches: [
          {
            ...patch(),
            vertices: [
              [0, 0, 0],
              [0, 0, 1],
            ],
          },
        ],
      },
    ],
    [
      'short vertex',
      {
        patches: [
          {
            ...patch(),
            vertices: [
              [0, 0],
              [0, 0, 1],
              [1, 0, 0],
            ],
          },
        ],
      },
    ],
    [
      'long vertex',
      {
        patches: [
          {
            ...patch(),
            vertices: [
              [0, 0, 0, 1],
              [0, 0, 1],
              [1, 0, 0],
            ],
          },
        ],
      },
    ],
    [
      'infinite vertex',
      {
        patches: [
          {
            ...patch(),
            vertices: [
              [0, Infinity, 0],
              [0, 0, 1],
              [1, 0, 0],
            ],
          },
        ],
      },
    ],
    [
      'Float32 overflow',
      {
        patches: [
          {
            ...patch(),
            vertices: [
              [0, 1e39, 0],
              [0, 0, 1],
              [1, 0, 0],
            ],
          },
        ],
      },
    ],
    ['empty triangles', { patches: [{ ...patch(), triangles: [] }] }],
    ['negative index', { patches: [{ ...patch(), triangles: [[-1, 1, 2]] }] }],
    ['fractional index', { patches: [{ ...patch(), triangles: [[0, 1.5, 2]] }] }],
    ['out of bounds index', { patches: [{ ...patch(), triangles: [[0, 1, 3]] }] }],
    ['repeated index', { patches: [{ ...patch(), triangles: [[0, 0, 2]] }] }],
    ['short triangle', { patches: [{ ...patch(), triangles: [[0, 1]] }] }],
    ['long triangle', { patches: [{ ...patch(), triangles: [[0, 1, 2, 0]] }] }],
    [
      'degenerate face',
      {
        patches: [
          {
            ...patch(),
            vertices: [
              [0, 0, 0],
              [1, 2, 1],
              [2, 4, 2],
            ],
          },
        ],
      },
    ],
    ['reversed face', { patches: [{ ...patch(), triangles: [[0, 2, 1]] }] }],
    [
      'Float32 collapsed face',
      {
        patches: [
          {
            ...patch(),
            vertices: [
              [1e8, 0, 0],
              [1e8, 0, 1],
              [1e8 + 1, 0, 0],
            ],
          },
        ],
      },
    ],
    ['sloped water', { patches: [{ ...patch(), surface: 'water' }] }],
  ])('refuses %s instead of accepting it as an unchecked loose field', (_name, ground) => {
    expect(roadNetworkSchema.safeParse(network(ground)).success).toBe(false);
    expect(roadNetworkSchema.safeParse(network(terrain())).success).toBe(true);
  });

  it('checks water planarity after Float32 rounding, with independent patch levels', () => {
    const water = {
      ...patch(),
      surface: 'water',
      vertices: [
        [0, 8, 0],
        [0, 8 + 1e-8, 10],
        [10, 8, 0],
      ],
    };
    const other = { ...water, vertices: water.vertices.map(([x, , z]) => [x ?? 0, 12, z ?? 0]) };
    expect(roadNetworkSchema.safeParse(network({ patches: [water, other] })).success).toBe(true);
  });

  it('hashes physical geometry and surface but excludes network provenance from the sim hash', () => {
    const base = contentHashes(buildRegistry(files()));
    const changed = terrain();
    changed.patches[0]!.vertices[0]![1] = 5;
    const shape = contentHashes(buildRegistry(files(changed)));
    expect(shape.sim).not.toBe(base.sim);
    expect(shape.full).not.toBe(base.full);
    const material = terrain();
    material.patches[0]!.surface = 'gravel';
    expect(contentHashes(buildRegistry(files(material))).sim).not.toBe(base.sim);
    const provenance = contentHashes(buildRegistry(files(terrain(), 'revised')));
    expect(provenance.sim).toBe(base.sim);
    expect(provenance.full).not.toBe(base.full);
  });

  it('retains exact frozen terrain in both ordinary and prebuilt registries', () => {
    const raw = files();
    const shipped = raw.map((file) => {
      const parsed = preParsePackFile(file.path, file.json);
      if ('findings' in parsed) throw new Error(JSON.stringify(parsed.findings));
      return { path: file.path, json: JSON.parse(JSON.stringify(parsed.data)) as unknown };
    });
    const ordinary = buildRegistry(raw);
    const built = buildRegistryWith(shipped, prebuilt);
    expect(built).toStrictEqual(ordinary);
    expect(contentHashes(built)).toEqual(contentHashes(ordinary));
    for (const registry of [ordinary, built]) {
      const source = lookup(registry.networks, 'terrain-fixture', 'fixture');
      expect(source.terrain).toStrictEqual(terrain());
      expect(Object.isFrozen(source.terrain)).toBe(true);
      expect(Object.isFrozen(source.terrain?.patches[0]?.vertices[0])).toBe(true);
      expect(Object.isFrozen(source.terrain?.patches[0]?.triangles[0])).toBe(true);
    }
  });
});
