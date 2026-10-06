/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// The maintainer, 2026-10-05: "in first person helmet view it seems easy to clip through cars for
// some reason? I was screensharing when I realized." Was it drawn or real? The bot rides the shared
// batch's races (base event, traffic both ways) with the helmet camera following the player each
// sim tick, and every tick on the road each vehicle is checked two ways:
// 1. Real: the rider's contact box (sim/traffic TRAFFIC.riderLengthM x riderWidthM) never sits
//    inside a vehicle's box past a 5 cm tolerance: the sim never lets the bike through traffic.
// 2. Drawn: the helmet camera's eye never sits over a vehicle's footprint (its type's widthM by
//    lengthM, which is also the drawn size: src/render/traffic-footprint.test.ts).
// What it found (measured before the fix, seeds 1 to 6, 38,695 frames on the road): 0 frames of
// (1), and 122 frames of (2) (a sedan and a shrimp truck among them), each at a hard lean (0.5 to
// 0.7 rad in the ones printed) beside a vehicle the rider was passing clean. The eye rode in the leaning
// model's head, 1.78 m up the lean, so at the bike's full lean (0.8 rad) it sat 1.28 m out to the
// side and 1.24 m up, through the door of a car the 0.8 m wide rider box had not touched. So it was
// visual. The eye's sideways swing is now held to `camera.helmetReachM` (0.2 m, inside the box);
// the same races with the old reach are the negative control and must still find frames.
import { describe, expect, it } from 'vitest';
import { CAMERA_TUNING, createFollowCamera, type CameraPose, type FollowCamera } from '../../src/camera';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { EntitySnapshot, SimTrafficTypeDef } from '../../src/sim/api';
import { TRAFFIC } from '../../src/sim/traffic';
import { createBatchRace } from './batch';

const DT = 1 / 60;
const ASPECT = 1248 / 576;
const SEEDS = [1, 2, 3, 4, 5, 6];
const MAX_TICKS = 60 * 60 * 4;
/** The old placement: the eye swings out as far as the leaning head (1.78 m x sin 0.8 = 1.28 m). */
const OLD_REACH_M = 1.3;
/** How far the rider's box may sit inside a vehicle's for one tick before contact pushes it out, m. */
const BOX_TOLERANCE_M = 0.05;
/** A vehicle more than this far below or above the eye is on another level (an overpass), m. */
const LEVEL_M = 3;

/** A point's place in a vehicle's frame: across (right) and along (forward), m. */
function local(e: EntitySnapshot, x: number, z: number): { across: number; along: number } {
  const dx = x - e.x;
  const dz = z - e.z;
  const ch = Math.cos(e.heading);
  const sh = Math.sin(e.heading);
  return { across: dx * ch - dz * sh, along: -dx * sh - dz * ch };
}

function helmetCam(road: Parameters<typeof createFollowCamera>[0], reach?: number): FollowCamera {
  const cam = createFollowCamera(road);
  cam.setView('helmet');
  if (reach !== undefined) cam.setParam('camera.helmetReachM', reach);
  return cam;
}

describe('the helmet camera and traffic (2026-10-05)', () => {
  it('the sim keeps the bike out of every vehicle, and the eye never sits inside one', () => {
    const reach = CAMERA_TUNING.find((p) => p.id === 'camera.helmetReachM')?.default ?? NaN;
    expect(reach).toBeLessThanOrEqual(TRAFFIC.riderWidthM / 2);
    let frames = 0;
    let passes = 0;
    let boxOverlaps = 0;
    let eyeInside = 0;
    let oldEyeInside = 0;
    let closestEye = Infinity;
    const found: string[] = [];
    for (const seed of SEEDS) {
      const { sim, config, playerId } = createBatchRace(seed);
      const dims = new Map<string, SimTrafficTypeDef>(config.trafficTypes.map((t) => [t.contentId, t]));
      const bot = createBot();
      const cams = [helmetCam({ road: config.road }), helmetCam({ road: config.road }, OLD_REACH_M)];
      const poses: (CameraPose | null)[] = [null, null];
      let snap = sim.snapshot();
      while (!sim.isOver() && sim.tick < MAX_TICKS && !snap.race.finishOrder.includes(playerId)) {
        const actions = emptyActions();
        bot.drive(snap, playerId, config.route, actions);
        sim.step([toSimInput(actions)]);
        snap = sim.snapshot();
        const events = sim.events();
        const me = snap.entities[playerId];
        if (!me) break;
        const target = { ...me, mode: me.mode, targetId: me.targetId, road: me.road };
        for (let c = 0; c < cams.length; c++) {
          const cam = cams[c] as FollowCamera;
          cam.onEvents(events);
          const prev = poses[c];
          poses[c] = prev
            ? cam.update(target, DT, { entities: snap.entities, aspect: ASPECT })
            : cam.snap(target, { aspect: ASPECT });
        }
        const [pose, oldPose] = poses as [CameraPose, CameraPose];
        if (me.mode !== 'Road' || me.road.h > TRAFFIC.maxContactH) continue;
        frames++;
        for (const e of snap.entities) {
          if (e.kind !== 'vehicle') continue;
          const t = dims.get(e.contentId);
          if (!t || Math.abs(pose.y - e.y) > LEVEL_M) continue;
          const rider = local(e, me.x, me.z);
          const alongside = Math.abs(rider.along) < (t.lengthM + TRAFFIC.riderLengthM) / 2;
          const sideGap = Math.abs(rider.across) - (t.widthM + TRAFFIC.riderWidthM) / 2;
          if (alongside && sideGap < 1) passes++;
          if (
            alongside &&
            Math.abs(rider.along) < (t.lengthM + TRAFFIC.riderLengthM) / 2 - BOX_TOLERANCE_M &&
            sideGap < -BOX_TOLERANCE_M
          )
            boxOverlaps++;
          const inside = (p: CameraPose): { inside: boolean; gap: number } => {
            const q = local(e, p.x, p.z);
            const gx = Math.abs(q.across) - t.widthM / 2;
            const gz = Math.abs(q.along) - t.lengthM / 2;
            return { inside: gx < 0 && gz < 0, gap: Math.max(gx, gz) };
          };
          const now = inside(pose);
          closestEye = Math.min(closestEye, now.gap);
          if (now.inside) {
            eyeInside++;
            if (found.length < 5)
              found.push(`seed ${seed} tick ${sim.tick} ${e.contentId} lean ${me.lean.toFixed(2)}`);
          }
          if (inside(oldPose).inside) oldEyeInside++;
        }
      }
    }
    const line =
      `[examined] ${SEEDS.length} races, ${frames} frames on the road, ${passes} vehicle-frames within 1 m ` +
      `alongside: rider box inside a vehicle ${boxOverlaps}; eye inside a vehicle ${eyeInside} ` +
      `(closest ${closestEye.toFixed(2)} m outside), with the old reach ${oldEyeInside}\n`;
    process.stdout.write(line + (found.length ? `  ${found.join('\n  ')}\n` : ''));
    // The control: with the old reach these races do put the eye inside traffic, so the check can
    // find it. If content or the bot change so that it no longer does, pick seeds that do.
    expect(oldEyeInside, 'the negative control finds the old clipping').toBeGreaterThan(0);
    expect(boxOverlaps, 'the sim let the bike into a vehicle').toBe(0);
    expect(eyeInside, 'the helmet eye sat inside a vehicle').toBe(0);
  }, 300_000);
});
