/// <reference types="vite/client" />
// The picture agrees with a rider on a roof and a rider who leaves the course (the maintainer, 2026-10-06,
// [decided]: a road race in a physical world with honest edges; "consistent physics and gameplay is important here
// so players know what to expect and how to interact with the world"). The sim's own snapshots and events, on the
// real roads and the race seed's structures plan (road/structures.ts), tick by tick:
// - the chase, far and helmet cameras follow a rider who lands on a roof beside a planned front (Duval Street's
//   Old Town, the Mission's alley) and rides it: the eye stays beside him instead of being held off over the street
//   by the sidewalk's tag, is never inside a building, and he stays in the frame, over the landing, the ride, the
//   take-off and the crash at the roof's end. Control: the camera with no plan (the camera as it was);
// - the shadow and the chalk mark lie on every roof the plan holds, on a pitched roof's plane (an audit of every
//   structure of 17 real networks, with the old flat mark as its negative control);
// - out of bounds reads: the real `splash` events of a fall onto the ground behind a front, through the app's
//   ticker feed, are one plain line; the old rules (no course edges) have no fall and no line.
import { describe, expect, it } from 'vitest';
import { outOfBoundsLineFor, createOutOfBounds } from '../../src/app/ticker-feed';
import { cameraTargetOf } from '../../src/app/camera-target';
import { createFollowCamera, type CameraPose, type FollowCamera } from '../../src/camera';
import { EYE_CLEARANCE_M, insideSolid, solidsNear } from '../../src/camera/solids';
import {
  createRoadNetwork,
  raceStructures,
  structuresAt,
  topAt,
  type BakedNetwork,
  type BakedNetworkBundle,
  type BakedRoad,
  type BakedRoute,
  type RoadNetwork,
  type StructurePlan,
} from '../../src/road';
import { fitRoof, MIN_ROOF_M } from '../../src/render/roof-fit';
import { createSimWithWorld } from '../../src/sim/create';
import { riderLimits, riderState } from '../../src/sim/riders';
import { plannedFrontAt, structuresOver } from '../../src/sim/riders/structures';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { EntitySnapshot, SimConfig, SimEvent, SimInput } from '../../src/sim/types';
import { ISOLATED } from './batch';

