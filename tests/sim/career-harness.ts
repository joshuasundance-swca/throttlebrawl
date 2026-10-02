/// <reference types="vite/client" />
// The headless career (docs/milestones/M4.md, career-1 and the M4 exit: "A headless career test has
// a bot play every event and the boss in the simulation, and the career ends in the teaser and free
// play"). A career race here is built exactly as the app builds one: the app's buildSimConfig with
// the profile's bike and grudges, the career's race log watching the sim's events and snapshots,
// then the career's settle. The dev bot rides; nothing is scripted in its favour except what a
// player can do too (retry, buy the best bike the cash allows).
import { buildSimConfig, createStreamCache } from '../../src/app';
import {
  bare,
  buyBike,
  createOnboarding,
  createRaceLog,
  eventPlan,
  garageBikes,
  nodeLength,
  nodeState,
  progressOf,
  settleRace,
  withPromptsSeen,
  type CareerDef,
  type CareerNode,
  type RaceStatus,
  type RaceTally,
  type SettleReport,
} from '../../src/career';
import { registryFromGlob, type ContentRegistry } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { Profile } from '../../src/save';
import { createSim, type EntitySnapshot, type SimConfig, type SimSnapshot } from '../../src/sim/api';

export const REG: ContentRegistry = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
/** A race's safety stop: 12 minutes of race. */
const MAX_TICKS = 60 * 60 * 12;

/**
 * The career bot's plan for an event (a player's plan too): the dev bot rides and fights; what it
 * is shown decides whom it fights. In a race (a classic race, a grudge to the line, a cop escape)
 * it is shown no riders, so it races and only dodges traffic; in a takedown hunt it fights anyone;
 * in a grudge settled by knockdowns (or a boss that may be) it is shown only the rival. The sim
 * always gets the real inputs: this is the bot's eyes, not the race.
 */
export type BotFocus = 'race' | 'hunt' | { rival: string };

export function botFocus(plan: ReturnType<typeof eventPlan>): BotFocus {
  if (plan.kind === 'takedown-hunt') return 'hunt';
  if (plan.kind === 'grudge-match' && plan.rules.rival) {
    const either = plan.objectives.some(
      (o) => o.kind === 'beat-rival' && typeof o.params['orKnockdowns'] === 'number',
    );
    if (plan.rules.winBy === 'knockdowns' || either) return { rival: plan.rules.rival };
  }
  return 'race';
}

function botView(snap: SimSnapshot, me: number, focus: BotFocus): SimSnapshot {
  if (focus === 'hunt') return snap;
  const keep = (e: EntitySnapshot) => typeof focus === 'object' && e.contentId === focus.rival;
  return {
    ...snap,
    entities: snap.entities.map((e) =>
      e.id !== me && e.kind === 'rider' && !keep(e) ? { ...e, kind: 'pickup' as const } : e,
    ),
  };
}

export interface CareerRace {
  profile: Profile;
  report: SettleReport;
  status: RaceStatus;
  tally: RaceTally;
  config: SimConfig;
  ticks: number;
  prompts: string[];
}

/**
 * One career race at a map node, ridden by the dev bot, settled into the profile. `free`: a
 * free-play race of the node's event (it pays, but wins nothing on the map).
 */
export function playNode(
  def: CareerDef,
  node: CareerNode,
  profile: Profile,
  seed: number,
  free = false,
): CareerRace {
  const plan = eventPlan(REG, node.event);
  const length = nodeLength(plan, node);
  if (!length) throw new Error(`${node.event} has no length`);
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, node.event, length.id), {
    seed,
    eventId: node.event,
    length: length.id,
    ...(profile.bikes.current ? { playerBike: profile.bikes.current } : {}),
    grudges: profile.grudges,
  });
  const sim = createSim(config);
  const me = config.riders.findIndex((r) => r.controller.kind === 'player');
  const log = createRaceLog({
    playerId: me,
    rules: plan.rules,
    objectives: plan.objectives,
    routeId: bare(length.route),
    roadIds: config.road.edges.map((e) => e.id),
    secrets: def.secrets,
  });
  const onboarding = createOnboarding(profile.oncePerCareer);
  const prompts: string[] = [];
  const bot = createBot();
  const focus = botFocus(plan);
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const a = emptyActions();
    bot.drive(botView(snap, me, focus), me, config.route, a);
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    const events = sim.events();
    log.note(events, snap);
    const p = onboarding.note(events, snap, me);
    if (p) prompts.push(p.id);
    const t = log.tally();
    if (log.status().endNow || t.finished || t.busted) break;
  }
  const status = log.status();
  const tally = log.tally();
  const settled = settleRace(profile, {
    reg: REG,
    def,
    node: free ? null : node,
    plan,
    status,
    tally,
    build: 'test',
    at: '2026-10-02T00:00:00.000Z',
  });
  const next = {
    ...settled.profile,
    oncePerCareer: withPromptsSeen(settled.profile.oncePerCareer, onboarding.shown()),
  };
  return { profile: next, report: settled.report, status, tally, config, ticks: sim.tick, prompts };
}

