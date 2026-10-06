/// <reference types="vite/client" />
// Bridges pick their supports by their own tag (playtest 4, P4-19, run B task B4; the identity
// sheets' cause C5). The maintainer: "The real roads do not have the characteristics of the roads in
// question in terms of scenery and feel etc". Until now any network with a `forest` tag anywhere
// stood every bridge on timber trestle bents, so the Columbia River Highway's concrete deck arches,
// I-5's concrete bridges and Upper Market's bridge in San Francisco (whose network had the Twin Peaks
// climb's stand-in `forest`) all stood on timber. Now a bent stands only under a deck tagged
// `trestle`, and a deck tagged `arch-bridge` gets Codex CX5's concrete deck arches
// (`gorge-landmarks`: the 24 m `gorge_arch_bay` and the 46 m `gorge_arch_span_46`), end to end
// along it, on columns down to the ground where the deck stands higher than the arch's own pier.
//
// The checks build the real baked networks with the real models, and each has a control: the same
// probe on a case that must find the thing (bents under a deck tagged `trestle`; plain pylons under
// the Gorge's decks without the arch kit), so "none" is never an empty pass.
import { InstancedMesh, Matrix4, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedTag,
  type RoadNetwork,
} from '../road';
import {
  ARCH_FOOTING,
  ARCH_KINDS,
  ARCH_M,
  ARCH_PIER_M,
  ARCH_ROOTS,
  ARCH_TAG,
  TRESTLE_TAG,
  planArches,
  type ArchEdge,
} from './bridge-bays';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { modelKindsFor, type SceneryModels } from './models';
import { buildRoadScene, networkTags, type RoadDressing, type RoadScene } from './road-mesh';

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

interface Track {
  id: string;
  roads: BakedRoad[];
  road: RoadNetwork;
  dressing: RoadDressing;
}

/** A network as the game builds it, from its own pack's road files, its tags passed through `retag`. */
function track(id: string, retag?: (r: BakedRoad) => readonly BakedTag[]): Track {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => (retag ? { ...r, tags: [...retag(r)] } : r));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { id, roads, road: createRoadNetwork({ network, roads }), dressing };
}

const tagsOf = (r: BakedRoad): readonly BakedTag[] => r.tags ?? [];
const covers = (t: BakedTag, s: number) => s >= t.s0 - 1e-6 && s <= t.s1 + 1e-6;

/** The bridge stretches of a network, each with whether a `trestle` tag covers it. */
function decks(t: Track) {
  return t.road.edges.flatMap((e) => {
    const r = t.roads.find((x) => x.id === e.id);
    const tags = r ? tagsOf(r) : [];
    return tags
      .filter((x) => x.tag === 'bridge')
      .map((b) => ({
        e,
        b,
        trestle: tags.some((x) => x.tag === TRESTLE_TAG && covers(x, (b.s0 + b.s1) / 2)),
        arch: tags.some((x) => x.tag === ARCH_TAG && covers(x, (b.s0 + b.s1) / 2)),
      }));
  });
}

/** Every instance matrix of the meshes with this name. */
function instances(group: Object3D, name: string): Matrix4[] {
  const out: Matrix4[] = [];
  group.traverse((o) => {
    if (!(o instanceof InstancedMesh) || o.name !== name) return;
    for (let i = 0; i < o.count; i++) {
      const m = new Matrix4();
      o.getMatrixAt(i, m);
      out.push(m);
    }
  });
  return out;
}

/** The deck stretch (and s on it) nearest a point in plan, within `within` m, or null. */
function deckUnder(t: Track, x: number, z: number, within = 2) {
  let best: { deck: ReturnType<typeof decks>[number]; s: number; dist: number } | null = null;
  for (const deck of decks(t)) {
    for (let s = deck.b.s0; s <= deck.b.s1; s += 0.5) {
      const w = t.road.toWorld(deck.e.index, s, 0, 0);
      const dist = Math.hypot(w.x - x, w.z - z);
      if (dist <= within && (!best || dist < best.dist)) best = { deck, s, dist };
    }
  }
  return best;
}