const print = (line: string) => process.stdout.write(`[camera-roofs] ${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('/packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('/packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<BakedRoute>('/packs/*/regions/*/routes/*.json', {
  eager: true,
  import: 'default',
});

const SOLID = { 'riders.structures': 1, 'riders.supports': 1 };
const DT = 1 / 60;
const ASPECT = 2.1;

function configOf(networkId: string, rules: Record<string, number> = SOLID): SimConfig {
  const network = Object.values(networkFiles).find((n) => n.id === networkId);
  if (!network) throw new Error(`no network ${networkId}`);
  const roads = network.roads.map((id) => {
    const r = Object.values(roadFiles).find((x) => x.id === id);
    if (!r) throw new Error(`no road ${id}`);
    return r;
  });
  const route = Object.values(routeFiles).find((r) => r.network === networkId);
  if (!route) throw new Error(`no route on ${networkId}`);
  const bundle: BakedNetworkBundle = { network, roads };
  return gapSimConfig(bundle, { route, tuning: { ...ISOLATED, 'ground.offRoad': 1, ...rules } });
}

/** The highest top over a world point, m above the road at (edge, s, d), of a structure that holds a bike. */
function topOver(road: RoadNetwork, plan: StructurePlan, edge: number, s: number, d: number, any = false) {
  const p = road.toWorld(edge, s, d, 0);
  const ground = road.surfaceHeight(edge, s, d);
  let best: number | null = null;
  for (const st of structuresOver(plan, p.x, p.z)) {
    if (!any && (2 * st.foot.hu < 2 || 2 * st.foot.hv < 2)) continue;
    const t = (topAt(st, p.x, p.z) ?? 0) - ground;
    if (best === null || t > best) best = t;
  }
  return best;
}

/** The first front whose roof is `lo` to `hi` m over the road and stays within a kerb of that for the flight. */
function findFront(road: RoadNetwork, plan: StructurePlan, lo: number, hi: number, zoneM: number) {
  for (const e of road.edges)
    for (let s = 40; s < e.length - 40; s += 4)
      for (const side of [1, -1] as const) {
        const vside = side > 0 ? 'right' : 'left';
        if (!plannedFrontAt(road, e.index, s, vside)) continue;
        const edgeD = road.vergeAt(e.index, s, vside).dOuter;
        const top = topOver(road, plan, e.index, s, edgeD + side * 1.5);
        if (top === null || top < lo || top > hi) continue;
        let even = true;
        for (let ds = 3; ds <= zoneM && even; ds += 1)
          for (let dd = 1; dd <= 3.5 && even; dd += 0.5) {
            const t = topOver(road, plan, e.index, s + ds, edgeD + side * dd);
            const any = topOver(road, plan, e.index, s + ds, edgeD + side * dd, true);
            if (t === null || any === null || Math.abs(t - top) > 0.3 || any > t + 0.05) even = false;
          }
        if (!even) continue;
        let clear = top;
        for (let ds = 0; ds <= 12; ds += 2)
          for (let dd = -1; dd <= 3; dd += 0.1)
            clear = Math.max(clear, topOver(road, plan, e.index, s + ds, edgeD + side * dd, true) ?? 0);
        return { edge: e.index, s, side, top, clear };
      }
  throw new Error(`no building front ${lo} to ${hi} m tall on ${road.id}`);
}

/** The camera's frame for one snapshot entity, the way the app builds it. */
const targetOf = (e: EntitySnapshot) =>
  cameraTargetOf({ id: e.id, x: e.x, y: e.y, z: e.z, heading: e.heading, speed: e.speed, lean: e.lean }, e);

/** The angle between where the camera looks and where the rider is, degrees. */
function offCentre(pose: CameraPose, e: EntitySnapshot): number {
  const vx = pose.lookX - pose.x;
  const vy = pose.lookY - pose.y;
  const vz = pose.lookZ - pose.z;
  const rx = e.x - pose.x;
  const ry = e.y + 1 - pose.y;
  const rz = e.z - pose.z;
  const dot = vx * rx + vy * ry + vz * rz;
  const m = Math.hypot(vx, vy, vz) * Math.hypot(rx, ry, rz);
  return m > 0 ? (Math.acos(Math.min(1, Math.max(-1, dot / m))) * 180) / Math.PI : 0;
}

interface Ride {
  frames: number;
  riddenTicks: number;
  crashed: boolean;
  /** Frames the eye was inside a building, and frames it was within the near plane's reach of one. */
  inside: number;
  withinNear: number;
  /** The farthest the eye was held across the road from him, riding the roof, m. */
  lateral: number;
  /** The widest angle between the view and him over the whole ride, degrees (the frame's vertical half is fov/2). */
  worstOffCentre: number;
  /** The same over the frames he was on the roof or crashed on it. */
  fov: number;
}

/**
 * One roof ride: the player in the air at the riding limit beside a front, a metre over what is between the edge
 * and the roof, bars toward it for a third of a second; the whole sim stepped, a camera following each frame.
 */
function rideRoof(
  id: string,
  speed: number,
  zone: number,
  view: number,
  withPlan: boolean,
  ticks = 150,
): Ride {
  const config = configOf(id);
  const plan = raceStructures(config.road, config.seed);
  const at = findFront(config.road, plan, 4, 8, zone);
  const { sim, world } = createSimWithWorld(config);
  const road = config.road;
  const p = world.movers[0];
  if (!p) throw new Error('no rider');
  const lim = riderLimits(world, config, at.edge, at.s, 0);
  p.pos.edge = at.edge;
  p.pos.s = at.s;
  p.pos.d = at.side > 0 ? lim.hi - 0.05 : lim.lo + 0.05;
  p.mode = 'Airborne';
  p.speed = speed;
  p.yaw = at.side * 0.3;
  const st = riderState(world);
  st.yAbs[p.id] = road.surfaceHeight(at.edge, at.s, p.pos.d) + at.clear + 1;
  st.vy[p.id] = 0;
  st.airTicks[p.id] = 0;
  st.lastTick[p.id] = -1;
  const cam: FollowCamera = createFollowCamera({ road });
  cam.setParam('camera.mode', view);
  const ctx = withPlan ? { aspect: ASPECT, structures: plan } : { aspect: ASPECT };
  const out: Ride = {
    frames: 0,
    riddenTicks: 0,
    crashed: false,
    inside: 0,
    withinNear: 0,
    lateral: 0,
    worstOffCentre: 0,
    fov: 0,
  };
  for (let t = 0; t < ticks; t++) {
    const cmd: SimInput = {
      steer: t < 20 && p.mode === 'Airborne' ? at.side * 127 : 0,
      throttle: 80,
      brake: 0,
      flags: 0,
    };
    sim.step([cmd]);
    const events = sim.events();
    cam.onEvents(events);
    if (events.some((e) => e.type === 'crash')) out.crashed = true;
    const e = sim.snapshot().entities[0];
    if (!e) throw new Error('no snapshot');
    const target = targetOf(e);
    const pose = t === 0 ? cam.snap(target, ctx) : cam.update(target, DT, ctx);
    out.frames++;
    out.fov = pose.fov;
    const near = solidsNear(plan, pose.x, pose.z, EYE_CLEARANCE_M);
    if (near.some((s) => insideSolid(s, pose.x, pose.y, pose.z, 0))) out.inside++;
    if (near.some((s) => insideSolid(s, pose.x, pose.y, pose.z, EYE_CLEARANCE_M))) out.withinNear++;
    if (e.mode === 'Road' && e.road.h > 0.5) {
      out.riddenTicks++;
      out.lateral = Math.max(
        out.lateral,
        Math.abs(road.project(pose.x, pose.z, e.road.edge).d - road.project(e.x, e.z, e.road.edge).d),
      );
    }
    out.worstOffCentre = Math.max(out.worstOffCentre, offCentre(pose, e));
  }
  return out;
}

describe('the cameras on a roof ride: Old Town’s roof over the sidewalk, and the Mission’s alley wall', () => {
  for (const [id, speed, zone] of [
    ['osm-keys-duval', 9, 11],
    ['sf-mission', 15, 20],
  ] as const) {
    for (const [view, name] of [
      [0, 'chase'],
      [1, 'far'],
      [2, 'helmet'],
    ] as const) {
      it(`${id}, ${name} view: beside him on the roof, never inside a building, and he stays in the frame`, () => {
        const withPlan = rideRoof(id, speed, zone, view, true);
        const without = rideRoof(id, speed, zone, view, false);
        print(
          `${id} ${name}: rode ${withPlan.riddenTicks} ticks (crash ${withPlan.crashed}); eye across from him at most ${withPlan.lateral.toFixed(2)} m with the plan, ${without.lateral.toFixed(2)} m as it was; inside a building ${withPlan.inside}/${withPlan.frames} frames, within the near plane's reach of one ${withPlan.withinNear}; widest view-to-rider angle ${withPlan.worstOffCentre.toFixed(1)} deg (as it was ${without.worstOffCentre.toFixed(1)}; frame half ${(withPlan.fov / 2).toFixed(0)})`,
        );
        expect(withPlan.riddenTicks).toBeGreaterThanOrEqual(15);
        expect(withPlan.inside).toBe(0);
        if (view === 2) {
          // The helmet eye is in his head, and rides over the roof it is on: nothing to hold off, and no view
          // of him to keep (he is behind it).
          expect(withPlan.lateral).toBeLessThan(0.5);
        } else {
          // Inside the middle 60 % of the frame's half height, however the solids moved the eye.
          expect(withPlan.worstOffCentre).toBeLessThan((withPlan.fov / 2) * 0.6);
          // Beside him as on the road; as it was the sidewalk's tag held it a metre or more off him.
          expect(withPlan.lateral).toBeLessThan(0.8);
          expect(without.lateral).toBeGreaterThan(1.5);
        }
      });
    }
  }
});

