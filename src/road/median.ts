import type { LaneInfo } from '../core';
import type { BakedMedian } from './types';

/** The authored turf, centred in the gap between opposing carriageways. Painted and barrier
 * medians retain their existing paved surface; this describes crossable grass only. */
export function grassMedianSpan(
  lanes: readonly LaneInfo[],
  median: BakedMedian | null | undefined,
): [number, number] | null {
  if (median?.kind !== 'grass' || !(median.widthM > 0)) return null;
  let forwardLo = Infinity;
  let forwardHi = -Infinity;
  let oncomingLo = Infinity;
  let oncomingHi = -Infinity;
  for (const lane of lanes) {
    if (lane.kind !== 'drive') continue;
    const lo = lane.dCenterM - lane.widthM / 2;
    const hi = lane.dCenterM + lane.widthM / 2;
    if (lane.direction === 1) {
      if (lo < forwardLo) forwardLo = lo;
      if (hi > forwardHi) forwardHi = hi;
    } else {
      if (lo < oncomingLo) oncomingLo = lo;
      if (hi > oncomingHi) oncomingHi = hi;
    }
  }
  if (forwardLo === Infinity || oncomingLo === Infinity) return null;
  const lo = forwardLo >= oncomingHi ? oncomingHi : forwardHi;
  const hi = forwardLo >= oncomingHi ? forwardLo : oncomingLo;
  if (hi <= lo) return null;
  // The road lint permits a small rounding tolerance; never put turf over a lane rectangle.
  const width = median.widthM < hi - lo ? median.widthM : hi - lo;
  return [(lo + hi - width) / 2, (lo + hi + width) / 2];
}