// The bent model and the arch kit, given to every network whatever it asks for, so the rule is the
// tag's and not the loader's (the old loader gave a forest network its bents).
const SUPPORTS: SceneryModels = {
  trestleBent: await bakeRepoModel('trestleBent'),
  gorgeArches: await bakeRepoModel('gorgeArches'),
};

/** The non-tropical networks that have a bridge: those the old forest rule could stand on trestles. */
const BRIDGED = Object.values(networkFiles)
  .map((n) => n.id)
  .filter((id) => {
    const t = track(id);
    const { tropical } = networkTags(t.road, t.dressing);
    return !tropical && decks(t).length > 0;
  })
  .sort();

describe('a bridge stands on timber trestle bents only where its own deck is tagged `trestle`', () => {
  it('finds the networks the rule is about: the Gorge, I-5, Twin Peaks and the hand-made PNW road', () => {
    print(`non-tropical networks with a bridge: ${BRIDGED.join(', ')}`);
    expect(BRIDGED).toEqual(
      expect.arrayContaining(['osm-pnw-gorge', 'osm-pnw-samish', 'osm-sf-twin-peaks', 'pnw-c1']),
    );
  });

  it.each(BRIDGED)('%s: every bent stands under a `trestle` deck, and no other deck has one', (id) => {
    const t = track(id);
    const scene = buildRoadScene(t.road, look, t.dressing, { seed: 7, models: SUPPORTS });
    const bents = instances(scene.group, 'road-trestle');
    const p = new Vector3();
    const wrong: string[] = [];
    for (const m of bents) {
      p.setFromMatrixPosition(m);
      const under = deckUnder(t, p.x, p.z);
      if (!under?.deck.trestle)
        wrong.push(`${under?.deck.e.id ?? 'no deck'} s ${under?.s.toFixed(0) ?? '?'}`);
    }
    const all = decks(t);
    const timber = all.filter((d) => d.trestle);
    print(
      `${id}: ${bents.length} bents; ${all.length} decks, ${timber.length} tagged trestle; ` +
        `${wrong.length} bents under a deck without the tag`,
    );
    expect(wrong.slice(0, 8)).toEqual([]);
    // A network with a `trestle` deck stands it on bents, about one every 8 m (the probe can see them).
    if (timber.length) {
      const metres = timber.reduce((a, d) => a + d.b.s1 - d.b.s0, 0);
      expect(bents.length).toBeGreaterThan((metres / 8) * 0.8);
    } else expect(bents).toHaveLength(0);
    scene.dispose();
  });

  it('control: the Gorge with its decks tagged `trestle` stands them on bents', () => {
    const t = track('osm-pnw-gorge', (r) => [
      ...tagsOf(r).filter((x) => x.tag !== ARCH_TAG),
      ...tagsOf(r)
        .filter((x) => x.tag === 'bridge')
        .map((x) => ({ ...x, tag: TRESTLE_TAG })),
    ]);
    const scene = buildRoadScene(t.road, look, t.dressing, { seed: 7, models: SUPPORTS });
    const bents = instances(scene.group, 'road-trestle');
    print(`control: the Gorge's decks tagged trestle stand ${bents.length} bents`);
    expect(bents.length).toBeGreaterThan(20);
    scene.dispose();
  });

  it('asks for the bent model only for a network with a `trestle` deck, forest or not', () => {
    const kinds = (tags: string[]) =>
      modelKindsFor({ tropical: false, tags: new Set(tags), palette: new Set(), traffic: [] });
    expect(kinds(['forest', 'bridge'])).not.toContain('trestleBent');
    expect(kinds(['forest', 'bridge', TRESTLE_TAG])).toContain('trestleBent');
    expect(kinds(['row-houses', 'bridge', TRESTLE_TAG])).toContain('trestleBent');
    for (const id of BRIDGED) {
      const t = track(id);
      const { tropical, tags } = networkTags(t.road, t.dressing);
      const wants = modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
      expect(wants.includes('trestleBent'), id).toBe(tags.has(TRESTLE_TAG));
    }
  });
});

// ---- The Gorge's deck arches ---------------------------------------------------------------------

