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
} from '../../src/road';
import { groundYOf } from '../../src/render/shadows';
import { createSimWithWorld, SIM_TUNING } from '../../src/sim/create';
import { riderLimits, riderState } from '../../src/sim/riders';
import { placeVehicle, trafficState } from '../../src/sim/traffic';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type {
  EntitySnapshot,
  SimConfig,
  SimEvent,
  SimInput,
  SimRiderDef,
  SimTrafficTypeDef,
} from '../../src/sim/types';
import { ISOLATED } from './batch';

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
