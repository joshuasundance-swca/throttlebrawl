// The Keys' sea in colour bands (playtest 4, P4-19; the identity study's S4: "Pale turquoise over sand,
// dark seagrass patches and deep-blue channels"; the sea was one flat colour). The rules this file asks,
// whatever the numbers are: a network with water beside its roads in the tropics draws its sea as vertex
// colours, any other keeps the one plane; the sea is deepest under a raised deck (a channel), shallowest
// beside land, and in between over open water, all read from the baked road and the distance from land;
// the deep is bluer and darker than the shallows, which carry seeded patches of seagrass and sand that
// the channel does not; the mesh keeps its triangles, its extent and its faces up as the camera moves,
// each vertex holding the colour the plan gives there; and a look's palette still recolours it. Each
// rule has a control: the same check with the cause taken away fails.
import { Color, Scene, type BufferAttribute, type Mesh, type MeshLambertMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { CLASSIC_PALETTE, createFlatLook, type MaterialKind } from './look';
import { createLookSet } from './looks';
import { buildRoadScene, type RoadDressing } from './road-mesh';
import { SEA_BANDS, SeaBands, seaDepthAt, seaPlanFor, seaTintAt, type SeaPlan } from './sea-bands';
import type { SideTag } from './scenery';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

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

function planOf(id: string): { road: RoadNetwork; dressing: RoadDressing; plan: SeaPlan } {
  const t = track(id);
  const plan = seaPlanFor(t.road, (e) => t.dressing[e.id]?.tags);
  if (!plan) throw new Error(`no sea plan for ${id}`);
  return { ...t, plan };
}

const waterMeshes = (group: { traverse(f: (o: unknown) => void): void }): Mesh[] => {
  const out: Mesh[] = [];
  group.traverse((o) => {
    if ((o as Mesh).isMesh && (o as Mesh).name === 'road-water') out.push(o as Mesh);
  });
  return out;
};

/** The luminance of a tint (a linear-light weighting of its three channels). */
const luma = (t: readonly number[]) => 0.2126 * (t[0] ?? 0) + 0.7152 * (t[1] ?? 0) + 0.0722 * (t[2] ?? 0);

describe('only a tropical network with water beside its roads draws the sea in bands', () => {
  it('bands the Seven Mile`s sea, and keeps Duval`s (no water tag) and San Francisco`s (not tropical) to one plane', () => {
    const sevenMile = track('osm-keys-seven-mile');
    const banded = buildRoadScene(sevenMile.road, look, sevenMile.dressing, { seed: 1 });
    const seas = waterMeshes(banded.group);
    expect(seas).toHaveLength(1);
    expect(seas[0]?.geometry.getAttribute('color'), 'vertex colours').toBeDefined();
    const duval = track('osm-keys-duval');
    expect(
      seaPlanFor(duval.road, (e) => duval.dressing[e.id]?.tags as readonly SideTag[] | undefined),
      'no plan for a street with no water',
    ).toBeNull();
    for (const id of ['osm-keys-duval', 'osm-sf-golden-gate']) {
      const t = track(id);
      const scene = buildRoadScene(t.road, look, t.dressing, { seed: 1 });
      const plain = waterMeshes(scene.group);
      expect(plain, id).toHaveLength(1);
      expect(plain[0]?.geometry.getAttribute('color'), `${id}: one flat colour`).toBeUndefined();
      expect(plain[0]?.geometry.getAttribute('position').count, `${id}: a plane's four corners`).toBe(4);
      scene.dispose();
    }
    print(
      `the Seven Mile's sea: ${seas[0]?.geometry.getAttribute('position').count} vertices, ${banded.stats.triangles} triangles in the scene`,
    );
    banded.dispose();
  });
});

describe('the sea is deepest under a raised deck, shallowest beside land, and between over open water', () => {
  const { road, plan } = planOf('osm-keys-seven-mile');
  const bridge = road.edges[road.edgeIndex('osm-sm-bridge')];
  if (!bridge) throw new Error('no osm-sm-bridge');
  /** The highest sample of the highway's bridge: the hump over Moser Channel. */
  let top = { s: 0, y: -Infinity };
  /** The sample of the bridge farthest from land, on the low deck. */
  let farthest = { s: 0, from: 0 };
  for (let s = 0; s <= bridge.length; s += 20) {
    const p = road.toWorld(bridge.index, s, 0, 0);
    if (p.y > top.y) top = { s, y: p.y };
    if (p.y < SEA_BANDS.channelFromM) {
      const from = Math.min(...plan.land.map((a) => Math.hypot(a.x - p.x, a.z - p.z)));
      if (from > farthest.from) farthest = { s, from };
    }
  }
  const at = (s: number, d: number) => road.toWorld(bridge.index, s, d, 0);
  const depth = (s: number, d: number) => {
    const p = at(s, d);
    return seaDepthAt(plan, p.x, p.z);
  };

  it('is deep under the hump and across it, and shallow beside the land the road ends on', () => {
    print(
      `hump ${top.y.toFixed(1)} m at s ${top.s}; the low deck is ${farthest.from.toFixed(0)} m from land at s ${farthest.s}`,
    );
    expect(top.y, 'the bridge is raised for boats').toBeGreaterThan(SEA_BANDS.channelFullM);
    expect(depth(top.s, 0), 'under the hump').toBeGreaterThan(0.9);
    expect(depth(top.s, 200), 'the channel runs across the road, a long way each side').toBeGreaterThan(0.5);
    expect(depth(top.s, -200)).toBeGreaterThan(0.5);
    expect(depth(top.s, 700), 'and ends').toBeLessThan(0.5);
    const p0 = road.toWorld(bridge.index, 0, 0, 0);
    expect(seaDepthAt(plan, p0.x, p0.z), 'where the bridge meets its key').toBeLessThan(0.05);
    // The control: take the raised deck out of the plan and the hump is no deeper than open water.
    const flat: SeaPlan = { ...plan, deck: [] };
    const q = at(top.s, 0);
    expect(seaDepthAt(flat, q.x, q.z), 'without the deck there is no channel').toBeLessThan(0.5);
  });

  it('is a little deeper over open water, far from any land, than over the flats, and not as deep as the channel', () => {
    const open = depth(farthest.s, 0);
    const flats = depth(0, 0);
    const channel = depth(top.s, 0);
    print(
      `flats ${flats.toFixed(2)}, open water ${open.toFixed(2)} (${farthest.from.toFixed(0)} m from land), channel ${channel.toFixed(2)}`,
    );
    expect(farthest.from, 'a stretch of the bridge is far from land').toBeGreaterThan(SEA_BANDS.openFromM);
    expect(open).toBeGreaterThan(flats + 0.1);
    expect(open).toBeLessThan(channel - 0.3);
    // The control: with the land taken out of the plan, no point is near land, so the flats are open water too.
    const noLand: SeaPlan = { ...plan, land: [] };
    const q = at(0, 0);
    expect(seaDepthAt(noLand, q.x, q.z), 'no land to be near').toBeGreaterThan(flats + 0.1);
  });

  it('reads the flats from a sandbar`s `water-shallow` side as land (the bake`s own word for them)', () => {
    const m1 = planOf('keys-m1');
    const flatsRoad = m1.road.edges[m1.road.edgeIndex('m1-tarpon-flats')];
    expect(flatsRoad, 'a road tagged water-shallow').toBeDefined();
    if (!flatsRoad) return;
    const p = m1.road.toWorld(flatsRoad.index, flatsRoad.length / 2, 0, 0);
    expect(seaDepthAt(m1.plan, p.x, p.z), 'beside the flats').toBeLessThan(0.05);
  });
});

describe('the deep is bluer and darker than the shallows, which carry seeded patches the channel does not', () => {
  const { road, plan } = planOf('osm-keys-seven-mile');
  const bridge = road.edges[road.edgeIndex('osm-sm-bridge')];
  if (!bridge) throw new Error('no osm-sm-bridge');
  let top = { s: 0, y: -Infinity };
  for (let s = 0; s <= bridge.length; s += 20) {
    const y = road.toWorld(bridge.index, s, 0, 0).y;
    if (y > top.y) top = { s, y };
  }
  const hump = road.toWorld(bridge.index, top.s, 0, 0);
  const keyEnd = road.toWorld(bridge.index, 0, 0, 0);

  it('turns the water deeper and bluer under the hump', () => {
    const base = new Color('#19b5b0');
    const colourOf = (t: readonly [number, number, number]) =>
      new Color(base.r * t[0], base.g * t[1], base.b * t[2]);
    const shallow = colourOf(seaTintAt(plan, keyEnd.x, keyEnd.z, 99));
    const deep = colourOf(seaTintAt(plan, hump.x, hump.z, 1));
    print(`deep ${deep.getHexString()} over shallows ${shallow.getHexString()}`);
    expect(luma([deep.r, deep.g, deep.b]), 'darker than the shallows').toBeLessThan(
      luma([shallow.r, shallow.g, shallow.b]),
    );
    expect(deep.b, 'blue over green: a deep blue').toBeGreaterThan(deep.g);
    expect(base.g, 'where the shallows are green over blue: a turquoise').toBeGreaterThan(base.b);
    expect(deep.r, 'and no red in either').toBeLessThan(deep.b / 4);
  });

  it('paints seagrass darker and sand paler over the flats, from the seed, and not at all in the channel', () => {
    const samples = (seed: number) => {
      const out: (readonly [number, number, number])[] = [];
      for (let k = 0; k < 400; k++) {
        // The flats around the key at the bridge's start: a field of points 60 to 600 m out.
        const a = (k * 2.399963) % (2 * Math.PI);
        const r = 60 + ((k * 37) % 540);
        out.push(seaTintAt(plan, keyEnd.x + Math.cos(a) * r, keyEnd.z + Math.sin(a) * r, seed));
      }
      return out;
    };
    const one = samples(1);
    const darkest = Math.min(...one.map(luma));
    const palest = Math.max(...one.map(luma));
    print(`flats' tints over 400 points: luma ${darkest.toFixed(2)} to ${palest.toFixed(2)}`);
    expect(darkest, 'seagrass patches').toBeLessThan(0.9);
    expect(palest, 'sand patches').toBeGreaterThan(1.03);
    expect(samples(1), 'the same seed lays the same patches').toEqual(one);
    expect(samples(2), 'another seed lays others').not.toEqual(one);
    // The channel is the same whatever the seed: its blue is not patchy.
    expect(seaTintAt(plan, hump.x, hump.z, 1)).toEqual(seaTintAt(plan, hump.x, hump.z, 2));
  });
});

describe('the sea mesh keeps its size and its extent, holds the plan`s colours and follows the camera', () => {
  const { road, plan } = planOf('osm-keys-seven-mile');
  const first = road.edges[0];
  if (!first) throw new Error('no edge');
  const start = road.toWorld(first.index, 0, 0, 0);
  const extent = { x: start.x, z: start.z, halfX: 20000, halfZ: 20000 };
  const sea = new SeaBands(plan, look, 3, extent, start);
  const pos = () => sea.mesh.geometry.getAttribute('position') as BufferAttribute;
  const col = () => sea.mesh.geometry.getAttribute('color') as BufferAttribute;

  it('is one mesh named for the sea, of 2,400 triangles or fewer, over the old plane`s extent', () => {
    expect(sea.mesh.name).toBe('road-water');
    expect(sea.triangles).toBeLessThanOrEqual(2400);
    const xs = Array.from({ length: pos().count }, (_, i) => pos().getX(i));
    const zs = Array.from({ length: pos().count }, (_, i) => pos().getZ(i));
    expect(Math.min(...xs)).toBeCloseTo(extent.x - extent.halfX, 1);
    expect(Math.max(...xs)).toBeCloseTo(extent.x + extent.halfX, 1);
    expect(Math.min(...zs)).toBeCloseTo(extent.z - extent.halfZ, 1);
    expect(Math.max(...zs)).toBeCloseTo(extent.z + extent.halfZ, 1);
    expect(
      Math.max(...Array.from({ length: pos().count }, (_, i) => Math.abs(pos().getY(i)))),
      'at sea level',
    ).toBe(0);
  });

  it('faces up, every triangle (seen from above the sea is drawn, not culled)', () => {
    const index = sea.mesh.geometry.getIndex();
    if (!index) throw new Error('no index');
    let down = 0;
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      const ux = pos().getX(b) - pos().getX(a);
      const uz = pos().getZ(b) - pos().getZ(a);
      const vx = pos().getX(c) - pos().getX(a);
      const vz = pos().getZ(c) - pos().getZ(a);
      // (b - a) x (c - a), the y component: positive faces up.
      if (uz * vx - ux * vz <= 0) down++;
    }
    expect(down, 'triangles facing down').toBe(0);
  });

  it('holds, at every vertex, the colour the plan gives there, and re-lays itself about a far camera', () => {
    const check = (): number => {
      let worst = 0;
      for (let i = 0; i < pos().count; i += 7) {
        const t = seaTintAt(plan, pos().getX(i), pos().getZ(i), 3);
        for (let k = 0; k < 3; k++)
          worst = Math.max(
            worst,
            Math.abs((k === 0 ? col().getX(i) : k === 1 ? col().getY(i) : col().getZ(i)) - (t[k] ?? 0)),
          );
      }
      return worst;
    };
    expect(check()).toBeLessThan(1e-5);
    const far = road.toWorld(first.index, first.length, 0, 0);
    // A camera standing at the middle of a square, a kilometre from where the sea was laid.
    const cx = Math.round((far.x + 1000) / SEA_BANDS.cellM) * SEA_BANDS.cellM;
    const cz = Math.round((far.z + 1000) / SEA_BANDS.cellM) * SEA_BANDS.cellM;
    sea.update(cx, cz);
    const near = Array.from({ length: pos().count }, (_, i) =>
      Math.hypot(pos().getX(i) - cx, pos().getZ(i) - cz),
    );
    expect(Math.min(...near), 'fine squares about the camera').toBeLessThan(1);
    expect(check()).toBeLessThan(1e-5);
    // Within one square nothing is re-laid (a colour never swims with the camera).
    const before = Float32Array.from(pos().array as Float32Array);
    sea.update(cx + SEA_BANDS.cellM * 0.4, cz - SEA_BANDS.cellM * 0.4);
    expect(Float32Array.from(pos().array as Float32Array)).toEqual(before);
    // A square on, it is.
    sea.update(cx + SEA_BANDS.cellM * 1.2, cz);
    expect(Float32Array.from(pos().array as Float32Array)).not.toEqual(before);
    sea.mesh.geometry.dispose();
  });
});

