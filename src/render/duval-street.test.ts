// Duval Street is a street (playtest 4, P4-19; the maintainer: "The real roads do not have the
// characteristics of the roads in question in terms of scenery and feel etc"). Key West's Old Town was
// a palm road: `palms` outranked `town` and `key-oldtown` in the theme order and the verge order, so
// Duval and Whitehead had a sand verge, a palm on every candidate spot, bait shacks and a pole line, and
// the shop fronts stood 9 m back behind them. These tests ask for the rules, not the lists: the order
// that puts a street ahead of a beach road, nothing of the beach road's scatter on an Old Town side, the
// fronts on the sidewalk's edge with their balconies over it, the sidewalk's own furniture on the
// sidewalk, the Old Town's trees in the gaps and behind the row, and an open bar among the shops.
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  deriveVerge,
  type BakedNetwork,
  type BakedRoad,
  type BakedTag,
  type RoadNetwork,
} from '../road';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { textSurfaceItemId, type SceneryModel } from './models';
import { buildRoadScene, type RoadDressing } from './road-mesh';
import {
  inDistrict,
  KEYS_KIT,
  RoadsideLayer,
  scatterRoadside,
  type RoadsideInput,
  type RoadsideItem,
} from './roadside';
import { themeAt, type SideTag } from './scenery';

const look = createFlatLook();
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
const regionFiles = import.meta.glob<{ signs?: { id: string; text: string; tags?: string[] }[] }>(
  '../../packs/base/regions/florida-keys/region.json',
  { eager: true, import: 'default' },
);
const keysSigns = Object.values(regionFiles)[0]?.signs ?? [];

function track(id: string): { road: RoadNetwork; dressing: RoadDressing; roads: BakedRoad[] } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing, roads };
}

const keysRoadside: SceneryModel = await bakeRepoModel('keysRoadside');
const duvalKit: SceneryModel = await bakeRepoModel('duvalKit');
const keysIdentity: SceneryModel = await bakeRepoModel('keysIdentity');
const models = { keysRoadside, duvalKit, keysIdentity };

const DUVAL = 'osm-keys-duval';
const OLDTOWN = ['key-oldtown'];
const SEEDS = [1, 7, 42];
const tag = (name: string): BakedTag => ({ s0: 0, s1: 100, tag: name, side: 'both' });

describe("a street is ahead of a beach road in the theme order and the verge order, and Old Town's is ahead of both", () => {
  const street = [tag('town'), tag('palms'), tag('conch-houses'), tag('key-oldtown')];

  it('names Old Town its own theme ahead of the town and the palms, and the town ahead of the palms', () => {
    expect(themeAt(street, 'left', 50)).toBe('oldtown');
    // Controls: without the district tag the town wins; the palms alone are palms; a beach with no town is a beach.
    expect(
      themeAt(
        street.filter((t) => t.tag !== 'key-oldtown'),
        'left',
        50,
      ),
    ).toBe('commercial');
    expect(themeAt([tag('palms')], 'left', 50)).toBe('palms');
    expect(themeAt([tag('palms'), tag('beach')], 'left', 50)).toBe('palms');
    // The sea still wins over every land tag.
    expect(themeAt([tag('water-gulf'), ...street], 'left', 50)).toBe('water');
  });

  it('gives Old Town a 4 m kerb sidewalk to a hard edge (a front is drawn there) and a town street a kerb, not sand', () => {
    const at = (tags: BakedTag[]) => deriveVerge({ tags, barriers: [] }, 'left', 50);
    expect(at(street)).toMatchObject({ widthM: 4, surface: 'kerb', edge: 'hard' });
    expect(at(street.filter((t) => t.tag !== 'key-oldtown'))).toMatchObject({
      widthM: 4,
      surface: 'kerb',
      edge: 'soft',
    });
    // The control: a palm road with no town keeps its sand.
    expect(at([tag('palms')])).toMatchObject({ widthM: 4, surface: 'sand', edge: 'soft' });
  });

  it('is what the real Old Town and Key West streets derive: no hand-written verge on Duval or Whitehead', () => {
    const { road, roads } = track(DUVAL);
    for (const r of roads) {
      for (const sec of r.laneSections) expect(sec.verges, `${r.id} keeps the derived verge`).toBeUndefined();
    }
    for (const e of road.edges) {
      for (const side of ['left', 'right'] as const) {
        const v = road.vergeAt(e.index, e.length / 2, side);
        expect(v, `${e.id} ${side}`).toMatchObject({
          widthM: 4,
          surface: 'kerb',
          edge: 'hard',
          derived: true,
        });
      }
    }
    const kw = track('osm-keys-key-west');
    for (const id of ['osm-kw-truman', 'osm-kw-white-street', 'osm-kw-bertha']) {
      const e = kw.road.edges[kw.road.edgeIndex(id)];
      if (!e) throw new Error(`no ${id}`);
      expect(kw.road.vergeAt(e.index, e.length / 2, 'right'), id).toMatchObject({ surface: 'kerb' });
    }
  });
});

