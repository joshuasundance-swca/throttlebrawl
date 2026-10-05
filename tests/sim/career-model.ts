/// <reference types="vite/client" />
// A modelled player through the real career (playtest 3, T7.5 balance QA; the maintainer,
// 2026-10-03: "each new bike takes about 3-4 races of winnings; smaller purses, pricier bikes,
// repairs after crashes"; round 3: "Six bikes", regions "In order", "Longer + seasons"). The dev bot
// is a fighter, not a racer (career-headless.ts), so it cannot say how long a racer saves for a
// bike. This file plays a whole season the way a player of a given skill would, and every number it
// reports comes from the career's own code on the real packs: the map's gates and region order
// (`nodeState`, `regionOpen`), the purse of each event file, the repairs, the half-pay replays and
// the season's purse scale (`settleRace`), the producer's ask and the side gig at their tier's pay
// (`pickAsk`, `currentGig`), the field level's fines (`fieldLevel`), and the garage's prices and
// locks (`garageBikes`, `buyBike`). Only the race's outcome is modelled: whether the player wins,
// where they place, what style cash they make, how often they crash or are busted, and whether they
// meet the ask and the gig, drawn from a seeded generator (progression.md, section 6's player
// models; they are assumptions, not measurements, stated in PLAYERS below).
import {
  bikeLadder,
  bestOpenRank,
  buyBike,
  careerDefs,
  currentGig,
  fieldLevel,
  garageBikes,
  globalTier,
  gigStatus,
  nodeState,
  pickAsk,
  progressOf,
  regionOpen,
  seasonRace,
  suggestedNode,
  settleRace,
  showOf,
  startCareer,
  type CareerDef,
  type CareerNode,
  type EventPlan,
  type ObjectiveStatus,
  type RaceTally,
} from '../../src/career';
import { DEFAULT_PROFILE, type Profile } from '../../src/save';
import { REG } from './career-harness';

export const DEFS = careerDefs(REG);
/** The step-up bikes, slowest first (the starting bike is rank 0). */
export const LADDER = bikeLadder(REG, DEFS);

/** A player's skill, as the outcome of a race on the right bike. */
export interface PlayerModel {
  name: string;
  /** The chance to win a race on the best bike open there. */
  win: number;
  /** Style cash (near misses, air, takedowns) a race at global tier 1, and its rise per tier. */
  style: number;
  stylePerTier: number;
  /** The chance to meet the producer's ask, and the side gig. */
  ask: number;
  gig: number;
  /** The mean wrecks a race (each billed as repairs, up to the career's cap). */
  wrecks: number;
  /** The chance a race ends in a bust (a lost race and the fine). */
  bust: number;
}

/** progression.md, section 6 (assumptions, not measurements). */
export const PLAYERS = {
  typical: {
    name: 'typical',
    win: 0.6,
    style: 350,
    stylePerTier: 40,
    ask: 0.5,
    gig: 0.4,
    wrecks: 2,
    bust: 0.08,
  },
  struggling: {
    name: 'struggling',
    win: 0.35,
    style: 150,
    stylePerTier: 15,
    ask: 0.25,
    gig: 0.2,
    wrecks: 4,
    bust: 0.15,
  },
} as const satisfies Record<string, PlayerModel>;

/**
 * Riding below the best open bike (progression.md, section 6): one rank down wins x0.75 of the
 * time in a region's first two tiers and x0.6 from its third, where the field rides your best; each
 * further rank down x0.55.
 */
export function bikeFactor(ranksDown: number, regionTier: number): number {
  if (ranksDown <= 0) return 1;
  return (regionTier < 2 ? 0.75 : 0.6) * 0.55 ** (ranksDown - 1);
}

