// The backdrop's middle distance that moves (run W-T, pitch 6 "the horizon comes alive": "a middle
// distance that moves: shrimp boats and a seaplane in the Keys; a freight train on the far bank and
// a ferry crossing in the PNW; fog pouring over the SF hills and headlights crawling along the far
// bridge"). The shrimp boats are a vessel style (shapes.ts) and the ferries were already there; this
// file builds the rest. Each piece glides end to end on the backdrop's one mesh (Soup.glide), thins
// into the haze at each end of its run and comes round again: no draw call, nothing per frame.
import type { AircraftPiece, BridgePiece, CloudsPiece, TrainPiece } from './data';
import { SKIRT_M, type ShapeCtx } from './shapes';
import { hashOf, rgb, rng, type Rgb } from './soup';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const raceRng = (ctx: ShapeCtx, id: string) => rng(hashOf(id) ^ Math.imul(ctx.seed | 0, 0x9e3779b1));

/** A compass bearing (0 = north, clockwise) and a distance from a point, as world [x, z]. */
function bearingFrom(cx: number, cz: number, deg: number, dist: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + Math.sin(a) * dist, cz - Math.cos(a) * dist];
}

/** Whether every point of the segment a-b (sampled every `stepM`) keeps `keep` from every road. */
function clearLine(
  ctx: ShapeCtx,
  a: readonly [number, number],
  b: readonly [number, number],
  keep: number,
  stepM = 200,
) {
  const n = Math.max(4, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / stepM));
  for (let k = 0; k <= n; k++)
    if (ctx.nearRoad(lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n), keep)) return false;
  return true;
}

/**
 * Traffic crawling across a bridge ("headlights crawling along the far bridge"): `traffic` lights
 * each way, headlights in one half of the deck and tail lights in the other, each sliding end to
 * end and round again, a share of a round apart. They glow (the far haze reaches them late). None
 * when any of the span stands near a road, since the lights run all of it. Returns the lights.
 */
export function buildBridgeTraffic(p: BridgePiece, ctx: ShapeCtx): number {
  const n = Math.min(60, Math.max(0, Math.floor(p.traffic ?? 0)));
  if (!n) return 0;
  const a = ctx.toWorld(p.from);
  const b = ctx.toWorld(p.to);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1 || !clearLine(ctx, a, b, p.keepOutM ?? 800, 150)) return 0;
  const tx = (b[0] - a[0]) / L;
  const tz = (b[1] - a[1]) / L;
  const e = p.exaggerate ?? 1;
  // The deck's half width and height, as the bridge builder draws them.
  const W = 16 * e;
  const deck = p.deckM * e;
  const s = ctx.soup;
  const r = raceRng(ctx, `${p.id}:traffic`);
  const [head, tail] = (p.trafficColours ?? ['#fff2cf', '#ff4b38']).map(rgb) as [Rgb, Rgb];
  const period = L / Math.max(1, p.trafficSpeedMps ?? 15);
  const size = 3.2 * e;
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;
  let lights = 0;
  for (const dir of [1, -1]) {
    const off = dir * W * 0.45;
    for (let k = 0; k < n; k++) {
      s.begin(-1);
      s.glide((dir * tx * L) / 2, (dir * tz * L) / 2, 0, period, (k + r() * 0.7) / n);
      s.frustum(
        mx - tz * off,
        deck,
        mz + tx * off,
        tx,
        tz,
        size,
        size * 0.55,
        size * 0.8,
        dir > 0 ? head : tail,
      );
      lights++;
    }
  }
  return lights;
}

/**
 * Fog pouring over a crest ("fog pouring over the SF hills"): a low bank lies on the crest every
 * 450 m or so, and from each a tongue of three puffs, a third of a round apart, slides down the far
 * side toward the pour's bearing, thins into the haze at the foot and starts again at the crest.
 * None where the crest or the foot of the pour comes near a road.
 */
