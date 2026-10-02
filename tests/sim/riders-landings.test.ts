/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Forgiving landings (playtest 2, 2026-10-02: "It's too easy to crash after a jump"; the maintainer
// picked "Forgiving landings"). A seeded batch of whole races on every region's routes, raced the way
// the game races them, counts every landing (the player's and the rivals') and what became of it:
// clean, wobble, a crash on the landing itself, or a crash within a second after it (the wobble's
// shaky bike into a barrier, a car or the next crest). Two players ride: the dev bot, which flies
// with the bars straight, and a "thumb" player, the bot with the steer it held at take-off still
// held in the air, as a phone thumb mid-bend does. The rivals fly as their AI does.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type SimEvent } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const MAX_TICKS = 60 * 60 * 6;
const EVENTS = ['base:m1-skeleton-sprint', 'region-pnw:pnw-fogline-run', 'region-sf:sf-hill-sprint'];
const SEEDS = [1, 2];
const print = (line: string) => process.stdout.write(line + '\n');
/** A crash this many ticks after a landing counts as the landing's. */
const AFTER_TICKS = 60;

interface Case {
  event: string;
  route: string | null;
}

/** Every route the game offers per event: each length's route, plus the region's real roads. */
function cases(): Case[] {
  const out: Case[] = [];
  for (const event of EVENTS) {
    const ev = lookup(REG.events, event);
    const lengths = new Set(ev.lengths.map((l) => l.id));
    for (const l of lengths) out.push({ event, route: `length:${l}` });
    for (const r of realRoutes(REG, event)) out.push({ event, route: r });
  }
  return out;
}

export interface LandingTally {
  landings: number;
  clean: number;
  wobble: number;
  crashOnLanding: number;
  crashAfter: number;
  airCrash: number;
  causes: Record<string, number>;
}

const tally = (): LandingTally => ({
  landings: 0,
  clean: 0,
  wobble: 0,
  crashOnLanding: 0,
  crashAfter: 0,
  airCrash: 0,
  causes: {},
});

function race(c: Case, seed: number, thumb: boolean) {
  const length = c.route?.startsWith('length:') ? c.route.slice(7) : undefined;
  const route = c.route && !c.route.startsWith('length:') ? c.route : null;
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, c.event, length, route), {
    seed,
    eventId: c.event,
    ...(length ? { length } : {}),
    ...(route ? { route } : {}),
  });
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  let snap = sim.snapshot();
  const events: SimEvent[] = [];
  let heldSteer = 0;
  while (!sim.isOver() && sim.tick < MAX_TICKS && !snap.race.finishOrder.includes(playerId)) {
    const actions = emptyActions();
    bot.drive(snap, playerId, config.route, actions);
    const me = snap.entities[playerId];
    if (thumb && me?.mode === 'Airborne') actions.steer = heldSteer;
    else heldSteer = actions.steer;
    sim.step([toSimInput(actions)]);
    events.push(...sim.events());
    snap = sim.snapshot();
  }
  return { events, playerId, ticks: sim.tick };
}

function count(events: readonly SimEvent[], playerId: number, player: LandingTally, rivals: LandingTally) {
  const lastLand = new Map<number, { tick: number; quality: string }>();
  const airborne = new Set<number>();
  for (const e of events) {
    const t = e.actor === playerId ? player : rivals;
    if (e.type === 'jump') airborne.add(e.actor);
    if (e.type === 'land') {
      airborne.delete(e.actor);
      t.landings++;
      const q = String(e.data['quality']);
      if (q === 'clean') t.clean++;
      else if (q === 'wobble') t.wobble++;
      else t.crashOnLanding++;
      lastLand.set(e.actor, { tick: e.tick, quality: q });
    }
    if (e.type === 'crash') {
      if (airborne.has(e.actor)) {
        t.airCrash++;
        airborne.delete(e.actor);
        const k = `air:${String(e.data['cause'])}`;
        t.causes[k] = (t.causes[k] ?? 0) + 1;
        continue;
      }
      const l = lastLand.get(e.actor);
      if (l && e.data['cause'] !== 'landing' && e.tick - l.tick <= AFTER_TICKS && l.quality !== 'crash') {
        t.crashAfter++;
        const k = `after:${String(e.data['cause'])}${e.data['object'] ? `:${String(e.data['object'])}` : ''}`;
        t.causes[k] = (t.causes[k] ?? 0) + 1;
      }
      if (e.data['cause'] === 'landing') {
        const why =
          Number(e.data['lateralMps']) >= 0 && Number(e.data['verticalMps']) >= 0
            ? `landing:lat${Math.round(Number(e.data['lateralMps']))}:vert${Math.round(Number(e.data['verticalMps']))}`
            : 'landing';
        t.causes[why] = (t.causes[why] ?? 0) + 1;
      }
    }
  }
}

const line = (name: string, t: LandingTally) => {
  const bad = t.crashOnLanding + t.crashAfter + t.airCrash;
  const pct = t.landings > 0 ? ((100 * bad) / t.landings).toFixed(1) : '0';
  return `${name}: ${t.landings} landings, ${t.clean} clean, ${t.wobble} wobble, ${t.crashOnLanding} crash on landing, ${t.crashAfter} crash within 1 s after, ${t.airCrash} crash in the air: ${pct}% bad; causes ${JSON.stringify(t.causes)}`;
};

describe('forgiving landings: a seeded batch on every route (playtest 2, 2026-10-02)', () => {
  it('counts landings and their outcomes for the bot, a held-thumb player and the rivals', () => {
    const bot = tally();
    const thumb = tally();
    const rivals = tally();
    let races = 0;
    for (const c of cases()) {
      for (const seed of SEEDS) {
        for (const isThumb of [false, true]) {
          const r = race(c, seed, isThumb);
          races++;
          count(r.events, r.playerId, isThumb ? thumb : bot, isThumb ? tally() : rivals);
        }
      }
    }
    print(`[landings] ${races} races, seeds ${SEEDS.join(' ')}`);
    print(`[landings] ${line('bot', bot)}`);
    print(`[landings] ${line('thumb', thumb)}`);
    print(`[landings] ${line('rivals', rivals)}`);
    expect(bot.landings + thumb.landings).toBeGreaterThan(0);
    // The player never goes down on or just after a landing on these roads (before playtest 2's
    // forgiving landings, seeds 1 and 2: the held thumb crashed 1 of its 16 landings), and the
    // rivals land at least 9 in 10 cleanly or with a wobble.
    for (const t of [bot, thumb]) expect(t.crashOnLanding + t.crashAfter).toBe(0);
    expect(rivals.crashOnLanding).toBeLessThanOrEqual(Math.floor(rivals.landings / 10));
  }, 900_000);
});