/** A straight, level fixture deck of `deckM` metres starting at s 20 on a 200 m road, 40 m up. */
function fixtureEdge(deckM: number, extra: Partial<ArchEdge> = {}): ArchEdge {
  return {
    edge: 0,
    length: 200,
    tags: [
      { s0: 20, s1: 20 + deckM, side: 'both', tag: 'bridge' },
      { s0: 20, s1: 20 + deckM, side: 'both', tag: ARCH_TAG },
    ],
    gaps: [],
    ramps: [],
    at: (s) => ({ x: 0, y: 40, z: s }),
    ...extra,
  };
}
const kindOf = (variant: number) => ARCH_KINDS[variant];

describe('the arches a deck tagged `arch-bridge` gets', () => {
  it('a deck no longer than the big span and one bay takes the one 46 m span, centred', () => {
    const spots = planArches(fixtureEdge(48));
    expect(spots.map((s) => kindOf(s.variant))).toEqual(['span']);
    expect(spots[0]!.s).toBeCloseTo(20 + (48 - ARCH_M.span) / 2, 6);
  });

  it('a longer deck takes 24 m bays end to end, centred, as many as fit', () => {
    for (const deckM of [76, 105]) {
      const spots = planArches(fixtureEdge(deckM));
      const n = Math.floor(deckM / ARCH_M.bay);
      expect(spots.map((s) => kindOf(s.variant))).toEqual(Array<string>(n).fill('bay'));
      const lead = (deckM - n * ARCH_M.bay) / 2;
      spots.forEach((s, i) => expect(s.s, `${deckM} m deck, bay ${i}`).toBeCloseTo(20 + lead + i * 24, 6));
    }
  });

  it('a deck shorter than one bay, a deck with no `arch-bridge` tag and a gap take none', () => {
    expect(planArches(fixtureEdge(20))).toEqual([]);
    expect(
      planArches({ ...fixtureEdge(76), tags: [{ s0: 20, s1: 96, side: 'both', tag: 'bridge' }] }),
    ).toEqual([]);
    // A gap in the middle of a 76 m deck leaves 28 m either side: one bay each, none over the gap.
    const gapped = planArches(fixtureEdge(76, { gaps: [{ s0: 48, s1: 68 }] }));
    expect(gapped).toHaveLength(2);
    for (const s of gapped) expect(s.s + ARCH_M.bay <= 48 + 1e-6 || s.s >= 68 - 1e-6).toBe(true);
  });

  it('the kit holds the nodes the plan names, each as long as the plan says, its piers that deep', () => {
    const model = SUPPORTS.gorgeArches!;
    expect(model.variants).toHaveLength(ARCH_ROOTS.length);
    ARCH_KINDS.forEach((k, v) => {
      const g = model.variants[v]!;
      g.computeBoundingBox();
      const box = g.boundingBox!;
      expect(box.max.z - box.min.z, k).toBeCloseTo(ARCH_M[k], 0);
      expect(-box.min.y, k).toBeCloseTo(ARCH_PIER_M[k], 0);
      expect(box.max.y, `${k}: nothing above the deck top`).toBeLessThan(0.05);
    });
  });
});

