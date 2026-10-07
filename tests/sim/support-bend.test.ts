/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// The live check of 2026-10-07 on I-5 by Lake Samish (seed 7): after a clean landing on a semi's roof
// (`region-pnw:semi`, 16 by 2.6 m, 4.0 m tall) a rider braked to 0 m/s over it drifted 1.24 m across it
// in 5.05 s and dropped off its side. The top carried him by its own straight-line velocity with no
// turn, on a bend of 352 to 840 m radius (s 980 to 1160 of `osm-i5-lake-samish`). The maintainer's rule
// (2026-10-06, [decided]): one consistent physics, so a moving top carries its rider along its own path
// and a rider who holds still on a turning truck stays where he is on it.
//
// The race's own road and traffic types (the ISOLATED profile, supports on, no traffic but the semi put
// there by hand), stepping only the riders and traffic, counted in sim ticks.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { cos, sin } from '../../src/core';
import { registryFromGlob } from '../../src/content';
import { riderState, ridersSystem } from '../../src/sim/riders';
import { supportKeyOf } from '../../src/sim/riders/supports';
import { placeVehicle, toCorridor, trafficState, trafficSystem } from '../../src/sim/traffic';
import type { SimConfig, SimInput } from '../../src/sim/types';
import { addMover, createWorld, stepWorld, type Mover, type World } from '../../src/sim/world';
import { ISOLATED } from './batch';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const EVENT = 'region-pnw:pnw-fogline-run';
const ROUTE = 'region-pnw:osm-i5-samish-run';
const ROAD = 'osm-i5-lake-samish';
const SEMI = 'region-pnw:semi';
const SYSTEMS = [ridersSystem, trafficSystem];
const BRAKE: SimInput = { steer: 0, throttle: 0, brake: 255, flags: 0 };

function config(): SimConfig {
  const stream = createStreamCache().forEvent(REG, EVENT, undefined, ROUTE);
  return buildSimConfig(REG, stream, {
    seed: 7,
    eventId: EVENT,
    route: ROUTE,
    tuning: { ...ISOLATED, 'riders.supports': 1 },
  });
}

/** Where the rider's middle is on the vehicle's box: along its heading and across it, m. */
function onBox(config: SimConfig, rider: Mover, v: Mover): { du: number; dc: number } {
  const road = config.road;
  const f = road.frameAt(v.pos.edge, v.pos.s);
  const tx = f.tx * v.pos.dir;
  const tz = f.tz * v.pos.dir;
  const hx = cos(v.yaw) * tx - sin(v.yaw) * tz;
  const hz = cos(v.yaw) * tz + sin(v.yaw) * tx;
  const p = road.toWorld(rider.pos.edge, rider.pos.s, rider.pos.d, 0);
  const o = road.toWorld(v.pos.edge, v.pos.s, v.pos.d, 0);
  return { du: (p.x - o.x) * hx + (p.z - o.z) * hz, dc: -(p.x - o.x) * hz + (p.z - o.z) * hx };
}

/**
 * The semi on the bend at `s` of the Lake Samish road, racing toward the finish at its cruise speed, and
 * the player set down on its roof 6 m behind its middle (where the live rider was held), braked to a
 * standstill over it; then `ticks` on the brake. How far his place on its box moved, and for how long
 * the semi held him.
 */
function brakedOnSemi(cfg: SimConfig, s: number, ticks: number) {
  const world: World = createWorld(cfg);
  const player = cfg.riders.findIndex((r) => r.controller.kind === 'player');
  const edge = cfg.road.edgeIndex(ROAD);
  const m = addMover(world, 'rider', { edge, s, d: 0, dir: 1 }, player);
  for (const sys of SYSTEMS) sys.init(world, cfg);
  const st = trafficState(world);
  const at = toCorridor(st.corridor, { edge, s, d: 0, dir: 1 });
  if (!at) throw new Error('the bend is off the corridor');
  const type = cfg.trafficTypes.findIndex((t) => t.contentId === SEMI);
  const slot = placeVehicle(world, cfg, { type, u: at.u, dir: at.dir === -1 ? -1 : 1 });
  const semi = world.movers[st.id[slot] ?? -1];
  if (!semi) throw new Error('no semi');
  // One traffic step puts the semi's mover on the road; then the rider just over its roof, at its speed.
  stepWorld(world, cfg, [trafficSystem], []);
  const ahead = (k: number) => semi.pos.s + semi.pos.dir * k;
  m.pos.edge = semi.pos.edge;
  m.pos.s = ahead(-6);
  m.pos.d = semi.pos.d;
  m.pos.dir = semi.pos.dir;
  m.speed = semi.speed;
  m.yaw = 0;
  m.mode = 'Airborne';
  m.h = 4.05;
  const rs = riderState(world);
  rs.yAbs[m.id] = cfg.road.surfaceHeight(m.pos.edge, m.pos.s, m.pos.d) + 4.05;
  rs.vy[m.id] = -1;
  rs.airTicks[m.id] = 0;
  rs.pitch[m.id] = 0;
  rs.pitchRate[m.id] = 0;
  let landed = false;
  for (let t = 0; t < 60 && !landed; t++)
    landed = stepWorld(world, cfg, SYSTEMS, [BRAKE]).some((e) => e.type === 'land');
  expect(landed, 'landed on the semi').toBe(true);
  expect(supportKeyOf(world, m.id)).toBe(`v:${semi.id}`);
  const at0 = onBox(cfg, m, semi);
  const kappa = { min: Infinity, max: 0 };
  let across = 0;
  let along = 0;
  let onTicks = 0;
  for (let t = 0; t < ticks; t++) {
    stepWorld(world, cfg, SYSTEMS, [BRAKE]);
    if (supportKeyOf(world, m.id) !== `v:${semi.id}`) break;
    onTicks++;
    const k = Math.abs(cfg.road.kappaAt(semi.pos.edge, semi.pos.s));
    kappa.min = Math.min(kappa.min, k);
    kappa.max = Math.max(kappa.max, k);
    const now = onBox(cfg, m, semi);
    across = Math.max(across, Math.abs(now.dc - at0.dc));
    along = Math.max(along, Math.abs(now.du - at0.du));
  }
  return { at0, across, along, onTicks, kappa, semiS: semi.pos.s, speed: semi.speed, d: semi.pos.d };
}

describe('a semi on the I-5 bend by Lake Samish carries a braked rider along its own path', () => {
  it('braked still 6 m behind its middle for 5 s on the bend, he stays where he is on it', () => {
    const cfg = config();
    const r = brakedOnSemi(cfg, 960, 60 * 5);
    console.log(
      `[examined] ${ROAD} from s 960 (to s ${r.semiS.toFixed(0)}), semi at ${r.speed.toFixed(1)} m/s at d ${r.d.toFixed(2)}, curvature ${r.kappa.min.toFixed(4)} to ${r.kappa.max.toFixed(4)} 1/m (radius ${(1 / r.kappa.max).toFixed(0)} to ${(1 / Math.max(r.kappa.min, 1e-9)).toFixed(0)} m): on ${r.onTicks} ticks, from (${r.at0.du.toFixed(2)}, ${r.at0.dc.toFixed(2)}) on the box moved at most ${r.across.toFixed(3)} m across and ${r.along.toFixed(3)} m along`,
    );
    // The bend the live check measured (radius 352 to 840 m somewhere under the ride).
    expect(r.kappa.max).toBeGreaterThan(1 / 900);
    expect(r.onTicks).toBe(60 * 5);
    expect(r.across).toBeLessThan(0.05);
    expect(r.along).toBeLessThan(0.1);
  });
});
