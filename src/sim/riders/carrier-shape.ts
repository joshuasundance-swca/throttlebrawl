// Carrier surfaces, in the same coordinates and scales as the committed tow-truck model and the
// procedural moving carrier. A roof, hood, stack or light owns its own footprint: the highest part
// does not fill the rest of the truck with an invisible box. DOM-free; the model raycast tests are
// the independent check on these dimensions (tools/blender/props/tow_truck.py and traffic-figures.ts).
import { rampTruckShape, type BakedFeature, type FurnitureShape } from '../../road';

export interface CarrierPart {
  feature: BakedFeature;
  shape: FurnitureShape;
  maxTop: number;
  topAt(s: number, d: number): number;
  /** A continuous top large enough to hold a bike; a stack or lamp is only an obstacle. */
  support: FurnitureShape | null;
}

const cache = new WeakMap<BakedFeature, readonly CarrierPart[]>();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Body parts after the ramp/deck, with the parked model's run/lip/width scaling. */
export function carrierParts(f: BakedFeature): readonly CarrierPart[] {
  const known = cache.get(f);
  if (known) return known;
  const moving = f.params?.['moving'] === true;
  const { run, lip } = rampTruckShape(f);
  const ls = run / (moving ? 5 : 11.5);
  const hs = moving ? 1 : lip / 2.8;
  const ws = Math.abs(f.d1 - f.d0) / (moving ? 2.4 : 2.5);
  const middle = (f.d0 + f.d1) / 2;
  const facing = f.params?.['facing'] === -1 ? -1 : 1;
  const foot = facing === 1 ? f.s0 : f.s1;
  const toS = (into: number) => foot + facing * into * ls;
  const box = (a: number, b: number, x0: number, x1: number): FurnitureShape => ({
    s: (toS(a) + toS(b)) / 2,
    d: middle + ((x0 + x1) * ws) / 2,
    r: 0,
    hu: ((b - a) * ls) / 2,
    hv: ((x1 - x0) * ws) / 2,
    us: 1,
    ud: 0,
    reachS: ((b - a) * ls) / 2,
    reachD: ((x1 - x0) * ws) / 2,
  });
  const out: CarrierPart[] = [];
  const add = (
    a: number,
    b: number,
    x0: number,
    x1: number,
    top: number,
    profile?: (into: number, x: number) => number,
    support?: FurnitureShape,
  ) => {
    out.push({
      feature: f,
      shape: box(a, b, x0, x1),
      maxTop: top * hs,
      topAt: (s, d) => hs * (profile ? profile(((s - foot) * facing) / ls, (d - middle) / ws) : top),
      support: support ?? null,
    });
  };
  if (moving) {
    // carrierShared(): cab, rack, lip, chassis, bumper and the small roof light.
    const roofSupport = box(5, 7.5, -1, 1);
    add(5.8, 7.5, -1.15, 1.15, 2.4, undefined, roofSupport);
    add(5.65, 5.75, -1.1, 1.1, 2.0);
    add(5.0, 5.8, -1, 1, lip, undefined, roofSupport);
    add(4.35, 7.45, -0.95, 0.95, 0.85);
    add(7.38, 7.5, -1.15, 1.15, 0.7);
    add(6.525, 6.775, -0.4, 0.4, 2.56);
  } else {
    // Roof cap: the 2.95 m cab with a tapered cap up to 3.15 m. The visor continues its top forward;
    // together they hold a 2 m bike, while neither an exhaust stack nor a marker light does.
    const roofSupport = box(17, 19.2, -1.1, 1.1);
    add(
      17,
      18.9,
      -1.2,
      1.2,
      3.15,
      (s, x) =>
        2.95 + 0.2 * clamp(Math.min((s - 17) / 0.08, (18.9 - s) / 0.2, (1.2 - Math.abs(x)) / 0.1), 0, 1),
      roofSupport,
    );
    add(18.9, 19.2, -1.1, 1.1, 2.97, (s) => 2.97 - (0.09 * (s - 18.9)) / 0.3, roofSupport);
    // Hood hull: a shallow slope to its nose, narrowing from 0.98 to 0.9 m either side. The grille
    // continues the top by 6 cm; the combined hood/grille footprint is 2.01 m long.
    const hoodSupport = box(18.9, 20.91, -0.9, 0.9);
    add(
      18.9,
      20.85,
      -0.98,
      0.98,
      2.05,
      (s, x) => {
        const width = 0.98 - (0.08 * (s - 18.9)) / 1.95;
        if (Math.abs(x) > width) return 0;
        return s <= 20.6 ? 2.05 - (0.1 * (s - 18.9)) / 1.7 : 1.95 - (0.15 * (s - 20.6)) / 0.25;
      },
      hoodSupport,
    );
    add(20.85, 20.91, -0.62, 0.62, 1.72, undefined, hoodSupport);
    add(20.8, 21.05, -1.25, 1.25, 0.82);
    // Chassis rails and front fenders (low parts outside the hood's footprint).
    for (const side of [-1, 1]) {
      add(13.9, 20.85, side * 0.45 - 0.1, side * 0.45 + 0.1, 0.95);
      const x0 = side < 0 ? -1.25 : 0.9;
      const x1 = side < 0 ? -0.9 : 1.25;
      add(19.2, 20.75, x0, x1, 1.3, (s) =>
        s < 19.45 ? 1.05 + (s - 19.2) : s > 20.5 ? 1.3 - (s - 20.5) : 1.3,
      );
      add(18.72, 18.84, side < 0 ? -1.4 : 1.25, side < 0 ? -1.25 : 1.4, 2.55);
      // The six-sided exhaust stack occupies only its 18 cm footprint behind the cab.
      const shape = box(16.81, 16.99, side * 1.05 - 0.09, side * 1.05 + 0.09);
      shape.r = 0.09 * Math.min(ls, ws);
      out.push({ feature: f, shape, maxTop: 3.7 * hs, topAt: () => 3.7 * hs, support: null });
    }
    // The windshield and roof markers are separate thin parts, not a whole raised roof.
    for (const [x0, x1] of [
      [-1.02, -0.06],
      [0.06, 1.02],
    ])
      add(18.9, 18.93, x0 as number, x1 as number, 2.8);
    for (const x of [-0.4, 0, 0.4]) add(18.55, 18.75, x - 0.1, x + 0.1, 3.21);
  }
  cache.set(f, out);
  return out;
}

/** A point is actually over this drawn part. */
export function onCarrierPart(p: CarrierPart, s: number, d: number): boolean {
  const ds = s - p.shape.s;
  const dd = d - p.shape.d;
  return p.shape.r > 0
    ? ds * ds + dd * dd <= p.shape.r * p.shape.r
    : Math.abs(ds) <= p.shape.hu + 1e-8 && Math.abs(dd) <= p.shape.hv + 1e-8;
}

/** Highest drawn body part at a point; zero in the space beside/between its parts. */
export function carrierTopAt(f: BakedFeature, s: number, d: number): number {
  let top = 0;
  for (const p of carrierParts(f)) if (onCarrierPart(p, s, d)) top = Math.max(top, p.topAt(s, d));
  return top;
}
