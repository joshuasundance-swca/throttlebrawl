/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Run W-P, W-O's visuals follow-up ("pitch down over a crest so the drop beyond reads"): over a
// sharp crest the chase camera looks over the top, so the road beyond shows, never the sky gap
// alone. Checked on San Francisco's real crests (Russian Hill and Twin Peaks, built from map data)
// with the bot riding whole races as the game runs them: each sim tick the camera follows the
// player's snapshot, and each frame is built with the same three.js calls render/index.ts makes
// (position, lookAt, rotateZ(roll)), on the maintainer's phone shape (1248x576) and on 16:9. The top
// speed and acceleration sliders sit at their 1.5x maximum, so the crest launch flies the bike too.
//
// Three checks per riding frame (on the bike, the low chase view):
// 1. The road ahead shows: a road point 6 to 60 m ahead, along the way the rider travels, projects
//    inside the view, in front of the camera and below the top 10 % of the view.
// 2. Over a crest, the road beyond it shows: when the road ahead tops out within 25 m and then
//    drops at least 1.5 m in the next 12 m, a road point 6 to 30 m past the top projects inside the
//    view (as in 1) and the line of sight to it clears the road's own profile in between, so the
//    crest does not hide it.
// 3. The camera is never inside the hill: at least 0.3 m over the road beneath it.
//
// What it found (run W-P, measured before the fix): the default chase camera already sees past
// every crest top (Russian Hill: 1807 of 1807 crest frames show road 30 m past the top, 566 of
// them in the air; Twin Peaks: 2453 of 2453), so it needed no crest pitch. The frames without the
// road ahead (159 on Russian Hill, 225 on Twin Peaks, phone shape) were all within a second of a
// remount, the framing swinging round from the walk back to the bike; a remount now cuts
// (src/camera/chase.ts, REMOUNT_CUT_RAD). With a low camera aimed high (height 0.8 m, aim 2 m: a
// negative control, not committed) Russian Hill's crest check fails 1752 of 1807 frames. Twin Peaks'
// tops are gentle enough that the same control does not hide them; its check guards the road ahead
// and the camera's clearance there.
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { createFollowCamera, type CameraPose } from '../../src/camera';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type RoadNetwork, type SimConfig } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const DT = 1 / 60;
const ASPECTS = [1248 / 576, 16 / 9];
const AHEAD_M = [6, 9, 12, 16, 20, 25, 30, 40, 50, 60];
/** A road point counts only below this NDC height (the top 10 % of the view does not count). */
const TOP_MARGIN = 0.8;
const MAX_TICKS = 60 * 60 * 6;
const FAST = { 'riders.speedScale': 1.5, 'riders.accelScale': 1.5 };
/** A crest: the road ahead tops out within this many metres... */
const CREST_WITHIN_M = 25;
/** ...and drops at least this much over the next 12 m. */
const CREST_DROP_M = 1.5;
const BEYOND_M = [6, 9, 12, 16, 20, 25, 30];
const SEEDS = [1, 3, 4, 6];

/**
 * `drop`: the crest threshold, metres of fall in the 12 m past the top. Russian Hill's tops fall
 * 2.2 to 2.7 m in 12 m where the bot rides them; Twin Peaks' climb tops out gentler, 0.76 m at
 * most riding the route forward, so its crests are counted from 0.7 m. (The 0.9 to 1.1 m once
 * measured here came from seeds 1 and 4 riding the route backward after a hairpin crash handed the
 * bot back facing the wrong way, about 12,000 frames each; the tumble hand-back now keeps the
 * route's way.) `flies`: the crest launch takes off there at 1.5x speed.
 */
const ROUTES = [
  {
    event: 'region-sf:sf-hill-sprint',
    route: 'region-sf:osm-sf-hills-run',
    name: 'Russian Hill',
    drop: CREST_DROP_M,
    flies: true,
  },
  {
    event: 'region-sf:sf-hill-sprint',
    route: 'region-sf:osm-sf-twin-peaks-run',
    name: 'Twin Peaks',
    drop: 0.7,
    flies: false,
  },
] as const;

/**
 * Blind crests the map itself makes (run W-U, #408's Jones Street branch on Russian Hill): the brink
 * of Jones's 29 % north face, and the hump where the branch climbs back onto Leavenworth (Chestnut
 * climbs about 15 %, the connector tops out 2.5 m higher, then Leavenworth falls about 15 %). The
 * crest stands above the line of sight from the chase camera's height there, so no aim shows the
 * road past it until the top is within about 13 m. Measured on the four seeds: 1 frame on the brink
 * and 126 on the rejoin (51 at 2.17, 76 at 1.78), every hidden frame on these roads. They are
 * counted and printed, capped at BLIND_BY_DESIGN_MAX per aspect, and every other road keeps the
 * full check.
 *
 * Playtest 4 (P4-4) moved the hump: the branch's connectors now hold the main road's height while
 * any of their lane lies over its surface (the 6 m wide leave connector sat up to 2 m under
 * Union's verge on the 12 % climb, a rider drawn inside the road), so the climb carries the leave
 * connector up 2 m before it peels off and drops: that crest hides 135 frames at 2.17 and 145 at
 * 1.78, all on the leave connector, and the rejoin now hides none. The cap is 160, the new
 * measurement plus about 10 %.
 */
