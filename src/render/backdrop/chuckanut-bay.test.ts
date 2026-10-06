// Chuckanut Drive's bay is water, as far as the map says (playtest 4, run B's live check, punch item 6: "Chuckanut's
// bay side does not read as a bay. It shows a parapet, a rail line, green flats and fog, not water 30 to 70 m
// below"). #580 gave the bay side its drop: a shelf, then the ground falls sheer to the sea. What lay beyond the drop
// was the backdrop's far ground, and the bay's water floor (`bellingham-bay`) stopped 0.3 to 4 km short of the road:
// its east edge ran from (48.66, -122.495) to (48.6, -122.5), a straight line well off the shore south of Larrabee,
// so past the drop the far view was the region's green ground (`floorColour`), not the bay. The floor follows the
// mainland shore now. The rules, with the map's own coastline as the oracle (OpenStreetMap's `natural=coastline`,
// simplified to 12 m, `chuckanut-coast.json`):
// - the sea off the drop side is water: every point seaward of the shore, from 150 m out to 3 km, on the bay side of
//   the road, lies inside the water floor;
// - the land is not: no point 150 m or more landward of the shore lies inside it, and no lane of the road does;
// - the floor is a simple polygon (the backdrop's triangulation covers it exactly).
// The control: the floor as it was before this change fails the first rule on the same points.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../../road';
import coast from './chuckanut-coast.json';
import type { BackdropRegionFile, FloorPiece } from './data';
import { geoFrame } from './geo';
import { insideRing } from './water';

const networkFiles = import.meta.glob<BakedNetwork>('../../../packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../../packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const regionFiles = import.meta.glob<BackdropRegionFile>(
  '../../../packs/region-pnw/assets/backdrop/*/region.json',
  { eager: true, import: 'default' },
);
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const ORIGIN = { lat: 48.66, lon: -122.47 };
const geo = geoFrame(ORIGIN.lat, ORIGIN.lon);
const bay = (Object.values(regionFiles)[0]?.pieces ?? []).find((p) => p.id === 'bellingham-bay') as
  FloorPiece | undefined;
if (!bay) throw new Error('no bellingham-bay floor');
const ring = bay.area.map(([a, b]) => geo.toWorld(a, b));

/** The floor as it stood before this change (the control): a straight east edge, kilometres off the shore. */
const OLD_AREA: readonly (readonly [number, number])[] = [
  [48.6, -122.7],
  [48.75, -122.7],
  [48.76, -122.52],
  [48.72, -122.5],
  [48.66, -122.495],
  [48.6, -122.5],
];
const oldRing = OLD_AREA.map(([a, b]) => geo.toWorld(a, b));

/** The shore, north to south, in world metres (the sea is on its right-hand side, looking south: to the west). */
const shore = (coast.points as [number, number][]).map(([a, b]) => geo.toWorld(a, b));

/** The land: the shore closed round the east, well inland of any road here (a simple polygon of the map's own shore). */
const landRing = [...shore, geo.toWorld(48.55, -122.3), geo.toWorld(48.7, -122.3)];

/**
 * Signed distance from the shore, m: positive over the sea, negative over the land. The distance is to the nearest
 * stretch of shore, the side is whether the point is inside the land polygon (the nearest segment's side is wrong
 * in the bay's lagoons and spits).
 */
function seaward(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < shore.length; i++) {
    const [ax, az] = shore[i]!;
    const [bx, bz] = shore[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return insideRing(landRing, x, z) ? -best : best;
}

const network = Object.values(networkFiles).find((n) => n.id === 'osm-pnw-chuckanut');
if (!network) throw new Error('no Chuckanut network');
const roads = network.roads.map((r) => {
  const road = Object.values(roadFiles).find((f) => f.id === r);
  if (!road) throw new Error(`no road ${r}`);
  return road;
});
const road = createRoadNetwork({ network, roads });

/** The points the rider's bay side looks over: every 100 m along the road, out to 3 km on the right-hand side. */
function baySide(): { x: number; z: number; out: number }[] {
  const out: { x: number; z: number; out: number }[] = [];
  for (const e of road.edges)
    for (let s = 0; s < e.length; s += 100)
      for (const d of [150, 300, 600, 1200, 2000, 3000]) {
        const p = road.toWorld(e.index, s, e.dMax + d, 0);
        out.push({ x: p.x, z: p.z, out: d });
      }
  return out;
}

describe("Chuckanut's bay is water out to the shore the map draws", () => {
  const points = baySide();
  const sea = points.filter((p) => seaward(p.x, p.z) >= 150);

  it('stands the map shore where the road is: the road runs on land, the sea beside it is the bay', () => {
    // The oracle sees the road as land (its centre line is landward of the shore) and the bay side's sea.
    const lanes = road.edges.flatMap((e) =>
      Array.from({ length: Math.floor(e.length / 50) }, (_, i) => road.toWorld(e.index, i * 50, 0, 0)),
    );
    const wet = lanes.filter((p) => seaward(p.x, p.z) > 0);
    print(
      `${lanes.length} points down the road's centre line, ${wet.length} seaward of the shore the map draws`,
    );
    expect(wet.length).toBeLessThan(lanes.length * 0.02);
    print(
      `${points.length} points off the bay side, ${sea.length} of them 150 m or more seaward of the shore`,
    );
    expect(sea.length, 'the bay side has sea to look at').toBeGreaterThan(points.length * 0.4);
  });

  it('covers the sea off the bay side with the bay floor (the floor as it was does not)', () => {
    const covered = (r: typeof ring) => sea.filter((p) => insideRing(r, p.x, p.z)).length;
    const now = covered(ring);
    const before = covered(oldRing);
    print(
      `sea points off the bay side inside the water floor: ${now} of ${sea.length}; with the floor as it was, ${before}`,
    );
    // The control: the old floor leaves most of the nearer sea as the green far ground.
    expect(before / sea.length).toBeLessThan(0.7);
    expect(now / sea.length).toBeGreaterThan(0.97);
  });

  it('keeps the land dry: no point well inland of the shore, and no lane, is in the water floor', () => {
    const land = points.filter((p) => seaward(p.x, p.z) <= -150);
    const wet = land.filter((p) => insideRing(ring, p.x, p.z));
    const lanes = road.edges.flatMap((e) =>
      Array.from({ length: Math.floor(e.length / 25) }, (_, i) => road.toWorld(e.index, i * 25, 0, 0)),
    );
    const drowned = lanes.filter((p) => insideRing(ring, p.x, p.z));
    print(
      `${land.length} landward points, ${wet.length} in the water floor; ${lanes.length} points down the road, ${drowned.length} under it`,
    );
    expect(wet.length).toBe(0);
    expect(drowned.length).toBe(0);
  });
});
