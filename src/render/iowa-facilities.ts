// Shared Iowa facility lifecycle stays behind the route's lazy render boundary.
import { Group, type Camera } from 'three';
import { loadIowaCountyLayout, loadIowaParkLayout, type RoadNetwork } from '../road';
import type { VisibleContent } from './boards';
import { IowaCountyLayer } from './iowa-county';
import { IowaParkLayer } from './iowa-park';
import type { LookStyle } from './look';

let parkPlan: Awaited<ReturnType<typeof loadIowaParkLayout>> | null = null;
let countyPlan: Awaited<ReturnType<typeof loadIowaCountyLayout>> | null = null;

export const iowaFacilitiesReady = (tags: ReadonlySet<string>): boolean =>
  (!tags.has('iowa-park') || parkPlan !== null) &&
  (!tags.has('iowa-county-farmstead') || countyPlan !== null);

export async function prepareIowaFacilities(tags: ReadonlySet<string>): Promise<void> {
  await Promise.all([
    tags.has('iowa-park') && !parkPlan
      ? loadIowaParkLayout().then((m) => {
          parkPlan = m;
        })
      : null,
    tags.has('iowa-county-farmstead') && !countyPlan
      ? loadIowaCountyLayout().then((m) => {
          countyPlan = m;
        })
      : null,
  ]);
}

export class IowaFacilitiesLayer {
  readonly group = new Group();
  readonly park: IowaParkLayer | null;
  readonly county: IowaCountyLayer | null;
  private readonly layers: readonly IowaParkLayer[];

  constructor(look: LookStyle, opts: { road: RoadNetwork; seed: number; tags: ReadonlySet<string> }) {
    const { road, seed, tags } = opts;
    if (!iowaFacilitiesReady(tags)) throw new Error('Iowa facility layouts are not prepared');
    this.park = tags.has('iowa-park')
      ? new IowaParkLayer(look, { layout: parkPlan!.iowaParkLayout(road, seed) })
      : null;
    this.county = tags.has('iowa-county-farmstead')
      ? new IowaCountyLayer(look, { layout: countyPlan!.iowaCountyLayout(road, seed) })
      : null;
    this.layers = [this.park, this.county].filter((layer): layer is IowaParkLayer => layer !== null);
    this.group.add(...this.layers.map((layer) => layer.group));
  }

  visibleContent(): VisibleContent[] {
    return this.layers.flatMap((layer) => layer.visibleContent());
  }
  hide(refs: Iterable<string>): void {
    const list = [...refs];
    for (const layer of this.layers) layer.hide(list);
  }
  pick(nx: number, ny: number, camera: Camera): string | null {
    for (const layer of this.layers) {
      const ref = layer.pick(nx, ny, camera);
      if (ref) return ref;
    }
    return null;
  }
  update(x: number, z: number, drawM: number): number {
    return this.layers.reduce((sum, layer) => sum + layer.update(x, z, drawM), 0);
  }
  dispose(): void {
    for (const layer of this.layers) layer.dispose();
    this.group.removeFromParent();
  }
}
