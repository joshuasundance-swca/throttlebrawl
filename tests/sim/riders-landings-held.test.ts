/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Forgiving landings, with the brake or the kick held in the air (playtest 2, 2026-10-02: "It's too
// easy to crash after a jump"; interview, 2026-10-02: "forgiving landings; flips and tricks").
// The W-Q0 verifier's repro, on the real roads: San Francisco, seed 1, the bot rides, and at a
// take-off the player takes over and holds S (the brake) to the touch-down. With air control on
// that put 23 of 34 jumps down (0 of 34 with it off), and a kick held 0.35 s put 9 of 34 down.
// Braking or attacking in the air must never wreck a landing: only a deliberate, badly
// over-rotated flip wipes out. src/sim/riders/air-safety.test.ts holds the same bar on the riders
// lane's fixture ramp and crest; this file holds it on every region's routes, where the ground
// under a landing is a real road's crest and bend, not a fixture's.
//
// Each race: the bot rides; 0.1 s after each of the player's take-offs (the browser repro's timing)
// the player takes over with the bars straight and gives the air command, and the bot rides on after
// the touch-down. Road events stay on, as the game races.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput, type ActionState } from '../../src/input';
import { createSim } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const MAX_TICKS = 60 * 60 * 6;
const EVENTS = ['base:m1-skeleton-sprint', 'region-pnw:pnw-fogline-run', 'region-sf:sf-hill-sprint'];
const SEED = 1;
/** Ticks after take-off the player takes over: 0.1 s, the browser repro. */
const TAKE_OVER = 6;
/** A crash this many ticks after a landing counts as the landing's. */
const AFTER_TICKS = 60;
/** The fewest held jumps a pattern must examine (seed 1 on main, 2026-10-02: 10 to 12 per pattern). */
const MIN_HELD = 6;
const print = (line: string) => process.stdout.write(line + '\n');

/** The air command, `t` ticks after the take-over. */
type Pattern = (a: ActionState, t: number) => void;
const PATTERNS: Record<string, Pattern> = {
  'brake held to the ground': (a) => {
    a.brake = 1;
    a.throttle = 0;
  },
  'kick held 0.35 s': (a, t) => {
    if (t < 21) a.kick = true;
  },
};

interface Case {
  event: string;
  route: string | null;
}

/** Every route the game offers per event: each length's route, plus the region's real roads. */
function cases(): Case[] {
  const out: Case[] = [];
  for (const event of EVENTS) {
    const ev = lookup(REG.events, event);
    for (const l of new Set(ev.lengths.map((x) => x.id))) out.push({ event, route: `length:${l}` });
    for (const r of realRoutes(REG, event)) out.push({ event, route: r });
  }
  return out;
}

interface Held {
  /** Jumps the player held the command on (in the air past the take-over). */
  held: number;
  /** Of those, down in the air, on the landing or within AFTER_TICKS after it. */
  down: string[];
}

function race(c: Case, pattern: Pattern): Held {
  const length = c.route?.startsWith('length:') ? c.route.slice(7) : undefined;
  const route = c.route && !c.route.startsWith('length:') ? c.route : null;
  // Off-road (run W-R) off: it reshuffles these seed-1 races (on the San Francisco real road the
  // first held jump moves from tick 918 to 12857), and there a head-on with oncoming traffic 47 ticks
  // after a clean landing falls inside AFTER_TICKS. The landing itself is the same either way.
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, c.event, length, route), {
    seed: SEED,
    eventId: c.event,
    tuning: { 'ground.offRoad': 0 },
    ...(length ? { length } : {}),
    ...(route ? { route } : {}),
  });
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  let snap = sim.snapshot();
  const out: Held = { held: 0, down: [] };
  let airT = -1;
  /** This flight had the command held; the last landing's flight did; and its tick. */
  let heldNow = false;
  let heldLanded = false;
  let landTick = Number.NEGATIVE_INFINITY;
  while (!sim.isOver() && sim.tick < MAX_TICKS && !snap.race.finishOrder.includes(playerId)) {
    const actions = emptyActions();
    bot.drive(snap, playerId, config.route, actions);
    airT = snap.entities[playerId]?.mode === 'Airborne' ? airT + 1 : -1;
    if (airT >= TAKE_OVER) {
      actions.steer = 0;
      actions.attack = false;
      actions.kick = false;
      pattern(actions, airT - TAKE_OVER);
      heldNow = true;
    }
    sim.step([toSimInput(actions)]);
    for (const e of sim.events()) {
      if (e.actor !== playerId) continue;
      if (e.type === 'jump') heldNow = false;
      if (e.type === 'land') {
        if (heldNow) out.held++;
        heldLanded = heldNow;
        landTick = e.tick;
        heldNow = false;
      }
      if (e.type === 'crash') {
        // Down in the air with the command held, or on or just after a landing it was held for.
        const mine = heldNow || (heldLanded && e.tick - landTick <= AFTER_TICKS);
        if (heldNow) out.held++;
        if (mine) {
          const why = `${String(e.data['cause'])}${e.data['botched'] ? ' (botched)' : ''}`;
          out.down.push(`${c.event} ${c.route ?? ''} tick ${e.tick}: ${why}`);
        }
        heldNow = false;
        heldLanded = false;
      }
    }
    snap = sim.snapshot();
  }
  return out;
}

describe('forgiving landings: the brake or the kick held in the air on every route (W-Q0 verifier)', () => {
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    it(`${name}: 0 jumps down`, () => {
      let held = 0;
      const down: string[] = [];
      for (const c of cases()) {
        const r = race(c, pattern);
        held += r.held;
        down.push(...r.down);
      }
      print(`[landings-held] ${name}: ${down.length} of ${held} held jumps down, seed ${SEED}`);
      // The check examined real held jumps, not races with none.
      expect(held).toBeGreaterThanOrEqual(MIN_HELD);
      expect(down).toEqual([]);
    }, 600_000);
  }
});
