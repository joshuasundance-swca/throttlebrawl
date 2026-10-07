/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Polish H's live check, punch item 5: "The dev bot sat at a standstill. In one control ride it
// stayed on Broadway (Bridge City, s 88) for 4,000+ ticks after a crash: throttle 0, brake 0.5, full
// left lock." Replayed headless (the never-stuck lane), the bot alone sat on Broadway the same way
// (seed 23 of the full world: 460 ticks at s 112, throttle 0, brake 0.5, full left lock). Broadway's
// cut leaves across the oncoming lanes (a split zone at d -10.5 to -6), and in the last 150 m before
// it the bot "followed" any car in the zone's line, a car coming the other way included: it braked
// to a stop across the centre line, at full lock toward the zone, and the cars coming down the road
// stopped for it in turn. And boxed in anywhere, it braked whatever the car in its line did, so a
// queue moving at 9 m/s held it still (941 ticks in dense traffic). Now a car coming the other way in
// the zone's line keeps the bot on its own side, riding, and it follows a car going its way at that
// car's pace (src/dev/bot). The traffic half of the same live check, a cop parked on the shoulder
// holding oncoming cars at a hairpin's wait line for good, is pinned in
// src/sim/traffic/hairpin-yield.test.ts.
//
// The rule, on Bridge City's quick race (the live check's), the bot in the player's seat, the
// ISOLATED profile with traffic on at the slider's top, over seeds 1 and 2 (every race is a case: the
// rule holds for any seed):
// - no rider of the field (the bot or a rival) stands still on the bike for longer than
//   STILL_MAX_TICKS once the race is under way;
// - while a car coming the other way is in the Broadway cut's line on the bot's approach, the bot
//   keeps at least STOP_MPS; and those meetings happen (the check can see them).
// Main's bot fails both on these seeds (the lane's A/B): seed 1 stood still 308 ticks (edge 7, late
// in the race), seed 2 stopped dead in the meeting (0 m/s, then 179 ticks still); seeds 3 and 4 measured
// 177 and 740 ticks still, the 740 on Broadway's approach. The fixed bot: at most 117 ticks still over
// seeds 1 to 10, rivals at most 4 over seeds 1 to 4 (the start), and no slower than 8 m/s (its
// remount pace) in a meeting.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';
import { ISOLATED } from './batch';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const BRIDGE_CITY = {
  eventId: 'region-pnw:pnw-fogline-run',
  route: 'region-pnw:osm-bridge-city-run',
  freePlay: true,
} as const;
/** The approach the bot rides into a split zone, m (dev/bot SHORTCUT_APPROACH_M). */
const APPROACH_M = 150;
/** The bot's traffic look-ahead and its line's half width plus a car's, m (dev/bot clearAt). */
const LOOK_M = 45;
const LINE_HALF_M = 2.5;
/** Ticks of meeting the two races need between them, so the meeting rule is seen to apply. */
const MEETING_TICKS = 20;
/** The longest a rider of the field may stand still on the bike (under 1 m/s, riding), ticks: 3 s. */
const STILL_MAX_TICKS = 180;
/** Through a meeting the bot keeps at least this pace, m/s (it rides on, on its own side). */
const STOP_MPS = 3;
const SEEDS = [1, 2];
const MAX_TICKS = 60 * 60 * 6;
/** Traffic at the slider's top (3x): cars fill the cut's line and both lanes of the bot's own way. */
const DENSITY = 3;

interface Ride {
  /** Ticks of the approach with a car coming the other way in the cut's line ahead of the bot. */
  meeting: number;
  /** The bot's slowest speed during those ticks, m/s. */
  meetingMinMps: number;
  /** The longest standstill on the bike of any rider in the field (the bot or a rival), ticks. */
  still: number;
  /** Who stood still that long, and where it began. */
  stillAt: string;
  ticks: number;
}