function scene(seed: number, dressingOf?: (d: RoadDressing) => RoadDressing) {
  const t = track(DUVAL);
  const dressing = dressingOf ? dressingOf(t.dressing) : t.dressing;
  const built = buildRoadScene(t.road, look, dressing, { seed, roadsideDensity: 1 });
  const input: RoadsideInput = {
    road: t.road,
    dressing,
    seed,
    density: 1,
    kit: KEYS_KIT,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
    models,
  };
  return { road: t.road, dressing, built, input };
}

describe.each(SEEDS)('Duval and Whitehead, seed %i', (seed) => {
  const { road, dressing, built, input } = scene(seed);
  const items = scatterRoadside(input);
  const tagsOf = (edge: number) =>
    dressing[road.edges[edge]?.id ?? '']?.tags as readonly SideTag[] | undefined;
  const sideName = (side: number) => (side < 0 ? 'left' : 'right');
  const rule = (id: string) => items.filter((it) => it.rule === id);
  /** The sidewalk's outer edge and inner edge under an item, as distances from the centre line. */
  const walk = (it: RoadsideItem) => {
    const side = it.d < 0 ? 'left' : 'right';
    const v = road.vergeAt(it.edge, it.s, side);
    return { inner: Math.abs(v.dInner), outer: Math.abs(v.dOuter) };
  };

  it('scatters no palm, bait shack or power pole on an Old Town side, and the same road without the tag does', () => {
    const onOldTown = (sp: { edge: number; s: number; d: number }) =>
      inDistrict(tagsOf(sp.edge), sideName(sp.d), sp.s, OLDTOWN);
    const bad = built.spots.filter((sp) => ['palm', 'shack', 'pole'].includes(sp.kind) && onOldTown(sp));
    expect(bad.slice(0, 5).map((sp) => `${sp.kind} on edge ${sp.edge} at s ${sp.s.toFixed(0)}`)).toEqual([]);
    // The control: the same network with the district tag taken off grows them (the check can find them).
    const stripped = scene(seed, (d) =>
      Object.fromEntries(
        Object.entries(d).map(([id, r]) => [
          id,
          { ...r, tags: (r.tags ?? []).filter((t) => t.tag !== 'key-oldtown') },
        ]),
      ),
    );
    const grown = stripped.built.spots.filter((sp) => ['palm', 'shack', 'pole'].includes(sp.kind));
    expect(new Set(grown.map((sp) => sp.kind)).size, 'palms, shacks and poles without the tag').toBe(3);
    print(
      `[examined] seed ${seed}: ${built.spots.length} scatter spots on Duval, none a palm, shack or pole; ${grown.length} without the Old Town tag`,
    );
  });

  it("stands every front on the sidewalk's edge, its balconies over the pavement", () => {
    const fronts = items.filter((it) => it.foot && it.rule !== 'oldtown-bar');
    expect(fronts.length).toBeGreaterThan(40);
    let worst = 0;
    const bad: string[] = [];
    for (const it of fronts) {
      const w = walk(it);
      const facade = Math.abs(it.d);
      const gap = facade - w.outer;
      worst = Math.max(worst, gap);
      // Its facade within a metre behind the pavement's edge, never in front of it.
      if (gap < -0.05 || gap > 1)
        bad.push(`${it.rule} at s ${it.s.toFixed(0)}: facade ${gap.toFixed(2)} m past the edge`);
      // A balcony hangs out over the pavement.
      if (it.foot && it.foot.front > 1 && facade - it.foot.front >= w.outer)
        bad.push(`${it.rule} at s ${it.s.toFixed(0)}: its balcony does not reach the pavement`);
    }
    expect(bad.slice(0, 6)).toEqual([]);
    print(
      `[examined] seed ${seed}: ${fronts.length} fronts, the farthest facade ${worst.toFixed(2)} m behind the sidewalk's edge`,
    );
  });

  it('puts the planters and scooter racks on the sidewalk, not behind the fronts or on the road', () => {
    const furniture = [...rule('oldtown-planter'), ...rule('oldtown-scooters')];
    expect(furniture.length).toBeGreaterThan(10);
    for (const it of furniture) {
      const w = walk(it);
      const d = Math.abs(it.d);
      expect(d, `${it.rule} at s ${it.s.toFixed(0)}`).toBeGreaterThan(w.inner);
      expect(d, `${it.rule} at s ${it.s.toFixed(0)}`).toBeLessThan(w.outer);
    }
  });

  it("grows the Old Town's own trees: frangipanis on the sidewalk, poincianas and banyans behind the row", () => {
    const ids = { frangi: 'oldtown-frangipani', poinciana: 'oldtown-poinciana', banyan: 'oldtown-banyan' };
    const counts = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, rule(id).length]));
    print(`[examined] seed ${seed}: Old Town trees ${JSON.stringify(counts)}`);
    for (const [k, n] of Object.entries(counts)) expect(n, k).toBeGreaterThan(3);
    for (const it of rule(ids.frangi)) {
      const w = walk(it);
      expect(Math.abs(it.d), 'a sidewalk tree').toBeLessThan(w.outer);
    }
    for (const it of [...rule(ids.poinciana), ...rule(ids.banyan)]) {
      const w = walk(it);
      // Behind the facade line of the row: no trunk where a front stands or a rider rides.
      expect(Math.abs(it.d), `${it.rule} at s ${it.s.toFixed(0)}`).toBeGreaterThan(w.outer + 8);
    }
    // And all of it on Old Town sides, the tree kit nowhere else.
    for (const it of items.filter(
      (x) => KEYS_KIT.rules.find((r) => r.id === x.rule)?.model === 'keysIdentity',
    ))
      expect(inDistrict(tagsOf(it.edge), sideName(it.d), it.s, OLDTOWN), `${it.rule} at s ${it.s}`).toBe(
        true,
      );
  });

  it('stands an open bar among the shops now and then, never two together', () => {
    const bars = rule('oldtown-bar').sort((a, b) => a.edge - b.edge || a.s - b.s);
    expect(bars.length).toBeGreaterThanOrEqual(3);
    expect(new Set(bars.map((b) => b.variant)).size, 'both bars').toBe(2);
    for (let i = 1; i < bars.length; i++) {
      const a = bars[i - 1];
      const b = bars[i];
      if (a && b && a.edge === b.edge && Math.sign(a.d) === Math.sign(b.d))
        expect(b.s - a.s, 'bars on one side of one road').toBeGreaterThan(40);
    }
    // Each is a street front like the rest: on the sidewalk's edge.
    for (const b of bars) {
      const gap = Math.abs(b.d) - walk(b).outer;
      expect(gap, `bar at s ${b.s.toFixed(0)}`).toBeGreaterThanOrEqual(-0.05);
      expect(gap).toBeLessThan(1);
    }
  });

  it("hands the bars' blank name boards to the text layer, and every board it hands has a pack sign", () => {
    const layer = new RoadsideLayer(keysRoadside, look, input);
    while (!layer.ready) layer.update(1e9, 1e9, 360);
    const surfaces = layer.surfaces();
    const bars = new Set(surfaces.map((s) => s.name).filter((n) => n.startsWith('duval_open_bar')));
    expect([...bars].sort()).toEqual(['duval_open_bar_a_name', 'duval_open_bar_b_name']);
    for (const s of surfaces) {
      const names = keysSigns.filter((x) => x.id === s.id || x.id.startsWith(`${s.id}-`));
      expect(names.length, `${s.id} has names`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the crowd zones stand on the sidewalk, clear of the shops' facades", () => {
  const { road, roads } = track(DUVAL);
  it('keeps every pedestrian and animal zone inside the pavement', () => {
    let checked = 0;
    for (const r of roads) {
      const e = road.edges[road.edgeIndex(r.id)];
      if (!e) throw new Error(`no ${r.id}`);
      for (const f of r.features ?? []) {
        if (f.kind !== 'roadsideZone') continue;
        const side = f.d0 + f.d1 < 0 ? 'left' : 'right';
        const outer = Math.abs(road.vergeAt(e.index, (f.s0 + f.s1) / 2, side).dOuter);
        checked++;
        expect(
          Math.max(Math.abs(f.d0), Math.abs(f.d1)),
          `${f.id}: the facade is ${outer} m out`,
        ).toBeLessThanOrEqual(outer - 0.5);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(14);
  });
});

describe('the bars paint their own words', () => {
  it('has three invented names for each open bar, as a neon sign by the Duval kit does', () => {
    for (const node of ['duval_open_bar_a_name', 'duval_open_bar_b_name']) {
      const id = textSurfaceItemId(node);
      const names = [id, `${id}-2`, `${id}-3`].map((x) => keysSigns.find((s) => s.id === x));
      for (const n of names) {
        expect(n, `${id}'s names`).toBeDefined();
        expect(n?.tags).toEqual(expect.arrayContaining(['site', 'surface', 'new']));
        expect(n?.text).toBe(n?.text.toUpperCase());
      }
      expect(new Set(names.map((n) => n?.text)).size).toBe(3);
    }
  });
});
