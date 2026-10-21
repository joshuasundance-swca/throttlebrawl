// The physical layout supplies every box. No generic scenery stand-in may close a shelter's
// open sides or make its posts disappear. One textured, vertex-coloured mesh per facility.
import { CanvasTexture, Group, Mesh, Raycaster, SRGBColorSpace, Vector2, type Camera } from 'three';
import type { IowaParkLayout } from '../road';
import { paintCopy, type VisibleContent } from './boards';
import { MIN_THREAT_DRAW_M, type LookStyle } from './look';
import type { SceneDef } from './scenes/data';
import { sceneGeometry, sceneRef } from './scenes/layer';

export const hasIowaPark = (tags: ReadonlySet<string>): boolean => tags.has('iowa-park');
export interface IowaParkCounts {
  placed: number;
  visible: number;
  triangles: number;
}
export class IowaParkLayer {
  readonly group = new Group();
  readonly views: { mesh: Mesh; ref: string; label: string; radiusM: number }[] = [];
  private readonly textures: CanvasTexture[] = [];
  private readonly blank = new Map<string, () => void>();
  private readonly hidden = new Set<string>();
  private readonly ray = new Raycaster();
  private readonly pointer = new Vector2();
  private last: IowaParkCounts;

  constructor(look: LookStyle, opts: { layout: IowaParkLayout }) {
    this.group.name = 'iowa-park';
    for (const facility of opts.layout.facilities) {
      const ref = sceneRef('region-clinton', 'clinton-iowa', facility.id);
      const def: SceneDef = { ...facility, status: 'live', on: ['rural'], acrossM: [0, 0] };
      let texture: CanvasTexture | null = null;
      const height = Math.round((512 * facility.sign.size[1]) / facility.sign.size[0]);
      let H = 256;
      while (H < 128 + height) H *= 2;
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 512, H);
          const paint = (words: boolean) => {
            ctx.save();
            ctx.translate(0, 128);
            ctx.fillStyle = facility.sign.bg;
            ctx.fillRect(0, 0, 512, height);
            if (words) paintCopy(ctx, 512, height, facility.sign.text, facility.sign.fg);
            ctx.restore();
          };
          paint(true);
          texture = new CanvasTexture(canvas);
          texture.colorSpace = SRGBColorSpace;
          texture.anisotropy = 4;
          const map = texture;
          this.blank.set(ref, () => {
            paint(false);
            map.needsUpdate = true;
          });
          this.textures.push(texture);
        }
      }
      const built = sceneGeometry(
        def,
        { u0: 0, u1: 1, v0: 1 - (128 + height) / H, v1: 1 - 128 / H },
        [64 / 512, 1 - 64 / H],
        false,
        true,
      );
      const material = look.material(
        'prop',
        texture ? { vertexColors: true, map: texture } : { vertexColors: true },
      );
      const mesh = new Mesh(built.geometry, material);
      mesh.name = facility.id;
      mesh.position.set(facility.x, facility.y, facility.z);
      mesh.rotation.y = facility.turn;
      mesh.userData['contentRef'] = ref;
      mesh.visible = false;
      this.group.add(mesh);
      this.views.push({ mesh, ref, label: facility.sign.text, radiusM: facility.radiusM });
    }
    this.last = { placed: this.views.length, visible: 0, triangles: 0 };
  }

  /** A veto blanks only the words: physical posts, boards and buildings remain visible and solid. */
  hide(refs: Iterable<string>): void {
    for (const ref of refs) {
      this.hidden.add(ref);
      this.blank.get(ref)?.();
    }
  }
  visibleContent(): VisibleContent[] {
    return this.views
      .filter((v) => v.mesh.visible && !this.hidden.has(v.ref))
      .map((v) => ({ ref: v.ref, kind: 'sign', label: v.label }));
  }
  pick(nx: number, ny: number, camera: Camera): string | null {
    this.ray.setFromCamera(this.pointer.set(nx, ny), camera);
    const meshes = this.views.filter((v) => v.mesh.visible && !this.hidden.has(v.ref)).map((v) => v.mesh);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    return hit ? String(hit.object.userData['contentRef']) : null;
  }
  /** All physical detail remains at every distance; cull only beyond the threat draw distance. */
  update(cameraX: number, cameraZ: number, drawM: number): number {
    let visible = 0;
    let triangles = 0;
    for (const v of this.views) {
      v.mesh.visible =
        Math.hypot(cameraX - v.mesh.position.x, cameraZ - v.mesh.position.z) - v.radiusM <
        Math.max(drawM, MIN_THREAT_DRAW_M);
      if (!v.mesh.visible) continue;
      visible++;
      triangles += v.mesh.geometry.getAttribute('position').count / 3;
    }
    this.last = { placed: this.views.length, visible, triangles };
    return visible;
  }
  counts(): IowaParkCounts {
    return { ...this.last };
  }
  dispose(): void {
    for (const v of this.views) v.mesh.geometry.dispose();
    for (const texture of this.textures) texture.dispose();
    // Look materials are shared by some styles, as in the existing scenes layer.
    this.group.removeFromParent();
  }
}
