/// <reference types="vite/client" />
// What the presentation does with the sim's own snapshots of a rider on a roof and a rider going over a
// rail (the maintainer, playing on the phone, 2026-10-06: "land on it and ride on it"; "go over and across
// barriers, possibly resulting in a crash like falling in the water"; "consistent physics and gameplay is
// important here so players know what to expect"; high falls "(a)": a clean cut-away, no gag). The unit
// tests beside each module hold the rules with hand-built snapshots; here the snapshots, the events and the
// camera's target are the real ones, every one a sim tick:
// - a rider who lands on a truck's roof and rides it: the shadow on the roof, the chase camera aimed along
//   it with no air tip, the helmet eye above it, the road's sounds on (`grounded` is false in his snapshot);
// - the Golden Gate's railing: the `splash` says `high`, so no gag and no sound, the camera holds on the rail
//   from the `railOver` to the `respawn` and cuts to him there, and the shadow of the falling body is on
//   the water;
// - the Seven Mile Bridge's rail: a low splash keeps its gag and its sound, and the camera follows him down.
import { describe, expect, it } from 'vitest';
import { cameraTargetOf } from '../../src/app/camera-target';
import { cueForEvent } from '../../src/audio/cues';
import { rollingOn } from '../../src/audio/rolling';
import { createFollowCamera, type CameraPose } from '../../src/camera';
import { tuningDefaults } from '../../src/core';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  type BakedNetwork,
  type BakedNetworkBundle,
  type BakedRoad,
  type BakedRoute,
  edgeTopAt,
  pastAt,
  waterLevelOf,
} from '../../src/road';
import { groundYOf } from '../../src/render/shadows';
import { createSimWithWorld, SIM_TUNING } from '../../src/sim/create';
import { riderLimits, riderState } from '../../src/sim/riders';
import { placeVehicle, trafficState } from '../../src/sim/traffic';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import { OVERBOARD_MAX_TICKS } from '../../src/sim/tumble/index';
import type {
  EntitySnapshot,
  SimConfig,
  SimEvent,
  SimInput,
  SimRiderDef,
  SimTrafficTypeDef,
} from '../../src/sim/types';
import { ISOLATED } from './batch';
import { routeNetworks, track } from './geometry-routes';

const print = (line: string) => process.stdout.write(`[high-riders] ${line}\n`);
const DT = 1 / 60;
const coast: SimInput = { steer: 0, throttle: 0, brake: 0, flags: 0 };

// ---- A rider on a truck's roof ---------------------------------------------------------------

const BOX_TRUCK: SimTrafficTypeDef = {
  contentId: 'base:box-truck',
  category: 'truck',
  lengthM: 7.5,
  widthM: 2.4,
  heightM: 3.4,
  cruiseMps: 15,
  hazard: 'big',
};
const PLAYER: SimRiderDef = {
  contentId: 'base:player',
  name: 'You',
  role: 'player',
  faction: 'rider',
  controller: { kind: 'player', slot: 0 },
  bike: {
    contentId: 'base:bike',
    topSpeedMps: 40,
    accelMps2: 4.2,
    brakeMps2: 9,
    steerRateMps: 5.5,
    massKg: 180,
  },
  massKg: 85,
  healthMax: 100,
};

function fixtureConfig(): SimConfig {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 2000, kappa: 0 }]);
  const road = createRoadNetwork(bundle);
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'a', s: 1980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  return {
    seed: 7,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [100],
      raceEndTimeoutTicks: 1800,
    },
    riders: [PLAYER],
    weapons: [],
    trafficTypes: [BOX_TRUCK],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: {
      ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
      'traffic.densitySame': 0,
      'traffic.densityOncoming': 0,
    },
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}

/** The camera's frame for one snapshot entity, the way the app builds it. */
const target = (e: EntitySnapshot) =>
  cameraTargetOf({ id: e.id, x: e.x, y: e.y, z: e.z, heading: e.heading, speed: e.speed, lean: e.lean }, e);

const pitchDown = (p: CameraPose) => Math.atan2(p.y - p.lookY, Math.hypot(p.lookX - p.x, p.lookZ - p.z));

