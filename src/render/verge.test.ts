// The ground band as drawn (run W-R; interview, 2026-10-02: "Anywhere with ground"; off-road as "a
// ground band beside most roads ... water, ferns and kerbs are the real edges; some fences smash",
// and "remove the invisible wall where ground is drawn"). The checks build the layer on every real
// network with its real road files and look at what was built: rays down onto the band at the
// sim's own band (vergeAt), none past it, each region's edges and fence, the smash, and the feel.
import { Raycaster, Vector3, type InstancedMesh, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import type { EntitySnapshot, GroundSurface, SimEvent, SimSnapshot } from '../sim/api';
import { createFlatLook } from './look';
import { buildRoadScene, networkTags, type RoadDressing } from './road-mesh';
import { SCENERY_RADIUS_M, TRUNK_M } from './scenery';
import { FENCE_SEG_M, VERGE_BEHIND_M, VERGE_LIFT_M, VERGE_LOD_M, VergeLayer } from './verge';

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
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

function layer(id: string): { road: RoadNetwork; verge: VergeLayer } {
  const { road, dressing } = track(id);
  const verge = new VergeLayer(road, look, { tags: networkTags(road, dressing).tags });
  verge.group.updateMatrixWorld(true);
  return { road, verge };
}

const named = (root: Object3D, name: string): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o.name === name) out.push(o as Mesh);
  });
  return out;
};

/** A rider entity as the snapshot carries it (only the fields the layer reads). */
function rider(over: Partial<EntitySnapshot>): EntitySnapshot {
  return {
    id: 0,
    kind: 'rider',
    mode: 'Road',
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 30,
    grounded: true,
    ground: 'asphalt',
    road: { edge: 0, s: 50, d: 0, h: 0, dir: 1, yaw: 0 },
    ...over,
  } as unknown as EntitySnapshot;
}

const snapOf = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 0,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 1, finishOrder: [] },
});

const NETWORKS = ['keys-m1', 'pnw-c1', 'sf-hills', 'osm-pnw-chuckanut', 'osm-sf-twin-peaks'] as const;

describe('the ground band is drawn where the sim lets a rider ride', () => {
  it.each(NETWORKS)(
    '%s: rays down hit the band mid-band at the road height, and miss it past the band',
    (id) => {
      const { road, verge } = layer(id);
      const bands = named(verge.group, 'verge-band');
      expect(bands.length).toBeGreaterThan(0);
      const ray = new Raycaster();
      const down = new Vector3(0, -1, 0);
      let on = 0;
      let off = 0;
      for (const e of road.edges) {
        for (let s = 7; s < e.length - 7; s += 37) {
          for (const side of ['left', 'right'] as const) {
            const v = road.vergeAt(e.index, s, side);
            // Mid-band, away from where a band starts or ends (a wall or a tag stops it there).
            const near = [s - 2.5, s + 2.5].map((x) => road.vergeAt(e.index, x, side).widthM);
            if (v.widthM < 1 || near.some((w) => w < v.widthM)) continue;
            const mid = road.toWorld(e.index, s, (v.dInner + v.dOuter) / 2, VERGE_LIFT_M);
            ray.set(new Vector3(mid.x, mid.y + 5, mid.z), down);
            const hit = ray.intersectObjects(bands, false)[0];
            expect(hit, `${id} ${e.id} s ${s} ${side}`).toBeDefined();
            expect(Math.abs((hit?.point.y ?? 0) - mid.y), `${id} ${e.id} s ${s} ${side}`).toBeLessThan(0.15);
            on++;
            // Past the band's outer edge, and clear of any other road's band, nothing of this layer
            // (past a water edge the shallows are drawn, in the same mesh: not counted).
            if (v.edge === 'water') {
              off++;
              continue;
            }
            const past = road.toWorld(e.index, s, v.dOuter + (side === 'left' ? -1.2 : 1.2), VERGE_LIFT_M);
            ray.set(new Vector3(past.x, past.y + 5, past.z), down);
            const beyond = ray.intersectObjects(bands, false)[0];
            if (!beyond || Math.abs(beyond.point.y - past.y) > 0.3) off++;
          }
        }
      }
      expect(on).toBeGreaterThan(20);
      // A station past one road's band can lie on another road's band (close roads, junctions).
      expect(off / on).toBeGreaterThan(0.8);
      console.log(`[examined] ${id}: ${on} band stations hit mid-band, ${off} clear past the edge`);
    },
  );
});

