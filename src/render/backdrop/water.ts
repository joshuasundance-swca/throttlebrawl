// A network's own water above the sea (playtest 4, P4-19, C4: Lake Samish, 82.85 m up): the water
// `floor` pieces of its backdrop file, in the network's metres, and the height of the water as drawn at a
// point. The roadside stands a dock's root there (roadside.ts, `waterline`); the backdrop draws the water
// itself (shapes.ts `buildFloor`). A lazy chunk of its own, loaded with the race's network.
import { FLOOR_UNDER_M, type BackdropNetworkFile } from './data';
import { geoFrame } from './geo';

/** A water floor above the sea: its level (the piece's `y`), the height it is drawn at, and its outline as world [x, z]. */
export interface WaterFloor {
  id: string;
  level: number;
  surfaceY: number;
  ring: readonly (readonly [number, number])[];
}

/** The water floors of a network's backdrop file that stand above the sea (a lake), in world metres. */
export function waterFloors(file: BackdropNetworkFile): WaterFloor[] {
  const geo = geoFrame(file.originLatDeg, file.originLonDeg);
  const out: WaterFloor[] = [];
  for (const p of file.pieces ?? []) {
    if (p.kind !== 'floor' || p.surface !== 'water') continue;
    const level = p.y ?? 0;
    if (!(level > 0)) continue;
    const ring = p.area.map(([a, b]) => (p.frame === 'local' ? ([a, b] as const) : geo.toWorld(a, b)));
    out.push({ id: p.id, level, surfaceY: level - FLOOR_UNDER_M.water, ring });
  }
  return out;
}

/** Whether (x, z) lies inside a ring (even-odd). */
export function insideRing(ring: WaterFloor['ring'], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** The height of the highest water floor drawn over (x, z), or null where there is none. */
export function waterAtOf(floors: readonly WaterFloor[]): (x: number, z: number) => number | null {
  return (x, z) => {
    let best: number | null = null;
    for (const f of floors)
      if (insideRing(f.ring, x, z) && (best === null || f.surfaceY > best)) best = f.surfaceY;
    return best;
  };
}
