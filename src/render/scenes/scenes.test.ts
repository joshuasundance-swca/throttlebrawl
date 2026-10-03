// The staged roadside scenes (run W-T, pitch 6 "the horizon comes alive": "small staged scenes
// beside the road, each with ONE dry sign"; "signs stay headline-short"; "merge each scene into one
// mesh, use far stand-ins"). The checks read the real scenes files and the real road networks,
// build the real road scene, place the scenes for several seeds and look at what was placed and
// drawn: every file well formed and every sign short, scenes on their own ground and never on a
// road or the band a rider rides, the same scenes for the same seed, each scene once a race, one
// mesh and one material per scene, the far level of detail, and the roadside props keeping off.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../../road';
import { createFlatLook } from '../look';
import { buildRoadScene, type RoadDressing, type RoadScene } from '../road-mesh';
import { KEYS_KIT, PNW_KIT, scatterRoadside, SF_KIT, type RoadsideKit } from '../roadside';
import { ridableBandPast, themeAt, type SideTag } from '../scenery';
import { SCENES_PER_RACE, scenesProblems, SIGN_MAX_WORDS, type ScenesFile } from './data';
import { ScenesLayer } from './layer';
import { placeScenes, type PlacedScene } from './place';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[print] ${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork & { region: string }>(
  '../../../packs/*/regions/*/networks/*.json',
  { eager: true, import: 'default' },
);
const roadFiles = import.meta.glob<BakedRoad>('../../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const sceneFiles = import.meta.glob<ScenesFile>('../../../packs/*/assets/scenes/*.json', {
  eager: true,
  import: 'default',
});

const fileOf = (region: string): { pack: string; file: ScenesFile } => {
  const key = Object.keys(sceneFiles).find((k) => k.endsWith(`/scenes/${region}.json`));
  if (!key) throw new Error(`no scenes for ${region}`);
  return { pack: /packs\/([^/]+)\//.exec(key)![1]!, file: sceneFiles[key]! };
};

function track(id: string): { road: RoadNetwork; dressing: RoadDressing; region: string } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing, region: network.region };
}

const NETWORKS = Object.values(networkFiles).map((n) => n.id);
const SEEDS = [1, 2, 3, 4, 5, 6];
const KITS: Record<string, RoadsideKit> = {
  'florida-keys': KEYS_KIT,
  'pacific-northwest': PNW_KIT,
  'san-francisco': SF_KIT,
};

const built = new Map<
  string,
  { road: RoadNetwork; dressing: RoadDressing; region: string; scene: RoadScene }
>();
function world(id: string, seed: number) {
  const key = `${id}@${seed}`;
  let w = built.get(key);
  if (!w) {
    const t = track(id);
    w = { ...t, scene: buildRoadScene(t.road, look, t.dressing, { seed }) };
    built.set(key, w);
  }
  return w;
}

function place(id: string, seed: number): PlacedScene[] {
  const w = world(id, seed);
  return placeScenes({
    road: w.road,
    seed,
    file: fileOf(w.region).file,
    landReach: (e, side, s) => w.scene.landReach(e, side, s),
    spots: w.scene.spots,
  });
}

describe('the scenes files', () => {
  it('are well formed, one per region, with five live scenes or more and every sign headline-short', () => {
    const regions = new Set(Object.values(networkFiles).map((n) => n.region));
    expect(regions.size).toBe(3);
    for (const region of regions) {
      const { file } = fileOf(region);
      expect(scenesProblems(file), region).toEqual([]);
      expect(file.region).toBe(region);
      const live = file.scenes.filter((s) => s.status === 'live');
      expect(live.length, region).toBeGreaterThanOrEqual(5);
      for (const s of live) expect(s.sign.text.split(/\s+/).length, s.id).toBeLessThanOrEqual(SIGN_MAX_WORDS);
      print(`${region}: ${live.map((s) => `${s.id} "${s.sign.text}"`).join('; ')}`);
    }
    expect(Object.keys(sceneFiles).length).toBe(3);
  });

  it("carries the pitch's three scenes word for word", () => {
    const text = (region: string, id: string) =>
      fileOf(region).file.scenes.find((s) => s.id === id)?.sign.text;
    expect(text('florida-keys', 'tow-requested')).toBe('TOW REQUESTED 2019');
    expect(text('pacific-northwest', 'view-lot')).toBe('VIEW LOT. VIEW NOT INCLUDED.');
    expect(text('san-francisco', 'series-a')).toBe('SERIES A. PARKED UNTIL 6PM.');
  });

  it('turns away a long sign, a lowercase one, a theme that is not one and a water scene on land', () => {
    const bad = {
      formatVersion: 1,
      region: 'x',
      everyM: 600,
      scenes: [
        {
          id: 'a',
          status: 'live',
          on: ['water', 'beach'],
          acrossM: [2, 4],
          radiusM: 2,
          sign: {
            text: 'THIS SIGN GOES ON AND ON AND ON',
            at: [0, 1, 0],
            size: [2, 1],
            bg: '#ffffff',
            fg: '#000000',
          },
          parts: [{ box: [1, 1, 1], at: [0, 0, 0], colour: '#ffffff' }],
        },
        {
          id: 'b',
          status: 'live',
          on: ['moon'],
          acrossM: [2, 4],
          radiusM: 2,
          sign: { text: 'Quiet', at: [0, 1, 0], size: [2, 1], bg: '#ffffff', fg: '#000000' },
          parts: [{ box: [1, 1, 1], at: [0, 0, 0], colour: '#ffffff' }],
        },
      ],
    };
    expect(scenesProblems(bad)).toEqual([
      'scenes[0]: a water scene stands on water only',
      'scenes[0].sign: headline-short (6 words, 32 characters)',
      'scenes[1]: on must list side themes',
      'scenes[1].sign: all caps',
    ]);
  });
});

describe.each(NETWORKS)('the scenes along %s', (id) => {
  it('stand on their own ground, past the riding band, clear of every road; once each a race', () => {
    let total = 0;
    let checked = 0;
    for (const seed of SEEDS) {
      const w = world(id, seed);
      const placed = place(id, seed);
      total += placed.length;
      expect(new Set(placed.map((p) => p.def.id)).size, `${id}@${seed}`).toBe(placed.length);
      expect(placed.length).toBeLessThanOrEqual(fileOf(w.region).file.maxPerRace ?? SCENES_PER_RACE);
      for (const p of placed) {
        const e = w.road.edges[p.edge]!;
        const sideName = p.side < 0 ? 'left' : 'right';
        const tags = e.tags as readonly SideTag[];
        const water = p.def.on.includes('water');
        const r = p.def.radiusM;
        const outer = p.side < 0 ? -e.dMin + 0.6 : e.dMax + 0.6;
        const across = Math.abs(p.d) - outer;
        for (const u of [-r, 0, r]) {
          expect(p.def.on, `${p.def.id} theme`).toContain(themeAt(tags, sideName, p.s + u));
          const land = w.scene.landReach(p.edge, p.side, p.s + u);
          if (water) expect(across - r, `${p.def.id} off the land`).toBeGreaterThan(land);
          else expect(land, `${p.def.id} on the land`).toBeGreaterThanOrEqual(across + r - 1e-6);
        }
        if (!water)
          expect(across - r).toBeGreaterThanOrEqual(
            ridableBandPast(w.road, p.edge, p.side, p.s, outer) - 1e-6,
          );
        // Never on any road: the scene's footprint clears every road's drawn half width.
        for (const o of w.road.edges) {
          const half = Math.max(-o.dMin, o.dMax) + 0.6;
          for (let i = 0; i < o.count; i++) {
            const dist = Math.hypot((o.x[i] ?? 0) - p.x, (o.z[i] ?? 0) - p.z);
            expect(dist, `${p.def.id} vs ${o.id}`).toBeGreaterThan(half + r - 0.5);
          }
        }
        checked++;
      }
    }
    print(
      `${id}: ${total} scenes over ${SEEDS.length} seeds (${(total / SEEDS.length).toFixed(1)} a race), ${checked} checked`,
    );
  });

  it('repeat exactly for a seed', () => {
    const a = place(id, 3).map((p) => [p.def.id, p.edge, p.s, p.d]);
    const b = place(id, 3).map((p) => [p.def.id, p.edge, p.s, p.d]);
    expect(a).toEqual(b);
  });
});

describe('the scenes, region by region', () => {
  const placedBy = (ids: string[]) => {
    const all = new Map<string, number>();
    let races = 0;
    for (const id of ids)
      for (const seed of SEEDS) {
        races++;
        for (const p of place(id, seed)) all.set(p.def.id, (all.get(p.def.id) ?? 0) + 1);
      }
    return { all, races };
  };

  it.each([
    ['florida-keys', ['keys-m1', 'osm-keys-bahia-honda', 'osm-keys-key-west'], 'tow-requested'],
    ['pacific-northwest', ['pnw-c1', 'osm-pnw-chuckanut', 'osm-pnw-gorge', 'osm-pnw-samish'], 'view-lot'],
    ['san-francisco', ['sf-hills', 'osm-sf-russian-hill', 'osm-sf-twin-peaks', 'sf-downtown'], 'series-a'],
  ])(
    '%s: a race meets a few of them, the pitch scene among them, and a new seed changes the line-up',
    (region, ids, signature) => {
      const { all, races } = placedBy(ids);
      const total = [...all.values()].reduce((a, b) => a + b, 0);
      print(
        `${region}: ${total} scenes in ${races} races; ${[...all].map(([k, v]) => `${k} ${v}`).join(', ')}`,
      );
      // At least one scene a race on average, and most of the region's scenes turn up somewhere.
      expect(total / races).toBeGreaterThanOrEqual(1);
      expect(all.size).toBeGreaterThanOrEqual(4);
      expect(all.get(signature) ?? 0).toBeGreaterThan(0);
      // Which scenes a race shows, not only where: the line-up itself changes with the seed.
      const lineUps = new Set(
        SEEDS.map((seed) =>
          place(ids[0]!, seed)
            .map((p) => p.def.id)
            .sort()
            .join(','),
        ),
      );
      expect(lineUps.size).toBeGreaterThan(1);
    },
  );
});

describe('a drawn scene', () => {
  const id = 'osm-pnw-gorge';
  const seed = SEEDS.find((s) => place(id, s).length >= 2) ?? 1;
  const w = world(id, seed);
  const { pack, file } = fileOf(w.region);
  const layer = new ScenesLayer(look, {
    road: w.road,
    seed,
    pack,
    file,
    landReach: (e, side, s) => w.scene.landReach(e, side, s),
    spots: w.scene.spots,
  });

  it('is one mesh with the layer one material, cheap, with a far stand-in that keeps the sign', () => {
    expect(layer.views.length).toBeGreaterThanOrEqual(2);
    const materials = new Set(layer.views.map((v) => v.mesh.material));
    expect(materials.size).toBe(1);
    expect(layer.group.children.length).toBe(layer.views.length);
    for (const v of layer.views) {
      expect(v.triangles, v.placed.def.id).toBeLessThanOrEqual(260);
      expect(v.farVertices).toBeLessThan(v.allVertices);
      // The sign's board and face come first, so the far stand-in still shows it.
      expect(v.farVertices / 3).toBeGreaterThanOrEqual(12);
      expect(v.ref).toBe(`${pack}:scenes/${w.region}#${v.placed.def.id}`);
      expect(v.mesh.geometry.getAttribute('uv').count).toBe(v.allVertices);
    }
    print(
      `${id}@${seed}: ${layer.views.map((v) => `${v.placed.def.id} ${v.triangles} tris (far ${v.farVertices / 3})`).join(', ')}`,
    );
  });

  it('draws only near the camera (one draw each), drops to its stand-in past the far detail, and hides on a veto', () => {
    const v = layer.views[0]!;
    const { x, z } = v.placed;
    expect(layer.update(x + 5000, z, 360, 200)).toBe(0);
    expect(layer.views.every((q) => !q.mesh.visible)).toBe(true);
    expect(layer.update(x + 10, z, 360, 200)).toBeGreaterThanOrEqual(1);
    expect(v.mesh.visible).toBe(true);
    expect(v.mesh.geometry.drawRange.count).toBe(v.allVertices);
    layer.update(x + 300, z, 360, 200);
    expect(v.mesh.visible).toBe(true);
    expect(v.mesh.geometry.drawRange.count).toBe(v.farVertices);
    expect(layer.counts().far).toBeGreaterThanOrEqual(1);
    layer.hide([v.ref]);
    layer.update(x + 10, z, 360, 200);
    expect(v.mesh.visible).toBe(false);
  });

  it('keeps the roadside props off its ground', () => {
    const input = {
      road: w.road,
      dressing: w.dressing,
      seed,
      density: 1,
      kit: KITS[w.region]!,
      landReach: (e: number, side: -1 | 1, s: number) => w.scene.landReach(e, side, s),
      spots: w.scene.spots,
    };
    const inside = (items: { p: { x: number; z: number } }[]) =>
      items.filter((it) => layer.reserved().some((q) => Math.hypot(it.p.x - q.x, it.p.z - q.z) < q.r)).length;
    const free = inside(scatterRoadside(input));
    const kept = inside(scatterRoadside({ ...input, reserved: layer.reserved() }));
    print(`${id}@${seed}: roadside props inside a scene, without and with its reservation: ${free}, ${kept}`);
    expect(kept).toBe(0);
  });
});