describe('nothing solid stands on the ridable ground', () => {
  it.each(['keys-m1', 'pnw-c1', 'osm-pnw-chuckanut'])(
    '%s: every tree, palm, pole, mangrove and shack stands its footprint past a loose band',
    (id) => {
      const { road, dressing } = track(id);
      const scene = buildRoadScene(road, look, dressing, { seed: 7 });
      const loose = new Set(['dirt', 'gravel', 'sand', 'grass']);
      let checked = 0;
      let banded = 0;
      for (const spot of scene.spots) {
        if (!['palm', 'pole', 'conifer', 'mangrove', 'shack'].includes(spot.kind)) continue;
        checked++;
        const v = road.vergeAt(spot.edge, spot.s, spot.d < 0 ? 'left' : 'right');
        if (!loose.has(v.surface) || v.widthM <= 0) continue;
        banded++;
        const past = Math.abs(spot.d) - Math.abs(v.dOuter);
        expect(
          past,
          `${spot.kind} on ${road.edges[spot.edge]?.id} s ${spot.s.toFixed(0)}`,
        ).toBeGreaterThanOrEqual((TRUNK_M[spot.kind] ?? SCENERY_RADIUS_M[spot.kind]) - 1e-6);
      }
      expect(banded).toBeGreaterThan(20);
      console.log(
        `[examined] ${id}: ${checked} solid scenery spots, ${banded} beside a loose band, all clear of it`,
      );
      scene.dispose();
    },
  );
});

describe("each region's ground and edges", () => {
  it('the Keys: sand and gravel bands, white pickets at the marina and trailer park', () => {
    const { verge } = layer('keys-m1');
    const c = verge.counts();
    expect(c.fenceStyle).toBe('picket');
    expect(c.bandM.sand).toBeGreaterThan(500);
    expect(c.fencePanels).toBeGreaterThan(10);
    console.log(`[examined] keys-m1: ${JSON.stringify(c)}`);
  });

  // Roadmap M5 (playtest 4 run C, punch item 9): a lower quality tier draws only its share of the fern
  // clumps (quality.ts `treeShare`, ranked as the scatter's trees are); a share of 1 draws every one.
  it("a lower tier's share of the ferns: fewer clumps drawn, all of them at a share of 1", () => {
    const { road, verge } = layer('pnw-c1');
    const p = road.toWorld(0, 300, 0, 0);
    const drawn = (share: number) => {
      verge.setTreeShare(share);
      verge.update(p.x, p.z, null, 0);
      return verge.counts().nearClumps;
    };
    const all = drawn(1);
    const low = drawn(0.4);
    const again = drawn(1);
    print(`[examined] pnw-c1 edge 0 s 300: ${all} fern clumps drawn at a share of 1, ${low} at 0.4`);
    expect(all).toBeGreaterThan(10);
    expect(again).toBe(all);
    expect(low).toBeLessThan(all * 0.6);
    expect(low).toBeGreaterThan(all * 0.2);
  });

  it('the Pacific Northwest: dirt under the trees ending in ferns, split rails at the landing', () => {
    const { verge } = layer('pnw-c1');
    const c = verge.counts();
    expect(c.fenceStyle).toBe('split-rail');
    expect(c.bandM.dirt).toBeGreaterThan(2000);
    expect(c.brushClumps).toBeGreaterThan(500);
    console.log(`[examined] pnw-c1: ${JSON.stringify(c)}`);
  });

  it('San Francisco: kerb and pavement to the house fronts, painted garden fences', () => {
    const { verge } = layer('sf-hills');
    const c = verge.counts();
    expect(c.fenceStyle).toBe('garden');
    expect(c.bandM.kerb).toBeGreaterThan(500);
    console.log(`[examined] sf-hills: ${JSON.stringify(c)}`);
  });

  it('stays cheap: one band mesh per chunk, plus near and far fences and ferns, the dust and the boards', () => {
    for (const id of NETWORKS) {
      const { road, verge } = layer(id);
      const bands = named(verge.group, 'verge-band');
      const others = verge.group.children.filter((o) => o.name !== 'verge-band').map((o) => o.name);
      expect(others.sort()).toEqual([
        'verge-boards',
        'verge-brush',
        'verge-brush-far',
        'verge-dust',
        'verge-fence',
        'verge-fence-far',
      ]);
      let tris = 0;
      for (const m of bands) tris += (m.geometry.getIndex()?.count ?? 0) / 3;
      // Along the road, the fences and ferns drawn stay inside their caps.
      let most = 0;
      const e = road.edges[0];
      for (let s = 0; e && s < e.length; s += 100) {
        const p = road.toWorld(e.index, s, 0, 0);
        verge.update(p.x, p.z, snapOf([]), 1 / 60);
        const c = verge.counts();
        most = Math.max(most, c.nearPanels + c.nearClumps);
      }
      console.log(
        `[examined] ${id}: ${bands.length} band meshes (${tris} triangles in all), 6 more; at most ${most} fence panels and fern clumps drawn at once`,
      );
    }
  });
});

