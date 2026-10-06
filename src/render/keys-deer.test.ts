// Key deer on Big Pine (playtest 4, P4-19, run B task B5; the identity sheets' B2: "Big Pine Key: Key deer,
// tiny white-tailed deer, with lowered speed limits and warning signs"). CX5's two deer (a buck and a doe in
// `models/scenery/keys-identity`) graze the verges of Big Pine Bend, the last road of the Bahia Honda run,
// after an invented deer-crossing sign, and nowhere else in the Keys. The checks build the real Keys networks
// from their road files and scatter the real kit with the real model, each rule with a control:
// - the deer kit loads for the network whose road carries the `key-deer` tag, and for no other Keys network but
//   Old Town's and those with open water, which draw their trees, bars and osprey posts from the same kit;
// - the deer stand on Big Pine Bend only, on both sides, past the sign, off the road, a few to a dozen a race;
// - with the tag taken off the road, or the model not loaded, or on another Keys network, none stand;
// - the sign is a board slot on that road, its words an invented deadpan sign in the region file, before them;
// - they draw in the road's own roadside stretches: no stretch and no mesh is added.
import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { modelKindsFor } from './models';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import { KEYS_KIT, RoadsideLayer, scatterRoadside, type RoadsideInput, type RoadsideItem } from './roadside';
import type { SideTag } from './scenery';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
  eager: true,
  import: 'default',
});
interface Sign {
  id: string;
  text: string;
  tags?: string[];
  status: string;
}
const region = Object.values(
  import.meta.glob<{ signs: Sign[] }>('../../packs/base/regions/florida-keys/region.json', {
    eager: true,
    import: 'default',
  }),
)[0]!;

const BAHIA = 'osm-keys-bahia-honda';
const BEND = 'osm-big-pine-bend';
const SIGN = 'key-deer-crossing';
const KEYS_NETWORKS = ['keys-m1', BAHIA, 'osm-keys-key-west', 'osm-keys-duval', 'osm-keys-seven-mile'];

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

const keysRoadside = await bakeRepoModel('keysRoadside');
const keysIdentity = await bakeRepoModel('keysIdentity');

/** The real kit scattered on a network, with the deer model loaded unless `models` says otherwise. */
function scene(
  id: string,
  seed: number,
  opts: { models?: RoadsideInput['models']; dressing?: RoadDressing } = {},
) {
  const { road, dressing: own } = track(id);
  const dressing = opts.dressing ?? own;
  const built = buildRoadScene(road, look, dressing, { seed });
  const input: RoadsideInput = {
    road,
    dressing,
    seed,
    density: 1,
    kit: KEYS_KIT,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
    models: opts.models ?? { keysRoadside, keysIdentity },
  };
  return { road, dressing, built, input };
}

const deerOf = (items: readonly RoadsideItem[]) => items.filter((it) => it.rule === 'key-deer');
const SEEDS = [1, 7, 42, 99];
const bend = (dressing: RoadDressing) => dressing[BEND] as unknown as BakedRoad;
const sign = (dressing: RoadDressing) =>
  (bend(dressing).features ?? []).find((f) => f.kind === 'billboard' && f.item === SIGN);

describe('the Key deer kit', () => {
  it("loads for the network whose road carries the key-deer tag, and otherwise only for Old Town's and open water's", () => {
    const wants: string[] = [];
    for (const id of KEYS_NETWORKS) {
      const { road, dressing } = track(id);
      const { tropical, tags } = networkTags(road, dressing);
      const kinds = modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
      if (kinds.includes('keysIdentity')) wants.push(id);
      expect(tags.has('key-deer'), id).toBe(id === BAHIA);
      // The same kit holds Old Town's trees and open bars (Duval, P4-16) and the osprey's nesting post
      // (CX6, on the shores of open water): a network with either loads it for them, never for deer.
      if (kinds.includes('keysIdentity') && id !== BAHIA)
        expect(tags.has('key-oldtown') || tags.has('water-open'), id).toBe(true);
    }
    print(
      `[examined] the identity kit loads for ${wants.join(', ')} of ${KEYS_NETWORKS.length} Keys networks`,
    );
    expect(wants).toContain(BAHIA);
  });

  it('is the two deer of CX5 (a buck and a doe), small, with no antler a metre wide', () => {
    // Variants 0 and 1 of the identity kit (models.ts); the rest are the mile post and Old Town's.
    expect(keysIdentity.variants.length).toBeGreaterThanOrEqual(2);
    const [buck, doe] = keysIdentity.variants.slice(0, 2).map((g) => {
      g.computeBoundingBox();
      return g.boundingBox!;
    });
    print(
      `[examined] buck ${(buck!.max.y - buck!.min.y).toFixed(2)} m tall, doe ${(doe!.max.y - doe!.min.y).toFixed(2)} m tall`,
    );
    expect(buck!.max.y - buck!.min.y).toBeLessThan(1.6);
    expect(doe!.max.y - doe!.min.y).toBeLessThan(0.9);
    expect(buck!.max.x - buck!.min.x).toBeLessThan(1);
  });
});

