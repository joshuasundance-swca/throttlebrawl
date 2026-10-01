/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
// The integration skeptic's finding F1 (playtest 1c): #180's split-zone guide had a 15 m lead-in, so
// a rider who committed to a shortcut 45 to 80 m before its split zone reached the road's edge
// before the guide and still met the wall: in the browser, full lock from marina-run s 180 gave
// `wobble(barrier)` at s 206.7 (36.4 to 31.8 m/s); headless, 8 of 28 early commits on the Keys and
// on the Pacific Northwest. The lead-in is now SPLIT_GUIDE_LEAD_M. This sweeps every live shortcut
// the same way: ride the right lane, then from 45 to 80 m before the zone steer right and hold it.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, type ActionState } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createSim, quantizeInput, type EntitySnapshot, type SimConfig } from '../../src/sim/api';
import { SPLIT_GUIDE_LEAD_M } from '../../src/sim/riders';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const REGIONS = [
  { name: 'keys-m1', event: 'base:m1-skeleton-sprint' },
  { name: 'pnw-c1', event: 'region-pnw:pnw-fogline-run' },
  { name: 'sf-hills', event: 'region-sf:sf-hill-sprint' },
] as const;
type Region = (typeof REGIONS)[number];

/** The player alone, no traffic, so a wall is the only thing that can wobble it. */
function soloConfig(r: Region, assist: 'off' | 'light'): SimConfig {
  const built = buildSimConfig(REG, STREAMS.forEvent(REG, r.event), {
    seed: 7,
    eventId: r.event,
    tuning: { 'ai.aggressionScale': 0, 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 },
  });
  return {
    ...built,
    riders: built.riders.filter((d) => d.controller.kind === 'player'),
    slots: [{ assists: { steer: assist, autoThrottle: false } }],
  };
}

/** Rides the right lane, then from `lead` m before the first split zone holds `steer` right. */
function earlyCommit(r: Region, lead: number, steer: number, assist: 'off' | 'light') {
  const config = soloConfig(r, assist);
  const zone = config.route.shortcuts[0];
  if (!zone) throw new Error(`${r.name}: no shortcut`);
  const sim = createSim(config);
  const road = config.road;
  const name = (e: number) => road.edges[e]?.id ?? '?';
  const walls: string[] = [];
  const trigger = zone.s0 - lead;
  let committed = false;
  for (let t = 0; t < 60 * 120; t++) {
    const me = sim.snapshot().entities[0] as EntitySnapshot;
    const { edge, s, d, dir, yaw } = me.road;
    if (edge === zone.edge && s >= trigger) committed = true;
    // Done once past the zone's edge (onto the branch or on along the main road).
    if (committed && edge !== zone.edge) break;
    const a: ActionState = {
      throttle: 1,
      brake: 0,
      steer: 0,
      attack: false,
      attackSide: 0,
      kick: false,
      lookBack: false,
      skipRunBack: false,
    };
    const v = Math.max(me.speed, 5);
    const kappa = road.kappaAt(edge, s) * dir;
    a.steer = committed
      ? steer
      : Math.max(-1, Math.min(1, 0.35 * (2 - d) * dir - 2.5 * yaw + (kappa * v * v) / 22));
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    for (const ev of sim.events()) {
      if (ev.actor !== 0 || (ev.type !== 'wobble' && ev.type !== 'crash')) continue;
      const now = sim.snapshot().entities[0] as EntitySnapshot;
      walls.push(
        `${ev.type}(${String(ev.data['cause'])}) at ${name(now.road.edge)} s ${now.road.s.toFixed(1)}`,
      );
    }
  }
  return { walls, zone, committed };
}

describe(`an early commit up to ${SPLIT_GUIDE_LEAD_M} m before a split zone meets no wall (skeptic F1)`, () => {
  for (const r of REGIONS) {
    it(`${r.name}: 45 to 80 m before the zone, any steer from 0.35 to full lock, assist off or light`, () => {
      const rows: string[] = [];
      let examined = 0;
      for (const assist of ['off', 'light'] as const) {
        for (const lead of [80, 70, 60, 50, 45]) {
          for (const steer of [1, 0.7, 0.5, 0.35]) {
            const res = earlyCommit(r, lead, steer, assist);
            expect(res.committed).toBe(true);
            examined++;
            if (res.walls.length > 0)
              rows.push(`lead ${lead} steer ${steer} ${assist}: ${res.walls.join(', ')}`);
          }
        }
      }
      process.stdout.write(`[split early] ${r.name}: ${examined} commits, ${rows.length} met a wall\n`);
      expect(rows).toEqual([]);
    }, 300_000);
  }

  it('guard: full lock well before the lead-in still wobbles on the barrier (Keys, 130 m before)', () => {
    const res = earlyCommit(REGIONS[0], 130, 1, 'off');
    expect(res.walls.some((w) => w.startsWith('wobble(barrier)'))).toBe(true);
  }, 120_000);
});