describe('a look`s palette still recolours the banded sea', () => {
  const water: MaterialKind = 'water';
  const colourOf = (m: unknown) => `#${(m as MeshLambertMaterial).color.getHexString()}`;

  it('multiplies the region`s water colour, where a plain vertex-coloured sea would ignore it (the control)', () => {
    const set = createLookSet(createFlatLook());
    const banded = set.material(water, { vertexColors: true, paletteBase: true });
    const plain = set.material(water, { vertexColors: true });
    set.select('kodak');
    set.setupScene(new Scene(), { timeOfDay: 'noon', palette: { water: '#336699' } });
    expect(colourOf(banded), 'the region`s water').toBe('#336699');
    expect(colourOf(plain), 'a plain vertex-coloured material keeps its white').toBe('#ffffff');
    // And with no region colour, the look's own sea: not white.
    const other = createLookSet(createFlatLook());
    const b2 = other.material(water, { vertexColors: true, paletteBase: true });
    other.select('kodak');
    other.setupScene(new Scene(), { timeOfDay: 'noon' });
    expect(colourOf(b2)).not.toBe('#ffffff');
    expect(new Color(colourOf(b2)).getHex()).toBe(new Color(colourOf(other.material(water))).getHex());
  });
});

// Playtest 4, run B's fix check (punch item 5): "Smathers' inland salt ponds are the sea's colour. At s 1988 the
// road reads as water on both sides." A pond is a `salt-pond` span of a side (over its `water-shallow`, which is why
// nothing stands in it): the sea's mesh paints it brackish, paler and greener than any of the sea's bands, with a
// mud edge by the road and at its ends. What is asked: at the pond the sea side and the pond side read as two
// different colours, for any look of the sea (shallows, a sand patch, a seagrass patch, the deep); the pond's
// edge is mud (darker, browner); and the pond is where its tag is and nowhere else (control: without the tag the
// same spot is sea).
const BASE_WATER = new Color(CLASSIC_PALETTE.water);

