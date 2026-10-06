// After a career race: the cash ledger, the grudges rivals keep, the map, the unlocks and the
// history (docs/milestones/M4.md, career-1; the product spec's Cash and Failure states). Pure: a
// profile and a race in, a new profile and a report out. DOM-free.
//
// Cash [decided for the sources: placing, takedowns, near-misses and style; no betting]:
// - the place prize (`rewards.byPlaceCash`), for a finish;
// - the style cash the sim scored (takedowns and combos, near misses, airtime, oncoming, steals,
//   tricks): the sim's own `style` events, so the screen and the ledger agree to the dollar;
// - each objective met that carries `rewardCash` (the optional bonuses, and an event's win bonus);
// - a stash found on the map;
// - minus the repairs for the player's wrecks, and a bust's fine. Road Trip [decided]: a fine never
//   takes cash below $0.
//
// The economy of playtest 3 (the maintainer, 2026-10-03: "each new bike takes about 3-4 races, with
// smaller purses, pricier bikes and repairs after crashes"; `[default]` for the numbers below):
// - repairs: each wreck bills REPAIR_PRICE_SHARE of the bike ridden (at least REPAIR_MIN_CASH), at
//   most REPAIR_WRECKS_BILLED wrecks, and never more than REPAIR_CAP_SHARE of what the race paid;
// - a replay of a won node pays REPLAY_PAY_SCALE of its purse (the place prize and the required
//   bonus); style and optional bonuses pay in full, so farming an old node is never the way up;
// - a later season's purse grows (`seasonPurseScale`).
//
// Grudges [decided: saved with the career, so rivals keep them across sessions]: each rival's
// points toward the player move by the rider file's `grudge` block: up by `gainPerHitTaken` per hit
// the player landed on them, `gainPerTakedownSuffered` per takedown and `gainPerWeaponStolen` per
// steal; a rival in the field the player left alone cools off by `decayPerRace`; a grudge match
// moves its rival by `rules.grudgeStakes` (up when you beat them, down when they beat you). Clamped
// to 0..`max`. The table goes into the next race's SimConfig.grudges.
import type { ContentRegistry } from '../content';
import { CASH_MAX, MAX_HISTORY, type EventOutcome, type EventResult, type Profile } from '../save';
import { careerDefs, type CareerDef, type CareerNode, type CareerSecret, type EventPlan } from './defs';
import { applyWin, progressOf, type WinApplied } from './map';
import type { RaceStatus, RaceTally } from './race-log';
import { withReceipts } from './receipts';

export interface LedgerLine {
  label: string;
  cash: number;
}

/** The grudge rules of a rider file's `grudge` block, with defaults for a rival without one. */
export interface GrudgeRules {
  startTowardPlayer: number;
  gainPerHitTaken: number;
  gainPerTakedownSuffered: number;
  gainPerWeaponStolen: number;
  decayPerRace: number;
  max: number;
}

/** A rival with no `grudge` block (the region packs' locals today). [default] */
export const DEFAULT_GRUDGE: GrudgeRules = {
  startTowardPlayer: 0,
  gainPerHitTaken: 1,
  gainPerTakedownSuffered: 3,
  gainPerWeaponStolen: 2,
  decayPerRace: 1,
  max: 10,
};

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function grudgeRules(reg: ContentRegistry, rival: string): GrudgeRules {
  const g = (reg.riders[rival] as { grudge?: Record<string, unknown> } | undefined)?.grudge ?? {};
  return {
    startTowardPlayer: num(g['startTowardPlayer'], DEFAULT_GRUDGE.startTowardPlayer),
    gainPerHitTaken: num(g['gainPerHitTaken'], DEFAULT_GRUDGE.gainPerHitTaken),
    gainPerTakedownSuffered: num(g['gainPerTakedownSuffered'], DEFAULT_GRUDGE.gainPerTakedownSuffered),
    gainPerWeaponStolen: num(g['gainPerWeaponStolen'], DEFAULT_GRUDGE.gainPerWeaponStolen),
    decayPerRace: num(g['decayPerRace'], DEFAULT_GRUDGE.decayPerRace),
    max: num(g['max'], DEFAULT_GRUDGE.max),
  };
}

