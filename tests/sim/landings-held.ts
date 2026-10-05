/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// The held-landing check that tests/sim/riders-landings-held.test.ts (the brake) and
// tests/sim/riders-landings-held-kick.test.ts (the kick) each run for one air command. One file per
// command, so CI's slice plan can put the two on different runners: together they were one file of
// about 500 to 575 s, the slowest sim file, against a 600 s job limit (2026-10-05). Each command's
// check is exactly what the one file ran; see the brake file for what it holds and why.
import { expect } from 'vitest';
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
export const PATTERNS = {
  'brake held to the ground': (a) => {
    a.brake = 1;
    a.throttle = 0;
  },
  'kick held 0.35 s': (a, t) => {
    if (t < 21) a.kick = true;
  },
} satisfies Record<string, Pattern>;
/** The control: the same take-over with the bars straight, and no air command. */
const NO_COMMAND: Pattern = () => {};

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
  let cleanLanding = false;
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
        // A clean landing that then meets traffic is the road's, not the landing's: the races part
        // ways with the control's long before, so the control cannot show it (P4-6's combat timing:
        // the Fogline Run's log hop landed clean at tick 5879, then met an oncoming log truck at 5884).
        heldLanded = heldNow;
        cleanLanding = e.data['quality'] === 'clean';
        landTick = e.tick;
        heldNow = false;
      }
      if (e.type === 'crash') {
        // Down in the air with the command held, or on or just after a landing it was held for.
        const roads = cleanLanding && e.data['cause'] === 'traffic';
        const mine = heldNow || (heldLanded && !roads && e.tick - landTick <= AFTER_TICKS);
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

/** Each check's own time limit, ms. */
export const HELD_TIMEOUT_MS = 600_000;

/** One air command's check over every route: no held jump goes down. */
export function checkHeld(name: keyof typeof PATTERNS): void {
  const pattern = PATTERNS[name];
  let held = 0;
  const down: string[] = [];
  const road: string[] = [];
  for (const c of cases()) {
    const r = race(c, pattern);
    held += r.held;
    if (r.down.length === 0) continue;
    // A down that the control race (the same take-over, no command) also has, at the same tick
    // for the same cause, is the road's, not the air command's: run W-U's Chinatown route meets
    // an oncoming rental sedan 16 ticks after a clean landing whether or not anything is held.
    // Run only when a race has a down, so a green run costs nothing extra.
    const control = new Set(race(c, NO_COMMAND).down);
    for (const d of r.down) (control.has(d) ? road : down).push(d);
  }
  print(`[landings-held] ${name}: ${down.length} of ${held} held jumps down, seed ${SEED}`);
  if (road.length > 0) print(`[landings-held] ${name}: also down without the command: ${road.join('; ')}`);
  // The check examined real held jumps, not races with none.
  expect(held).toBeGreaterThanOrEqual(MIN_HELD);
  expect(down).toEqual([]);
}