describe('only what the camera can see is drawn', () => {
  // main-green-4 (2026-10-02): at the perf probe's tick 840 the Keys race drew 394 fence panels
  // (28 k triangles), 217 of them more than 10 m behind the rider. A camera aim leaves out what
  // stands behind the camera, and turning the camera round refills without moving.
  it('fences behind the camera are left out, and a camera turned round gets them back', () => {
    const { road, verge } = layer('keys-m1');
    const found = firstFence(road);
    const at = road.toWorld(found.edge, found.s, 0, 0);
    const ahead = road.toWorld(found.edge, Math.min(found.s + 20, road.edges[found.edge]!.length), 0, 0);
    const back = { x: 2 * at.x - ahead.x, z: 2 * at.z - ahead.z };
    verge.update(at.x, at.z, snapOf([]), 1 / 60);
    const all = verge.counts().nearPanels;
    verge.update(at.x, at.z, snapOf([]), 1 / 60, ahead.x, ahead.z);
    const forward = verge.counts().nearPanels;
    const fx = ahead.x - at.x;
    const fz = ahead.z - at.z;
    const len = Math.hypot(fx, fz);
    let worst = Infinity;
    let read = 0;
    // The near panels and (past VERGE_LOD_M) the far ones: both sets are what is drawn.
    for (const name of ['verge-fence', 'verge-fence-far']) {
      const fence = named(verge.group, name)[0] as unknown as InstancedMesh;
      for (let i = 0; i < fence.count; i++, read++) {
        const m = fence.instanceMatrix.array;
        const along = (((m[i * 16 + 12] ?? 0) - at.x) * fx + ((m[i * 16 + 14] ?? 0) - at.z) * fz) / len;
        worst = Math.min(worst, along);
      }
    }
    expect(read).toBe(forward);
    verge.update(at.x, at.z, snapOf([]), 1 / 60, back.x, back.z);
    const reversed = verge.counts().nearPanels;
    console.log(
      `[examined] keys-m1 fence at edge ${found.edge} s ${found.s.toFixed(0)}: ${all} panels with no aim, ${forward} aimed ahead (nearest ${worst.toFixed(1)} m along), ${reversed} turned round`,
    );
    expect(forward).toBeGreaterThan(0);
    expect(forward).toBeLessThan(all);
    expect(reversed).toBeGreaterThan(0);
    expect(reversed).toBeLessThan(all);
    expect(forward + reversed).toBeGreaterThanOrEqual(all);
    expect(worst).toBeGreaterThanOrEqual(-VERGE_BEHIND_M - FENCE_SEG_M);
  });
});

