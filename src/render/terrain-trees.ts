import { Group, InstancedMesh, Object3D, type BufferGeometry, type Material } from 'three';
import type { RoadNetwork } from '../road';
import { planTerrainTrees, type TerrainTree } from '../road/structures/terrain-trees';
import { MIN_THREAT_DRAW_M, type LookStyle } from './look';
import { deciduousGeometry } from './deciduous';

const CHUNK_M = 100;
interface TreeChunk {
  mesh: InstancedMesh;
  loX: number;
  hiX: number;
  loZ: number;
  hiZ: number;
}

export class TerrainTrees {
  readonly root = new Group();
  private road: RoadNetwork | null = null;
  private seed = -1;
  private readonly geometry: BufferGeometry;
  private readonly material: Material;
  private readonly chunks: TreeChunk[] = [];
  private placed = 0;
  private visible = 0;
  constructor(look: LookStyle, road: RoadNetwork | null = null, seed = 0) {
    this.geometry = deciduousGeometry();
    this.material = look.material('prop', { vertexColors: true });
    this.setRoad(road, seed);
  }
  setRoad(road: RoadNetwork | null, seed: number): void {
    if (road === this.road && seed === this.seed) return;
    this.road = road;
    this.seed = seed;
    for (const c of this.chunks) {
      this.root.remove(c.mesh);
      c.mesh.dispose();
    }
    this.chunks.length = 0;
    this.placed = this.visible = 0;
    if (!road) return;
    const cells = new Map<string, TerrainTree[]>();
    for (const tree of planTerrainTrees(road, seed).items) {
      const key = `${Math.floor(tree.x / CHUNK_M)},${Math.floor(tree.z / CHUNK_M)}`;
      const list = cells.get(key);
      if (list) list.push(tree);
      else cells.set(key, [tree]);
    }
    const pose = new Object3D();
    for (const trees of cells.values()) {
      const mesh = new InstancedMesh(this.geometry, this.material, trees.length);
      mesh.name = 'physical-rural-trees';
      let loX = Infinity,
        hiX = -Infinity,
        loZ = Infinity,
        hiZ = -Infinity;
      trees.forEach((tree, i) => {
        pose.position.set(tree.x, tree.baseY, tree.z);
        pose.rotation.set(0, tree.turn, 0);
        pose.scale.setScalar(tree.scale);
        pose.updateMatrix();
        mesh.setMatrixAt(i, pose.matrix);
        loX = Math.min(loX, tree.x);
        hiX = Math.max(hiX, tree.x);
        loZ = Math.min(loZ, tree.z);
        hiZ = Math.max(hiZ, tree.z);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.chunks.push({ mesh, loX, hiX, loZ, hiZ });
      this.root.add(mesh);
      this.placed += trees.length;
    }
  }
  /** Physical obstacles keep the threat floor even at the lowest scenery settings. */
  update(x: number, z: number, drawM: number): number {
    const reach = Math.max(MIN_THREAT_DRAW_M, drawM);
    this.visible = 0;
    for (const c of this.chunks) {
      const dx = Math.max(c.loX - x, 0, x - c.hiX);
      const dz = Math.max(c.loZ - z, 0, z - c.hiZ);
      c.mesh.visible = dx * dx + dz * dz <= reach * reach;
      if (c.mesh.visible) this.visible += c.mesh.count;
    }
    return this.visible;
  }
  counts() {
    return { placed: this.placed, visible: this.visible };
  }
  dispose(): void {
    this.setRoad(null, -1);
    this.geometry.dispose();
    this.material.dispose();
  }
}
