// Duval Street's Old Town (playtest 3, T12.1; the wave-B live check's punch list, item 1: "Duval
// Street draws as an empty palm-and-sand highway, with no Old Town shopfronts"). The Duval kit from
// Codex CX2 lines every road side tagged `key-oldtown`: balconied shopfronts, conch houses and the
// corner bar stood end to end on the sidewalk's edge (playtest 4, P4-19: a street, not a palm road),
// facing the road, on the drawn land, clear of the landmarks and of the pedestrian zones' pavement, in
// the Keys' roadside stretches (no new draw call), with
// the region atlas as their one material's map. The buoy and the Mile 0 marker draw where the
// route's landmark features name them.
import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import {
  atlasAsset,
  atlasLayoutAsset,
  atlasTexture,
  decodeAtlasPng,
  parseAtlasLayout,
  withAtlas,
} from './atlas';
import { readGlb } from './glb';
import { GroundTris } from './land-probe.test-util';
import { LandmarkLayer, landmarkPlacements } from './landmarks';
import { createFlatLook } from './look';
import {
  bakeLandmarkKit,
  bakeModel,
  landmarkKitAsset,
  MODEL_ASSETS,
  modelKindsFor,
  type ModelKind,
  type SceneryModel,
} from './models';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import {
  inDistrict,
  KEYS_KIT,
  RoadsideLayer,
  scatterRoadside,
  type RoadsideInput,
  type RoadsideItem,
} from './roadside';
import type { SideTag } from './scenery';

const look = createFlatLook();
/** The examined lines, printed even when the tests pass (console.log is not). */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

async function readRepoFile(rel: string): Promise<ArrayBuffer> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const buf = fs.readFileSync(rel);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const bake = async (kind: ModelKind): Promise<SceneryModel> =>
  bakeModel(kind, readGlb(await readRepoFile(`packs/base/assets/${MODEL_ASSETS[kind]}.glb`)));

const SHEET = 'florida-keys';
const layout = parseAtlasLayout(
  JSON.parse(
    new TextDecoder().decode(await readRepoFile(`packs/base/assets/${atlasLayoutAsset(SHEET)}.json`)),
  ),
);
const texture = atlasTexture(
  await decodeAtlasPng(await readRepoFile(`packs/base/assets/${atlasAsset(SHEET)}.png`)),
);
const keysRoadside = await bake('keysRoadside');
const duvalKit = withAtlas(await bake('duvalKit'), { sheet: SHEET, layout, texture });
const models = { keysRoadside, duvalKit };

const OLDTOWN = ['key-oldtown'];
const SEEDS = [1, 7, 42];
const DUVAL = 'osm-keys-duval';

/** Whether an item is one of the Duval kit's (a rule that draws from it). */
const fromDuval = (it: RoadsideItem) => KEYS_KIT.rules.find((r) => r.id === it.rule)?.model === 'duvalKit';
/** The street front's first row; the second row behind it (`oldtown-back`) has its own checks, duval-city.test.ts. */
const isFront = (it: RoadsideItem) => fromDuval(it) && !!it.foot && it.rule !== 'oldtown-back';

function scene(id: string, seed: number, withModels = true) {
  const { road, dressing } = track(id);
  const built = buildRoadScene(road, look, dressing, { seed });
  const input: RoadsideInput = {
    road,
    dressing,
    seed,
    density: 1,
    kit: KEYS_KIT,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
    ...(withModels ? { models } : {}),
  };
  return { road, dressing, built, input };
}

describe("Old Town's kit", () => {
  it('loads for a network with Old Town on it, and for no other Keys network', () => {
    for (const [id, want] of [
      [DUVAL, true],
      ['keys-m1', false],
      ['osm-keys-seven-mile', false],
    ] as const) {
      const { road, dressing } = track(id);
      const { tropical, tags } = networkTags(road, dressing);
      const kinds = modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
      expect(kinds.includes('duvalKit'), id).toBe(want);
    }
  });
});