describe('far fences and ferns draw lighter (run W-S, the triangle headroom)', () => {
  const tris = (o: Object3D | undefined) => ((o as Mesh | undefined)?.geometry.getIndex()?.count ?? 0) / 3;
  const instanceAt = (m: InstancedMesh, i: number) => {
    const a = m.instanceMatrix.array;
    return { x: a[i * 16 + 12] ?? 0, z: a[i * 16 + 14] ?? 0 };
  };

  // A picket fence (the Keys), split rails and ferns (the Pacific Northwest). Twin Peaks was here for its
  // ferns until playtest 4 made it open grass hill (headlands), with no fern or fence to draw.
  for (const id of ['keys-m1', 'pnw-c1']) {
    it(`${id}: past VERGE_LOD_M the far form, nearer the whole one, and fewer triangles than before`, () => {
      const { road, verge } = layer(id);
      const near = named(verge.group, 'verge-fence')[0] as unknown as InstancedMesh;
      const far = named(verge.group, 'verge-fence-far')[0] as unknown as InstancedMesh;
      const fern = named(verge.group, 'verge-brush')[0] as unknown as InstancedMesh;
      const fernFar = named(verge.group, 'verge-brush-far')[0] as unknown as InstancedMesh;
      // Before run W-S each panel was 3 to 7 whole boxes (12 triangles each), each fern clump 3.
      const old = { picket: 72, 'split-rail': 36, garden: 84 }[verge.fenceStyle];
      expect(tris(near)).toBeLessThan(old);
      // The split rail's far form is its near one (a square post shows its sides), so it has none.
      if (verge.fenceStyle === 'split-rail') expect(tris(far)).toBe(tris(near));
      else expect(tris(far)).toBeLessThan(tris(near));
      expect(tris(fern)).toBeLessThan(36);
      expect(tris(fernFar)).toBeLessThan(tris(fern));
      let drawn = 0;
      let before = 0;
      let farSeen = 0;
      for (const e of road.edges)
        for (let s = 0; s < e.length; s += 150) {
          const c = road.toWorld(e.index, s, 0, 0);
          verge.update(c.x, c.z, snapOf([]), 1 / 60);
          for (let i = 0; i < near.count && verge.fenceStyle !== 'split-rail'; i++) {
            const p = instanceAt(near, i);
            expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeLessThanOrEqual(VERGE_LOD_M + 0.01);
          }
          for (let i = 0; i < fern.count; i++) {
            const p = instanceAt(fern, i);
            expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeLessThanOrEqual(VERGE_LOD_M + 0.01);
          }
          for (let i = 0; i < far.count; i++) {
            const p = instanceAt(far, i);
            expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeGreaterThan(VERGE_LOD_M);
          }
          if (verge.fenceStyle === 'split-rail') expect(far.count).toBe(0);
          farSeen += far.count + fernFar.count;
          drawn +=
            near.count * tris(near) +
            far.count * tris(far) +
            fern.count * tris(fern) +
            fernFar.count * tris(fernFar);
          before += (near.count + far.count) * old + (fern.count + fernFar.count) * 36;
        }
      print(
        `[examined] ${id} (${verge.fenceStyle}): a panel ${tris(near)} triangles near, ${tris(far)} far (was ${old}); a fern clump ${tris(fern)} and ${tris(fernFar)} (was 36); fences and ferns over the walk ${drawn} triangles, ${before} before`,
      );
      expect(farSeen).toBeGreaterThan(0);
      expect(drawn).toBeLessThan(before * 0.75);
    });
  }
});