describe('a rider who has landed on a box truck’s roof and rides it', () => {
  /** Drops the player onto a box truck's roof, then rides on with the brake held; returns the snapshots. */
  function ridden() {
    const config = fixtureConfig();
    const { sim, world } = createSimWithWorld(config);
    const slot = placeVehicle(world, config, { type: 0, u: 300, dir: 1, v0: 15, speed: 15 });
    const truck = trafficState(world).id[slot] ?? -1;
    const m = world.movers[0];
    if (!m) throw new Error('no rider');
    m.pos.s = 299;
    m.pos.d = world.movers[truck]?.pos.d ?? 0;
    m.mode = 'Airborne';
    m.speed = 18;
    m.h = 3.6;
    const st = riderState(world);
    st.yAbs[m.id] = config.road.surfaceHeight(0, m.pos.s, m.pos.d) + 3.6;
    st.vy[m.id] = -4;
    st.airTicks[m.id] = 0;
    st.lastTick[m.id] = -1;
    const frames: EntitySnapshot[] = [];
    for (let t = 0; t < 90; t++) {
      sim.step([{ ...coast, brake: 255 }]);
      const e = sim.snapshot().entities.find((x) => x.id === m.id);
      if (e) frames.push(e);
    }
    return { config, frames };
  }

  it('his snapshot says he rides it: Road mode, 3.4 m up, `grounded` false', () => {
    const { frames } = ridden();
    const on = frames.filter((e) => e.mode === 'Road' && e.road.h > 3);
    print(`${on.length} of ${frames.length} frames riding the roof; first ${JSON.stringify(on[0]?.road)}`);
    expect(on.length).toBeGreaterThan(30);
    for (const e of on) {
      expect(e.y).toBeCloseTo(3.4, 6);
      expect(e.grounded).toBe(false);
    }
  });

  it('the shadow is on the roof, not the road under the truck; the road’s sounds go on', () => {
    const { frames } = ridden();
    const on = frames.filter((e) => e.mode === 'Road' && e.road.h > 3);
    for (const e of on) {
      expect(groundYOf(e)).toBeCloseTo(3.4, 6);
      expect(rollingOn(e)).toBe(true);
    }
    // Control: while he is still in the air above it the shadow is on the roof too, and no sound of rolling.
    const air = frames.filter((e) => e.mode === 'Airborne');
    expect(air.length).toBeGreaterThan(0);
    for (const e of air) {
      expect(e.floorY).toBeCloseTo(3.4, 6);
      expect(groundYOf(e)).toBeCloseTo(3.4, 6);
      expect(rollingOn(e)).toBe(false);
    }
  });

  it('the chase camera aims along the roof with no air tip; the helmet eye is a head above it', () => {
    const { config, frames } = ridden();
    const riding = (view: 'lowChase' | 'helmet') => {
      const cam = createFollowCamera({ road: config.road });
      cam.setView(view);
      let pose: CameraPose | null = null;
      let tgt: ReturnType<typeof target> | null = null;
      frames.forEach((e, i) => {
        tgt = target(e);
        pose = i === 0 ? cam.snap(tgt) : cam.update(tgt, DT);
      });
      return { pose: pose as unknown as CameraPose, tgt: tgt as unknown as ReturnType<typeof target> };
    };
    const chase = riding('lowChase');
    // A control: the same camera on a rider on the road (the roof ride's pitch is the road's).
    const road = fixtureConfig();
    const { sim } = createSimWithWorld(road);
    const cam = createFollowCamera({ road: road.road });
    let ground: CameraPose | null = null;
    for (let t = 0; t < 90; t++) {
      sim.step([{ ...coast, throttle: 255 }]);
      const e = sim.snapshot().entities[0];
      if (!e) continue;
      ground = t === 0 ? cam.snap(target(e)) : cam.update(target(e), DT);
    }
    print(
      `chase pitch down: roof ${pitchDown(chase.pose).toFixed(3)}, road ${ground ? pitchDown(ground).toFixed(3) : 'n/a'}`,
    );
    expect(ground).not.toBeNull();
    expect(Math.abs(pitchDown(chase.pose) - pitchDown(ground as CameraPose))).toBeLessThan(0.08);
    const helmet = riding('helmet');
    expect(helmet.pose.y).toBeGreaterThan(3.4 + 1.4);
  });
});

