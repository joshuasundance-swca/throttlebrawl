// A brick road draws as brick (playtest 3, wave B's live check, item 7: "Lombard's crooked block draws
// in grey asphalt though the bake marks it brick"). The rule: a road whose `surface` is brick draws its
// lanes in the brick material with mortar joints across them, in every look, and a road of any other
// surface draws as it did. The checks build the real San Francisco and Keys roads and ask which
// mesh lies under points on them.
import { InstancedMesh, Mesh, MeshLambertMaterial, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { createLookSet, LOOK_IDS } from './looks';
import { buildRoadScene, type RoadDressing, type RoadScene } from './road-mesh';

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function build(id: string): { road: RoadNetwork; scene: RoadScene } {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const road = createRoadNetwork({ network, roads });
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road, scene: buildRoadScene(road, createFlatLook(), dressing, { roadsideDensity: 0 }) };
}

type Tri = readonly [number, number, number, number, number, number];

/** The (x, z) triangles of every mesh of one name. */
function trisNamed(scene: RoadScene, name: string): Tri[] {
  const out: Tri[] = [];
  scene.group.traverse((o) => {
    if (!(o instanceof Mesh) || o instanceof InstancedMesh || o.name !== name) return;
    const g = o.geometry as BufferGeometry;
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const count = idx ? idx.count : pos.count;
    for (let k = 0; k + 2 < count; k += 3) {
      const v = [0, 1, 2].map((i) => (idx ? idx.getX(k + i) : k + i));
      out.push([
        pos.getX(v[0]!),
        pos.getZ(v[0]!),
        pos.getX(v[1]!),
        pos.getZ(v[1]!),
        pos.getX(v[2]!),
        pos.getZ(v[2]!),
      ]);
    }
  });
  return out;
}

function covers(tris: readonly Tri[], x: number, z: number): boolean {
  return tris.some(([ax, az, bx, bz, cx, cz]) => {
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) return false;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    return u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6;
  });
}

const lombard = build('osm-sf-lombard');
const crooked = lombard.road.edges.find((e) => e.id === 'osm-sf-lombard-crooked');
const plain = lombard.road.edges.find((e) => e.surface === 'asphalt' && e.length > 100 && !e.isConnector);

describe('a brick road draws as brick', () => {
  it("draws the crooked block's lanes in the brick surface and nowhere in asphalt", () => {
    expect(crooked?.surface).toBe('brick');
    const brick = trisNamed(lombard.scene, 'road-brick');
    const asphalt = trisNamed(lombard.scene, 'road-road');
    const samples: [number, number][] = [];
    for (let s = 3; s < crooked!.length - 3; s += 5) {
      for (const d of [-1.5, 0, 1.5]) {
        const p = lombard.road.toWorld(crooked!.index, s, d, 0);
        samples.push([p.x, p.z]);
      }
    }
    expect(samples.length).toBeGreaterThan(100);
    const notBrick = samples.filter(([x, z]) => !covers(brick, x, z));
    expect(notBrick, 'lane points with no brick under them').toEqual([]);
    // A tight hairpin's own legs run close by, so only the middle of each lane is asked about asphalt.
    const onAsphalt = samples.filter(([x, z]) => covers(asphalt, x, z));
    expect(onAsphalt.length, 'lane points with asphalt over them').toBe(0);
  });

  it('control: the same check finds asphalt under an asphalt road of the same network', () => {
    expect(plain).toBeDefined();
    const brick = trisNamed(lombard.scene, 'road-brick');
    const asphalt = trisNamed(lombard.scene, 'road-road');
    const p = lombard.road.toWorld(plain!.index, plain!.length / 2, 0, 0);
    expect(covers(asphalt, p.x, p.z)).toBe(true);
    expect(covers(brick, p.x, p.z)).toBe(false);
  });

  it('lays mortar joints across the brick, only over brick', () => {
    expect(lombard.scene.stats.brickCourses).toBeGreaterThan(50);
    const joints = trisNamed(lombard.scene, 'road-brickCourse');
    expect(joints.length).toBe(lombard.scene.stats.brickCourses * 2);
    const brick = trisNamed(lombard.scene, 'road-brick');
    // Every joint corner lies over brick (the joints are laid on the lanes, not beside them).
    const off = joints.filter(([ax, az, bx, bz, cx, cz]) => {
      const mx = (ax + bx + cx) / 3;
      const mz = (az + bz + cz) / 3;
      return !covers(brick, mx, mz);
    });
    expect(off).toEqual([]);
  });

  it('leaves the Keys boardwalk (a brick-grip surface drawn as planks) and other roads as they were', () => {
    const keys = build('keys-m1');
    const boardwalk = keys.road.edges.find((e) => e.id === 'm1-mangrove-boardwalk');
    expect(boardwalk?.surface).toBe('brick');
    expect(trisNamed(keys.scene, 'road-brick')).toEqual([]);
    expect(keys.scene.stats.brickCourses).toBe(0);
    expect(trisNamed(keys.scene, 'road-road').length).toBeGreaterThan(100);
  });
});

describe('the brick material', () => {
  it.each(LOOK_IDS)('is a red brick, not asphalt, in the %s look', (id) => {
    const set = createLookSet(createFlatLook());
    set.select(id);
    const brick = (set.material('brick') as MeshLambertMaterial).color;
    const road = (set.material('road') as MeshLambertMaterial).color;
    // Red leads green leads blue, clearly: a brick, where asphalt is a grey (red close to blue).
    expect(brick.r, `${id} brick red over green`).toBeGreaterThan(brick.g * 1.3);
    expect(brick.g, `${id} brick green over blue`).toBeGreaterThan(brick.b * 1.05);
    expect(brick.r - road.r, `${id} brick redder than the road`).toBeGreaterThan(0.1);
  });
});
