/// <reference types="vite/client" />
// The Marin Headlands and the Twin Peaks summit have things standing on them (playtest 4, P4-19, run C,
// task C2; the identity sheets' G2 and T1; Codex CX6's `models/scenery/sf-headlands`, built and placed
// nowhere until now). The maintainer: "The real roads do not have the characteristics of the roads in
// question in terms of scenery and feel etc". The headlands' grass had nothing on it (`RATE.headlands`
// was empty): now a Golden Gate road's Gate side carries low concrete gun batteries, and every headlands
// road coyote brush; the Twin Peaks climb's last stretch, at the top, carries outcrops of red chert.
//
// Three rules, each held by a check with a control that must find the thing, so a pass is never an
// empty one:
// - a battery stands only on a headlands side that faces the water the network crosses (the Gate's
//   side), never on the landward one, and only on a network that crosses water;
// - an outcrop stands only within reach of the end of a headlands road that ends there (the summit);
// - all of them stand past the ridable band, on drawn land, and no network of San Francisco draws a
//   conifer (src/render/sf-land.test.ts holds that for every network of the pack).
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { modelKindsFor, type SceneryModels } from './models';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import {
  ridableBandPast,
  scatterEdge,
  SUMMIT_REACH_M,
  themeAt,
  type ScatterEdge,
  type ScenerySpot,
  type SideTheme,
} from './scenery';

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

function track(id: string): Track {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { roads, road: createRoadNetwork({ network, roads }), dressing };
}

const kindsOf = (t: Track) => {
  const { tropical, tags } = networkTags(t.road, t.dressing);
  return modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
};

async function modelsOf(t: Track): Promise<SceneryModels> {
  const out: SceneryModels = {};
  for (const k of kindsOf(t)) out[k] = await bakeRepoModel(k);
  return out;
}

const SF = Object.values(networkFiles)
  .map((n) => n.id)
  .sort();
const SEEDS = [1, 2, 3, 7, 11];
const KINDS = ['battery', 'brush', 'outcrop'] as const;
const headlandsKinds = (spots: readonly ScenerySpot[]) =>
  spots.filter((s) => (KINDS as readonly string[]).includes(s.kind));

/** The model variants the three kinds draw: the file's roots in order (models.ts `ROOTS`). */
const VARIANT = { battery: 0, brush: 1, outcrop: 2 } as const;

describe('the headlands kit loads for a network with headlands, and only for one', () => {
  it.each(SF)(
    '%s asks for models/scenery/sf-headlands exactly when a road of it is tagged headlands',
    (id) => {
      const t = track(id);
      const tagged = t.roads.some((r) => (r.tags ?? []).some((x) => x.tag === 'headlands'));
      expect(kindsOf(t).includes('sfHeadlands'), id).toBe(tagged);
    },
  );

  it('the Golden Gate and the Twin Peaks climb are headlands, so the control set is not empty', () => {
    expect(kindsOf(track('osm-sf-golden-gate'))).toContain('sfHeadlands');
    expect(kindsOf(track('osm-sf-twin-peaks'))).toContain('sfHeadlands');
  });

  it("bakes the file's three roots as three variants: a battery, a brush clump and a chert outcrop", async () => {
    const m = await bakeRepoModel('sfHeadlands');
    expect(m.variants).toHaveLength(3);
    for (const g of m.variants) expect(g.getAttribute('position').count).toBeGreaterThan(0);
  });
});

/** A bare edge for the scatter: flat ground, a road along +x, nothing in the way. */
function bare(over: Partial<ScatterEdge> = {}): ScatterEdge {
  return {
    seed: 5,
    edge: 0,
    length: 2400,
    density: 1,
    tropical: false,
    outer: () => 2,
    theme: (): SideTheme => 'headlands',
    landReach: () => 24,
    clear: () => true,
    openWater: () => false,
    world: (s, d, h) => ({ x: s, y: h, z: d }),
    ...over,
  };
}