function ride(seed: number): Ride {
  const tuning = { ...ISOLATED, 'traffic.density': DENSITY };
  const config = buildSimConfig(
    REG,
    STREAMS.forEvent(REG, BRIDGE_CITY.eventId, undefined, BRIDGE_CITY.route),
    {
      seed,
      ...BRIDGE_CITY,
      tuning,
    },
  );
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const zones = config.route.shortcuts;
  const bot = createBot();
  let snap = sim.snapshot();
  const out: Ride = { meeting: 0, meetingMinMps: Infinity, still: 0, stillAt: '', ticks: 0 };
  const runs = new Map<number, { n: number; at: string }>();
  let started = false;
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, config.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    const me = snap.entities[playerId];
    if (!me || me.finished) break;
    started ||= me.speed > 2;
    // The standstill: a rider of the field on the bike, under 1 m/s, once the race is under way.
    for (const m of snap.entities) {
      if (m.kind !== 'rider' || m.faction !== 'rider' || m.finished) continue;
      const still = started && (m.mode === 'Road' || m.mode === 'Airborne') && m.speed < 1;
      if (!still) {
        runs.delete(m.id);
        continue;
      }
      const r = runs.get(m.id) ?? {
        n: 0,
        at: `${m.id === playerId ? 'the bot' : m.contentId} from tick ${snap.tick}, edge ${m.road.edge} s ${m.road.s.toFixed(0)}`,
      };
      r.n++;
      runs.set(m.id, r);
      if (r.n > out.still) {
        out.still = r.n;
        out.stillAt = r.at;
      }
    }
    if (me.mode !== 'Road' && me.mode !== 'Airborne') continue;
    const { edge, s, dir } = me.road;
    for (const z of zones) {
      if (z.edge !== edge) continue;
      const inApproach = dir > 0 ? s >= z.s0 - APPROACH_M && s <= z.s1 : s <= z.s1 + APPROACH_M && s >= z.s0;
      if (!inApproach) continue;
      const inner = Math.abs(z.d0) <= Math.abs(z.d1) ? z.d0 : z.d1;
      const outer = inner === z.d0 ? z.d1 : z.d0;
      const line = inner + Math.sign(outer - inner) * Math.min(0.9, Math.abs(outer - inner) / 2);
      // Only a cut that leaves across the oncoming lanes: its line is on the other side of the road.
      if (line * dir >= 0) continue;
      const meets = snap.entities.some((o) => {
        if (o.kind !== 'vehicle' || o.road.edge !== edge || o.road.dir === dir) return false;
        const ahead = (o.road.s - s) * dir;
        return ahead > 0.5 && ahead < LOOK_M && Math.abs(o.road.d - line) < LINE_HALF_M;
      });
      if (meets) {
        out.meeting++;
        out.meetingMinMps = Math.min(out.meetingMinMps, me.speed);
      }
    }
  }
  out.ticks = sim.tick;
  return out;
}

describe('nobody stands still on Bridge City in dense traffic (polish H, punch item 5)', () => {
  it("the field never stands still on the bike, and the bot rides on through cars in the Broadway cut's line", () => {
    const rides = SEEDS.map((seed) => ({ seed, ...ride(seed) }));
    for (const r of rides)
      console.log(
        `[examined] seed ${r.seed}, ${r.ticks} ticks: the longest standstill on the bike ${r.still} ticks ` +
          `(${r.stillAt || 'none'}); ${r.meeting} ticks of a car coming the other way in the cut's line, ` +
          `the bot's slowest ${r.meeting > 0 ? r.meetingMinMps.toFixed(1) : '-'} m/s through them`,
      );
    expect(rides.reduce((n, r) => n + r.meeting, 0)).toBeGreaterThanOrEqual(MEETING_TICKS);
    for (const r of rides) {
      expect(r.still, `seed ${r.seed}: ${r.stillAt}`).toBeLessThanOrEqual(STILL_MAX_TICKS);
      if (r.meeting > 0) expect(r.meetingMinMps, `seed ${r.seed}`).toBeGreaterThanOrEqual(STOP_MPS);
    }
  }, 240_000);
});
