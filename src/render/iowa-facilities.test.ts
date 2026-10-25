import { readFileSync } from 'node:fs';
import { Group } from 'three';
import { expect, it, vi } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../road';
import { IowaFacilitiesLayer, prepareIowaFacilities, iowaFacilitiesReady } from './iowa-facilities';
import { createFlatLook } from './look';
import { createChunkGate } from './chunk-gate';
import { packInputs } from '../../scripts/pack-inputs.mjs';

const root = 'packs/region-clinton/regions/clinton-iowa';
const inputs = packInputs(process.cwd());
const read = <T>(path: string): T => JSON.parse(inputs.materialize(path, readFileSync(path, 'utf8'))) as T;
const roadOf = (id: string) => {
  const network = read<BakedNetwork>(`${root}/networks/${id}.json`);
  return createRoadNetwork({
    network,
    roads: network.roads.map((id) => read<BakedRoad>(`${root}/roads/${id}.json`)),
  });
};

it.each([
  ['osm-clinton-eagle-point', 'iowa-park', 'park'],
  ['osm-clinton-ia136', 'iowa-county-farmstead', 'county'],
] as const)(
  'prepares the actual %s facility and keeps it selectable, visible and disposable',
  async (id, tag, kind) => {
    const road = roadOf(id),
      tags = new Set([tag]);
    const gate = createChunkGate();
    await prepareIowaFacilities(tags, gate.chunk.bind(gate));
    expect(iowaFacilitiesReady(tags)).toBe(true);
    const layer = new IowaFacilitiesLayer(createFlatLook(), { road, seed: 1, tags });
    const parent = new Group();
    parent.add(layer.group);
    try {
      const selected = layer[kind];
      expect(selected).not.toBeNull();
      expect(selected!.counts().placed).toBeGreaterThan(0);
      const first = selected!.views[0]!;
      expect(layer.update(first.mesh.position.x, first.mesh.position.z, 400)).toBeGreaterThan(0);
      expect(layer.visibleContent().some((v) => v.ref === first.ref)).toBe(true);
      layer.hide([first.ref]);
      expect(layer.visibleContent().some((v) => v.ref === first.ref)).toBe(false);
      expect(first.mesh.visible).toBe(true);
    } finally {
      layer.dispose();
    }
    expect(layer.group.parent).toBeNull();
    const unrelated = new IowaFacilitiesLayer(createFlatLook(), { road, seed: 1, tags: new Set() });
    expect(unrelated.park).toBeNull();
    expect(unrelated.county).toBeNull();
    expect(unrelated.update(0, 0, 400)).toBe(0);
    unrelated.dispose();
  },
);

it('constructs an empty facility layer without Three invalid-object errors after plans are prepared', async () => {
  const tags = new Set(['iowa-park']);
  const gate = createChunkGate();
  await prepareIowaFacilities(tags, gate.chunk.bind(gate));
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const layer = new IowaFacilitiesLayer(createFlatLook(), {
    road: roadOf('osm-clinton-eagle-point'),
    seed: 1,
    tags: new Set(),
  });
  try {
    expect(layer.park).toBeNull();
    expect(layer.county).toBeNull();
    expect(layer.visibleContent()).toEqual([]);
    expect(layer.update(0, 0, 400)).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    layer.dispose();
    consoleError.mockRestore();
  }
});

it('keeps a failed layout unavailable and prepares it on a later race without refetching a successful sibling', async () => {
  vi.resetModules();
  const fresh = await import('./iowa-facilities');
  const tags = new Set(['iowa-park', 'iowa-county-farmstead']);
  const attempts: string[] = [];
  let countyUnavailable = true;
  const gate = createChunkGate(async (name, load) => {
    attempts.push(name);
    return name === 'Iowa county layout' && countyUnavailable ? null : load();
  });
  expect(await fresh.prepareIowaFacilities(tags, gate.chunk.bind(gate))).toBe(false);
  expect(fresh.iowaFacilitiesReady(tags)).toBe(false);
  expect(fresh.iowaFacilitiesReady(new Set(['iowa-park']))).toBe(true);
  expect(
    () =>
      new fresh.IowaFacilitiesLayer(createFlatLook(), { road: roadOf('osm-clinton-ia136'), seed: 1, tags }),
  ).toThrow('not prepared');
  countyUnavailable = false;
  gate.raceStart();
  expect(await fresh.prepareIowaFacilities(tags, gate.chunk.bind(gate))).toBe(true);
  expect(attempts.filter((name) => name === 'Iowa park layout')).toHaveLength(1);
  expect(attempts.filter((name) => name === 'Iowa county layout')).toHaveLength(2);
});