// ---- Over a rail --------------------------------------------------------------------------------

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

function configOf(networkId: string): SimConfig {
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
  return gapSimConfig(bundle, { route, tuning: { ...ISOLATED, 'ground.offRoad': 1 } });
}

interface Frame {
  e: EntitySnapshot;
  events: readonly SimEvent[];
  pose: CameraPose;
}

/**
 * The player in the air at the riding limit on `side` of `road`, `hM` above the deck, flying out at
 * `yaw`, bars toward the side; the whole sim stepped until the respawn, with the chase camera fed the
 * way the app feeds it (the tick's events, then the frame's target). Returns every frame.
 */
function flyOver(
  config: SimConfig,
  at: { road: string; s: number; side: 'left' | 'right'; hM: number; vy: number; speed: number; yaw: number },
): Frame[] {
  const road = config.road;
  const edge = road.edgeIndex(at.road);
  const { sim, world } = createSimWithWorld(config);
  const p = world.movers[0];
  if (!p) throw new Error('no player');
  const sign = at.side === 'right' ? 1 : -1;
  p.pos.edge = edge;
  p.pos.s = at.s;
  p.pos.dir = 1;
  const lim = riderLimits(world, config, edge, at.s, 0);
  p.pos.d = sign > 0 ? lim.hi - 0.05 : lim.lo + 0.05;
  const st = riderState(world);
  p.mode = 'Airborne';
  p.speed = at.speed;
  p.yaw = sign * at.yaw;
  st.yAbs[p.id] = road.surfaceHeight(edge, at.s, p.pos.d) + at.hM;
  st.vy[p.id] = at.vy;
  st.airTicks[p.id] = 0;
  st.lastTick[p.id] = -1;
  const cam = createFollowCamera({ road });
  const first = sim.snapshot().entities[0];
  if (!first) throw new Error('no snapshot');
  cam.snap(target(first));
  const frames: Frame[] = [];
  for (let t = 0; t < 60 * 14; t++) {
    const cmd: SimInput = {
      steer: p.mode === 'Airborne' ? sign * 127 : 0,
      throttle: 255,
      brake: 0,
      flags: 0,
    };
    sim.step([cmd]);
    const events = sim.events();
    cam.onEvents(events);
    const e = sim.snapshot().entities.find((x) => x.id === p.id);
    if (!e) throw new Error('no entity');
    frames.push({ e, events: [...events], pose: cam.update(target(e), DT) });
    if (events.some((x) => x.type === 'respawn')) break;
  }
  return frames;
}

const eyeOf = (p: CameraPose) => [p.x, p.y, p.z];
const indexOf = (frames: Frame[], type: SimEvent['type']) =>
  frames.findIndex((f) => f.events.some((x) => x.type === type));

describe('over the Golden Gate’s railing: a high drop, a clean cut-away', () => {
  const frames = flyOver(configOf('osm-sf-golden-gate'), {
    road: 'osm-sf-gg-bridge',
    s: 1400,
    side: 'right',
    hM: 3,
    vy: 1,
    speed: 30,
    yaw: 0.15,
  });
  const over = indexOf(frames, 'railOver');
  const woke = indexOf(frames, 'respawn');
  const splash = frames.flatMap((f) => f.events).find((x) => x.type === 'splash');

  it('the splash says it is high, so it has no gag and no sound', () => {
    print(`railOver at frame ${over}, splash ${JSON.stringify(splash?.data)}, respawn at ${woke}`);
    expect(over).toBeGreaterThan(0);
    expect(splash?.data).toMatchObject({ over: true, past: 'water', high: true });
    for (const f of frames) {
      for (const e of f.events) if (e.type === 'splash') expect(cueForEvent(e, 0)).toBeNull();
    }
  });

  it('the camera holds on the rail from the railOver to the respawn, and cuts to him there', () => {
    const held = frames.slice(over, woke);
    const fell = frames[woke - 1]?.e.tumble?.rider.y ?? NaN;
    print(
      `held ${held.length} frames; the rider’s body fell to y ${fell.toFixed(1)}, the held eye is at y ${(held[0] as Frame).pose.y.toFixed(1)}`,
    );
    expect(held.length).toBeGreaterThan(300);
    for (const f of held) expect(eyeOf(f.pose)).toEqual(eyeOf((held[0] as Frame).pose));
    // The rider's body fell away far below the held view (the cut-away), then he woke on the bridge.
    expect(fell).toBeLessThan((held[0] as Frame).pose.y - 30);
    const cut = frames[woke] as Frame;
    const behind = createFollowCamera({ road: configOf('osm-sf-golden-gate').road }).snap(target(cut.e));
    expect(cut.pose.x).toBeCloseTo(behind.x, 1);
    expect(cut.pose.z).toBeCloseTo(behind.z, 1);
    // And it follows him again.
    expect(cut.e.mode).toBe('Road');
  });

  it('while he falls the bodies’ shadow is on the water, not at the deck’s height', () => {
    const falling = frames.slice(over, woke).filter((f) => f.e.mode === 'Tumble');
    expect(falling.length).toBeGreaterThan(300);
    for (const f of falling) expect(groundYOf(f.e)).toBe(0);
  });
});

