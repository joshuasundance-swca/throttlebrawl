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
import { buildSimConfig, createStreamCache } from '../../src/app';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type SimEvent } from '../../src/sim/api';
import { ISOLATED } from './batch';
import { memoCases } from './case-results';
import { LANDING_REGISTRY as REG, LANDING_SEEDS, landingCases, type LandingCase } from './landing-inventory';
import {
  assertLandings,
  foldLandings,
  landingLine,
  tally,
  validateTally,
  type LandingResult,
  type LandingTally,
} from './landing-oracle';
export { landingCases, type LandingCase } from './landing-inventory';
export { tally, type LandingResult, type LandingTally } from './landing-oracle';

const STREAMS = createStreamCache();
const MAX_TICKS = 60 * 60 * 6;
/** A crash this many ticks after a landing counts as the landing's. */
const AFTER_TICKS = 60;

type Case = Pick<LandingCase, 'event' | 'route'>;

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

function runLanding(c: LandingCase): LandingResult {
  const r = race(c, c.seed, c.thumb);
  const player = tally();
  const rivals = tally();
  count(r.events, r.playerId, player, rivals);
  return { player, rivals };
}

/** Keep required results in this file's memory; failed and absent races cannot become a pass. */
export function landingSurvey(
  run: (c: LandingCase) => LandingResult = runLanding,
  required: LandingCase[] = landingCases(),
) {
  const results = memoCases(required, (c) => {
    const r = run(c);
    if (!r) throw new Error('Missing landing survey result');
    validateTally(r.player);
    validateTally(r.rivals);
    return r;
  });
  return { cases: required, run: results.get, results: results.results };
}

/** Same pure pooled oracle as the reporter. Missing rows never trigger races. */
export function checkLandings(survey: ReturnType<typeof landingSurvey>): void {
  const rows = survey.results();
  const pooled = foldLandings(survey.cases, rows);
  console.log('[landings] ' + rows.length + ' races, seeds ' + LANDING_SEEDS.join(' '));
  for (const [name, t] of Object.entries(pooled)) console.log('[landings] ' + landingLine(name, t));
  assertLandings(pooled);
}
