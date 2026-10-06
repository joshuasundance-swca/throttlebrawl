/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// The maintainer, 2026-10-05: "one person was talking about hitboxes. like I noticed you need to
// give trucks a wider berth. I'd like all hitboxes on everything to make sense." Traffic contacts
// were measured in corridor coordinates, which bend with the road and stretch with the offset
// across it, while the render draws each vehicle as a rigid box along its heading. On the Gorge's
// bends a log truck's corridor box reached up to 0.57 m past the drawn truck, so riders crashed
// into air beside and behind it (measured before the fix, seeds 1 to 3 of the Gorge and four other
// PNW and SF events: big-vehicle contacts at a drawn gap of 0.30 m at the 90th percentile).
// Contacts now use the vehicle's rigid box (sim/traffic rigidOffset).
//
// The bot rides the Gorge. Every traffic crash or wobble is measured in the world, on the drawn
// shapes: the rider's 2.0 x 0.8 box and the vehicle's type box at their snapshot poses (the
// drawn sizes: scripts/hitboxes.test.ts), the smallest gap of the poses before and after the tick
// and of the pose the sim tests the contact at: the rider moved on by its speed along its heading,
// before a wobble's push sets it clear (after a slow bump wobbles, the after-pose is already pushed
// apart, and a fast rider closes a metre or more in a tick, so neither snapshot holds the touch).
// The negative control: the same races do hold moments where the old corridor boxes overlapped
// a big vehicle while the drawn shapes stood well apart, so the check can see the bug class.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { SIM_HZ, type EntitySnapshot, type SimTrafficTypeDef } from '../../src/sim/api';
import { TRAFFIC } from '../../src/sim/traffic';
import { NO_ROAD_EVENTS } from './batch';

const REG = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const EVENT = 'region-pnw:pnw-t3-gorge';
const SEEDS = [1, 2, 3];
const MAX_TICKS = 60 * 60 * 4;
/** A big vehicle: the trucks, RVs, buses and streetcars, m long. */
const BIG_M = 6.5;
/** A contact may sit this far from the drawn shapes (a tick of relative motion, and the push), m. */
const DRAWN_GAP_M = 0.2;
/** A moment counts for the control when the drawn shapes stand this far apart, m. */
const AIR_M = 0.15;

const L = TRAFFIC.riderLengthM;
const W = TRAFFIC.riderWidthM;

/** The rider's pose one tick on from `e` by its own speed and heading, before any contact moves it. */
function movedOn(e: EntitySnapshot): EntitySnapshot {
  const step = e.speed / SIM_HZ;
  return { ...e, x: e.x - Math.sin(e.heading) * step, z: e.z - Math.cos(e.heading) * step };
}

/** The gap between two drawn boxes on the ground (negative: overlapping), by separating axes. */
function drawnGap(
  a: EntitySnapshot,
  al: number,
  aw: number,
  b: EntitySnapshot,
  bl: number,
  bw: number,
): number {
  const axesOf = (h: number) => [
    [Math.cos(h), -Math.sin(h)],
    [-Math.sin(h), -Math.cos(h)],
  ];
  const half = (e: EntitySnapshot, l: number, w: number, ax: number[]) => {
    const [across, along] = axesOf(e.heading) as [number[], number[]];
    return (
      (w / 2) * Math.abs((across[0] ?? 0) * (ax[0] ?? 0) + (across[1] ?? 0) * (ax[1] ?? 0)) +
      (l / 2) * Math.abs((along[0] ?? 0) * (ax[0] ?? 0) + (along[1] ?? 0) * (ax[1] ?? 0))
    );
  };
  let sep = -Infinity;
  for (const ax of [...axesOf(a.heading), ...axesOf(b.heading)]) {
    const d = Math.abs((b.x - a.x) * (ax[0] ?? 0) + (b.z - a.z) * (ax[1] ?? 0));
    sep = Math.max(sep, d - half(a, al, aw, ax) - half(b, bl, bw, ax));
  }
  return sep;
}