// ---- A high fall shows nothing hanging (the one live check of 2026-10-07, mustFix 3) -----------------------

/** The phone held sideways (915 × 412) is the widest view the game draws; a body is a sphere this big, m. */
const ASPECT = 915 / 412;
const BODY_R_M = 1;
/** The render camera's far plane (render/index.ts), m. */
const FAR_M = 760;

/**
 * Whether a sphere of `BODY_R_M` at `p` is inside the pose's view frustum (the phone's widest aspect), and
 * not wholly under the water (`waterY`) while the eye is above it: the sea and a lake are drawn opaque.
 */
function inView(pose: CameraPose, p: { x: number; y: number; z: number }, waterY: number): boolean {
  if (pose.y > waterY && p.y + BODY_R_M < waterY) return false;
  const f = [pose.lookX - pose.x, pose.lookY - pose.y, pose.lookZ - pose.z];
  const fl = Math.hypot(f[0]!, f[1]!, f[2]!);
  const fw = f.map((v) => v / fl) as [number, number, number];
  const up = [pose.upX, pose.upY, pose.upZ];
  // right = forward × up, then the true up = right × forward.
  const r = [
    fw[1] * up[2]! - fw[2] * up[1]!,
    fw[2] * up[0]! - fw[0] * up[2]!,
    fw[0] * up[1]! - fw[1] * up[0]!,
  ];
  const rl = Math.hypot(r[0]!, r[1]!, r[2]!);
  const rw = r.map((v) => v / rl) as [number, number, number];
  const u = [rw[1] * fw[2] - rw[2] * fw[1], rw[2] * fw[0] - rw[0] * fw[2], rw[0] * fw[1] - rw[1] * fw[0]];
  const v = [p.x - pose.x, p.y - pose.y, p.z - pose.z];
  const z = v[0]! * fw[0] + v[1]! * fw[1] + v[2]! * fw[2];
  if (z < 0.3 - BODY_R_M || z > FAR_M + BODY_R_M) return false;
  const x = v[0]! * rw[0] + v[1]! * rw[1] + v[2]! * rw[2];
  const y = v[0]! * u[0]! + v[1]! * u[1]! + v[2]! * u[2]!;
  const ty = Math.tan(((pose.fov / 2) * Math.PI) / 180);
  return Math.abs(y) - BODY_R_M <= z * ty && Math.abs(x) - BODY_R_M <= z * ty * ASPECT;
}

type Body = { x: number; y: number; z: number };
/**
 * The frames from the `railOver` to the `respawn` in which a crash body has not moved since the frame before
 * (it hangs or rests) and is in view of the camera: what the live check saw on the Golden Gate.
 */