describe('the shadow and the chalk mark on every roof of the real plans', () => {
  const NETWORKS = [...new Set(Object.values(networkFiles).map((n) => n.id))].sort();
  it('lie on the roof’s own plane at four points round them, a flat mark does not on a pitched one', () => {
    let roofs = 0;
    let pitched = 0;
    let shrunk = 0;
    let fits = 0;
    let tooSmall = 0;
    let planar = 0;
    let ridge = 0;
    let edgeFlat = 0;
    let worst = 0;
    let flatWorst = 0;
    for (const id of NETWORKS) {
      let config: SimConfig;
      let plan: StructurePlan;
      try {
        config = configOf(id);
        plan = raceStructures(config.road, config.seed);
      } catch {
        continue;
      }
      for (const st of plan.items) {
        // A top too small to hold a bike is no roof for a mark (render/roof-fit.ts).
        if (2 * st.foot.hu < MIN_ROOF_M || 2 * st.foot.hv < MIN_ROOF_M) {
          tooSmall++;
          continue;
        }
        roofs++;
        if (st.roof.kind === 'pitched') pitched++;
        const f = st.foot;
        // The oval's size: a rider's shadow; headings turned 30 degrees apart; the middle, and near each side.
        for (let h = 0; h < 12; h++) {
          const heading = (h * Math.PI) / 6;
          for (const [fu, fv] of [
            [0, 0],
            [0.5, 0.3],
            [-0.6, 0.4],
            [0.2, -0.7],
          ] as const) {
            const u = fu * f.hu;
            const v = fv * f.hv;
            const x = f.x + u * f.ux - v * f.uz;
            const z = f.z + u * f.uz + v * f.ux;
            const top = topAt(st, x, z);
            if (top === null) continue;
            // Only where this structure is the roof under him (no taller one on it).
            const over = structuresAt(plan, x, z)
              .map((o) => topAt(o, x, z) ?? -Infinity)
              .reduce((a, b) => Math.max(a, b), -Infinity);
            if (over > top + 1e-9) continue;
            const fit = fitRoof(plan, x, top, z, heading, 2.3, 1.1);
            expect(fit, `${id} ${st.rule}`).not.toBeNull();
            if (!fit) continue;
            fits++;
            if (fit.scale < 1) shrunk++;
            const fx = -Math.sin(heading);
            const fz = -Math.cos(heading);
            const rx = Math.cos(heading);
            const rz = -Math.sin(heading);
            const hl = (2.3 * fit.scale) / 2;
            const hw = (1.1 * fit.scale) / 2;
            const samples = (
              [
                [x + fx * hl, z + fz * hl],
                [x - fx * hl, z - fz * hl],
                [x + rx * hw, z + rz * hw],
                [x - rx * hw, z - rz * hw],
              ] as const
            ).map(([px, pz]) => ({ px, pz, t: topAt(fit.roof, px, pz) }));
            // The smallest oval a rider at the very edge gets is a small flat mark, not a fit.
            if (samples.some((s) => s.t === null)) {
              edgeFlat++;
              continue;
            }
            // An oval over a ridge is two planes: the four points are not one plane, and no mark fits both.
            const mean = samples.reduce((a, s) => a + (s.t ?? 0), 0) / 4;
            if (Math.abs(mean - top) > 1e-9) {
              ridge++;
              continue;
            }
            planar++;
            for (const s of samples) {
              // The fitted plane through (x, fit.y, z) with its normal, read at the sample.
              const plane = fit.y - (fit.nx * (s.px - x) + fit.nz * (s.pz - z)) / fit.ny;
              worst = Math.max(worst, Math.abs(plane - (s.t ?? 0)));
              flatWorst = Math.max(flatWorst, Math.abs(fit.y - (s.t ?? 0)));
            }
          }
        }
      }
    }
    print(
      `${roofs} roofs (${pitched} pitched; ${tooSmall} tops too small for a bike left out) on ${NETWORKS.length} networks, ${fits} placements (${shrunk} drawn smaller to stay on the roof): ${planar} on one plane, where the fitted plane is within ${worst.toExponential(2)} m of the roof at the oval's four points and a flat mark would be off by ${flatWorst.toFixed(2)} m; ${ridge} over a ridge, ${edgeFlat} at the very edge (a small flat mark)`,
    );
    expect(fits).toBeGreaterThan(1000);
    expect(planar).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(1e-6);
    // Control: the old flat mark, on the same placements, sinks into a slope by far more than that.
    expect(pitched).toBeGreaterThan(0);
    expect(flatWorst).toBeGreaterThan(0.05);
  });
});