const STYLE_LABELS: Readonly<Record<string, string>> = {
  takedownCombo: 'Takedowns',
  nearMiss: 'Near misses',
  airtime: 'Airtime',
  oncoming: 'Oncoming',
  weaponSteal: 'Steals',
  trick: 'Tricks',
  wheelie: 'Wheelies',
  drift: 'Drifts',
  roofRide: 'Roof rides',
};

/** A wreck bills this share of the bike's price. [default] */
export const REPAIR_PRICE_SHARE = 0.01;
/** The least a wreck bills, so a free bike still has a cost. [default] */
export const REPAIR_MIN_CASH = 50;
/** At most this many wrecks of a race are billed. [default] */
export const REPAIR_WRECKS_BILLED = 5;
/** The bill is never more than this share of what the race paid before it. [default] */
export const REPAIR_CAP_SHARE = 0.25;
/** A replay of a won node pays this share of its place prize and required bonus. [default] */
export const REPLAY_PAY_SCALE = 0.5;
/** A season's purse multiplier, by season: Season 2 pays 15% more, Season 3 and later 30% more. [default] */
const SEASON_PURSE_SCALES: readonly number[] = [1, 1, 1.15, 1.3];

/** The purse multiplier of a season (absent or 1 is Season 1: no change). */
export function seasonPurseScale(season: number | undefined): number {
  const s = typeof season === 'number' && Number.isFinite(season) ? Math.max(1, Math.floor(season)) : 1;
  return SEASON_PURSE_SCALES[Math.min(s, SEASON_PURSE_SCALES.length - 1)] ?? 1;
}

/**
 * What a bike costs: the lowest price any career shop asks (the garage's own rule), looking at the
 * career being settled and then at every career the registry carries; 0 for a bike no shop sells
 * (the starting bike, a joke ride).
 */
export function bikePrice(reg: ContentRegistry, def: CareerDef, bike: string | null): number {
  if (!bike) return 0;
  const shops = [def.shop, ...(reg.careers ? careerDefs(reg).map((d) => d.shop) : [])];
  const prices = shops.flatMap((shop) => shop.filter((i) => i.bike === bike).map((i) => i.priceCash));
  return prices.length ? Math.min(...prices) : 0;
}

/**
 * The repairs for a race: `wrecks` falls on a bike that costs `price`, against what the race paid
 * (`paid`, before repairs and fines). Wrecks past the billed few are free, and the cap keeps a rough
 * race from costing more than a quarter of its pay.
 */
export function repairBill(wrecks: number, price: number, paid: number): { wrecks: number; cash: number } {
  const billed = Math.max(0, Math.min(REPAIR_WRECKS_BILLED, Math.floor(wrecks)));
  const each = Math.max(REPAIR_MIN_CASH, Math.round(REPAIR_PRICE_SHARE * Math.max(0, price)));
  const cap = Math.floor(REPAIR_CAP_SHARE * Math.max(0, paid));
  return { wrecks: billed, cash: Math.min(billed * each, cap) };
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
};

/**
 * How a race's purse is scaled: not at all for a first run in Season 1. A replay of a won node pays
 * half (REPLAY_PAY_SCALE) and a later season pays more (`seasonPurseScale`). Only the purse is
 * scaled, the place prize and a required bonus; style and optional bonuses pay as earned.
 */
export interface PurseScale {
  replay?: boolean;
  season?: number | undefined;
}

/** The race's cash lines, before the repairs and the fine. */
export function raceEarnings(
  plan: EventPlan,
  status: RaceStatus,
  tally: RaceTally,
  scale: PurseScale = {},
): LedgerLine[] {
  const lines: LedgerLine[] = [];
  const k = seasonPurseScale(scale.season) * (scale.replay ? REPLAY_PAY_SCALE : 1);
  const purse = (cash: number) => Math.round(cash * k);
  if (tally.finished && !tally.busted) {
    const prize = purse(Math.max(0, Math.round(plan.byPlaceCash[tally.place - 1] ?? 0)));
    if (prize > 0)
      lines.push({ label: `${ordinal(tally.place)} place${scale.replay ? ' (replay)' : ''}`, cash: prize });
  }
  for (const [kind, row] of Object.entries(tally.style).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (row.cash === 0) continue;
    const label = STYLE_LABELS[kind] ?? kind;
    lines.push({ label: row.count > 1 ? `${label} ×${row.count}` : label, cash: row.cash });
  }
  for (const o of status.objectives)
    if (o.met === true && o.rewardCash > 0)
      lines.push({
        label: `Bonus: ${o.label.toLowerCase()}`,
        cash: o.required ? purse(o.rewardCash) : o.rewardCash,
      });
  return lines;
}

