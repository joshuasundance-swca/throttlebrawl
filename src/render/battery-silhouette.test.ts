/// <reference types="vite/client" />
// The headland batteries read at the distance a rider sees them (playtest 4, run C's fix check, J2's batteries:
// "the batteries read clearly only up close: 1 of 6 Conzelman frames shows a gun"). Run C's first guns were a thin
// barrel lifted 12 degrees down inside the pit, and the front wall (5.6 m at the battery's size) hid the pit and
// the breech from a camera 3 to 5 m up, so a gun showed only as a dark line a few pixels over a grey wall. The
// guns now stand on a pedestal out of the pit with a thick barrel lifted 30 degrees, so its muzzle rises over the
// wall into the sky; each pit has a dark collar and a dark inside; and the concrete is paler against the grass.
//
// The check is a screen size: the real baked battery at its drawn size, seen by the chase camera's own field on a
// phone held sideways (915 by 412) from 60, 100 and 150 m down the road, from the low chase camera's height and the
// far one's, with the battery's middle 20 m off the camera's line. The control is run C's first guns on the same
// views, which fall under every number below.
import { BufferGeometry, Float32BufferAttribute, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BATTERY_GUNS,
  BATTERY_GUNS_FIRST,
  CONCRETE_FILE,
  CONCRETE_PALE,
  PIT_DARK,
  withBatteryGuns,
  type GunNumbers,
} from './battery-guns';
import { bakeRepoModel } from './model-files.test-util';
import { BATTERY_SIZE } from './scenery';
import { SURFACE_COLOUR } from './verge';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const region = Object.values(
  import.meta.glob<{ palette: { land: string } }>('../../packs/region-sf/regions/*/region.json', {
    eager: true,
    import: 'default',
  }),
)[0]!;

const W = 915;
const H = 412;
const FOV = 72; // the chase view at speed
const FOCAL_PX = H / 2 / Math.tan((FOV / 2) * (Math.PI / 180));
const ORIGINAL_VERTS = 660; // the file's own vertices of the battery root
const LATERAL_M = 20; // the battery's middle off the camera's line
const GUN_X = BATTERY_GUNS.pitX[0]! * BATTERY_SIZE; // the near gun's place along the road, m
const WALL_TOP_M = 3.7 * BATTERY_SIZE; // the front wall's top
const WALL_FRONT_M = 5.5 * BATTERY_SIZE;

/** The first `n` vertices of a triangle-list geometry as a geometry of their own. */
function firstVerts(g: BufferGeometry, n: number): BufferGeometry {
  const out = new BufferGeometry();
  for (const name of ['position', 'normal', 'color'] as const) {
    const src = g.getAttribute(name);
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = src.getX(i);
      a[i * 3 + 1] = src.getY(i);
      a[i * 3 + 2] = src.getZ(i);
    }
    out.setAttribute(name, new Float32BufferAttribute(a, 3));
  }
  return out;
}

async function variants() {
  const baked = (await bakeRepoModel('sfHeadlands')).variants[0]!;
  const file = firstVerts(baked, ORIGINAL_VERTS);
  return {
    now: baked,
    first: withBatteryGuns(file, BATTERY_GUNS_FIRST),
  };
}

/** What the gun vertices above the rim (4 m) show of a battery from `distM` down the road at height `camY`. */
function view(g: BufferGeometry, numbers: GunNumbers, distM: number, camY: number) {
  const cam = new PerspectiveCamera(FOV, W / H, 0.3, 1500);
  cam.position.set(GUN_X - distM, camY, LATERAL_M);
  cam.up.set(0, 1, 0);
  cam.lookAt(1000, camY - 1, LATERAL_M);
  cam.updateMatrixWorld(true);
  const px = (v: Vector3) => {
    const n = v.clone().project(cam);
    return { x: ((n.x + 1) / 2) * W, y: ((1 - n.y) / 2) * H };
  };
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  let top = Infinity;
  let any = false;
  for (let i = ORIGINAL_VERTS; i < pos.count; i++) {
    if (Math.max(col.getX(i), col.getY(i), col.getZ(i)) >= 0.15 || pos.getY(i) <= 4.5) continue;
    // Only a gun's own vertices count (the collar stands on the rim): within the barrel's reach of a pit's middle.
    const v = new Vector3(pos.getX(i) * BATTERY_SIZE, pos.getY(i) * BATTERY_SIZE, pos.getZ(i) * BATTERY_SIZE);
    if (pos.getX(i) > 0) continue;
    top = Math.min(top, px(v).y);
    any = true;
  }
  const wall = px(new Vector3(GUN_X, WALL_TOP_M, WALL_FRONT_M)).y;
  const dist = Math.hypot(distM, LATERAL_M - WALL_FRONT_M);
  return {
    any,
    /** Pixels the near gun stands over the front wall's top edge, in the frame. */
    aboveWall: wall - top,
    /** Pixels thick the barrel is, across. */
    barrelPx: (2 * numbers.barrelRadiusM * BATTERY_SIZE * FOCAL_PX) / dist,
  };
}

const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const hexLum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return lum([lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)]);
};
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const DISTANCES = [60, 100, 150];
const HEIGHTS = [3.2, 4.8]; // the low chase camera, and the far one
/** At every distance and height: the gun stands this many pixels over the wall, and the barrel is this thick (at 150 m). */
const MIN_ABOVE_PX = 6;
const MIN_BARREL_PX = 3;

