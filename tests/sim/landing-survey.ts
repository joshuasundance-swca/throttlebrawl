/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Forgiving landings (playtest 2, 2026-10-02: "It's too easy to crash after a jump"; the maintainer
// picked "Forgiving landings"). A seeded batch of whole races on every region's routes, raced the way
// the game races them but with the optional world systems off (traffic, cops, road events: see
// race() below), counts every landing (the player's and the rivals') and what became of it:
// clean, wobble, a crash on the landing itself, or a crash within a second after it (the wobble's
// shaky bike into a barrier, a car or the next crest). Two players ride: the dev bot, which flies
// with the bars straight, and a "thumb" player, the bot with the steer it held at take-off still
// held in the air, as a phone thumb mid-bend does. The rivals fly as their AI does.
import { expect } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type SimEvent } from '../../src/sim/api';
import { ISOLATED } from './batch';
import { memoCases } from './case-results';

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

export const tally = (): LandingTally => ({
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
    // Isolated (R5, the determinism run, 2026-10-03): this counts landings, so every world system is
    // off (ISOLATED in tests/sim/batch.ts) except the ground beside the road, where a jump can come
    // down. Before, only road events, the patrol and the heat were off, and any other system that put
    // a car or a cop after one wobble flipped this zero-tolerance count (road events did, #279 with
    // #268; seed 1 or 2 had the bot hit by traffic 1 s after a clean landing). Traffic meeting a
    // wobbling lander is an interaction, not the landing's judgment; the traffic lane owns that.
    tuning: { ...ISOLATED, 'ground.offRoad': 1 },
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
        const what = `${String(e.data['cause'])}${e.data['object'] ? `:${String(e.data['object'])}` : ''}`;
        if (l.quality === 'wobble') {
          // The landing's own consequence: the wobble's shaky bike went down within the second.
          t.crashAfter++;
          t.causes[`after:${what}`] = (t.causes[`after:${what}`] ?? 0) + 1;
        } else {
          // A clean landing, then something else (a car ahead, a rival's hit): not the landing's
          // fault, so it is reported but not counted against it. Before this split, any traffic
          // change could flip the batch (main, 2026-10-02: one bot ride into a car after a clean
          // landing, "after:traffic").
          t.causes[`afterClean:${what}`] = (t.causes[`afterClean:${what}`] ?? 0) + 1;
        }
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

export interface LandingCase extends Case {
  seed: number;
  thumb: boolean;
}

export interface LandingResult {
  player: LandingTally;
  rivals: LandingTally;
}

/** The original event/route, seed, then player-policy order; one full race per scheduled case. */
export function landingCases(): LandingCase[] {
  return cases().flatMap((c) =>
    SEEDS.flatMap((seed) => [false, true].map((thumb) => ({ ...c, seed, thumb }))),
  );
}

function runLanding(c: LandingCase): LandingResult {
  const r = race(c, c.seed, c.thumb);
  const player = tally();
  const rivals = tally();
  count(r.events, r.playerId, player, rivals);
  return { player, rivals };
}

function validate(t: LandingTally): void {
  const counts = t && [t.landings, t.clean, t.wobble, t.crashOnLanding, t.crashAfter, t.airCrash];
  if (
    !counts ||
    !counts.every((n) => Number.isSafeInteger(n) && n >= 0) ||
    t.landings !== t.clean + t.wobble + t.crashOnLanding ||
    !t.causes ||
    typeof t.causes !== 'object' ||
    Array.isArray(t.causes) ||
    !Object.values(t.causes).every((n) => Number.isSafeInteger(n) && n >= 0)
  )
    throw new Error('Malformed landing survey tally');
}

/** Keep required results in this file's memory; failed and absent races cannot become a pass. */
export function landingSurvey(run: (c: LandingCase) => LandingResult = runLanding) {
  const required = landingCases();
  const results = memoCases(required, (c) => {
    const r = run(c);
    if (!r) throw new Error('Missing landing survey result');
    validate(r.player);
    validate(r.rivals);
    return r;
  });
  return { cases: required, run: results.get, results: results.results };
}

function add(total: LandingTally, t: LandingTally): void {
  total.landings += t.landings;
  total.clean += t.clean;
  total.wobble += t.wobble;
  total.crashOnLanding += t.crashOnLanding;
  total.crashAfter += t.crashAfter;
  total.airCrash += t.airCrash;
  for (const [cause, n] of Object.entries(t.causes)) total.causes[cause] = (total.causes[cause] ?? 0) + n;
}

/** The original pooled oracle, including rivals from bot races only. Never rerun missing races here. */
export function checkLandings(survey: ReturnType<typeof landingSurvey>): void {
  const bot = tally();
  const thumb = tally();
  const rivals = tally();
  const rows = survey.results();
  expect(rows).toHaveLength(survey.cases.length);
  expect(survey.cases.length).toBeGreaterThan(0);
  rows.forEach((r, i) => {
    validate(r.player);
    validate(r.rivals);
    if (survey.cases[i]?.thumb) add(thumb, r.player);
    else {
      add(bot, r.player);
      add(rivals, r.rivals);
    }
  });
  print('[landings] ' + rows.length + ' races, seeds ' + SEEDS.join(' '));
  print('[landings] ' + line('bot', bot));
  print('[landings] ' + line('thumb', thumb));
  print('[landings] ' + line('rivals', rivals));
  expect(bot.landings + thumb.landings).toBeGreaterThan(0);
  // The player never goes down on or just after a landing on these roads, and rivals land at
  // least 9 in 10 cleanly or with a wobble. These remain pooled checks, never per-route floors.
  for (const t of [bot, thumb]) expect(t.crashOnLanding + t.crashAfter).toBe(0);
  expect(rivals.crashOnLanding).toBeLessThanOrEqual(Math.floor(rivals.landings / 10));
}
