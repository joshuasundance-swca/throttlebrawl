// Osprey nesting posts on the Keys' shores (playtest 4, P4-19; the identity study's S5: "ospreys nest on the
// poles and channel markers"). Codex CX6 built the post (`keys_osprey_post`, 112 triangles: a 9 m pole with
// a stick nest and the bird on it, no words) and placed it nowhere; the Keys' roadside kit places it now, on
// the shore and mangrove sides of the roads that run beside open water. The rules this file asks, whatever
// the numbers are: the kit's one file serves the roadside's variants and the mile post whichever loads
// first; a network with open water loads the file for the roadside; the post stands on land the road scene
// drew, past the verge, apart from one another; it stands on no Old Town street, bridge or sea; and each rule
// has a control (the same scatter without the rule, or with the tag it keeps out of).
import { describe, expect, it } from 'vitest';
import type { AssetManifest } from '../assets';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { loadLandmarkKits, loadSceneryModels, modelKindsFor, type SceneryModel } from './models';
import { buildRoadScene, type RoadDressing } from './road-mesh';
import { KEYS_KIT, scatterRoadside, type RoadsideInput, type RoadsideItem } from './roadside';
import type { SideTag } from './scenery';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

const keysRoadside: SceneryModel = await bakeRepoModel('keysRoadside');
const duvalKit: SceneryModel = await bakeRepoModel('duvalKit');
const keysIdentity: SceneryModel = await bakeRepoModel('keysIdentity');
const models = { keysRoadside, duvalKit, keysIdentity };

const RULE = 'osprey-post';
const SEEDS = [1, 2, 3, 4, 5, 6];
/** The roads of the Overseas Highway that are land: the keys between its bridges. */
const HIGHWAY_NETWORKS = ['osm-keys-seven-mile', 'osm-keys-bahia-honda'];

function scene(id: string, seed: number, kit = KEYS_KIT) {
  const t = track(id);
  const built = buildRoadScene(t.road, look, t.dressing, { seed, roadsideDensity: 1 });
  const input: RoadsideInput = {
    road: t.road,
    dressing: t.dressing,
    seed,
    density: 1,
    kit,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
    models,
  };
  return { ...t, built, items: scatterRoadside(input) };
}

const osprey = (items: readonly RoadsideItem[]) => items.filter((i) => i.rule === RULE);

/** The shipped files, loaded the way the asset manifest does: each id once, later callers share the first result. */
function fileManifest(): AssetManifest {
  const inFlight = new Map<string, Promise<unknown>>();
  return {
    entries: () => [],
    resolve: () => null,
    progress: () => ({ total: 0, done: 0, fellBack: 0, bytesLoaded: 0, bytesTotal: 0, perAsset: {} }),
    onProgress: () => () => undefined,
    onRetryReady: () => () => undefined,
    load<T>(id: string, standIn: () => T, o?: { decode?: (data: ArrayBuffer) => T | Promise<T> }) {
      const running = inFlight.get(id);
      if (running) return running as Promise<never>;
      const p = (async () => {
        const mod: string = 'node:fs';
        const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
        const buf = fs.readFileSync(`packs/base/assets/${id}.glb`);
        const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        const value = o?.decode ? await o.decode(data) : standIn();
        return { id, source: 'baked' as const, value, fellBack: false };
      })();
      inFlight.set(id, p);
      return p as Promise<never>;
    },
  };
}

describe('the keys-identity file serves the roadside and the mile post, whichever loads first', () => {
  for (const order of ['scenery first', 'landmarks first'] as const) {
    it(`gives each its own view of the one decode (${order})`, async () => {
      const manifest = fileManifest();
      const scenery = () => loadSceneryModels(manifest, ['keysIdentity']);
      const kits = () => loadLandmarkKits(manifest, ['keys-identity']);
      const [a, b] =
        order === 'scenery first' ? [await scenery(), await kits()] : [await kits(), await scenery()];
      const loaded = (order === 'scenery first' ? a : b) as Awaited<ReturnType<typeof scenery>>;
      const kit = (order === 'scenery first' ? b : a) as Awaited<ReturnType<typeof kits>>;
      const model = loaded.models.keysIdentity;
      expect(model?.variants, 'the roadside variants, osprey post included').toHaveLength(9);
      expect(
        kit.get('keys-identity')?.nodes.has('keys_mile_marker'),
        'the mile post, as a landmark node',
      ).toBe(true);
    });
  }
});

describe('a Keys network with open water loads the identity kit for its roadside', () => {
  const needs = (tags: string[]) => ({
    tropical: true,
    tags: new Set(tags),
    palette: new Set<string>(),
    traffic: [] as string[],
  });

  it('asks for it on the Overseas Highway`s networks (open water), and not on a dry one (the control)', () => {
    expect(modelKindsFor(needs(['palms', 'beach', 'bridge', 'water-open']))).toContain('keysIdentity');
    expect(modelKindsFor(needs(['palms', 'town']))).not.toContain('keysIdentity');
    // Old Town still asks for it, as before.
    expect(modelKindsFor(needs(['key-oldtown']))).toContain('keysIdentity');
  });
});

