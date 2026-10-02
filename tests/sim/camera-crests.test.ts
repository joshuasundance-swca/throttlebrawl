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
// them in the air; Twin Peaks: 2453 of 2453, though those were ridden backward, see ROUTES), so it
// needed no crest pitch. The frames without the
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
 * 2.2 to 2.7 m in 12 m where the bot rides them. Twin Peaks' tops are gentler: ridden the way the
 * race goes, the steepest falls 0.76 m in 12 m, so its crests are counted from 0.6 m (1158 crest
 * frames over the four seeds, phone shape). The 0.9 to 1.1 m first measured here came from the bot
 * riding the route BACKWARD: a crash on the twin-peaks-climb hairpin handed it back facing downhill
 * (11 803 wrong-way frames, and every one of the 1099 crest frames then counted), fixed in
 * src/sim/tumble (tests/sim/tumble-hairpin.test.ts). `flies`: the crest launch takes off there at
 * 1.5x speed.
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
    drop: 0.6,
    flies: false,
  },
] as const;

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

/** The bot races the route; each tick the camera follows the player, and each frame is checked. */
function ride(
  c: { event: string; route?: string; drop?: number },
  seed: number,
  aspect: number,
  tuning: Record<string, number> = FAST,
) {
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
  const camera = createFollowCamera({ road });
  let snap = sim.snapshot();
  const frames: Frame[] = [];
  let pose: CameraPose | null = null;
  let maxDrop = 0;
  while (!sim.isOver() && sim.tick < MAX_TICKS && !snap.race.finishOrder.includes(playerId)) {
    const actions = emptyActions();
    bot.drive(snap, playerId, config.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    camera.onEvents(sim.events());
    const me = snap.entities[playerId];
    if (!me) break;
    const target = { ...me, mode: me.mode, targetId: me.targetId, road: me.road };
    pose = pose
      ? camera.update(target, DT, { entities: snap.entities, aspect })
      : camera.snap(target, { aspect });
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
    maxDrop = Math.max(maxDrop, drop);
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
    frames.push({
      tick: sim.tick,
      edge: me.road.edge,
      s: me.road.s,
      airborne: me.mode === 'Airborne',
      aheadShown,
      beyondShown,
      farthest,
      top,
      clearance: pose.y - road.toWorld(under.edge, under.s, under.d, 0).y,
    });
  }
  return { frames, ticks: sim.tick, maxDrop };
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
        const buried: string[] = [];
        const all: Frame[] = [];
        for (const seed of SEEDS) {
          const { frames, maxDrop } = ride(c, seed, aspect);
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
            if (f.beyondShown === false) hidden.push(where);
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
        expect(riding).toBeGreaterThan(10_000);
        if (c.flies) expect(airborne, 'the crest launch flies the bike in these races').toBeGreaterThan(0);
        expect(crestFrames, 'the races pass crests').toBeGreaterThan(c.flies ? 200 : 20);
        expect(hidden).toEqual([]);
        expect(blind).toEqual([]);
        expect(buried).toEqual([]);
      });
    }
  }
});