export function buildPour(p: CloudsPiece, ctx: ShapeCtx): number {
  const e = p.exaggerate ?? 1;
  const s = ctx.soup;
  const r = raceRng(ctx, p.id);
  const over = rgb(p.colour);
  const under = rgb(p.shadeColour ?? p.colour);
  const keep = p.keepOutM ?? 600;
  const db = ((p.driftBearingDeg ?? 90) * Math.PI) / 180;
  const dx = Math.sin(db);
  const dz = -Math.cos(db);
  const reach = p.driftM ?? 1200;
  const drop = p.dropM ?? p.baseM;
  const period = p.driftPeriodS ?? 240;
  const base = p.baseM;
  const pts = (p.path ?? []).map((q) => ctx.toWorld(q));
  let built = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 450));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5 + (r() - 0.5) * 0.5) / n;
      const x = lerp(a[0], b[0], t);
      const z = lerp(a[1], b[1], t);
      const H = Math.max(30, lerp(p.topM[0], p.topM[1], r()) * e - base);
      const phase = r();
      const spin = r();
      if (!clearLine(ctx, [x, z], [x + dx * reach, z + dz * reach], keep)) continue;
      // The bank on the crest, leaning a little over the edge and back.
      s.begin(p.haze ?? 0);
      s.drift = [dx * 80 * e, dz * 80 * e, (Math.PI * 2) / (period * 2), phase * Math.PI * 2];
      s.blob([x, base + H * 0.35, z], 260 * e, H * 0.55, 210 * e, over, under, base - drop, base + H, spin);
      // The tongue: puffs sliding from the crest down to the foot, round and round.
      for (let j = 0; j < 3; j++) {
        s.begin(p.haze ?? 0);
        s.glide((dx * reach) / 2, (dz * reach) / 2, -drop / 2, period, phase + j / 3);
        s.blob(
          [x + (dx * reach) / 2, base - drop / 2 + H * 0.25, z + (dz * reach) / 2],
          170 * e,
          H * 0.4,
          130 * e,
          over,
          under,
          base - drop,
          base + H,
          spin + j * 0.3,
        );
      }
      built++;
    }
  }
  return built > 0 ? 1 : 0;
}

/**
 * A freight train on a straight track ("a freight train on the far bank"): the ballast along the
 * whole track, then two locomotives and a string of box cars, hoppers, tank cars and stacked
 * containers, gliding from the first end to the second and round again. None when any of the track
 * (and the train's own length past each end) comes near a road.
 */
export function buildTrain(p: TrainPiece, ctx: ShapeCtx): number {
  const [ax, az] = ctx.toWorld(p.path[0]);
  const [bx, bz] = ctx.toWorld(p.path[1]);
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 200) return 0;
  const tx = (bx - ax) / L;
  const tz = (bz - az) / L;
  const e = p.exaggerate ?? 1;
  const cars = Math.max(0, Math.min(80, Math.floor(p.cars)));
  const unit = 18 * e;
  const total = (cars + 2) * unit;
  const ext = total / 2;
  if (!clearLine(ctx, [ax - tx * ext, az - tz * ext], [bx + tx * ext, bz + tz * ext], p.keepOutM ?? 600))
    return 0;
  const s = ctx.soup;
  const r = raceRng(ctx, p.id);
  const y0 = p.baseM ?? 6;
  const loco = rgb(p.colour);
  const colours = p.colours.map(rgb);
  const dark = rgb('#2d2b29');
  const ballast = rgb('#6b6359');
  // The ballast, a long low bank, in pieces so the haze follows it out.
  s.begin(p.haze ?? 0);
  const segs = Math.max(1, Math.ceil(L / 500));
  for (let k = 0; k < segs; k++) {
    const half = L / segs / 2;
    const u = (L * (k + 0.5)) / segs;
    s.frustum(
      ax + tx * u,
      -SKIRT_M * 0.2,
      az + tz * u,
      tx,
      tz,
      half,
      3 * e,
      y0 + SKIRT_M * 0.2,
      ballast,
      half,
      2.2 * e,
    );
  }
  s.begin(p.haze ?? 0);
  s.glide((tx * L) / 2, (tz * L) / 2, 0, L / Math.max(1, p.speedMps ?? 14), r());
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const pick = () => colours[Math.floor(r() * colours.length)]!;
  for (let k = 0; k < cars + 2; k++) {
    // The locomotives lead (toward the second end); the cars follow.
    const off = total / 2 - unit * (k + 0.5);
    const x = mx + tx * off;
    const z = mz + tz * off;
    const half = unit * 0.46;
    s.frustum(x, y0, z, tx, tz, half * 0.92, 1.1 * e, 1.1 * e, dark);
    const y = y0 + 1.1 * e;
    if (k < 2) {
      s.frustum(x, y, z, tx, tz, half, 1.6 * e, 3.4 * e, loco);
      const cab = half * 0.62;
      s.frustum(x + tx * cab, y + 3.4 * e, z + tz * cab, tx, tz, half * 0.3, 1.5 * e, 1.1 * e, loco);
      continue;
    }
    const c = pick();
    const kind = r();
    if (kind < 0.35) {
      // A box car.
      s.frustum(x, y, z, tx, tz, half, 1.55 * e, 3.6 * e, c);
    } else if (kind < 0.6) {
      // A hopper, wider at the top.
      s.frustum(x, y, z, tx, tz, half * 0.7, 1.2 * e, 3.2 * e, c, half, 1.55 * e);
    } else if (kind < 0.8) {
      // A tank car, rounded off at the top.
      s.frustum(x, y + 0.4 * e, z, tx, tz, half * 0.95, 1.35 * e, 2.6 * e, c, half * 0.8, 0.9 * e);
    } else {
      // Two containers, one on the other.
      s.frustum(x, y, z, tx, tz, half * 0.95, 1.4 * e, 2.4 * e, c);
      s.frustum(x, y + 2.4 * e, z, tx, tz, half * 0.95, 1.4 * e, 2.4 * e, pick());
    }
  }
  return 1;
}