describe.each(SEEDS)('Duval Street and Whitehead Street, seed %i', (seed) => {
  const { road, dressing, built, input } = scene(DUVAL, seed);
  const items = scatterRoadside(input);
  const fronts = items.filter(isFront);
  const tagsOf = (edge: number) => dressing[road.edges[edge]!.id]?.tags as readonly SideTag[] | undefined;
  const sideOf = (it: RoadsideItem) => (it.d < 0 ? 'left' : 'right');

  it('lines both sides of every Old Town road with shopfronts and conch houses, end to end', () => {
    let sides = 0;
    for (const e of road.edges) {
      for (const side of [-1, 1] as const) {
        const name = side < 0 ? 'left' : 'right';
        let oldtown = 0;
        for (let s = 1; s < e.length; s += 2)
          if (inDistrict(tagsOf(e.index), name, s, OLDTOWN) && built.landReach(e.index, side, s) >= 20)
            oldtown += 2;
        if (oldtown < 200) continue;
        const covered = fronts
          .filter((it) => it.edge === e.index && Math.sign(it.d) === side)
          .reduce((n, it) => n + 2 * it.foot!.half, 0);
        const share = covered / oldtown;
        print(
          `[examined] seed ${seed} ${e.id} ${name}: ${oldtown} m of Old Town land side, ${(share * 100).toFixed(0)}% built front`,
        );
        expect(share, `${e.id} ${name}`).toBeGreaterThan(0.5);
        sides++;
      }
    }
    expect(sides).toBeGreaterThanOrEqual(4);
    const kinds = new Set(fronts.map((it) => it.variant));
    expect(kinds.size, 'balconies, conch houses and the corner bar').toBeGreaterThanOrEqual(5);
  });

  it('stands only on Old Town sides, facing the road, clear of each other, the zones and the landmarks', () => {
    const bad: string[] = [];
    const keepClear = new Set(['roadsideZone', 'boostPad', 'copSpawn', 'landmark', 'billboard', 'rampTruck']);
    for (const it of items.filter(fromDuval)) {
      if (!inDistrict(tagsOf(it.edge), sideOf(it), it.s, OLDTOWN))
        bad.push(`${it.rule} off Old Town at s ${it.s}`);
    }
    for (const it of fronts) {
      const e = road.edges[it.edge]!;
      const f = it.foot!;
      const sgn = Math.sign(it.d);
      const dFront = it.d - sgn * f.front;
      const dBack = it.d + sgn * f.back;
      const [lo, hi] = [Math.min(dFront, dBack), Math.max(dFront, dBack)];
      // A crowd stands on the pavement under the balcony (playtest 4, P4-19): only the body is in its way.
      const [bodyLo, bodyHi] = [Math.min(it.d, dBack), Math.max(it.d, dBack)];
      // Facing: its +Z turned by `turn` points at the road's centre line.
      const toRoad = road.toWorld(e.index, it.s, 0, 0);
      const fx = Math.sin(it.turn);
      const fz = Math.cos(it.turn);
      const len = Math.hypot(toRoad.x - it.p.x, toRoad.z - it.p.z);
      if ((fx * (toRoad.x - it.p.x) + fz * (toRoad.z - it.p.z)) / len < 0.95)
        bad.push(`${it.rule} at s ${it.s} faces away`);
      for (const ft of dressing[e.id]?.features ?? []) {
        if (!keepClear.has(ft.kind)) continue;
        const overS = it.s + f.half > Math.min(ft.s0, ft.s1) && it.s - f.half < Math.max(ft.s0, ft.s1);
        const [from, to] = ft.kind === 'roadsideZone' ? [bodyLo, bodyHi] : [lo, hi];
        const overD = to > Math.min(ft.d0, ft.d1) && from < Math.max(ft.d0, ft.d1);
        if (overS && overD) bad.push(`${it.rule} at s ${it.s.toFixed(0)} stands in ${ft.kind} ${ft.id}`);
      }
      for (const other of fronts) {
        if (other === it || other.edge !== it.edge || Math.sign(other.d) !== sgn) continue;
        if (Math.abs(other.s - it.s) < other.foot!.half + f.half - 1e-6)
          bad.push(`${it.rule} at s ${it.s.toFixed(0)} overlaps ${other.rule} at s ${other.s.toFixed(0)}`);
      }
    }
    print(
      `[examined] seed ${seed}: ${fronts.length} street-front buildings, ${items.filter(fromDuval).length - fronts.length} planters and scooter racks`,
    );
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('stands every building on the drawn land at its height, corners and back included', () => {
    const ground = new GroundTris(built.group);
    const bad: string[] = [];
    let points = 0;
    for (const it of fronts) {
      const e = road.edges[it.edge]!;
      const f = it.foot!;
      const sgn = Math.sign(it.d);
      for (const u of [-f.half * 0.95, 0, f.half * 0.95])
        for (const dd of [-f.front * 0.95, f.back * 0.95]) {
          const p = road.toWorld(e.index, it.s + u, it.d + sgn * dd, 0);
          points++;
          // Land under the corner, near the building's floor (it neither floats nor sinks).
          const hit = ground.heightAt(p.x, p.z, p.y + 40);
          if (!(hit?.name.startsWith('road-land') && Math.abs(hit.y - it.p.y) < 0.5))
            bad.push(
              `${it.rule} on ${e.id} s ${it.s.toFixed(0)}: ${hit?.name ?? 'sea'} at ${hit?.y.toFixed(2)} vs floor ${it.p.y.toFixed(2)}`,
            );
        }
    }
    print(`[examined] seed ${seed}: ${points} building corner points ray-checked onto drawn land`);
    expect(points).toBeGreaterThan(100);
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe('without Old Town', () => {
  it('places no Duval building on a Keys road with no Old Town, kit loaded or not', () => {
    const { input } = scene('keys-m1', 7);
    const items = scatterRoadside(input);
    expect(items.filter(fromDuval)).toEqual([]);
    expect(items.length).toBeGreaterThan(300);
  });

  it('places no Old Town prop at all when its kits failed to load, and throws nothing', () => {
    // Old Town is a street of its own (playtest 4, P4-19): the Keys kit's beach props do not stand on it,
    // so with the Duval kit and the identity kit missing the street is bare ground, not a palm road.
    const { input } = scene(DUVAL, 7, false);
    const items = scatterRoadside({ ...input, models: { keysRoadside } });
    expect(items).toEqual([]);
  });
});

describe('drawing Old Town', () => {
  it('draws its buildings in the Keys roadside stretches, one mesh each, with the atlas as the map', () => {
    const { input } = scene(DUVAL, 7);
    const layer = new RoadsideLayer(keysRoadside, look, input);
    while (!layer.ready) layer.update(1e9, 1e9, 360);
    const { road } = input;
    let mapped = 0;
    for (const e of road.edges)
      for (let s = 0; s < e.length; s += 50) {
        const p = road.toWorld(e.index, s, 0, 0);
        for (let k = 0; k < 4; k++) layer.update(p.x, p.z, 360);
      }
    const counts = layer.counts();
    const meshes = layer.group.children.filter((o): o is Mesh => o instanceof Mesh);
    expect(meshes.length).toBe(counts.built);
    for (const m of meshes) {
      const material = m.material as { map?: unknown };
      if (material.map) {
        mapped++;
        expect(material.map).toBe(texture);
        expect(m.geometry.getAttribute('uv')?.count).toBe(m.geometry.getAttribute('position').count);
      }
    }
    print(
      `[examined] ${DUVAL} seed 7: ${meshes.length} built stretches, ${mapped} with the atlas map, ${counts.chunks} stretches in all`,
    );
    expect(mapped).toBeGreaterThan(0);
    // A Keys road with no Old Town keeps the plain material.
    const m1 = scene('keys-m1', 7);
    const plain = new RoadsideLayer(keysRoadside, look, m1.input);
    while (!plain.ready) plain.update(1e9, 1e9, 360);
    const e0 = m1.input.road.edges[0]!;
    const p0 = m1.input.road.toWorld(e0.index, 20, 0, 0);
    for (let k = 0; k < 6; k++) plain.update(p0.x, p0.z, 360);
    const built = plain.group.children.filter((o): o is Mesh => o instanceof Mesh);
    expect(built.length).toBeGreaterThan(0);
    for (const m of built) expect((m.material as { map?: unknown }).map ?? null).toBeNull();
  });

  it("draws the buoy and the Mile 0 marker where the route's landmark features name them", async () => {
    const { road } = track(DUVAL);
    const kit = bakeLandmarkKit(
      'keys-landmarks',
      readGlb(await readRepoFile(`packs/base/assets/${landmarkKitAsset('keys-landmarks')}.glb`)),
    );
    const named = landmarkPlacements(road).filter((p) => p.kit === 'keys-landmarks');
    expect(named.map((p) => p.node)).toEqual(expect.arrayContaining(['southernmost_buoy', 'mile_marker_0']));
    // As the layer looks a node up: its own name, else its near form (`cruise_ship` is `cruise_ship_lod0`).
    for (const p of named)
      expect(kit.nodes.has(p.node) || kit.nodes.has(`${p.node}_lod0`), p.node).toBe(true);
    const layer = new LandmarkLayer(new Map([['keys-landmarks', kit]]), look, { road });
    expect(layer.counts()).toMatchObject({ placed: named.length, skipped: 0 });
    print(
      `[examined] ${DUVAL}: ${named.length} keys-landmarks features (${named.map((p) => p.node).join(', ')}), all placed`,
    );
  });
});
