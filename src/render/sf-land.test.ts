/// <reference types="vite/client" />
// San Francisco grows no Pacific Northwest forest (playtest 4, P4-19, run B task B4; the identity
// sheets' fixes T1 and G4). The maintainer: "The real roads do not have the characteristics of the
// roads in question in terms of scenery and feel etc". Two stand-in tags were left from the first
// bakes: the Twin Peaks climb was `forest` (conifer clusters, far conifers on the skirt, the PNW's
// dirt verge with a fern edge) where Twin Peaks is open grass and rock, and the Golden Gate's toll
// plaza was the headlands' bare grass where the south approach runs through the Presidio's cypress
// and eucalyptus. The climb is `headlands` now, and the toll plaza `presidio`: Codex CX5's Monterey
// cypress and blue gum eucalyptus (`models/scenery/sf-identity`), no conifer, no fern, no pole.
//
// The checks build the real baked networks the way the game does; each has a control that must find
// the thing ("no conifer" against the climb tagged forest again, the trees against the toll plaza
// tagged headlands), so a pass is never an empty one.
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
import { modelKindsFor, type SceneryModels } from './models';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import { ridableBandPast, themeAt } from './scenery';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-sf/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-sf/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

interface Track {
  roads: BakedRoad[];
  road: RoadNetwork;
  dressing: RoadDressing;
}

function track(id: string, retag?: (r: BakedRoad) => readonly BakedTag[]): Track {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles)
    .filter((r) => network.roads.includes(r.id))
    .map((r) => (retag ? { ...r, tags: [...retag(r)] } : r));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { roads, road: createRoadNetwork({ network, roads }), dressing };
}

const kindsOf = (t: Track) => {
  const { tropical, tags } = networkTags(t.road, t.dressing);
  return modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
};

/** Every model a network asks for, as the game loads them. */
async function modelsOf(t: Track): Promise<SceneryModels> {
  const out: SceneryModels = {};
  for (const k of kindsOf(t)) out[k] = await bakeRepoModel(k);
  return out;
}

const SF = Object.values(networkFiles)
  .map((n) => n.id)
  .sort();

describe('no San Francisco network grows the Pacific Northwest forest', () => {
  it.each(SF)('%s: no forest tag, no conifer drawn, no PNW kit or conifer model asked for', async (id) => {
    const t = track(id);
    const tags = t.roads.flatMap((r) => (r.tags ?? []).map((x) => x.tag));
    expect(tags, id).not.toContain('forest');
    const kinds = kindsOf(t);
    expect(kinds).not.toContain('conifers');
    expect(kinds).not.toContain('pnwRoadside');
    const scene = buildRoadScene(t.road, look, t.dressing, { seed: 7, models: await modelsOf(t) });
    expect(scene.stats.scenery.conifer, id).toBe(0);
    scene.dispose();
  });

  it('control: the Twin Peaks climb tagged forest again grows pines (the probe sees them)', () => {
    const t = track('osm-sf-twin-peaks', (r) =>
      (r.tags ?? []).map((x) => (x.tag === 'headlands' ? { ...x, tag: 'forest' } : x)),
    );
    const scene = buildRoadScene(t.road, look, t.dressing, { seed: 7 });
    print(`control: Twin Peaks with its climb tagged forest grows ${scene.stats.scenery.conifer} conifers`);
    expect(scene.stats.scenery.conifer).toBeGreaterThan(20);
    scene.dispose();
  });
});

describe('the Twin Peaks climb is open grass hill', () => {
  const t = track('osm-sf-twin-peaks');
  const climb = t.roads.find((r) => r.id === 'osm-sf-twin-peaks-climb')!;

  it('reads as the open hill on both sides over its whole length, with a soft grass verge and no ferns', () => {
    for (let s = 0; s <= climb.lengthM; s += 25)
      for (const side of ['left', 'right'] as const) {
        const at = Math.min(s, climb.lengthM);
        expect(themeAt(climb.tags, side, at), `${side} at ${s}`).toBe('headlands');
        const v = deriveVerge(climb, side, at);
        expect([v.surface, v.edge], `${side} at ${s}`).toEqual(['grass', 'soft']);
      }
    expect((climb.tags ?? []).map((x) => x.tag)).toContain('fog');
  });
});

describe("the Golden Gate's toll plaza is the Presidio's cypress and eucalyptus", () => {
  const t = track('osm-sf-golden-gate');
  const plaza = t.roads.find((r) => r.id === 'osm-sf-gg-toll-plaza')!;
  const edge = t.road.edges.find((e) => e.id === plaza.id)!;

  it('tags the toll plaza `presidio` on both sides, with a soft grass verge and no ferns', () => {
    for (let s = 0; s <= plaza.lengthM; s += 10)
      for (const side of ['left', 'right'] as const) {
        const at = Math.min(s, plaza.lengthM);
        expect(themeAt(plaza.tags, side, at), `${side} at ${s}`).toBe('presidio');
        const v = deriveVerge(plaza, side, at);
        expect([v.surface, v.edge], `${side} at ${s}`).toEqual(['grass', 'soft']);
      }
  });

  it('asks for the San Francisco tree kit, and only a network with a `presidio` side does', () => {
    expect(kindsOf(t)).toContain('sfIdentity');
    for (const id of SF.filter((x) => x !== 'osm-sf-golden-gate'))
      expect(kindsOf(track(id)), id).not.toContain('sfIdentity');
  });

  it('stands cypress and eucalyptus there, off the ridable band, and no conifer, house or pole', async () => {
    const models = await modelsOf(t);
    const variants = new Set<number>();
    let trees = 0;
    for (const seed of [1, 2, 3, 7, 11]) {
      const scene = buildRoadScene(t.road, look, t.dressing, { seed, models });
      const onPlaza = scene.spots.filter((s) => s.edge === edge.index);
      const mine = onPlaza.filter((s) => s.kind === 'coastTree');
      expect(onPlaza.filter((s) => ['conifer', 'house', 'pole', 'palm'].includes(s.kind))).toEqual([]);
      for (const s of mine) {
        variants.add(s.variant);
        const side = s.d < 0 ? -1 : 1;
        const outer = side < 0 ? -edge.dMin + 0.6 : edge.dMax + 0.6;
        const band = ridableBandPast(t.road, edge.index, side, s.s, outer);
        // Its trunk stands past the ridable grass, on land the scene drew there.
        expect(Math.abs(s.d) - outer, `seed ${seed} s ${s.s.toFixed(0)}`).toBeGreaterThanOrEqual(band);
        expect(scene.landReach(edge.index, side, s.s), `seed ${seed} s ${s.s.toFixed(0)}`).toBeGreaterThan(
          Math.abs(s.d) - outer,
        );
      }
      trees += mine.length;
      scene.dispose();
    }
    print(
      `the toll plaza over 5 seeds: ${trees} cypress and eucalyptus, variants ${[...variants].sort().join('/')}`,
    );
    expect(trees).toBeGreaterThan(10);
    expect([...variants].sort()).toEqual([0, 1]);
  });

  it('control: the same road tagged as bare headlands stands no tree', () => {
    const bare = track('osm-sf-golden-gate', (r) =>
      (r.tags ?? []).map((x) => (x.tag === 'presidio' ? { ...x, tag: 'headlands' } : x)),
    );
    const scene = buildRoadScene(bare.road, look, bare.dressing, { seed: 7 });
    expect(scene.spots.filter((s) => s.kind === 'coastTree')).toEqual([]);
    scene.dispose();
  });
});