describe('out of bounds reads: the real fall behind a front, through the app’s feed', () => {
  it('a fall onto the ground is one plain line, once; the old rules have no fall and no line', () => {
    // The first opening in a planned front where the ground rule ends a ride (the search the course-edges test makes).
    for (const id of ['osm-keys-duval', 'sf-mission', 'sf-chinatown-northbeach']) {
      const rules = { ...SOLID, 'riders.courseEdges': 1 };
      const config = configOf(id, rules);
      const plan = raceStructures(config.road, config.seed);
      const road = config.road;
      for (const e of road.edges)
        for (const side of [1, -1] as const)
          for (let s = 30; s < e.length - 30; s += 7) {
            const vside = side > 0 ? 'right' : 'left';
            if (!plannedFrontAt(road, e.index, s, vside)) continue;
            const line = road.vergeAt(e.index, s, vside).dOuter;
            // A ride at the line, 2 m up, heading out: whatever lies there is what the rule says.
            const events = flyOut(config, e.index, s, line - side * 1.2, side);
            const splash = events.filter((v) => v.type === 'splash' && v.data['past'] === 'ground');
            if (splash.length === 0) continue;
            const state = createOutOfBounds();
            const lines = events
              .map((ev) => outOfBoundsLineFor([ev], 0, state))
              .filter((l): l is NonNullable<typeof l> => l !== null);
            print(
              `${id} at ${road.edges[e.index]?.id} s ${s} side ${side}: ${splash.length} splash events past ground (penalty ${String(splash[0]?.data['penaltyTicks'])} ticks), ${lines.length} line: ${lines[0]?.text}`,
            );
            expect(lines).toHaveLength(1);
            expect(lines[0]).toEqual({
              cls: 'system',
              text: 'OUT OF BOUNDS. BACK ON THE ROAD IN 4 SECONDS.',
            });
            // Control: the same ride on the old rules (no course edges) has no such fall, so no line.
            const old = configOf(id, { ...SOLID, 'riders.courseEdges': 0 });
            const oldEvents = flyOut(old, e.index, s, line - side * 1.2, side);
            const oldState = createOutOfBounds();
            expect(oldEvents.filter((v) => v.type === 'splash' && v.data['past'] === 'ground')).toEqual([]);
            expect(oldEvents.map((ev) => outOfBoundsLineFor([ev], 0, oldState))).toEqual(
              oldEvents.map(() => null),
            );
            void plan;
            return;
          }
    }
    throw new Error('no fall out of bounds found on the real roads');
  });
});

/** The player 2 m up at (edge, s, d) heading out toward `side`, bars held that way, the whole sim stepped. */
function flyOut(config: SimConfig, edge: number, s: number, d: number, side: 1 | -1): SimEvent[] {
  const { sim, world } = createSimWithWorld(config);
  const me = world.movers[0];
  if (!me) throw new Error('no rider');
  const st = riderState(world);
  me.pos = { edge, s, d, dir: 1 };
  me.speed = 6;
  me.yaw = side * 1;
  me.mode = 'Airborne';
  me.h = 2;
  st.yAbs[me.id] = config.road.surfaceHeight(edge, s, d) + 2;
  st.vy[me.id] = 0;
  st.airTicks[me.id] = 0;
  const events: SimEvent[] = [];
  for (let t = 0; t < 400; t++) {
    sim.step([{ steer: 0, throttle: 128, brake: 0, flags: 0 }]);
    events.push(...sim.events());
    if (sim.events().some((e) => e.type === 'respawn')) break;
  }
  return events;
}

void createRoadNetwork;