const BLIND_BY_DESIGN = /jones/;
const BLIND_BY_DESIGN_MAX = 160;

function renderCamera(pose: CameraPose, aspect: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(pose.fov, aspect, 0.3, 1500);
  cam.position.set(pose.x, pose.y, pose.z);
  cam.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  if (pose.roll) cam.rotateZ(pose.roll);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

function inView(p: Vector3, cam: PerspectiveCamera): boolean {
  const local = p.clone().applyMatrix4(cam.matrixWorldInverse);
  if (local.z >= -cam.near) return false;
  const n = p.clone().project(cam);
  return Math.abs(n.x) <= 1 && n.y >= -1 && n.y <= TOP_MARGIN;
}

type Pos = { edge: number; s: number; d: number; dir: 1 | -1 };

/** The road point `k` metres along the way the rider travels (k may be negative: behind). */
function along(road: RoadNetwork, at: Pos, k: number): Vector3 {
  const p = { edge: at.edge, s: at.s + at.dir * k, d: at.d, dir: at.dir };
  road.advance(p);
  const w = road.toWorld(p.edge, p.s, p.d, 0);
  return new Vector3(w.x, w.y, w.z);
}

/** True when no road sample between the camera and `to` stands above the line of sight. */
function clearSight(cam: Vector3, to: Vector3, samples: readonly Vector3[]): boolean {
  const hx = to.x - cam.x;
  const hz = to.z - cam.z;
  const len2 = hx * hx + hz * hz;
  for (const q of samples) {
    const t = ((q.x - cam.x) * hx + (q.z - cam.z) * hz) / len2;
    if (t <= 0.02 || t >= 0.98) continue;
    // Only road beside the sight line can hide it (a bend's far side is not in the way).
    const off = Math.abs((q.x - cam.x) * hz - (q.z - cam.z) * hx) / Math.sqrt(len2);
    if (off > 4) continue;
    if (q.y > cam.y + t * (to.y - cam.y) + 0.05) return false;
  }
  return true;
}

interface Frame {
  tick: number;
  edge: number;
  /** The road's id (for the blind-by-design roads). */
  road: string;
  s: number;
  airborne: boolean;
  aheadShown: boolean;
  /** Over a crest: whether the road beyond showed; null when no crest is ahead. */
  beyondShown: boolean | null;
  /** Over a crest: the farthest road point past the top that showed (-1 none), and the top's distance. */
  farthest: number;
  top: number;
  clearance: number;
}

interface Ride {
  frames: Frame[];
  ticks: number;
  maxDrop: number;
}

/**
 * The bot races the route once; each tick one follow camera per aspect follows the player, and each
 * of its frames is checked. The race does not depend on the aspect (the camera only reads the sim),
 * so one race serves both aspects' cameras (the test-diet run, 2026-10-06: CI printed the same
 * frame counts for both when each aspect rode its own races).
 */
function ride(
  c: { event: string; route?: string; drop?: number },
  seed: number,
  aspects: readonly number[],
  tuning: Record<string, number> = FAST,
): Ride[] {
  const config: SimConfig = buildSimConfig(REG, STREAMS.forEvent(REG, c.event, undefined, c.route ?? null), {
    seed,
    eventId: c.event,
    ...(c.route ? { route: c.route } : {}),
    tuning,
  });
  const sim = createSim(config);
  const road = config.road;
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const views = aspects.map((aspect) => ({
    aspect,
    camera: createFollowCamera({ road }),
    pose: null as CameraPose | null,
    frames: [] as Frame[],
    maxDrop: 0,
  }));
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < MAX_TICKS && !snap.race.finishOrder.includes(playerId)) {
    const actions = emptyActions();
    bot.drive(snap, playerId, config.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    const events = sim.events();
    for (const v of views) v.camera.onEvents(events);
    const me = snap.entities[playerId];
    if (!me) break;
    for (const v of views) {
      const { camera, aspect } = v;
      const target = { ...me, mode: me.mode, targetId: me.targetId, road: me.road };
      const pose = v.pose
        ? camera.update(target, DT, { entities: snap.entities, aspect })
        : camera.snap(target, { aspect });
      v.pose = pose;
      if ((me.mode !== 'Road' && me.mode !== 'Airborne') || camera.mode !== 'lowChase') continue;
      const cam = renderCamera(pose, aspect);
      const at: Pos = { edge: me.road.edge, s: me.road.s, d: me.road.d, dir: me.road.dir };
      const aheadShown = AHEAD_M.some((k) => inView(along(road, at, k), cam));

      // The profile ahead, 1 m apart, and a crest in it.
      const profile: Vector3[] = [];
      for (let k = -10; k <= CREST_WITHIN_M + 12 + 30; k++) profile.push(along(road, at, k));
      const ya = (k: number) => profile[k + 10]?.y ?? Number.NaN;
      let top = -1;
      for (let k = 0; k <= CREST_WITHIN_M; k++) if (top < 0 || ya(k) > ya(top)) top = k;
      const drop = top >= 0 ? ya(top) - ya(top + 12) : 0;
      v.maxDrop = Math.max(v.maxDrop, drop);
      const crest = top >= 0 && drop >= (c.drop ?? CREST_DROP_M) && ya(top) >= ya(0);
      let beyondShown: boolean | null = null;
      let farthest = -1;
      if (crest) {
        const eye = new Vector3(pose.x, pose.y, pose.z);
        for (const k of BEYOND_M) {
          const p = profile[top + k + 10];
          if (p && inView(p, cam) && clearSight(eye, p, profile)) farthest = k;
        }
        beyondShown = farthest >= 0;
      }
      const under = road.project(pose.x, pose.z, me.road.edge);
      v.frames.push({
        tick: sim.tick,
        edge: me.road.edge,
        road: road.edges[me.road.edge]?.id ?? '',
        s: me.road.s,
        airborne: me.mode === 'Airborne',
        aheadShown,
        beyondShown,
        farthest,
        top,
        clearance: pose.y - road.toWorld(under.edge, under.s, under.d, 0).y,
      });
    }
  }
  return views.map((v) => ({ frames: v.frames, ticks: sim.tick, maxDrop: v.maxDrop }));
}

const RIDES = new Map<string, Ride[]>();
/** One race per route and seed, with its frames at every aspect in ASPECTS, shared by their tests. */
function rideFor(c: (typeof ROUTES)[number], seed: number, aspect: number): Ride {
  const key = `${c.route} ${seed}`;
  let rides = RIDES.get(key);
  if (!rides) {
    rides = ride(c, seed, ASPECTS);
    RIDES.set(key, rides);
  }
  const out = rides[ASPECTS.indexOf(aspect)];
  if (!out) throw new Error(`no ride at aspect ${aspect}`);
  return out;
}

describe('the chase camera over real crests (run W-P)', () => {
  for (const c of ROUTES) {
    for (const aspect of ASPECTS) {
      it(`${c.name} at aspect ${aspect.toFixed(2)}: the road ahead and the road beyond each crest show`, () => {
        let riding = 0;
        let airborne = 0;
        let crestFrames = 0;
        const blind: string[] = [];
        const hidden: string[] = [];
        const mapBlind: string[] = [];
        const buried: string[] = [];
        const all: Frame[] = [];
        for (const seed of SEEDS) {
          const { frames, maxDrop } = rideFor(c, seed, aspect);
          console.log(
            `[print] ${c.name} seed ${seed}: steepest drop past a top within 25 m: ${maxDrop.toFixed(2)} m over 12 m`,
          );
          all.push(...frames);
          riding += frames.length;
          airborne += frames.filter((f) => f.airborne).length;
          for (const f of frames) {
            const where = `seed ${seed} t${f.tick} e${f.edge} s${f.s.toFixed(0)}${f.airborne ? ' air' : ''}`;
            if (!f.aheadShown) blind.push(where);
            if (f.beyondShown !== null) crestFrames++;
            if (f.beyondShown === false) (BLIND_BY_DESIGN.test(f.road) ? mapBlind : hidden).push(where);
            if (f.clearance < 0.3) buried.push(`${where} clearance ${f.clearance.toFixed(2)}`);
          }
        }
        const near = all.filter((f) => f.beyondShown !== null && f.top <= 12);
        const share = (m: number) => `${near.filter((f) => f.farthest >= m).length}/${near.length}`;
        console.log(
          `[print] ${c.name} ${aspect.toFixed(2)}: crest within 12 m: beyond >=6 m ${share(6)}, >=12 m ${share(12)}, >=20 m ${share(20)}, >=30 m ${share(30)}`,
        );
        console.log(
          `[print] ${c.name} ${aspect.toFixed(2)}, seeds ${SEEDS.join(' ')}: ${riding} riding frames ` +
            `(${airborne} airborne), ${crestFrames} with a crest ahead; road ahead hidden in ${blind.length}, ` +
            `road beyond the crest hidden in ${hidden.length}, camera under 0.3 m in ${buried.length}` +
            (hidden[0] ? `; first hidden: ${hidden[0]}` : '') +
            (blind[0] ? `; first blind: ${blind[0]}` : ''),
        );
        console.log(
          `[print] ${c.name} ${aspect.toFixed(2)}: hidden on the blind-by-design roads: ${mapBlind.length} (cap ${BLIND_BY_DESIGN_MAX})`,
        );
        expect(riding).toBeGreaterThan(10_000);
        if (c.flies) expect(airborne, 'the crest launch flies the bike in these races').toBeGreaterThan(0);
        expect(crestFrames, 'the races pass crests').toBeGreaterThan(c.flies ? 200 : 20);
        expect(hidden).toEqual([]);
        expect(mapBlind.length).toBeLessThanOrEqual(BLIND_BY_DESIGN_MAX);
        expect(blind).toEqual([]);
        expect(buried).toEqual([]);
      });
    }
  }
});