export interface GrudgeChange {
  rival: string;
  before: number;
  after: number;
}

/** The grudge table after a race (the rivals who rode; others keep theirs). */
export function settleGrudges(
  reg: ContentRegistry,
  grudges: Profile['grudges'],
  tally: RaceTally,
  stakes: { rival: string; delta: number } | null,
): { grudges: Profile['grudges']; changes: GrudgeChange[] } {
  const out: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(grudges)) out[k] = { ...v };
  const changes: GrudgeChange[] = [];
  const me = tally.player;
  if (!me) return { grudges: out, changes };
  for (const rival of [...new Set(tally.field)].sort()) {
    const rules = grudgeRules(reg, rival);
    const row = (out[rival] ??= {});
    const before = row[me] ?? rules.startTowardPlayer;
    const did = tally.toRivals[rival];
    let delta = did
      ? did.hits * rules.gainPerHitTaken +
        did.takedowns * rules.gainPerTakedownSuffered +
        did.steals * rules.gainPerWeaponStolen
      : 0;
    if (delta === 0) delta = -rules.decayPerRace;
    if (stakes && stakes.rival === rival) delta += stakes.delta;
    const after = Math.round(Math.min(rules.max, Math.max(0, before + delta)) * 100) / 100;
    if (after === 0) delete row[me];
    else row[me] = after;
    if (Object.keys(row).length === 0) delete out[rival];
    if (after !== before) changes.push({ rival, before, after });
  }
  return { grudges: out, changes };
}

export interface SettleInput {
  reg: ContentRegistry;
  def: CareerDef;
  /** The map node raced, or null for a free-play race in the career's region. */
  node: CareerNode | null;
  plan: EventPlan;
  status: RaceStatus;
  tally: RaceTally;
  /** The player quit before the end (no cash, no win; grudges still count). */
  quit?: boolean;
  /** The bike the player rode (qualified), for its repairs; the profile's current bike by default. */
  bike?: string;
  build: string;
  at: string;
}

export interface Teaser {
  lines: readonly string[];
  /** The next region (qualified), or null. */
  next: string | null;
  freePlayAfter: boolean;
}

export interface SettleReport {
  outcome: EventOutcome;
  won: boolean;
  lines: LedgerLine[];
  /** The repairs billed for the player's wrecks (also a negative line in `lines`); 0 when none. */
  repairs: number;
  /** The node had been won before, so its purse paid half. */
  replay: boolean;
  fine: number;
  cashBefore: number;
  cashAfter: number;
  map: WinApplied | null;
  /** Bikes (or riders) granted by the career's `unlocks`, qualified. */
  unlocked: string[];
  secretsFound: CareerSecret[];
  grudges: GrudgeChange[];
  /** The boss fell for the first time: the next region's teaser, then free play. */
  teaser: Teaser | null;
}