function frozenInView(frames: readonly Frame[], waterY: number, bodies = (f: Frame) => f.e.tumble): string[] {
  const over = indexOf(frames as Frame[], 'railOver');
  const woke = indexOf(frames as Frame[], 'respawn');
  const out: string[] = [];
  for (let i = Math.max(1, over); i < woke; i++) {
    const now = bodies(frames[i] as Frame);
    const was = bodies(frames[i - 1] as Frame);
    if (!now || !was) continue;
    for (const k of ['rider', 'bike'] as const) {
      const a: Body = now[k];
      const b: Body = was[k];
      const still = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-4;
      if (still && inView((frames[i] as Frame).pose, a, waterY))
        out.push(`${i - over}:${k}@y${a.y.toFixed(1)}`);
    }
  }
  return out;
}

/** The old `OVERBOARD_MAX_TICKS` (3 s): the cap that stopped a long fall in mid-air (sim/tumble before this fix). */
const OLD_CAP_TICKS = 180;

/** The control: the same frames with the bodies stopped where they were `OLD_CAP_TICKS` after the `railOver`. */
function withOldCap(frames: readonly Frame[]): (f: Frame) => EntitySnapshot['tumble'] {
  const over = indexOf(frames as Frame[], 'railOver');
  const stop = frames[over + OLD_CAP_TICKS]?.e.tumble ?? null;
  return (f) => (frames.indexOf(f) >= over + OLD_CAP_TICKS ? stop : f.e.tumble);
}

/** The second control: the same frames with each body that went under floating at the surface instead. */
function afloat(waterY: number): (f: Frame) => EntitySnapshot['tumble'] {
  const up = (b: Body & { vx: number; vy: number; vz: number }) => ({ ...b, y: Math.max(b.y, waterY) });
  return (f) => (f.e.tumble ? { rider: up(f.e.tumble.rider), bike: up(f.e.tumble.bike) } : null);
}

describe('a high fall shows nothing hanging: no body is still in view of the camera, railOver to respawn', () => {
  const cases: {
    name: string;
    config: () => SimConfig;
    at: Parameters<typeof flyOver>[1];
    /** Whether a body floating at the surface below would be in the held view (the second control). */
    floatSeen: boolean;
  }[] = [
    {
      name: 'the Golden Gate',
      config: () => configOf('osm-sf-golden-gate'),
      at: { road: 'osm-sf-gg-bridge', s: 1400, side: 'right', hM: 3, vy: 1, speed: 30, yaw: 0.15 },
      floatSeen: true,
    },
    {
      name: 'Chuckanut’s bluff',
      config: () => configOf('osm-pnw-chuckanut'),
      at: { road: 'osm-chuckanut-cliffs', s: 385, side: 'right', hM: 3, vy: 1, speed: 25, yaw: 0.15 },
      floatSeen: true,
    },
    {
      name: 'the Gorge at Crown Point (the highest drop past any route’s edge, 223 m)',
      config: () => configOf('osm-pnw-gorge'),
      at: { road: 'osm-gorge-crown-point-loops', s: 295, side: 'left', hM: 3, vy: 1, speed: 20, yaw: 0.15 },
      floatSeen: false,
    },
  ];
  for (const c of cases) {
    it(`${c.name}: the bodies fall the whole way and go under; none is held in view (controls: the old cap, afloat)`, () => {
      const config = c.config();
      const waterY = waterLevelOf(config.road);
      const frames = flyOver(config, c.at);
      const over = indexOf(frames, 'railOver');
      const woke = indexOf(frames, 'respawn');
      const splashes = frames.flatMap((f) => f.events).filter((x) => x.type === 'splash');
      const last = frames[woke - 1]?.e.tumble;
      const frozen = frozenInView(frames, waterY);
      const capped = frozenInView(frames, waterY, withOldCap(frames));
      const floating = frozenInView(frames, waterY, afloat(waterY));
      print(
        `${c.name}: railOver ${over}, splash ${indexOf(frames, 'splash')}, respawn ${woke}; ` +
          `${JSON.stringify(splashes[0]?.data)}; bodies at the end y ${last?.rider.y.toFixed(2)} / ` +
          `${last?.bike.y.toFixed(2)} (water ${waterY}); frozen in view ${frozen.length}; with the old cap ` +
          `${capped.length} (${capped.slice(0, 2).join(' ')}); afloat ${floating.length} (${floating.slice(0, 2).join(' ')})`,
      );
      expect(over).toBeGreaterThan(0);
      expect(woke).toBeGreaterThan(over);
      expect(splashes.length).toBe(2);
      for (const e of splashes) expect(e.data).toMatchObject({ over: true, high: true });
      // They fell the whole way and went under: at the respawn both bodies are wholly below the water.
      expect(last?.rider.y).toBeLessThan(waterY - BODY_R_M);
      expect(last?.bike.y).toBeLessThan(waterY - BODY_R_M);
      expect(frozen).toEqual([]);
      // The controls: the checker sees bodies stopped in mid-air (the old cap, as the live check saw it) …
      expect(capped.length).toBeGreaterThan(0);
      // … and, where the held view looks down on the water below, bodies left floating at its surface.
      expect(floating.length > 0).toBe(c.floatSeen);
    });
  }

  it('the overboard cap is a safety only: the highest drop past any route’s edge falls well within it', () => {
    let worst = { drop: 0, where: '' };
    for (const net of routeNetworks()) {
      const { road } = track(net);
      const floor = waterLevelOf(road);
      road.edges.forEach((e, i) => {
        for (let s = 5; s < e.length - 5; s += 10) {
          for (const side of ['left', 'right'] as const) {
            const top = edgeTopAt(road, i, s, side);
            if (top === null || !(top > 0) || pastAt(road, i, s, side) === 'ground') continue;
            const drop = road.surfaceHeight(i, s, side === 'right' ? e.dMax : e.dMin) - floor;
            if (drop > worst.drop) worst = { drop, where: `${net.id} ${e.id} s ${s} ${side}` };
          }
        }
      });
    }
    // From rest, thrown up at 10 m/s (a hard crash's throw), with the fall's height plus the 10 m it climbs.
    const upMps = 10;
    const fallTicks = ((upMps + Math.sqrt(upMps * upMps + 2 * 9.81 * worst.drop)) / 9.81) * 60;
    print(
      `highest drop past an edge: ${worst.drop.toFixed(1)} m (${worst.where}); falls in ${fallTicks.toFixed(0)} ticks, cap ${OVERBOARD_MAX_TICKS}`,
    );
    expect(worst.drop).toBeGreaterThan(200);
    expect(fallTicks).toBeLessThan(OVERBOARD_MAX_TICKS);
  });
});

