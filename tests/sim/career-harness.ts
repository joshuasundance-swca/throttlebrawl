/// <reference types="vite/client" />
// The headless career (docs/milestones/M4.md, career-1 and the M4 exit: "A headless career test has
// a bot play every event and the boss in the simulation, and the career ends in the teaser and free
// play"). A career race here is built exactly as the app builds one: the app's buildSimConfig with
// the profile's bike and grudges, the career's race log watching the sim's events and snapshots,
// then the career's settle. The dev bot rides; nothing is scripted in its favour except what a
// player can do too (retry, buy the best bike the cash allows). Playtest 3: a career race carries
// the career's field level for its tier and season, and the season's remix, exactly as the app's
// career race does (`careerRaceSetup`), so the headless career meets the field the player meets.
// The bot rides at least the bike the career gives at a node's tier (the best step-up bike open
// there, the one the field level is measured against), and a race's time limit comes from its
// route's length and that bike (`raceLimitS`), not one fixed stop for every road and bike.
import { buildSimConfig, createStreamCache } from '../../src/app';
import { careerRaceSetup } from '../../src/app/career-flow';
import {
  bare,
  bestOpenRank,
  bikeLadder,
  buyBike,
  careerDefs,
  createOnboarding,
  createRaceLog,
  eventPlan,
  garageBikes,
  globalTier,
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
import type { FieldLevel } from '../../src/core';
import type { Profile } from '../../src/save';
import {
  createSim,
  type EntitySnapshot,
  type SimConfig,
  type SimEvent,
  type SimSnapshot,
} from '../../src/sim/api';

export const REG: ContentRegistry = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
/** A race's safety stop: 12 minutes of race, or the race's own time limit when that is longer. */
const MAX_TICKS = 60 * 60 * 12;
/**
 * A race's time limit is its route ridden at this share of the player's bike's top speed on
 * average, crashes, respawns, traffic and fights included. The dev bot averages about 0.55 to 0.65
 * of the starting bike's top speed on San Francisco's hills (tests/sim/region-sf.test.ts), and less
 * of a fast bike's in the city: about 0.37 of the superbike's in the San Francisco career's slowest
 * races (2026-10-04). A fifth leaves it close to double its own time, so the limit catches a race
 * that cannot end (a stall, a loop, a finish nobody reaches), not a slow ride. [default]
 */
export const RACE_LIMIT_SHARE = 0.2;

/**
 * A race's time limit, s: the route's length (start to finish, as the sim races it) at
 * RACE_LIMIT_SHARE of the player's bike's top speed (scaled by the race's speed multiplier).
 */
export function raceLimitS(config: SimConfig): number {
  const me = config.riders.find((r) => r.controller.kind === 'player');
  const top = (me?.bike.topSpeedMps ?? 0) * (config.speedMultiplier ?? 1);
  if (!(top > 0)) throw new Error(`${config.event.contentId}: the player has no bike top speed`);
  return config.route.length / (RACE_LIMIT_SHARE * top);
}

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

/** What the bot is shown (its eyes): every rider it should not fight shows as a pickup. */
export function botView(snap: SimSnapshot, me: number, focus: BotFocus): SimSnapshot {
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

/** Every career, in chapter order (the field level counts the tiers of the chapters before). */
const DEFS = careerDefs(REG);
const LADDER = bikeLadder(REG, DEFS);

/**
 * The bike the career gives at a node's tier: the best step-up bike open at its global tier
 * (Season 1), the bike its field level is measured against (src/career/level.ts). Null when the
 * ladder has none open there.
 */
export function tierBike(def: CareerDef, node: CareerNode): { key: string; topSpeedMps: number } | null {
  return LADDER[bestOpenRank(LADDER, globalTier(DEFS, def, node.tier))] ?? null;
}

/**
 * The profile riding at least the bike the career gives at the node's tier, as a player who kept
 * up would (owned from then on); a faster bike it already rides stays. Cash is untouched.
 */
export function onTierBike(
  reg: ContentRegistry,
  def: CareerDef,
  node: CareerNode,
  profile: Profile,
): Profile {
  const bike = tierBike(def, node);
  const current = profile.bikes.current ? reg.bikes[profile.bikes.current]?.handling.topSpeedMps : undefined;
  if (!bike || (current !== undefined && current >= bike.topSpeedMps)) return profile;
  return {
    ...profile,
    bikes: {
      ...profile.bikes,
      owned: [...new Set([...profile.bikes.owned, bike.key])].sort(),
      current: bike.key,
    },
  };
}

/** How a test bends a career race: free play, a tuning profile, or another tier's field level. */
export interface CareerRaceOptions {
  /** A free-play race of the node's event: the event file's own field, as free play races it. */
  free?: boolean;
  /** The sim tuning (a balance test races with the ISOLATED profile). */
  tuning?: Readonly<Record<string, number>>;
  /** Race this node at another field level (a balance test races every tier on one road). */
  level?: FieldLevel;
}

/**
 * A career race at a map node as the app builds it (playtest 3: the season's plan and length, the
 * field level of the node's tier and season, and the season's remix).
 */
export function careerRace(
  def: CareerDef,
  node: CareerNode,
  profile: Profile,
  seed: number,
  opts: CareerRaceOptions = {},
): {
  plan: ReturnType<typeof eventPlan>;
  length: { id: string; route: string };
  config: SimConfig;
  level: FieldLevel | null;
} {
  const setup = opts.free ? null : careerRaceSetup(REG, DEFS, profile, def, node);
  const plan = setup?.plan ?? eventPlan(REG, node.event);
  const length = setup ? setup.length : nodeLength(plan, node);
  if (!length) throw new Error(`${node.event} has no length`);
  const level = setup ? (opts.level ?? setup.fieldLevel) : null;
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, node.event, length.id), {
    seed,
    eventId: node.event,
    length: length.id,
    ...(profile.bikes.current ? { playerBike: profile.bikes.current } : {}),
    grudges: profile.grudges,
    ...(level ? { fieldLevel: level } : {}),
    ...(setup?.patch ? { eventPatch: setup.patch } : {}),
    ...(opts.tuning ? { tuning: { ...opts.tuning } } : {}),
  });
  return { plan, length, config, level };
}

/**
 * One career race at a map node (`careerRace`), ridden by the dev bot, settled into the profile.
 * `free`: a free-play race of the node's event (it pays, but wins nothing on the map).
 */
export function playNode(
  def: CareerDef,
  node: CareerNode,
  profile: Profile,
  seed: number,
  free = false,
  /** Sees every step's events and snapshot (run W-U: checks that read the race as it runs). */
  watch?: (events: readonly SimEvent[], snap: SimSnapshot, config: SimConfig) => void,
): CareerRace {
  const { plan, length, config } = careerRace(def, node, profile, seed, { free });
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
  const stop = Math.max(MAX_TICKS, Math.ceil(raceLimitS(config) * 60));
  while (!sim.isOver() && sim.tick < stop) {
    const a = emptyActions();
    bot.drive(botView(snap, me, focus), me, config.route, a);
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    const events = sim.events();
    watch?.(events, snap, config);
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
 * back), a fresh seed for every try, at least the bike the career gives at the node's tier
 * (`onTierBike`), and the fastest affordable bike bought after every race. It
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
    profile = onTierBike(REG, def, node, profile);
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