/** mulberry32: a small seeded generator, so a modelled season is the same every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rankOf = (bike: string | null) => LADDER.findIndex((b) => b.key === bike);

/** The region the player rides next: the first in chapter order that is open and not finished. */
export function nextRegion(profile: Profile): CareerDef | null {
  return (
    DEFS.find((d) => regionOpen(DEFS, profile, d) && !progressOf(d, profile.regions).finaleBeaten) ?? null
  );
}

/**
 * How the player picks the next race. `suggested`: the node the career map suggests (the app's
 * own Next: the tier's regular events, then its boss; after a loss, the same race again).
 * `rush`: the tier's boss as soon as it opens, otherwise the open race tried least, so a player in
 * a hurry rides the fewest races a season allows.
 */
export type Route = 'suggested' | 'rush';

/** The node the player rides next in a region, or null when every node there is won. */
export function nextNode(
  def: CareerDef,
  profile: Profile,
  tries: Map<string, number>,
  route: Route = 'suggested',
): CareerNode | null {
  const progress = progressOf(def, profile.regions);
  if (route === 'suggested') return suggestedNode(def, progress);
  const open = def.nodes.filter((n) => nodeState(def, progress, n) === 'open');
  const boss = open.find((n) => def.tiers[n.tier]?.boss === n.id || def.boss === n.id);
  if (boss) return boss;
  return (
    [...open].sort((a, b) => (tries.get(a.id) ?? 0) - (tries.get(b.id) ?? 0) || a.tier - b.tier)[0] ?? null
  );
}

/** One modelled race: the status and the tally the race log would have kept. */
function raceOutcome(
  player: PlayerModel,
  plan: EventPlan,
  g: number,
  regionTier: number,
  ranksDown: number,
  fine: number,
  r: () => number,
): { won: boolean; busted: boolean; tally: RaceTally; objectives: ObjectiveStatus[] } {
  const racers = plan.field.length + 1;
  const busted = r() < player.bust;
  const won = !busted && r() < player.win * bikeFactor(ranksDown, regionTier);
  // A win to the line is first place; a win by an objective (a hunt, an escape, a grudge) still
  // crosses the line in the field's top half; a loss places behind the winner.
  const place = won
    ? plan.kind === 'classic-race'
      ? 1
      : 1 + Math.floor(r() * Math.max(1, Math.ceil(racers / 2)))
    : 2 + Math.floor(r() * Math.max(1, racers - 1));
  const styleCash = Math.round(
    (player.style + player.stylePerTier * (g - 1)) * (0.5 + r()) * (busted ? 0.5 : 1),
  );
  const wrecks = Math.floor(r() * (2 * player.wrecks + 1));
  const objectives: ObjectiveStatus[] = plan.objectives.map((o) => ({
    id: o.id,
    kind: o.kind,
    required: o.required,
    rewardCash: o.rewardCash,
    met: o.required ? won : !busted && r() < 0.3,
    label: o.id,
  }));
  const tally: RaceTally = {
    finished: !busted,
    place: busted ? 0 : Math.min(racers, place),
    racers,
    busted,
    fineCash: busted ? fine : 0,
    takedowns: 0,
    wrecks,
    style: styleCash > 0 ? { nearMiss: { count: 1, cash: styleCash } } : {},
    styleCash,
    toRivals: {},
    branches: [],
    secrets: [],
    field: [...plan.field],
    player: 'base:player',
  };
  return { won, busted, tally, objectives };
}

export interface ModelledSeason {
  profile: Profile;
  /** Races ridden this season. */
  races: number;
  /** Per step-up bike (rank 1 up): the races ridden when it went on sale, and when it was bought. */
  bikes: { key: string; onSale: number | null; bought: number | null }[];
  /** Region ids in the order their first race was ridden. */
  regionOrder: string[];
  /** The player's cash after every race. */
  cash: number[];
}

/**
 * One season played by a modelled player from `start`, until every region boss has fallen (or
 * `maxRaces`). After every race the player buys the next step-up bike when the cash covers it, the
 * garage's own price and lock. `seed` draws the outcomes.
 */