describe('over the Seven Mile Bridge’s rail: a low splash keeps its gag', () => {
  const frames = flyOver(configOf('osm-keys-seven-mile'), {
    road: 'osm-sm-bridge',
    s: 3000,
    side: 'left',
    hM: 3,
    vy: 1,
    speed: 30,
    yaw: 0.15,
  });
  const over = indexOf(frames, 'railOver');
  const woke = indexOf(frames, 'respawn');
  const splash = frames.flatMap((f) => f.events).find((x) => x.type === 'splash');

  it('the splash is low, and it sounds', () => {
    print(`railOver at frame ${over}, splash ${JSON.stringify(splash?.data)}`);
    expect(splash?.data).toMatchObject({ over: true, past: 'water', high: false });
    expect(cueForEvent(splash as SimEvent, 0)?.cue).toBe('splash');
  });

  it('control for the high plunge: after a low splash the bodies float at the surface, for the gag', () => {
    const last = frames[woke - 1]?.e.tumble;
    print(`at the respawn the bodies float at y ${last?.rider.y.toFixed(2)} / ${last?.bike.y.toFixed(2)}`);
    expect(last?.rider.y).toBeCloseTo(0, 6);
    expect(last?.bike.y).toBeCloseTo(0, 6);
  });

  it('control: the camera is not held: it goes on following him', () => {
    const during = frames.slice(over, Math.min(woke, over + 120));
    let moved = 0;
    for (let i = 1; i < during.length; i++) {
      const a = eyeOf((during[i - 1] as Frame).pose);
      const b = eyeOf((during[i] as Frame).pose);
      if (a.some((v, k) => v !== b[k])) moved++;
    }
    print(`${moved} of ${during.length - 1} frames moved the eye`);
    expect(moved).toBeGreaterThan((during.length - 1) * 0.9);
  });
});
