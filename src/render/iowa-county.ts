// County and park facilities share the same physical-box drawing and lifecycle.
import type { IowaCountyLayout } from '../road/structures/iowa-county';
import { IowaParkLayer, type IowaParkCounts } from './iowa-park';
import type { LookStyle } from './look';

export const hasIowaCounty = (tags: ReadonlySet<string>): boolean => tags.has('iowa-county-farmstead');
export type IowaCountyCounts = IowaParkCounts;

export class IowaCountyLayer extends IowaParkLayer {
  constructor(look: LookStyle, opts: { layout: IowaCountyLayout }) {
    super(look, opts);
    this.group.name = 'iowa-county';
  }
}