export function playSeason(
  player: PlayerModel,
  seed: number,
  opts: { start?: Profile; route?: Route; maxRaces?: number } = {},
): ModelledSeason {
  const start = opts.start ?? startCareer(DEFS, { ...DEFAULT_PROFILE });
  const maxRaces = opts.maxRaces ?? 400;
  const r = rng(seed);
  let profile = start;
  const tries = new Map<string, number>();
  const bikes = LADDER.slice(1).map((b) => ({
    key: b.key,
    onSale: null as number | null,
    bought: null as number | null,
  }));
  const regionOrder: string[] = [];
  const cash: number[] = [];
  const noteGarage = (races: number) => {
    const shown = garageBikes(REG, DEFS, profile);
    for (const b of bikes) {
      const state = shown.find((x) => x.key === b.key)?.state;
      if (b.onSale === null && (state === 'for-sale' || state === 'owned')) b.onSale = races;
      if (b.bought === null && state === 'owned') b.bought = races;
    }
  };
  noteGarage(0);
  let races = 0;
  while (races < maxRaces) {
    const def = nextRegion(profile);
    if (!def) break;
    const node = nextNode(def, profile, tries, opts.route);
    if (!node) break;
    if (!regionOrder.includes(def.regionId)) regionOrder.push(def.regionId);
    tries.set(node.id, (tries.get(node.id) ?? 0) + 1);
    const { plan } = seasonRace(REG, DEFS, profile, def, node);
    const level = fieldLevel(REG, DEFS, def, node, profile.season);
    const g = globalTier(DEFS, def, node.tier);
    const ranksDown = Math.max(0, bestOpenRank(LADDER, g, profile.season) - rankOf(profile.bikes.current));
    const fine = Math.round(400 * (level?.fineScale ?? 1));
    const out = raceOutcome(player, plan, g, node.tier, ranksDown, fine, r);
    // The producer's ask and the side gig, as the app adds them: optional bonuses the ledger pays.
    const show = showOf(REG, def);
    const ask = pickAsk(show, plan, seed * 1000 + races);
    const extras: ObjectiveStatus[] = [];
    if (ask)
      extras.push({
        id: `ask-${ask.id}`,
        kind: ask.kind,
        required: false,
        rewardCash: ask.cash,
        met: !out.busted && r() < player.ask,
        label: ask.id,
      });
    const gig = currentGig(show, profile, def.regionId);
    if (gig) extras.push({ ...gigStatus(gig, out.tally), met: !out.busted && r() < player.gig });
    const settled = settleRace(profile, {
      reg: REG,
      def,
      node,
      plan,
      status: {
        state: out.won ? 'won' : 'lost',
        endNow: false,
        objectives: [...out.objectives, ...extras],
        headline: '',
      },
      tally: out.tally,
      build: 'model',
      at: '2026-10-04T00:00:00.000Z',
    });
    profile = settled.profile;
    races += 1;
    noteGarage(races);
    profile = buyNext(profile);
    noteGarage(races);
    cash.push(profile.cash);
  }
  return { profile, races, bikes, regionOrder, cash };
}

/** The garage step: buy the next step-up bike up the ladder when it is for sale and affordable. */
export function buyNext(profile: Profile): Profile {
  const next = LADDER[rankOf(profile.bikes.current) + 1];
  if (!next) return profile;
  const offer = garageBikes(REG, DEFS, profile).find((b) => b.key === next.key);
  if (offer?.state !== 'for-sale' || offer.priceCash > profile.cash) return profile;
  const bought = buyBike(REG, DEFS, profile, next.key);
  return bought.ok ? bought.profile : profile;
}

/** The median of a list (the mean of the middle two for an even count). */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? NaN) : ((s[m - 1] ?? NaN) + (s[m] ?? NaN)) / 2;
}

/** The p-th percentile (0 to 1), nearest rank. */
export function quantile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] ?? NaN;
}