/** CIE L*a*b* of a tint over the water colour (the sea's colour at a point), D65, clamped to what a screen shows. */
function labOf(tint: readonly number[]): [number, number, number] {
  const lin = [0, 1, 2].map((k) =>
    Math.min(1, Math.max(0, [BASE_WATER.r, BASE_WATER.g, BASE_WATER.b][k]! * (tint[k] ?? 1))),
  );
  const [r, g, b] = lin as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

describe('Smathers` salt ponds are not the sea`s colour (run B fix check, punch item 5)', () => {
  const KW = 'osm-keys-key-west';
  const BEACH = 'osm-kw-smathers-beach';
  const POND_S = 2025;
  const planKW = (without = false) => {
    const t = track(KW);
    const dressing = without
      ? ({
          ...t.dressing,
          [BEACH]: {
            ...(t.dressing[BEACH] as unknown as BakedRoad),
            tags: ((t.dressing[BEACH] as unknown as BakedRoad).tags as readonly SideTag[]).filter(
              (x) => x.tag !== 'salt-pond',
            ),
          },
        } as unknown as RoadDressing)
      : t.dressing;
    const plan = seaPlanFor(t.road, (e) => dressing[e.id]?.tags);
    if (!plan) throw new Error('no plan');
    const edge = t.road.edges[t.road.edgeIndex(BEACH)]!;
    const half = Math.max(-edge.dMin, edge.dMax);
    /** The sea's tint at a spot `across` m past the road's edge, on a side (+1 right: inland), at s. */
    const at = (s: number, side: -1 | 1, across: number, seed = 1) => {
      const p = t.road.toWorld(edge.index, s, side * (half + 0.6 + across), 0);
      return seaTintAt(plan, p.x, p.z, seed);
    };
    return { plan, at };
  };

  /** Every colour the sea shows near and far from the Smathers road: shallows, sand and seagrass patches, open water. */
  function seaColours(): (readonly number[])[] {
    const { at } = planKW();
    const out: (readonly number[])[] = [];
    for (const seed of [1, 2, 3, 4, 5])
      for (let s = 100; s <= 4600; s += 150)
        for (const across of [60, 150, 300, 600, 1200]) out.push(at(s, -1, across, seed));
    // The deep channel, from the Seven Mile's high deck.
    const sm = planOf('osm-keys-seven-mile');
    const e = sm.road.edges.find((x) => x.id === 'osm-sm-bridge')!;
    for (let s = 0; s < e.length; s += 250) {
      const p = sm.road.toWorld(e.index, s, 12, 0);
      for (const seed of [1, 2]) out.push(seaTintAt(sm.plan, p.x, p.z, seed));
    }
    return out;
  }

  it('paints the pond a brackish colour no band of the sea comes near (at least 25 on the Lab scale)', () => {
    const { at } = planKW();
    const pond = labOf(at(POND_S, 1, 45));
    const sea = seaColours().map(labOf);
    const nearest = Math.min(...sea.map((c) => deltaE(c, pond)));
    print(
      `the pond at s ${POND_S}, 45 m in: Lab ${pond.map((v) => v.toFixed(0)).join(', ')}; the nearest of ${sea.length} sea colours is ${nearest.toFixed(0)} away`,
    );
    expect(nearest).toBeGreaterThanOrEqual(25);
  });

  it('the measure can tell: with the salt-pond tag taken off, the same spot is a colour of the sea (control)', () => {
    const { at } = planKW(true);
    const spot = labOf(at(POND_S, 1, 45));
    const sea = seaColours().map(labOf);
    expect(Math.min(...sea.map((c) => deltaE(c, spot)))).toBeLessThan(25);
  });

  it('has a mud edge: by the road, and at the pond`s end, darker than its middle', () => {
    const { at } = planKW();
    const middle = labOf(at(POND_S, 1, 45));
    const byRoad = labOf(at(POND_S, 1, 1));
    const atEnd = labOf(at(1700 + 2, 1, 45));
    expect(byRoad[0], 'darker by the road').toBeLessThan(middle[0] - 5);
    expect(atEnd[0], 'darker at the end').toBeLessThan(middle[0] - 5);
  });

  it('is on the inland side of the tagged spans only', () => {
    const { at } = planKW();
    const pond = labOf(at(POND_S, 1, 45));
    const sea = seaColours().map(labOf);
    // The sea side of the same stretch, and the inland side where no pond is tagged (s 1400, s 2600): the sea's.
    for (const [s, side] of [
      [POND_S, -1],
      [1400, 1],
      [2600, 1],
    ] as const)
      expect(
        Math.min(...sea.map((c) => deltaE(c, labOf(at(s, side, 45))))),
        `s ${s}, side ${side}`,
      ).toBeLessThan(25);
    expect(deltaE(labOf(at(POND_S, -1, 45)), pond)).toBeGreaterThan(25);
  });
});