export function settleRace(profile: Profile, input: SettleInput): { profile: Profile; report: SettleReport } {
  const { reg, def, node, plan, status, tally } = input;
  const quit = input.quit === true;
  const won = !quit && status.state === 'won';
  const outcome: EventOutcome = quit
    ? 'quit'
    : tally.busted
      ? 'busted'
      : won
        ? 'won'
        : tally.finished
          ? 'placed'
          : 'lost';
  // The map: the node is won; its roads open and glow; secrets passed are found.
  const before = progressOf(def, profile.regions);
  let progress = before;
  let map: WinApplied | null = null;
  if (won && node) {
    map = applyWin(def, progress, node);
    progress = map.progress;
  }
  const newSecrets = def.secrets.filter(
    (s) => tally.secrets.includes(s.id) && !progress.secrets.includes(s.id),
  );
  progress = {
    ...progress,
    secrets: [...new Set([...progress.secrets, ...newSecrets.map((s) => s.id)])].sort(),
    foundShortcuts: [...new Set([...progress.foundShortcuts, ...tally.branches])].sort(),
  };
  // Cash. A replay is a node (or, from free play, an event) already won on the map.
  const replay =
    !quit &&
    (node
      ? before.won.includes(node.id)
      : def.nodes.some((n) => n.event === plan.key && before.won.includes(n.id)));
  const lines = quit ? [] : raceEarnings(plan, status, tally, { replay, season: profile.season });
  for (const s of newSecrets) if (s.cash > 0) lines.push({ label: `Found: ${s.name}`, cash: s.cash });
  // Repairs: the player's wrecks, against what the race paid.
  const paid = lines.reduce((sum, l) => sum + Math.max(0, l.cash), 0);
  const repair = quit
    ? { wrecks: 0, cash: 0 }
    : repairBill(tally.wrecks ?? 0, bikePrice(reg, def, input.bike ?? profile.bikes.current), paid);
  if (repair.cash > 0)
    lines.push({ label: repair.wrecks > 1 ? `Repairs ×${repair.wrecks}` : 'Repairs', cash: -repair.cash });
  const earned = lines.reduce((sum, l) => sum + l.cash, 0);
  const cashBefore = profile.cash;
  // A bust's fine, plus any citations billed at the finish (run W-T: Deputy Lindqvist), never
  // taking cash below $0 (Road Trip).
  const owed = (tally.busted ? tally.fineCash : 0) + Math.max(0, tally.citationCash ?? 0);
  const fine = Math.min(owed, Math.max(0, cashBefore + earned));
  const cashAfter = Math.min(CASH_MAX, Math.max(0, cashBefore + earned - fine));
  // Grudges.
  const stakes =
    plan.rules.rival && plan.rules.grudgeStakes
      ? { rival: plan.rules.rival, delta: (won ? 1 : -1) * plan.rules.grudgeStakes }
      : null;
  const g = settleGrudges(reg, profile.grudges, tally, quit ? null : stakes);
  // Unlocks: a boss beaten or an event won grants its rides.
  const owned = new Set(profile.bikes.owned);
  const unlocked: string[] = [];
  for (const u of def.unlocks) {
    const met =
      (u.kind === 'boss-beaten' && progress.finaleBeaten) ||
      (u.kind === 'event-won' && won && plan.key === u.ref);
    if (met && reg.bikes[u.grant] && !owned.has(u.grant)) {
      owned.add(u.grant);
      unlocked.push(u.grant);
    }
  }
  const teaserFlag = `teaser:${def.regionId}`;
  const teaser =
    map?.finale && !profile.oncePerCareer.includes(teaserFlag)
      ? { lines: def.ending.lines, next: def.ending.next, freePlayAfter: def.ending.freePlayAfter }
      : null;
  const result: EventResult = {
    event: plan.key,
    node: node?.id ?? null,
    region: def.regionId,
    place: tally.finished ? tally.place : 0,
    outcome,
    cash: cashAfter - cashBefore,
    takedowns: tally.takedowns,
    build: input.build,
    at: input.at,
    // The season it was played in, from Season 2 (a Season 1 result is written as before).
    ...(profile.season > 1 ? { season: profile.season } : {}),
  };
  const history = [...profile.history, result].slice(-MAX_HISTORY);
  const next: Profile = {
    ...profile,
    cash: cashAfter,
    bikes: { ...profile.bikes, owned: [...owned].sort() },
    regions: { ...profile.regions, [def.regionId]: progress },
    grudges: g.grudges,
    history,
    oncePerCareer: teaser
      ? [...new Set([...profile.oncePerCareer, teaserFlag])].sort()
      : profile.oncePerCareer,
    // The world's receipts (run W-T): what this race did and where, kept for the boards.
    receipts: withReceipts(
      profile,
      plan,
      def.regionId,
      tally,
      history.filter((h) => h.outcome === 'busted').length,
    ),
  };
  return {
    profile: next,
    report: {
      outcome,
      won,
      lines,
      repairs: repair.cash,
      replay,
      fine,
      cashBefore,
      cashAfter,
      map,
      unlocked,
      secretsFound: newSecrets,
      grudges: g.changes,
      teaser,
    },
  };
}