export interface CareerRun {
  profile: Profile;
  /** One line per race: node, seed, outcome, objectives, cash. */
  log: string[];
  /** Races per node id. */
  tries: Record<string, number>;
  /** The boss race's report (the teaser rides on it), or null when it never fell. */
  bossReport: SettleReport | null;
  /** Every race, in order. */
  races: CareerRace[];
}

/**
 * A region's whole career, the way a player who never gives up plays it: the open node tried the
 * fewest times (the tutorial first, then the lowest tier; so after a loss they move on and come
 * back), a fresh seed for every try, and the fastest affordable bike bought after every race. It
 * stops when the boss falls, or when every open node has been tried `maxTries` times; then, in
 * free play, every node never ridden gets one race, so every event is played.
 */
export function runCareer(
  defs: readonly CareerDef[],
  def: CareerDef,
  start: Profile,
  opts: { maxTries: number },
): CareerRun {
  let profile = start;
  const log: string[] = [];
  const tries: Record<string, number> = {};
  const races: CareerRace[] = [];
  let bossReport: SettleReport | null = null;
  for (;;) {
    const progress = progressOf(def, profile.regions);
    let node: CareerNode | undefined;
    if (!progress.finaleBeaten) {
      const open = def.nodes.filter((nd) => nodeState(def, progress, nd) === 'open');
      node =
        open.find((nd) => nd.id === def.tutorialNode) ??
        [...open].sort((a, b) => (tries[a.id] ?? 0) - (tries[b.id] ?? 0) || a.tier - b.tier)[0];
      if (node && (tries[node.id] ?? 0) >= opts.maxTries) node = undefined;
    }
    // Free play after the boss, or once the career is stuck: every node never ridden, once (a
    // locked one as a free-play race of its event, which wins nothing on the map).
    node ??= def.nodes.find((nd) => !tries[nd.id]);
    if (!node) break;
    const free = nodeState(def, progress, node) === 'locked';
    const n = (tries[node.id] ?? 0) + 1;
    tries[node.id] = n;
    const seed = 7919 * (def.nodes.indexOf(node) + 1) + n;
    const race = playNode(def, node, profile, seed, free);
    races.push(race);
    profile = shop(defs, race.profile);
    if (node.id === def.boss && race.report.won) bossReport = race.report;
    const objectives = race.status.objectives.map(
      (o) => `${o.label}:${o.met === true ? 'met' : o.met === false ? 'missed' : 'open'}`,
    );
    log.push(
      `${def.regionId} ${node.id}${free ? ' (free play)' : ''} try ${n} seed ${seed}: ${race.report.outcome} place ${race.tally.place}/${race.tally.racers} ` +
        `td ${race.tally.takedowns} [${objectives.join(', ')}] cash ${race.report.cashBefore}->${race.report.cashAfter} ` +
        `bike ${profile.bikes.current} ${(race.ticks / 60).toFixed(0)}s`,
    );
  }
  return { profile, log, tries, bossReport, races };
}

/** The garage step a player would take: buy the fastest bike for sale that the cash covers. */
export function shop(defs: readonly CareerDef[], profile: Profile): Profile {
  const forSale = garageBikes(REG, defs, profile)
    .filter((b) => b.state === 'for-sale' && !b.secret && b.priceCash <= profile.cash)
    .sort((a, b) => b.topSpeedMps - a.topSpeedMps);
  const current = garageBikes(REG, defs, profile).find((b) => b.current);
  const best = forSale[0];
  if (!best || (current && current.topSpeedMps >= best.topSpeedMps)) return profile;
  const bought = buyBike(REG, defs, profile, best.key);
  return bought.ok ? bought.profile : profile;
}