/**
 * A seaplane on a straight line ("a seaplane in the Keys"): a high wing, two floats and a tail,
 * gliding from one end and height of its line to the other (by default down to the water: a
 * landing), thinning into the haze at each end, then round again. Its line is `path`, or seeded by
 * the race round the network, tried a few times for a line that keeps clear of every road.
 */
export function buildAircraft(p: AircraftPiece, ctx: ShapeCtx): number {
  const e = p.exaggerate ?? 1;
  const r = raceRng(ctx, p.id);
  const keep = p.keepOutM ?? 800;
  let line: [[number, number], [number, number]] | null = null;
  if (p.path) {
    const a = ctx.toWorld(p.path[0]);
    const b = ctx.toWorld(p.path[1]);
    if (clearLine(ctx, a, b, keep, 300)) line = [a, b];
  } else {
    const [b0, b1] = p.bearingDeg ?? [0, 360];
    const [d0, d1] = p.distanceM ?? [3000, 8000];
    const half = (p.lengthM ?? 9000) / 2;
    for (let tries = 0; tries < 12 && !line; tries++) {
      const [cx, cz] = bearingFrom(ctx.centre[0], ctx.centre[1], lerp(b0, b1, r()), lerp(d0, d1, r()));
      const head = r() * Math.PI * 2;
      const a: [number, number] = [cx - Math.cos(head) * half, cz - Math.sin(head) * half];
      const b: [number, number] = [cx + Math.cos(head) * half, cz + Math.sin(head) * half];
      if (clearLine(ctx, a, b, keep, 300)) line = [a, b];
    }
  }
  if (!line) return 0;
  const [[ax, az], [bx, bz]] = line;
  const L = Math.hypot(bx - ax, bz - az) || 1;
  const hx = (bx - ax) / L;
  const hz = (bz - az) / L;
  const vx = -hz;
  const vz = hx;
  const [y0, y1] = p.altitudeM ?? [220, 0];
  const s = ctx.soup;
  s.begin(p.haze ?? 0);
  s.glide((bx - ax) / 2, (bz - az) / 2, (y1 - y0) / 2, L / Math.max(1, p.speedMps ?? 45), r());
  const body = rgb(p.colour);
  const trim = rgb(p.trimColour ?? '#27415f');
  const x = (ax + bx) / 2;
  const z = (az + bz) / 2;
  // The floats' keels ride the line's height, so a landing ends with them on the water.
  const y = (y0 + y1) / 2 + 2.4 * e;
  const at = (along: number, across: number, up: number): [number, number, number] => [
    x + hx * along + vx * across,
    y + up,
    z + hz * along + vz * across,
  ];
  // The fuselage, the high wing, the fin and the tailplane.
  s.frustum(x, y, z, hx, hz, 5 * e, 0.7 * e, 1.6 * e, body, 4 * e, 0.55 * e);
  const [wx, , wz] = at(0.6 * e, 0, 0);
  s.frustum(wx, y + 1.6 * e, wz, hx, hz, 1.1 * e, 7.5 * e, 0.25 * e, body);
  s.inside = null;
  s.tri(at(-4.6 * e, 0, 1.2 * e), at(-3 * e, 0, 1.4 * e), at(-4.9 * e, 0, 3.4 * e), trim);
  const [tx, , tz] = at(-4.4 * e, 0, 0);
  s.frustum(tx, y + 1.2 * e, tz, hx, hz, 0.6 * e, 2.2 * e, 0.15 * e, body);
  // Two floats on struts.
  for (const side of [1, -1]) {
    const [fx, , fz] = at(0, side * 1.5 * e, 0);
    s.frustum(fx, y - 2.4 * e, fz, hx, hz, 3.8 * e, 0.35 * e, 0.5 * e, trim, 4.2 * e, 0.3 * e);
    s.beam([fx, y - 1.9 * e, fz], at(0, side * 0.5 * e, 0), 0.18 * e, trim);
  }
  return 1;
}