describe('a battery reads at the distance a rider sees it (playtest 4, run C fix check)', () => {
  it('shows a gun standing over the front wall, and a barrel thick enough to see, from 60 to 150 m (control: the first guns do not)', async () => {
    const { now, first } = await variants();
    const rows: string[] = [];
    for (const dist of DISTANCES) {
      for (const camY of HEIGHTS) {
        const a = view(now, BATTERY_GUNS, dist, camY);
        const b = view(first, BATTERY_GUNS_FIRST, dist, camY);
        rows.push(
          `${dist} m at ${camY} m up: gun ${a.aboveWall.toFixed(1)} px over the wall, barrel ${a.barrelPx.toFixed(1)} px (the first guns: ${b.aboveWall.toFixed(1)} and ${b.barrelPx.toFixed(1)})`,
        );
        expect(a.any, `${dist} m, ${camY} m: guns found`).toBe(true);
        expect(b.any, `${dist} m, ${camY} m: the control's guns found`).toBe(true);
        expect(a.aboveWall, `${dist} m at ${camY} m up: gun over the wall`).toBeGreaterThanOrEqual(
          MIN_ABOVE_PX,
        );
        expect(a.barrelPx, `${dist} m at ${camY} m up: barrel thickness`).toBeGreaterThanOrEqual(
          MIN_BARREL_PX,
        );
        // The control fails the same numbers at the far end (150 m), which is the reach the fix check measured.
        if (dist === 150) {
          expect(b.aboveWall, `control, ${dist} m at ${camY} m up`).toBeLessThan(MIN_ABOVE_PX);
          expect(b.barrelPx, `control, ${dist} m at ${camY} m up`).toBeLessThan(MIN_BARREL_PX);
        }
      }
    }
    print(`battery at the chase camera's field (${FOV} degrees on ${W}x${H}):\n  ${rows.join('\n  ')}`);
  });

  it('draws each pit as a dark hole with a collar over the roofline, and pale concrete against the ground', async () => {
    const { now } = await variants();
    const pos = now.getAttribute('position');
    const col = now.getAttribute('color');
    // Pit insides: dark vertices of the file's own set, inside each pit's hexagon, between its floor and rim.
    let darkInside = 0;
    let paleOutside = 0;
    let fileGrey = 0;
    for (let i = 0; i < ORIGINAL_VERTS; i++) {
      const c = [col.getX(i), col.getY(i), col.getZ(i)];
      const inPit = BATTERY_GUNS.pitX.some(
        (px) =>
          Math.hypot(pos.getX(i) - px, pos.getZ(i) - BATTERY_GUNS.pitZ) <= BATTERY_GUNS.pitRadiusM + 0.02 &&
          pos.getY(i) >= BATTERY_GUNS.floorY - 0.02 &&
          pos.getY(i) <= BATTERY_GUNS.rimY + 0.02,
      );
      if (inPit && lum(c) < 0.06) darkInside++;
      if (Math.abs(c[0]! - CONCRETE_PALE[0]) < 0.006 && Math.abs(c[1]! - CONCRETE_PALE[1]) < 0.006)
        paleOutside++;
      if (Math.abs(c[0]! - CONCRETE_FILE[0]) < 0.006 && Math.abs(c[1]! - CONCRETE_FILE[1]) < 0.006)
        fileGrey++;
    }
    expect(darkInside, 'dark vertices inside the pits').toBeGreaterThanOrEqual(24);
    expect(paleOutside, 'pale concrete outside them').toBeGreaterThan(100);
    expect(fileGrey, 'none of the file’s old grey is left').toBe(0);
    // The collar: stands over the front wall's top by more than a metre of the model.
    expect(BATTERY_GUNS.rimY + BATTERY_GUNS.collarLiftM + BATTERY_GUNS.collarRadiusM - 3.7).toBeGreaterThan(
      1,
    );
    print(`battery: ${darkInside} dark vertices inside the pits, ${paleOutside} pale concrete vertices`);
  });

  it('keeps the concrete apart from the ground it stands on in luminance (control: the file’s grey was not), and the pits from the concrete', () => {
    const land = hexLum(region.palette.land);
    const grass = hexLum(SURFACE_COLOUR.grass);
    const rows = {
      'pale concrete over the region land': ratio(lum(CONCRETE_PALE), land),
      'pale concrete over the verge grass': ratio(lum(CONCRETE_PALE), grass),
      'the file’s grey over the verge grass': ratio(lum(CONCRETE_FILE), grass),
      'a pit over the pale concrete': ratio(lum(PIT_DARK), lum(CONCRETE_PALE)),
      'a gun over the pale concrete': ratio(lum(BATTERY_GUNS.colour), lum(CONCRETE_PALE)),
    };
    print(
      Object.entries(rows)
        .map(([k, v]) => `${k}: ${v.toFixed(2)}`)
        .join('; '),
    );
    expect(rows['pale concrete over the region land']).toBeGreaterThanOrEqual(1.8);
    expect(rows['pale concrete over the verge grass']).toBeGreaterThanOrEqual(1.8);
    expect(rows['the file’s grey over the verge grass'], 'the control').toBeLessThan(1.5);
    expect(rows['a pit over the pale concrete']).toBeGreaterThanOrEqual(7);
    expect(rows['a gun over the pale concrete']).toBeGreaterThanOrEqual(5);
  });

  it('adds nothing past the file’s footprint (the front wall, the ends and the budget of triangles)', async () => {
    const { now } = await variants();
    now.computeBoundingBox();
    const box = now.boundingBox!;
    expect(box.max.z).toBeLessThanOrEqual(5.6);
    expect(box.min.x).toBeGreaterThanOrEqual(-15.01);
    expect(box.max.x).toBeLessThanOrEqual(15.01);
    const added = (now.getAttribute('position').count - ORIGINAL_VERTS) / 3;
    print(`battery: ${added} triangles of guns, pedestals and collars on the file's ${ORIGINAL_VERTS / 3}`);
    // Run C's guns were 96 triangles a battery; the budget here is under 400.
    expect(added).toBeLessThan(400);
  });
});