describe('the headlands rules, on a bare edge', () => {
  it('stands a battery only where the side faces the water, and an outcrop only in the summit', () => {
    const spots = scatterEdge(
      bare({ seaward: (side) => side === 1, summit: (s) => s > 2400 - SUMMIT_REACH_M }),
    );
    const batteries = spots.filter((s) => s.kind === 'battery');
    const outcrops = spots.filter((s) => s.kind === 'outcrop');
    print(`bare edge: ${batteries.length} batteries, ${outcrops.length} outcrops, ${spots.length} spots`);
    expect(batteries.length).toBeGreaterThan(3);
    expect(batteries.every((s) => s.d > 0)).toBe(true);
    expect(outcrops.length).toBeGreaterThan(5);
    expect(outcrops.every((s) => s.s > 2400 - SUMMIT_REACH_M)).toBe(true);
    // Brush is the headlands' own: both sides, the whole length.
    const brush = spots.filter((s) => s.kind === 'brush');
    expect(brush.some((s) => s.d < 0) && brush.some((s) => s.d > 0)).toBe(true);
    expect(Math.min(...brush.map((s) => s.s))).toBeLessThan(300);
    expect(Math.max(...brush.map((s) => s.s))).toBeGreaterThan(2000);
    // Each kind draws its own root of the file.
    for (const s of spots)
      if (s.kind in VARIANT) expect(s.variant, s.kind).toBe(VARIANT[s.kind as keyof typeof VARIANT]);
  });

  it('control: with no water side and no summit it stands no battery and no outcrop, only brush', () => {
    const spots = scatterEdge(bare());
    expect(spots.filter((s) => s.kind === 'battery' || s.kind === 'outcrop')).toEqual([]);
    expect(spots.filter((s) => s.kind === 'brush').length).toBeGreaterThan(20);
  });

  it('stands none of the three on any other theme (the Presidio, the forest, the city)', () => {
    for (const theme of ['presidio', 'forest', 'urban', 'palms', 'beach'] as const) {
      const spots = scatterEdge(
        bare({
          theme: () => theme,
          tropical: theme === 'palms' || theme === 'beach',
          seaward: () => true,
          summit: () => true,
        }),
      );
      expect(headlandsKinds(spots), theme).toEqual([]);
    }
  });

  it('keeps a battery in front of its land: its back and both ends on land, its front past the band', () => {
    // 9 m of land past the verge is too little for a 12 m deep battery whatever the roll.
    const spots = scatterEdge(bare({ landReach: () => 9, seaward: () => true }));
    expect(spots.filter((s) => s.kind === 'battery')).toEqual([]);
    // With a ridable band 6 m deep, its front (5.6 m ahead of its origin) stands past it.
    const banded = scatterEdge(bare({ band: () => 6, seaward: () => true }));
    const own = banded.filter((s) => s.kind === 'battery');
    expect(own.length).toBeGreaterThan(3);
    for (const s of own)
      expect(Math.abs(s.d) - 2 - 5.6, `s ${s.s.toFixed(0)}`).toBeGreaterThanOrEqual(6 - 1e-6);
  });
});