describe.each(SEEDS)('Big Pine Bend, seed %i', (seed) => {
  const { road, dressing, input } = scene(BAHIA, seed);
  const items = scatterRoadside(input);
  const deer = deerOf(items);

  it('stands a few deer past the sign, off the road, and on Big Pine Bend only', () => {
    const e = road.edges[road.edgeIndex(BEND)]!;
    const slot = sign(dressing)!;
    const half = Math.max(-e.dMin, e.dMax);
    print(
      `[examined] ${BAHIA} seed ${seed}: ${deer.length} deer (s ${deer.map((d) => d.s.toFixed(0)).join(', ')}); sign at s ${slot.s0} to ${slot.s1}; road ${e.length.toFixed(0)} m, half-width ${half.toFixed(1)} m`,
    );
    expect(deer.length).toBeGreaterThanOrEqual(4);
    expect(deer.length).toBeLessThanOrEqual(14);
    for (const d of deer) {
      expect(road.edges[d.edge]!.id, 'the deer stand on Big Pine Bend only').toBe(BEND);
      expect(d.s, 'after the sign').toBeGreaterThan(slot.s1);
      // Off the road: past the drawn road and its shoulders, never on the lanes.
      expect(Math.abs(d.d), `deer at s ${d.s.toFixed(0)}`).toBeGreaterThan(half);
      expect([0, 1]).toContain(d.variant);
    }
  });

  it('is only the one rule: everything else of the kit is where it was', () => {
    const others = items.filter((it) => it.rule !== 'key-deer');
    expect(others.length).toBeGreaterThan(50);
  });
});

describe('the deer need the tag, the model and the road', () => {
  it('stand on both sides of the road over the seeds', () => {
    const sides = new Set<number>();
    for (const seed of SEEDS)
      for (const d of deerOf(scatterRoadside(scene(BAHIA, seed).input))) sides.add(Math.sign(d.d));
    expect([...sides].sort()).toEqual([-1, 1]);
  });

  it('stand none when the road has no key-deer tag (control)', () => {
    const { dressing } = track(BAHIA);
    const stripped = {
      ...dressing,
      [BEND]: {
        ...bend(dressing),
        tags: (bend(dressing).tags as readonly SideTag[]).filter((t) => t.tag !== 'key-deer'),
      },
    } as unknown as RoadDressing;
    expect((bend(stripped).tags as readonly SideTag[]).some((t) => t.tag === 'mangrove')).toBe(true);
    const placed = deerOf(scatterRoadside(scene(BAHIA, 7, { dressing: stripped }).input));
    const control = deerOf(scatterRoadside(scene(BAHIA, 7).input));
    expect(control.length).toBeGreaterThan(0);
    expect(placed).toEqual([]);
  });

  it('stand none when the deer model has not loaded (a rule whose model is missing places nothing)', () => {
    const placed = deerOf(scatterRoadside(scene(BAHIA, 7, { models: { keysRoadside } }).input));
    expect(placed).toEqual([]);
  });

  it('stand none on any other Keys network, with the model loaded', () => {
    for (const id of ['keys-m1', 'osm-keys-key-west', 'osm-keys-duval', 'osm-keys-seven-mile']) {
      const items = scatterRoadside(scene(id, 7).input);
      expect(items.length, id).toBeGreaterThan(50);
      expect(deerOf(items), id).toEqual([]);
    }
  });
});

describe('the sign', () => {
  it('is a board slot on Big Pine Bend, right at its start, naming an invented sign of the region', () => {
    const { dressing, road } = track(BAHIA);
    const slot = sign(dressing);
    expect(slot, 'the slot').toBeDefined();
    const e = road.edges[road.edgeIndex(BEND)]!;
    // On the right edge, past the shoulder, before any deer can stand (the rule starts 40 m in).
    expect(slot!.d0).toBeGreaterThan(e.dMax);
    expect(slot!.s1).toBeLessThan(40);
    expect(slot!.s0).toBeGreaterThanOrEqual(0);
    const item = region.signs.find((s) => s.id === SIGN);
    expect(item, 'the region sign').toBeDefined();
    expect(item!.status).toBe('live');
    // Pooled nowhere else: a `site` sign is only ever placed by the slot that names it.
    expect(item!.tags).toContain('site');
    expect(item!.text).toMatch(/^KEY DEER CROSSING\. \S/);
    print(
      `[examined] the sign: "${item!.text}", slot s ${slot!.s0} to ${slot!.s1}, d ${slot!.d0} to ${slot!.d1}`,
    );
  });

  it('stands on no other road of the Keys', () => {
    const users = Object.values(roadFiles)
      .filter((r) => (r.features ?? []).some((f) => f.kind === 'billboard' && f.item === SIGN))
      .map((r) => r.id);
    expect(users).toEqual([BEND]);
  });
});

describe('drawing the deer', () => {
  it('rides the roadside stretches: the same stretches and meshes with them as without, a few hundred more triangles', () => {
    const run = (models: RoadsideInput['models']) => {
      const { input, road } = scene(BAHIA, 7, { models });
      const layer = new RoadsideLayer(keysRoadside, look, input);
      while (!layer.ready) layer.update(1e9, 1e9, 360);
      const e = road.edges[road.edgeIndex(BEND)]!;
      for (let s = 0; s < e.length; s += 40) {
        const p = road.toWorld(e.index, s, 0, 0);
        for (let k = 0; k < 4; k++) layer.update(p.x, p.z, 360);
      }
      const meshes = layer.group.children.filter((o): o is Mesh => o instanceof Mesh);
      const tris = meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0);
      return { chunks: layer.counts().chunks, meshes: meshes.length, tris, deer: deerOf(layer.items).length };
    };
    const without = run({ keysRoadside });
    const withDeer = run({ keysRoadside, keysIdentity });
    print(
      `[examined] Big Pine Bend, seed 7: ${withDeer.deer} deer; ${withDeer.chunks} stretches and ${withDeer.meshes} meshes with them, ${without.chunks} and ${without.meshes} without; ${withDeer.tris - without.tris} more triangles`,
    );
    expect(without.deer).toBe(0);
    expect(withDeer.deer).toBeGreaterThan(0);
    expect(withDeer.chunks).toBe(without.chunks);
    expect(withDeer.meshes).toBe(without.meshes);
    expect(withDeer.tris - without.tris).toBeGreaterThan(0);
    expect(withDeer.tris - without.tris).toBeLessThan(withDeer.deer * 250);
  });
});
