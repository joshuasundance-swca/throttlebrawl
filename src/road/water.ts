// The existing lake floor is authored in local world metres. Physics reads its exact outline,
// so the lake cannot become a water plane outside the water the backdrop draws.
import samish from '../../packs/region-pnw/assets/backdrop/pacific-northwest/networks/osm-pnw-samish.json';

/** The height drawn inside an above-sea lake, or null outside it. Private to road queries. */
export function lakeWaterAt(id: string, x: number, z: number): number | null {
  if (id !== samish.network) return null;
  let best: number | null = null;
  for (const floor of samish.pieces) {
    let inside = false;
    const ring = floor.area;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]?.[0] ?? 0;
      const zi = ring[i]?.[1] ?? 0;
      const xj = ring[j]?.[0] ?? 0;
      const zj = ring[j]?.[1] ?? 0;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    // Backdrop floors draw water 0.5 m below the authored level.
    if (inside) best = Math.max(best ?? -Infinity, floor.y - 0.5);
  }
  return best;
}