describe('osprey posts stand on the highway`s shores', () => {
  const runs = HIGHWAY_NETWORKS.flatMap((id) => SEEDS.map((seed) => ({ id, seed, ...scene(id, seed) })));
  const all = runs.flatMap((r) => osprey(r.items).map((item) => ({ run: r, item })));

  it('places some on every seed band of the real highway keys (a presence rule over several seeds)', () => {
    const perNetwork = Object.fromEntries(
      HIGHWAY_NETWORKS.map((id) => [id, all.filter((x) => x.run.id === id).length]),
    );
    print(`osprey posts over ${SEEDS.length} seeds: ${JSON.stringify(perNetwork)}`);
    // The Seven Mile's two keys and Bahia Honda's key are shore; each gets nests over the seeds.
    expect(perNetwork['osm-keys-seven-mile']).toBeGreaterThan(0);
    expect(perNetwork['osm-keys-bahia-honda']).toBeGreaterThan(0);
  });

  it('draws the osprey post model, a tall slim pole (variant of the identity kit)', () => {
    expect(all.length).toBeGreaterThan(0);
    const variants = new Set(all.map((x) => x.item.variant));
    expect(variants.size, 'one model').toBe(1);
    const geometry = keysIdentity.variants[[...variants][0] ?? -1];
    expect(geometry, 'the variant exists in the kit').toBeDefined();
    geometry?.computeBoundingBox();
    const box = geometry?.boundingBox;
    expect(box?.max.y ?? 0).toBeGreaterThan(7);
    expect(box?.max.y ?? 99).toBeLessThan(11);
    expect(
      Math.max((box?.max.x ?? 9) - (box?.min.x ?? 0), (box?.max.z ?? 9) - (box?.min.z ?? 0)),
    ).toBeLessThan(3);
  });

  it('stands on land the road scene drew, past the verge, never on a road, a bridge or the sea', () => {
    const bad: string[] = [];
    for (const { run, item } of all) {
      const side = item.d < 0 ? 'left' : 'right';
      const v = run.road.vergeAt(item.edge, item.s, side);
      const out = Math.abs(v.dOuter);
      const reach = run.built.landReach(item.edge, item.d < 0 ? -1 : 1, item.s);
      const d = Math.abs(item.d);
      if (d <= out)
        bad.push(
          `${run.id} s ${item.s.toFixed(0)}: ${d.toFixed(1)} m is on the verge (ends ${out.toFixed(1)})`,
        );
      if (d >= out + reach) bad.push(`${run.id} s ${item.s.toFixed(0)}: ${d.toFixed(1)} m is past the land`);
      const tags = run.dressing[run.road.edges[item.edge]?.id ?? '']?.tags as readonly SideTag[] | undefined;
      if (
        (tags ?? []).some(
          (t) => (t.tag === 'bridge' || t.tag.startsWith('water')) && t.s0 <= item.s && item.s <= t.s1,
        )
      )
        bad.push(`${run.id} s ${item.s.toFixed(0)}: on a bridge or water run`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
    print(`${all.length} osprey posts ray-checked onto drawn land and off the bridges`);
  });

  it('keeps the nests apart: no two on one side of a road within 50 m (a candidate every 200 m, jittered)', () => {
    for (const run of runs) {
      for (const side of [-1, 1] as const) {
        const own = osprey(run.items)
          .filter((i) => Math.sign(i.d) === side)
          .sort((a, b) => a.edge - b.edge || a.s - b.s);
        for (let i = 1; i < own.length; i++) {
          const a = own[i - 1];
          const b = own[i];
          if (a && b && a.edge === b.edge)
            expect(b.s - a.s, `${run.id} seed ${run.seed}`).toBeGreaterThan(50);
        }
      }
    }
  });

  it('leaves the Overseas Highway`s bridges to the posts the bridge has, and Old Town to its trees (the controls)', () => {
    // Duval is Old Town on both sides over its whole length: no nest on a shop street.
    for (const seed of SEEDS)
      expect(osprey(scene('osm-keys-duval', seed).items), `Duval seed ${seed}`).toHaveLength(0);
    // The same scatter on the Seven Mile's land with the rule taken out places none: the rule is what makes them.
    const without = { ...KEYS_KIT, rules: KEYS_KIT.rules.filter((r) => r.id !== RULE) };
    for (const seed of SEEDS.slice(0, 3)) {
      expect(osprey(scene('osm-keys-seven-mile', seed, without).items), `no rule, seed ${seed}`).toHaveLength(
        0,
      );
    }
    // And the district keep-out is what keeps them off a street: the Old Town tag stripped, a nest may stand there.
    // (Its sides are themed `oldtown`, which the rule does not stand on, so the theme is the second lock.)
    const rule = KEYS_KIT.rules.find((r) => r.id === RULE);
    expect(rule?.notDistrict).toEqual(expect.arrayContaining(['key-oldtown']));
    expect(rule?.on).not.toContain('oldtown');
    // It builds Duval's and the Seven Mile's road scenes eight times. With land kept off lower roads' lanes (here and
    // in road/drawn-ground.ts, which Old Town's structure plan reads) that took 6.3 s on the dev machine, against 2.0 s on
    // main, and ran past the unit tier's 20 s on CI in train 432.
  }, 60_000);
});