describe('the Golden Gate: batteries on the Gate side, brush on both, no pine', () => {
  const t = track('osm-sf-golden-gate');
  const byIndex = (i: number) => t.roads.find((r) => r.id === t.road.edges[i]?.id)!;

  /** The middle of the water the network crosses: the baked bridge's own samples (not the code's). */
  const water = (() => {
    const pts: { x: number; z: number }[] = [];
    for (const e of t.road.edges) {
      const r = t.roads.find((x) => x.id === e.id)!;
      if (!(r.tags ?? []).some((x) => x.tag === 'water-open')) continue;
      for (let s = 0; s <= e.length; s += 20) pts.push(t.road.toWorld(e.index, s, 0, 0));
    }
    return {
      x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
      z: pts.reduce((a, p) => a + p.z, 0) / pts.length,
      n: pts.length,
    };
  })();

  /** How squarely a side of the road at s faces the water's middle: the cosine, -1..1. */
  const facing = (edge: number, side: -1 | 1, s: number): number => {
    const f = t.road.frameAt(edge, s);
    const nx = side > 0 ? -f.tz : f.tz;
    const nz = side > 0 ? f.tx : -f.tx;
    const qx = water.x - f.x;
    const qz = water.z - f.z;
    return (nx * qx + nz * qz) / Math.hypot(qx, qz);
  };

  it('has water to face: the bridge is baked as water-open', () => {
    expect(water.n).toBeGreaterThan(100);
  });

  it('stands batteries on headlands land, on the side that faces the Gate, off the band, and brush on both sides', async () => {
    const models = await modelsOf(t);
    let batteries = 0;
    let brushL = 0;
    let brushR = 0;
    let worstFacing = 1;
    for (const seed of SEEDS) {
      const scene = buildRoadScene(t.road, look, t.dressing, { seed, models });
      for (const s of scene.spots) {
        if (!(KINDS as readonly string[]).includes(s.kind)) continue;
        const side = s.d < 0 ? -1 : 1;
        const road = byIndex(s.edge);
        const where = `seed ${seed} ${s.kind} ${road.id} s ${s.s.toFixed(0)}`;
        expect(themeAt(road.tags, side < 0 ? 'left' : 'right', s.s), where).toBe('headlands');
        expect(s.kind, where).not.toBe('outcrop');
        const edge = t.road.edges[s.edge]!;
        const outer = side < 0 ? -edge.dMin + 0.6 : edge.dMax + 0.6;
        const band = ridableBandPast(t.road, s.edge, side, s.s, outer);
        expect(Math.abs(s.d) - outer, where).toBeGreaterThanOrEqual(band);
        expect(scene.landReach(s.edge, side, s.s), where).toBeGreaterThan(Math.abs(s.d) - outer);
        if (s.kind === 'battery') {
          batteries++;
          worstFacing = Math.min(worstFacing, facing(s.edge, side, s.s));
          expect(facing(s.edge, side, s.s), `${where}: faces the Gate`).toBeGreaterThan(0.3);
          expect(s.variant, where).toBe(VARIANT.battery);
        }
        if (s.kind === 'brush') {
          if (side < 0) brushL++;
          else brushR++;
        }
      }
      scene.dispose();
    }
    print(
      `the Golden Gate over ${SEEDS.length} seeds: ${batteries} batteries (worst facing ${worstFacing.toFixed(2)}), ` +
        `brush ${brushL} left / ${brushR} right`,
    );
    expect(batteries).toBeGreaterThan(15);
    expect(brushL).toBeGreaterThan(30);
    expect(brushR).toBeGreaterThan(30);
  });

  it('control: the landward side is headlands too, and has brush on it but never a battery', async () => {
    const models = await modelsOf(t);
    let landwardHeadlands = 0;
    for (const seed of SEEDS) {
      const scene = buildRoadScene(t.road, look, t.dressing, { seed, models });
      for (const s of scene.spots) {
        const side = s.d < 0 ? -1 : 1;
        if (s.kind === 'brush' && facing(s.edge, side, s.s) < -0.3) landwardHeadlands++;
        if (s.kind === 'battery') expect(facing(s.edge, side, s.s)).toBeGreaterThan(-0.3);
      }
      scene.dispose();
    }
    expect(landwardHeadlands).toBeGreaterThan(10);
  });

  it('draws no battery on the bridge or the toll plaza, no outcrop anywhere, no conifer, house or pole', async () => {
    const models = await modelsOf(t);
    for (const seed of SEEDS) {
      const scene = buildRoadScene(t.road, look, t.dressing, { seed, models });
      for (const s of scene.spots) {
        const road = byIndex(s.edge);
        if ((KINDS as readonly string[]).includes(s.kind))
          expect(
            (road.tags ?? []).some((x) => x.tag === 'bridge' || x.tag === 'presidio'),
            `${road.id} ${s.kind}`,
          ).toBe(false);
      }
      expect(scene.spots.filter((s) => s.kind === 'outcrop')).toEqual([]);
      expect(scene.stats.scenery.conifer).toBe(0);
      expect(scene.stats.scenery.house).toBe(0);
      expect(scene.stats.scenery.pole).toBe(0);
      scene.dispose();
    }
  });
});

describe('the Twin Peaks summit: chert outcrops within reach of the climb end, off the road', () => {
  const t = track('osm-sf-twin-peaks');
  const climb = t.road.edges.find((e) => e.id === 'osm-sf-twin-peaks-climb')!;

  it('the climb ends at the top: nothing follows it', () => {
    expect(climb.nextLinks).toHaveLength(0);
  });

  it('stands outcrops only in the last stretch of the climb, past the band, with brush all along it', async () => {
    const models = await modelsOf(t);
    let outcrops = 0;
    let brushOutside = 0;
    for (const seed of SEEDS) {
      const scene = buildRoadScene(t.road, look, t.dressing, { seed, models });
      for (const s of scene.spots) {
        const where = `seed ${seed} ${s.kind} s ${s.s.toFixed(0)}`;
        if (s.kind === 'battery') throw new Error(`${where}: a battery on a network that crosses no water`);
        if (s.kind === 'brush' && s.edge === climb.index && s.s < climb.length - SUMMIT_REACH_M)
          brushOutside++;
        if (s.kind !== 'outcrop') continue;
        outcrops++;
        expect(s.edge, where).toBe(climb.index);
        expect(s.s, where).toBeGreaterThanOrEqual(climb.length - SUMMIT_REACH_M);
        expect(s.variant, where).toBe(VARIANT.outcrop);
        const side = s.d < 0 ? -1 : 1;
        const outer = side < 0 ? -climb.dMin + 0.6 : climb.dMax + 0.6;
        expect(Math.abs(s.d) - outer, where).toBeGreaterThanOrEqual(
          ridableBandPast(t.road, s.edge, side, s.s, outer),
        );
        expect(scene.landReach(s.edge, side, s.s), where).toBeGreaterThan(Math.abs(s.d) - outer);
      }
      expect(scene.stats.scenery.conifer).toBe(0);
      scene.dispose();
    }
    print(
      `the Twin Peaks climb over ${SEEDS.length} seeds: ${outcrops} chert outcrops, ${brushOutside} brush clumps before the summit`,
    );
    expect(outcrops).toBeGreaterThan(20);
    expect(brushOutside).toBeGreaterThan(30);
  });

  it('control: the Golden Gate, which ends on no headlands road, stands no outcrop', async () => {
    const g = track('osm-sf-golden-gate');
    const scene = buildRoadScene(g.road, look, g.dressing, { seed: 7, models: await modelsOf(g) });
    expect(scene.spots.filter((s) => s.kind === 'outcrop')).toEqual([]);
    scene.dispose();
  });
});