describe("the Gorge's three bridges are concrete deck arches", () => {
  const gorge = track('osm-pnw-gorge');
  const archDecks = decks(gorge).filter((d) => d.arch);
  const scene = buildRoadScene(gorge.road, look, gorge.dressing, { seed: 7, models: SUPPORTS });
  const plain = buildRoadScene(gorge.road, look, gorge.dressing, { seed: 7 });
  const arches = scene.bays.filter((s) => s.kind === 'arch');

  /** The road-pylons instances standing within a deck's arches, as (s on the deck, width). */
  const pylonsOn = (sc: RoadScene, deck: (typeof archDecks)[number]) => {
    const p = new Vector3();
    const scale = new Vector3();
    const out: { s: number; w: number; top: number }[] = [];
    for (const m of instances(sc.group, 'road-pylons')) {
      p.setFromMatrixPosition(m);
      scale.setFromMatrixScale(m);
      const under = deckUnder(gorge, p.x, p.z, 6);
      if (under && under.deck.b === deck.b) out.push({ s: under.s, w: scale.x, top: p.y + scale.y });
    }
    return out;
  };

  it('tags all three decks `arch-bridge` in the bake, and none of them `trestle`', () => {
    expect(archDecks.map((d) => d.e.id).sort()).toEqual([
      'osm-gorge-crown-point-loops',
      'osm-gorge-latourell',
      'osm-gorge-shepperds-dell',
    ]);
    expect(decks(gorge).some((d) => d.trestle)).toBe(false);
  });

  it('runs the arches along each deck, their deck top on the road, with no bent under them', () => {
    for (const deck of archDecks) {
      const mine = arches.filter((a) => a.edge === deck.e.index && covers(deck.b, a.s));
      const run = mine.reduce((a, s) => a + ARCH_M[kindOf(s.variant)!], 0);
      const len = deck.b.s1 - deck.b.s0;
      print(
        `${deck.e.id}: deck ${len.toFixed(0)} m, ${mine.map((a) => kindOf(a.variant)).join('+')} = ${run} m`,
      );
      expect(mine.length, deck.e.id).toBeGreaterThan(0);
      // At most one bay's length of the deck is left bare (split between its two ends).
      expect(len - run, deck.e.id).toBeLessThan(ARCH_M.bay);
      expect(len - run, deck.e.id).toBeGreaterThanOrEqual(0);
      for (const a of mine) {
        const road = gorge.road.toWorld(deck.e.index, a.s, 0, 0);
        expect(Math.hypot(a.p.x - road.x, a.p.y - road.y, a.p.z - road.z), deck.e.id).toBeLessThan(0.05);
      }
    }
    expect(instances(scene.group, 'road-trestle')).toHaveLength(0);
  });

  it('stands each footing on a column down to the ground, and no plain pylon in the arches', () => {
    let columns = 0;
    for (const deck of archDecks) {
      const mine = arches.filter((a) => a.edge === deck.e.index && covers(deck.b, a.s));
      const spans = mine.map((a) => [a.s, a.s + ARCH_M[kindOf(a.variant)!]] as const);
      const inArch = (s: number) => spans.some(([a, b]) => s > a - 0.5 && s < b + 0.5);
      const here = pylonsOn(scene, deck).filter((p) => inArch(p.s));
      // Plain pylons are 0.9 m boxes at unit width; a column is wider.
      expect(
        here.filter((p) => p.w < 1.5),
        `${deck.e.id}: plain pylons inside the arches`,
      ).toEqual([]);
      for (const a of mine) {
        const k = kindOf(a.variant)!;
        for (const s of [a.s + ARCH_FOOTING.inM, a.s + ARCH_M[k] - ARCH_FOOTING.inM]) {
          const deckY = gorge.road.toWorld(deck.e.index, s, 0, 0).y;
          const col = here.find((p) => Math.abs(p.s - s) < 1.5 && p.w >= 1.5);
          expect(col, `${deck.e.id} column under the footing at s ${s.toFixed(0)}`).toBeDefined();
          // Its top meets the footing at the foot of the arch's pier.
          expect(
            Math.abs((col?.top ?? 0) - (deckY - ARCH_PIER_M[k])),
            `${deck.e.id} s ${s.toFixed(0)}`,
          ).toBeLessThan(0.6);
          columns++;
        }
      }
    }
    print(`the Gorge: ${arches.length} arches on ${archDecks.length} decks, ${columns} footings on columns`);
    expect(columns).toBeGreaterThan(0);
  });

  it('control: without the arch kit the same decks stand on plain pylons (the probe sees them)', () => {
    const n = archDecks.reduce((a, d) => a + pylonsOn(plain, d).filter((p) => p.w < 1.5).length, 0);
    print(`control: the Gorge without the kit stands ${n} plain pylons under its arch decks`);
    expect(n).toBeGreaterThan(4);
    expect(plain.bays.filter((s) => s.kind === 'arch')).toEqual([]);
  });

  it('asks for the arch kit only for a network with an `arch-bridge` deck', () => {
    const { tropical, tags } = networkTags(gorge.road, gorge.dressing);
    expect(modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] })).toContain('gorgeArches');
    for (const id of BRIDGED.filter((x) => x !== 'osm-pnw-gorge')) {
      const t = track(id);
      const n = networkTags(t.road, t.dressing);
      expect(modelKindsFor({ ...n, palette: new Set(), traffic: [] }), id).not.toContain('gorgeArches');
    }
  });
});
