/// <reference types="vite/client" />
// The crash camera keeps clear of the building fronts (the solid-world batch's live check, punch item 2:
// "the camera ends up inside buildings after a Duval sidewalk crash": it sat inside the upper-floor balcony
// railing after a planter-palm crash and clipped a building face after a frangipani crash).
//
// Riders now crash into the sidewalk furniture beside the buildings, and a crash throws the rider, and the
// chase camera that follows the rider, toward the front. This test rides a scripted rider along the
// sidewalk of three streets (Duval Street's Old Town, Russian Hill's row houses and San Francisco's
// downtown towers) until it crashes into the furniture, with two cameras following each ride tick by tick:
// the camera as it was (`camera.keepClearOfFronts` 0, the control) and the camera as shipped. Every frame
// from the crash to half a second after the rider is back on the road, the camera's eye is checked against
// the DRAWN fronts: the street front's buildings with their balconies (render/roadside.ts, the footprint
// of each building's whole model, balcony included), the row houses and apartments the scenery scatter
// stands, and the downtown towers (render/downtown.ts), each as a box on the ground from its base up.
// The eye is inside a front when it is inside a box padded by the near plane.
//
// Controls: the camera as it was is inside Duval's balconies in the same rides, so the check can see them;
// and on every street the old camera pushed 5 m toward the front is inside a building, so the check can see
// that street's fronts too.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { CAMERA_TUNING, createFollowCamera, type CameraPose, type FollowCamera } from '../../src/camera';
import { registryFromGlob } from '../../src/content';
import { emptyActions, toSimInput } from '../../src/input';
import type { BakedRoad } from '../../src/road';
import { createSim, type SimConfig } from '../../src/sim/api';
import { planDowntown, towerFootprint } from '../../src/render/downtown';
import { createFlatLook } from '../../src/render/look';
import { bakeRepoModel } from '../../src/render/model-files.test-util';
import { modelKindsFor, type ModelKind, type SceneryModels } from '../../src/render/models';
import { buildRoadScene, networkTags, type RoadDressing } from '../../src/render/road-mesh';
import { KITS, scatterRoadside } from '../../src/render/roadside';
import { DEPTH_M, halfAlongOf } from '../../src/render/scenery';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const roadFiles = import.meta.glob<BakedRoad>('/packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const STREAMS = createStreamCache();
const print = (line: string) => process.stdout.write(`${line}\n`);
const look = createFlatLook();

const DT = 1 / 60;
const ASPECT = 1248 / 576;
const TICKS = 60 * 50;
const RIDE_MPS = 22;
/** Frames kept after the rider is back on the road, 0.5 s, so the camera's blend back is checked too. */
const AFTER_TICKS = 30;
/** The near plane, padded round every front: an eye this close to a face is inside it as drawn, m. */
const NEAR_M = 0.3;
/** How far the control pushes the old camera toward the front, m. */
const SWING_M = 5;
/** How far up a front goes, m (a balconied shopfront is 9 m, a row house about 12 m, a tower far more). */
const TOP_M = { kit: 12, scenery: 16, tower: 60 } as const;

const STREETS = [
  { name: 'Duval Street', eventId: 'base:keys-t1-last-light-duval', seeds: [1, 2, 3, 4] },
  { name: 'Russian Hill', eventId: 'region-sf:sf-t2-russian-hill', seeds: [1, 2, 3] },
  { name: 'downtown', eventId: 'region-sf:sf-t1-burn-rate', seeds: [1, 2, 3] },
] as const;

/** A drawn front: a box on the ground in its own frame (+z toward the road), from its base up. */
interface Front {
  src: string;
  x: number;
  z: number;
  y: number;
  turn: number;
  half: number;
  front: number;
  back: number;
  top: number;
}

/** How far the deepest drawn Old Town front reaches over the sidewalk, m (its balcony, or the open bar's roof). */
let drawnReach = 0;

const models: SceneryModels = {};
async function modelsFor(kinds: readonly ModelKind[]): Promise<SceneryModels> {
  const out: SceneryModels = {};
  for (const k of kinds) {
    if (!models[k]) {
      try {
        models[k] = await bakeRepoModel(k);
      } catch {
        continue;
      }
    }
    out[k] = models[k];
  }
  return out;
}

/** The fronts a race on this config draws, from the render layers' own plans. */
async function frontsOf(config: SimConfig): Promise<Front[]> {
  const road = config.road;
  const dressing = Object.fromEntries(
    road.edges.map((e) => [e.id, Object.values(roadFiles).find((r) => r.id === e.id)]),
  ) as unknown as RoadDressing;
  const { tropical, tags } = networkTags(road, dressing);
  const kinds = modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
  const loaded = await modelsFor(kinds);
  const built = buildRoadScene(road, look, dressing, { seed: config.seed, models: loaded });
  const out: Front[] = [];
  const kit = Object.keys(KITS).find((k) => kinds.includes(k as ModelKind) && loaded[k as ModelKind]);
  if (kit) {
    for (const i of scatterRoadside({
      road,
      dressing,
      seed: config.seed,
      density: 1,
      kit: KITS[kit]!,
      landReach: (e, side, s) => built.landReach(e, side, s),
      spots: built.spots,
      models: loaded,
    }))
      if (i.foot) {
        if (i.rule === 'oldtown-front' || i.rule === 'oldtown-bar')
          drawnReach = Math.max(drawnReach, i.foot.front);
        out.push({
          src: i.rule,
          x: i.p.x,
          z: i.p.z,
          y: i.p.y,
          turn: i.turn,
          half: i.foot.half,
          front: i.foot.front,
          back: i.foot.back,
          top: TOP_M.kit,
        });
      }
  }
  for (const sp of built.spots) {
    const depth = DEPTH_M[sp.kind];
    if (depth === undefined || (sp.kind !== 'house' && sp.kind !== 'apartment')) continue;
    out.push({
      src: sp.kind,
      x: sp.p.x,
      z: sp.p.z,
      y: sp.p.y,
      turn: sp.turn,
      half: halfAlongOf(sp),
      front: 0,
      back: depth,
      top: TOP_M.scenery,
    });
  }
  if (['towers', 'plaza'].some((t) => tags.has(t))) {
    const stacked = loaded['sfTowerModules' as ModelKind] !== undefined;
    for (const i of planDowntown({ road, dressing, seed: config.seed, stacked }).items) {
      if (!['tower', 'plaza-tower', 'back-tower'].includes(i.rule)) continue;
      const [width, depth] = towerFootprint(i.variant, stacked);
      out.push({
        src: i.rule,
        x: i.p.x,
        z: i.p.z,
        y: i.p.y,
        turn: i.turn,
        half: width / 2,
        front: 0,
        back: depth,
        top: TOP_M.tower,
      });
    }
  }
  return out;
}

/** The front the eye is inside (padded by the near plane), or null. */
function insideFront(fronts: readonly Front[], p: { x: number; y: number; z: number }): Front | null {
  for (const f of fronts) {
    const dx = p.x - f.x;
    const dz = p.z - f.z;
    const sin = Math.sin(f.turn);
    const cos = Math.cos(f.turn);
    // The box's own frame: u along its width, v toward the road (the model's +z goes to (sin, cos)).
    const u = dx * cos - dz * sin;
    const v = dx * sin + dz * cos;
    if (
      Math.abs(u) < f.half + NEAR_M &&
      v > -f.back - NEAR_M &&
      v < f.front + NEAR_M &&
      p.y > f.y - 1 &&
      p.y < f.y + f.top
    )
      return f;
  }
  return null;
}

interface Tally {
  rides: number;
  crashes: number;
  frames: number;
  /** Frames the eye was inside a front, for the camera as it was, as shipped, and the pushed control. */
  old: number;
  now: number;
  pushed: number;
  oldWhere: Map<string, number>;
  nowWhere: Map<string, number>;
  /** The eye's least distance from the road's centre line toward the front, m: how far it swung. */
  swung: number;
}

function cameraFor(road: SimConfig['road'], keepClear: number): FollowCamera {
  const cam = createFollowCamera({ road });
  cam.setParam('camera.keepClearOfFronts', keepClear);
  return cam;
}

const ridden = new Map<string, Promise<Tally>>();
const ride = (eventId: string, seeds: readonly number[]): Promise<Tally> => {
  const key = eventId;
  if (!ridden.has(key)) ridden.set(key, street(eventId, seeds));
  return ridden.get(key) as Promise<Tally>;
};

async function street(eventId: string, seeds: readonly number[]): Promise<Tally> {
  const tally: Tally = {
    rides: 0,
    crashes: 0,
    frames: 0,
    old: 0,
    now: 0,
    pushed: 0,
    oldWhere: new Map(),
    nowWhere: new Map(),
    swung: 0,
  };
  for (const seed of seeds) {
    const config: SimConfig = buildSimConfig(REG, STREAMS.forEvent(REG, eventId), { seed, eventId });
    const fronts = await frontsOf(config);
    const sim = createSim(config);
    const cams = [cameraFor(config.road, 0), cameraFor(config.road, 1)] as const;
    // The seed picks the side and the place across the sidewalk (0 its kerb, 1 its back).
    const side: 1 | -1 = seed % 2 === 0 ? -1 : 1;
    const frac = 0.15 + 0.7 * ((seed * 0.618034) % 1);
    let snap = sim.snapshot();
    let started = false;
    /** Ticks left of the window being checked (crash to back on the road, then AFTER_TICKS), or -1. */
    let window = -1;
    tally.rides++;
    for (let i = 0; i < TICKS && !sim.isOver(); i++) {
      const me = snap.entities.find((e) => e.kind === 'rider' && e.slot === 0);
      const a = emptyActions();
      if (me) {
        const { edge, s, d, dir } = me.road;
        const v = config.road.vergeAt(edge, s, side < 0 ? 'left' : 'right');
        const width = Math.abs(v.dOuter - v.dInner);
        const target = width > 1.6 ? v.dInner + side * (0.4 + frac * (width - 0.8)) : v.dInner;
        a.steer = Math.max(-1, Math.min(1, (target - d) * 0.6 * dir));
        a.throttle = me.speed < RIDE_MPS ? 1 : 0.3;
      }
      sim.step([toSimInput(a)]);
      snap = sim.snapshot();
      const events = sim.events();
      const m = snap.entities.find((e) => e.kind === 'rider' && e.slot === 0);
      if (!m) break;
      const target = {
        ...m,
        mode: m.mode,
        targetId: m.targetId,
        road: m.road,
        drift: m.drift,
        wheelie: m.wheelie,
      };
      const poses: CameraPose[] = cams.map((cam) => {
        cam.onEvents(events);
        const pose = started
          ? cam.update(target, DT, { entities: snap.entities, aspect: ASPECT })
          : cam.snap(target, { aspect: ASPECT });
        return pose;
      });
      started = true;
      if (events.some((e) => e.type === 'crash' && e.actor === m.id)) {
        tally.crashes++;
        window = 1e9;
      }
      if (window < 0) continue;
      if (m.mode === 'Road' && window > AFTER_TICKS) window = AFTER_TICKS;
      window--;
      const [old, now] = poses as [CameraPose, CameraPose];
      tally.frames++;
      const o = insideFront(fronts, old);
      if (o) {
        tally.old++;
        tally.oldWhere.set(o.src, (tally.oldWhere.get(o.src) ?? 0) + 1);
      }
      const n = insideFront(fronts, now);
      if (n) {
        tally.now++;
        tally.nowWhere.set(n.src, (tally.nowWhere.get(n.src) ?? 0) + 1);
      }
      // The control: the old camera pushed toward the front the rider is beside.
      const at = config.road.project(old.x, old.z, m.road.edge);
      const toward = Math.sign(m.road.d) || 1;
      const c0 = config.road.toWorld(at.edge, at.s, 0, 0);
      const c1 = config.road.toWorld(at.edge, at.s, toward, 0);
      if (
        insideFront(fronts, {
          x: old.x + (c1.x - c0.x) * SWING_M,
          y: old.y,
          z: old.z + (c1.z - c0.z) * SWING_M,
        })
      )
        tally.pushed++;
    }
  }
  return tally;
}

const where = (m: Map<string, number>) => [...m].map(([k, n]) => `${k} ${n}`).join(', ') || 'none';

describe('the crash camera keeps clear of the building fronts (solid-world check, punch item 2)', () => {
  for (const st of STREETS) {
    it(`${st.name}: after a sidewalk crash the camera never sits inside a drawn front`, async () => {
      const t = await ride(st.eventId, st.seeds);
      print(
        `[examined] ${st.name}: ${t.rides} rides, ${t.crashes} crashes, ${t.frames} frames from each crash to half a second back on the road; ` +
          `camera as it was inside a front in ${t.old} (${where(t.oldWhere)}); as shipped ${t.now} (${where(t.nowWhere)}); ` +
          `old camera pushed ${SWING_M} m toward the front inside one in ${t.pushed}`,
      );
      // Enough crashes and frames to mean something.
      expect(t.crashes, 'crashes on the sidewalk').toBeGreaterThanOrEqual(4);
      expect(t.frames).toBeGreaterThan(200);
      // The rule's reach over Old Town's sidewalk covers the deepest front the kit draws (a model change that
      // grew a balcony past it would fail here, before it clipped).
      if (st.name === 'Duval Street') {
        const reach = CAMERA_TUNING.find((p) => p.id === 'camera.frontReachM')?.default ?? 0;
        expect(drawnReach, 'the deepest drawn Old Town front').toBeGreaterThan(2);
        expect(reach).toBeGreaterThanOrEqual(drawnReach);
      }
      // The control: the check can see this street's fronts.
      expect(t.pushed, 'the pushed control finds the fronts').toBeGreaterThan(0);
      expect(t.now, 'frames the camera sat inside a drawn front').toBe(0);
    }, 600_000);
  }

  it('the camera as it was sits inside Duval balconies in the same rides (the check can find the bug)', async () => {
    const st = STREETS[0];
    const t = await ride(st.eventId, st.seeds);
    print(`[control] ${st.name}: camera as it was inside a front in ${t.old} frames (${where(t.oldWhere)})`);
    expect(t.old).toBeGreaterThan(0);
  }, 600_000);
});