// Playtest 4, run C's live check: "the headland batteries read as small grey blocks or rubble on Conzelman's
// verge, not gun emplacements". The kit's battery is a 30 m by 3.7 m wall with two open gun pits behind it, which
// from the road is a grey block with three dark slits. Two things make it read: it stands bigger (a spot's size,
// with every footprint number that follows it), and each pit has its gun, a code-made barrel laid on the
// parapet (`withBatteryGuns`), since the file has none and this lane has no Blender.
describe('a battery reads as a concrete gun emplacement (playtest 4, run C)', () => {
  const ORIGINAL_VERTS = 660; // the file's own vertices of the battery root, which the guns follow

  async function battery() {
    const m = await bakeRepoModel('sfHeadlands');
    const g = m.variants[0]!;
    g.computeBoundingBox();
    return { g, box: g.boundingBox! };
  }

  /** The vertices that are dark steel (the guns): nothing else in the file is that dark above the parapet. */
  function dark(g: Awaited<ReturnType<typeof battery>>['g'], from: number, to: number) {
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    const out: { x: number; y: number; z: number }[] = [];
    for (let i = from; i < Math.min(to, pos.count); i++)
      if (col.getX(i) < 0.15 && col.getY(i) < 0.15 && pos.getY(i) > 3.7)
        out.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
    return out;
  }

  it('stands at least 45 m long and 5.5 m high on the Golden Gate, every battery the same size', async () => {
    const t = track('osm-sf-golden-gate');
    const models = await modelsOf(t);
    const { box } = await battery();
    const sizes = new Set<number>();
    for (const seed of SEEDS) {
      const scene = buildRoadScene(t.road, look, t.dressing, { seed, models });
      for (const s of scene.spots) if (s.kind === 'battery') sizes.add(s.size);
      scene.dispose();
    }
    expect(sizes.size, 'one size for every battery').toBe(1);
    const size = [...sizes][0]!;
    const length = (box.max.x - box.min.x) * size;
    const wall = 3.7 * size;
    print(`a battery: size ${size}, ${length.toFixed(1)} m long, ${wall.toFixed(1)} m of front wall`);
    expect(length).toBeGreaterThanOrEqual(45);
    expect(wall).toBeGreaterThanOrEqual(5.5);
  });

  it('has a gun in each pit: a barrel laid over the parapet, inside the footprint (control: the file has none)', async () => {
    const { g, box } = await battery();
    const pos = g.getAttribute('position');
    expect(pos.count, 'guns follow the file’s own vertices').toBeGreaterThan(ORIGINAL_VERTS);
    // The control: the file's own vertices have no dark steel over the parapet, so the finder can tell.
    expect(dark(g, 0, ORIGINAL_VERTS)).toEqual([]);
    const guns = dark(g, ORIGINAL_VERTS, pos.count);
    expect(guns.length).toBeGreaterThan(40);
    // One in each pit (the pits stand at x = -7 and 7), each lifting over the parapet toward the front.
    for (const x of [-7, 7]) {
      const own = guns.filter((p) => Math.abs(p.x - x) < 1);
      expect(own.length, `a gun at x ${x}`).toBeGreaterThan(20);
      expect(Math.max(...own.map((p) => p.y)), `its muzzle over the parapet at x ${x}`).toBeGreaterThan(4.3);
      expect(Math.max(...own.map((p) => p.z)), `its muzzle reaches the front wall at x ${x}`).toBeGreaterThan(
        4.4,
      );
    }
    // And they add nothing past the file's footprint: the front stays where the scatter keeps it off the band.
    expect(box.max.z).toBeLessThanOrEqual(5.6);
    expect(box.min.x).toBeGreaterThanOrEqual(-15.01);
    expect(box.max.x).toBeLessThanOrEqual(15.01);
  });
});
