// The ground band as drawn (run W-R; interview, 2026-10-02: "Anywhere with ground"; off-road as "a
// ground band beside most roads ... water, ferns and kerbs are the real edges; some fences smash",
// and "remove the invisible wall where ground is drawn"). The checks build the layer on every real
// network with its real road files and look at what was built: rays down onto the band at the
// sim's own band (vergeAt), none past it, each region's edges and fence, the smash, and the feel.
import { InstancedMesh, Matrix4, Raycaster, Vector3, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import type { EntitySnapshot, GroundSurface, SimEvent, SimSnapshot } from '../sim/api';
import { createFlatLook } from './look';
import { networkTags, type RoadDressing } from './road-mesh';
import { VERGE_LIFT_M, VergeLayer } from './verge';

const look = createFlatLook();

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
            expect(Math.abs((hit?.point.y ?? 0) - mid.y)).toBeLessThan(0.15);
            on++;
            // Past the band's outer edge, and clear of any other road's band, nothing of this layer.
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

describe("each region's ground and edges", () => {
  it('the Keys: sand and gravel bands, white pickets at the marina and trailer park', () => {
    const { verge } = layer('keys-m1');
    const c = verge.counts();
    expect(c.fenceStyle).toBe('picket');
    expect(c.bandM.sand).toBeGreaterThan(500);
    expect(c.fencePanels).toBeGreaterThan(10);
    console.log(`[examined] keys-m1: ${JSON.stringify(c)}`);
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

  it('stays cheap: at most four meshes per chunk (band, shallows, fences, ferns)', () => {
    for (const id of NETWORKS) {
      const { verge } = layer(id);
      let chunks = 0;
      let meshes = 0;
      let tris = 0;
      for (const ch of verge.group.children) {
        if (!ch.name.startsWith('verge-chunk-')) continue;
        chunks++;
        expect(ch.children.length, `${id} ${ch.name}`).toBeLessThanOrEqual(4);
        meshes += ch.children.length;
        for (const m of ch.children as Mesh[]) {
          const idx = m.geometry.getIndex();
          const n = idx ? idx.count / 3 : 0;
          tris += m instanceof InstancedMesh ? n * m.count : n;
        }
      }
      console.log(`[examined] ${id}: ${chunks} chunks, ${meshes} meshes, ${tris} triangles in all`);
    }
  });
});

describe('the edges act', () => {
  it('a smash hides the fence panels it covers and throws boards; a second smash there breaks nothing', () => {
    const { road, verge } = layer('keys-m1');
    const found = firstFence(road);
    const fences = named(verge.group, 'verge-fence') as unknown as InstancedMesh[];
    const zeroBefore = countZero(fences);
    const n = verge.smash(found.edge, found.side, found.s - 4, found.s + 4);
    expect(n).toBeGreaterThanOrEqual(4);
    expect(countZero(fences) - zeroBefore).toBe(n);
    expect(verge.smash(found.edge, found.side, found.s - 4, found.s + 4)).toBe(0);
    verge.update(0, 0, snapOf([]), 1 / 60);
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

function countZero(meshes: readonly InstancedMesh[]): number {
  const m = new Matrix4();
  let n = 0;
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      if (m.elements[0] === 0 && m.elements[5] === 0 && m.elements[10] === 0) n++;
    }
  }
  return n;
}
