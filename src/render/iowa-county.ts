// County facilities share the park's physical-box drawing. Low crops are soft, lazy dressing.
import { BufferGeometry, Color, Float32BufferAttribute, Mesh, Raycaster, Vector2, type Camera } from 'three';
import type { IowaCountyLayout } from '../road/structures/iowa-county';
import { IowaParkLayer, type IowaParkCounts } from './iowa-park';
import type { LookStyle } from './look';
import type { VisibleContent } from './boards';
import { sceneRef } from './scenes/layer';

export const hasIowaCounty = (tags: ReadonlySet<string>): boolean => tags.has('iowa-county-farmstead');
export type IowaCountyCounts = IowaParkCounts;

export class IowaCountyLayer extends IowaParkLayer {
  private readonly cropViews: { mesh: Mesh; ref: string; radiusM: number }[] = [];
  private readonly cropHidden = new Set<string>();
  private readonly cropRay = new Raycaster();
  private readonly cropPointer = new Vector2();
  private cropCounts: IowaCountyCounts = { placed: 0, visible: 0, triangles: 0 };

  constructor(look: LookStyle, opts: { layout: IowaCountyLayout }) {
    super(look, opts);
    this.group.name = 'iowa-county';
    const colours = [new Color('#87733e'), new Color('#a69750')];
    for (const field of opts.layout.crops ?? []) {
      const positions: number[] = [],
        colors: number[] = [];
      for (const [i, p] of field.vertices.entries()) {
        positions.push(p[0] - field.x, p[1], p[2] - field.z);
        const colour = colours[Math.floor(i / 6) % 2]!;
        colors.push(colour.r, colour.g, colour.b);
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, look.material('prop', { vertexColors: true, doubleSided: true }));
      mesh.name = field.id;
      mesh.position.set(field.x, 0, field.z);
      mesh.visible = false;
      const ref = sceneRef('region-clinton', 'clinton-iowa', field.id.replaceAll(':', '-'));
      mesh.userData['contentRef'] = ref;
      this.cropViews.push({ mesh, ref, radiusM: field.radiusM });
      this.group.add(mesh);
    }
    this.cropCounts.placed = this.cropViews.length;
  }

  override hide(refs: Iterable<string>): void {
    const list = [...refs];
    super.hide(list);
    for (const ref of list) this.cropHidden.add(ref);
    for (const v of this.cropViews) if (this.cropHidden.has(v.ref)) v.mesh.visible = false;
  }
  override visibleContent(): VisibleContent[] {
    return [
      ...super.visibleContent(),
      ...this.cropViews
        .filter((v) => v.mesh.visible && !this.cropHidden.has(v.ref))
        .map((v) => ({ ref: v.ref, kind: 'sign' as const, label: 'County crop rows' })),
    ];
  }
  override pick(nx: number, ny: number, camera: Camera): string | null {
    const facility = super.pick(nx, ny, camera);
    if (facility) return facility;
    this.cropRay.setFromCamera(this.cropPointer.set(nx, ny), camera);
    const hit = this.cropRay.intersectObjects(
      this.cropViews.filter((v) => v.mesh.visible && !this.cropHidden.has(v.ref)).map((v) => v.mesh),
      false,
    )[0];
    return hit ? String(hit.object.userData['contentRef']) : null;
  }
  override update(cameraX: number, cameraZ: number, drawM: number): number {
    const facilities = super.update(cameraX, cameraZ, drawM);
    let visible = 0,
      triangles = 0;
    for (const v of this.cropViews) {
      v.mesh.visible =
        !this.cropHidden.has(v.ref) &&
        Math.hypot(cameraX - v.mesh.position.x, cameraZ - v.mesh.position.z) - v.radiusM < drawM;
      if (v.mesh.visible) {
        visible++;
        triangles += v.mesh.geometry.getAttribute('position').count / 3;
      }
    }
    this.cropCounts = { placed: this.cropViews.length, visible, triangles };
    return facilities + visible;
  }
  override counts(): IowaCountyCounts {
    const base = super.counts();
    return {
      placed: base.placed + this.cropCounts.placed,
      visible: base.visible + this.cropCounts.visible,
      triangles: base.triangles + this.cropCounts.triangles,
    };
  }
  override dispose(): void {
    for (const v of this.cropViews) v.mesh.geometry.dispose();
    super.dispose();
  }
}