describe('the edges act', () => {
  it('a smash hides the fence panels it covers and throws boards; a second smash there breaks nothing', () => {
    const { road, verge } = layer('keys-m1');
    const found = firstFence(road);
    const at = road.toWorld(found.edge, found.s, 0, 0);
    verge.update(at.x, at.z, snapOf([]), 1 / 60);
    const before = verge.counts().nearPanels;
    expect(before).toBeGreaterThan(8);
    const n = verge.smash(found.edge, found.side, found.s - 4, found.s + 4);
    expect(n).toBeGreaterThanOrEqual(4);
    expect(verge.smash(found.edge, found.side, found.s - 4, found.s + 4)).toBe(0);
    verge.update(at.x, at.z, snapOf([]), 1 / 60);
    expect(verge.counts().nearPanels).toBe(before - n);
    expect(verge.counts().boards).toBe(n * 4);
    expect(verge.counts().brokenPanels).toBe(n);
  });

  it("a fence smash event breaks the fence where the sim's event says", () => {
    const { road, verge } = layer('keys-m1');
    const e = road.edges.find((x) => road.vergeAt(x.index, x.length / 2, 'right').edge === 'fence');
    if (!e) throw new Error('no right-side fence');
    const s = e.length / 2;
    const ev = {
      type: 'wobble',
      tick: 0,
      actor: 0,
      data: { cause: 'fence', object: 'fence', smashed: true, side: 1, s0: s - 4, s1: s + 4 },
    } as unknown as SimEvent;
    verge.pushEvents([ev]);
    verge.update(0, 0, snapOf([rider({ road: { edge: e.index, s, d: 9, h: 0, dir: 1, yaw: 0 } })]), 1 / 60);
    expect(verge.counts().brokenPanels).toBeGreaterThanOrEqual(4);
    expect(verge.counts().bursts.boards).toBe(1);
  });

  it('a splash at the water and leaves at the ferns, from their wobble events', () => {
    const { verge } = layer('pnw-c1');
    const ev = (cause: string) =>
      ({ type: 'wobble', tick: 0, actor: 0, data: { cause } }) as unknown as SimEvent;
    verge.pushEvents([ev('water'), ev('brush'), ev('barrier')]);
    verge.update(0, 0, snapOf([rider({})]), 1 / 60);
    const c = verge.counts();
    expect(c.bursts).toEqual({ splash: 1, leaves: 1, boards: 0 });
    expect(c.particles).toBe(28 + 16);
  });
});

describe('the feel on loose ground', () => {
  it('kicks up its surface behind a bike on sand, dirt, gravel and grass, never on the road', () => {
    const { verge } = layer('keys-m1');
    const frames = (ground: GroundSurface | null, speed = 30, grounded = true) => {
      const v = layer('keys-m1').verge;
      for (let i = 0; i < 30; i++) v.update(0, 0, snapOf([rider({ ground, speed, grounded })]), 1 / 60);
      return v.counts().particles;
    };
    for (const g of ['sand', 'dirt', 'gravel', 'grass'] as const) expect(frames(g), g).toBeGreaterThan(3);
    expect(frames('asphalt')).toBe(0);
    expect(frames('shoulder')).toBe(0);
    expect(frames('sand', 2)).toBe(0);
    expect(frames('sand', 30, false)).toBe(0);
    verge.dispose();
  });
});

/** The first station on a network with a fence at its band's edge. */
function firstFence(road: RoadNetwork): { edge: number; s: number; side: -1 | 1 } {
  for (const e of road.edges) {
    for (let s = 10; s < e.length; s += 10) {
      for (const side of [-1, 1] as const) {
        if (road.vergeAt(e.index, s, side < 0 ? 'left' : 'right').edge === 'fence')
          return { edge: e.index, s, side };
      }
    }
  }
  throw new Error('no fence on the network');
}