describe('traffic contacts happen where the vehicles are drawn (playtest 4)', () => {
  it('no crash or wobble into the air beside a truck on a bend', () => {
    let contacts = 0;
    let bigContacts = 0;
    let air = 0;
    const far: string[] = [];
    for (const seed of SEEDS) {
      const { sim, config, playerId } = createHeadlessRace(
        { seed, eventId: EVENT, tuning: NO_ROAD_EVENTS },
        { registry: REG },
      );
      const dims = new Map<string, SimTrafficTypeDef>(config.trafficTypes.map((t) => [t.contentId, t]));
      const bot = createBot();
      let snap = sim.snapshot();
      while (!sim.isOver() && sim.tick < MAX_TICKS && !snap.race.finishOrder.includes(playerId)) {
        const actions = emptyActions();
        bot.drive(snap, playerId, config.route, actions);
        const before = snap;
        sim.step([toSimInput(actions)]);
        snap = sim.snapshot();
        const byId = new Map(snap.entities.map((e) => [e.id, e]));
        const beforeById = new Map(before.entities.map((e) => [e.id, e]));
        for (const ev of sim.events()) {
          if ((ev.type !== 'crash' && ev.type !== 'wobble') || ev.data?.['cause'] !== 'traffic') continue;
          const r = [beforeById.get(ev.actor), byId.get(ev.actor)];
          const v = [beforeById.get(ev.target ?? -1), byId.get(ev.target ?? -1)];
          const t = v[1] ? dims.get(v[1].contentId) : undefined;
          if (!t || !r[0] || !r[1] || !v[0] || !v[1]) continue;
          const gap = Math.min(
            drawnGap(r[0], L, W, v[0], t.lengthM, t.widthM),
            drawnGap(r[1], L, W, v[1], t.lengthM, t.widthM),
            drawnGap(movedOn(r[0]), L, W, v[1], t.lengthM, t.widthM),
          );
          contacts++;
          if (t.lengthM >= BIG_M) bigContacts++;
          if (t.lengthM >= BIG_M && gap > DRAWN_GAP_M)
            far.push(
              `seed ${seed} tick ${sim.tick} ${t.contentId} ${String(ev.data?.['hit'])} ${gap.toFixed(2)} m`,
            );
        }
        // The control: a rider on the road whose corridor-style box (same edge: s along, d across)
        // overlaps a big vehicle's while the drawn shapes stand apart.
        for (const me of snap.entities) {
          if (me.kind !== 'rider' || me.mode !== 'Road' || me.road.h > TRAFFIC.maxContactH) continue;
          for (const e of snap.entities) {
            if (e.kind !== 'vehicle' || e.road.edge !== me.road.edge) continue;
            const t = dims.get(e.contentId);
            if (!t || t.lengthM < BIG_M) continue;
            const ds = Math.abs(e.road.s - me.road.s);
            const dd = Math.abs(e.road.d - me.road.d);
            if (ds >= (t.lengthM + L) / 2 || dd >= (t.widthM + W) / 2) continue;
            if (drawnGap(me, L, W, e, t.lengthM, t.widthM) > AIR_M) air++;
          }
        }
      }
    }
    process.stdout.write(
      `[examined] ${EVENT} seeds ${SEEDS.join(', ')}: ${contacts} traffic contacts, ${bigContacts} with big vehicles; ` +
        `${far.length} of those over ${DRAWN_GAP_M} m from the drawn truck; control: ${air} rider-frames where ` +
        `the corridor boxes overlapped a big vehicle the drawn shapes kept ${AIR_M} m+ apart\n` +
        (far.length ? `  ${far.slice(0, 8).join('\n  ')}\n` : ''),
    );
    // If content or the bot change so that these seeds hold none, add seeds until they do.
    expect(air, 'the negative control finds corridor-box overlaps in the air').toBeGreaterThan(0);
    expect(bigContacts, 'the races meet big vehicles').toBeGreaterThan(5);
    expect(far).toEqual([]);
  }, 600_000);
});
