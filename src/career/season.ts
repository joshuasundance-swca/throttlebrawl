// Seasons (playtest 3, the maintainer, round 2: "Longer + seasons": "Season 2+ with a harder field
// and remixed events, the garage carried over"; round 3: "Season 2 on the finished save, plus a
// 'New career' button that keeps the old save as a backup code"). DOM-free, pure.
//
// [default] for the exact rules (docs/product-spec.md, "Career"):
// - Season n+1 can start once every region boss of season n has fallen; the map offers it as a
//   card and the player starts it (starting resets the maps, so it is never automatic).
// - Carried over: cash, the garage (bikes, the one ridden, paints and each bike's paint), grudges,
//   receipts, secrets and shortcuts found (a stash never pays twice), the prompts seen and the
//   history (each result keeps its season). Reset: each region's wins, roads, claims, tier and
//   boss, so the chapters open in order again (the Keys first); each boss's teaser plays again.
// - The remix (Season 2 on; Season 1 builds the event files as they are): every roll of a node
//   comes from its own stream, seeded by the season's seed, the node id and the season, so the
//   same save always remixes the same way, and a new season remixes anew:
//   1. a time of day from the five presets, never the node's Season 1 one;
//   2. an event with a `long` length races it half the time in a region's tiers 3 and 4;
//   3. a regular event's field is redrawn, the same count, from the region's roster (the rivals of
//      no region and the region's own, its boss's rival aside); from Season 3, up to 2 guests from
//      the other regions' rosters;
//   4. one regular node in 3 swaps kind within classic, hunt and escape, by templates scaled by
//      the region tier and paying the new kind's purse (`kindPurse`); drift and grudge nodes never;
//   5. each tier boss's match goes to the region rival with the highest grudge toward the player
//      who is not yet a boss this season (ties and no grudges: the seeded draw); the match keeps
//      its route and win rule, and the rival's own rule only when it is the new rival's; the
//      region boss stays the rematch;
//   6. weird events: the chance x(1 + 0.5 (season - 1)), at most 2.5, and one more a race, at
//      most 3;
//   7. a drift target x1.25 a season.
//   The purse's season scale (x1.15, then x1.3) is settled in settle.ts; the field's strength per
//   season in level.ts.
import { packOf, TIMES_OF_DAY, type ContentRegistry } from '../content';
import { createRng, hashString, MAX_SEASON, nextFloat, type EventPatch, type RngState } from '../core';
import { emptyRegion, type Profile } from '../save';
import { bare, eventPlan, nodeLength, type CareerDef, type CareerNode, type EventPlan } from './defs';
import { globalTier } from './level';
import { progressOf, tierBoss } from './map';

/** Season names (draft content, docs/tone-guide.md); later seasons go by number. */
const SEASON_NAMES: Readonly<Record<number, string>> = {
  2: 'Renewed',
  3: 'Syndication',
  4: 'The Streaming Era',
};

/** "Season 1", "Season 2: Renewed". */
export function seasonLabel(season: number): string {
  const name = SEASON_NAMES[season];
  return name ? `Season ${season}: ${name}` : `Season ${season}`;
}

/** The Start Season card's lines (draft content). */
export function seasonCardLines(season: number): string[] {
  return [
    `SEASON ${season}. THE NETWORK RENEWED YOU. NOBODY ASKED THE RIVALS.`,
    'THE FIELD WATCHED YOUR TAPES. THEY BOUGHT BETTER BIKES.',
    'YOUR GARAGE COMES WITH YOU. SO DO THE GRUDGES.',
  ];
}

/** Whether the next season can start: every region boss of this season has fallen. */
export function canStartSeason(defs: readonly CareerDef[], profile: Profile): boolean {
  return (
    defs.length > 0 &&
    profile.season < MAX_SEASON &&
    defs.every((d) => progressOf(d, profile.regions).finaleBeaten)
  );
}

/**
 * The profile at the start of the next season, with `seed` (a uint32 from the app's seed source)
 * as its remix seed. A profile that cannot start one comes back as it is.
 */
export function startSeason(defs: readonly CareerDef[], profile: Profile, seed: number): Profile {
  if (!canStartSeason(defs, profile)) return profile;
  const regions = { ...profile.regions };
  for (const d of defs) {
    const was = progressOf(d, profile.regions);
    regions[d.regionId] = {
      ...emptyRegion(),
      unlockedRoads: [...d.startRoads],
      foundShortcuts: [...was.foundShortcuts],
      secrets: [...was.secrets],
    };
  }
  return {
    ...profile,
    season: profile.season + 1,
    seasonSeed: seed >>> 0,
    regions,
    // The teasers are per season: each boss's plays again when it falls this season.
    oncePerCareer: profile.oncePerCareer.filter((f) => !f.startsWith('teaser:')),
  };
}

// ---- The remix -------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {};
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const round50 = (x: number) => Math.round(x / 50) * 50;

/** The kinds a regular node may swap between. */
const SWAP_KINDS = ['classic-race', 'takedown-hunt', 'cop-escape'] as const;
type SwapKind = (typeof SWAP_KINDS)[number];
/** The share of regular nodes that swap kind. [default] */
export const SWAP_SHARE = 1 / 3;
/** The share of tier 3 and 4 nodes that race a `long` length. [default] */
export const LONG_SHARE = 0.5;
const MODIFIER_CHANCE_CAP = 2.5;
const MODIFIER_MAX_CAP = 3;
const DRIFT_TARGET_PER_SEASON = 1.25;
/** Fewest rivals a swapped race fields: a top 3 among at least 6 racers. [default] */
const CLASSIC_MIN_FIELD = 5;

/**
 * The purse of a global tier, W(g) = $900 x 1.22^(g - 1) to the $50 (docs/product-spec.md, "Cash"),
 * and its place shares: a race to the line pays its place; a hunt or an escape pays its win in
 * the required bonus (W) and a consolation by place.
 */
export function tierPurse(g: number): number {
  return round50(900 * 1.22 ** (Math.max(1, g) - 1));
}
const CLASSIC_SHARES = [1, 0.55, 0.35, 0.15, 0.1, 0.05, 0.03];
const BONUS_KIND_SHARES = [0.3, 0.2, 0.1, 0.05, 0.03, 0.02];

/** A swapped node's prize by place for `kind` at global tier g, for a field of `riders`. */
export function kindPurse(kind: SwapKind, g: number, riders: number): number[] {
  const shares = kind === 'classic-race' ? CLASSIC_SHARES : BONUS_KIND_SHARES;
  const w = tierPurse(g);
  return shares.slice(0, Math.max(1, riders + 1)).map((s) => (s === 1 ? w : round50(w * s)));
}

/** A node's rolls: a fixed order of draws, then the stream for the shuffles. */
interface NodeRolls {
  timeOfDay: number;
  long: number;
  swap: number;
  swapTo: number;
  guests: number;
  tie: number;
  rest: RngState;
}
function nodeRolls(seed: number, nodeId: string, season: number): NodeRolls {
  const rest = createRng((seed ^ hashString(nodeId) ^ season) >>> 0);
  return {
    timeOfDay: nextFloat(rest),
    long: nextFloat(rest),
    swap: nextFloat(rest),
    swapTo: nextFloat(rest),
    guests: nextFloat(rest),
    tie: nextFloat(rest),
    rest,
  };
}
const pick = <T>(xs: readonly T[], roll: number): T | undefined => xs[Math.floor(roll * xs.length)];
function shuffled<T>(xs: readonly T[], rng: RngState): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(rng) * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** An event's plan, or null when the registry does not hold it. */
function planOf(reg: ContentRegistry, key: string): EventPlan | null {
  return reg.events[key] ? eventPlan(reg, key) : null;
}

/** The rival of a career's region boss (qualified), or null. */
function bossRival(reg: ContentRegistry, def: CareerDef): string | null {
  const node = def.nodes.find((n) => n.id === def.boss);
  return (node && planOf(reg, node.event)?.rules.rival) ?? null;
}

/**
 * The rivals a region fields (qualified, sorted): `home` are the rivals of no region and the
 * region's own; `guests` the other regions' own. Every region boss's rival is left out.
 */
function rosterOf(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  def: CareerDef,
): { home: string[]; guests: string[] } {
  const bosses = new Set(defs.map((d) => bossRival(reg, d)).filter((r): r is string => r !== null));
  const own = bossRival(reg, def);
  if (own) bosses.add(own);
  const home: string[] = [];
  const guests: string[] = [];
  for (const key of Object.keys(reg.riders).sort()) {
    const r = reg.riders[key];
    if (!r || r.role !== 'rival' || bosses.has(key)) continue;
    const region = typeof r.region === 'string' && r.region ? bare(r.region) : null;
    if (region === null || region === def.regionId) home.push(key);
    else guests.push(key);
  }
  return { home, guests };
}

/** Who owns each grudge rule: the rivals whose matches in the registry carry it. */
function ruleOwners(reg: ContentRegistry): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const key of Object.keys(reg.events)) {
    const e = reg.events[key];
    if (e?.kind !== 'grudge-match') continue;
    const rules = obj(e.rules);
    const rule = rules['rule'];
    const rival = rules['rival'];
    if (typeof rule !== 'string' || typeof rival !== 'string') continue;
    const rider = rival.includes(':') ? rival : `${packOf(key)}:${rival}`;
    out.set(rule, (out.get(rule) ?? new Set()).add(rider));
  }
  return out;
}

/** The grudge a rival holds toward the player (the career's table has one row per rival). */
function grudgeOf(grudges: Profile['grudges'], rival: string): number {
  const row = grudges[rival] ?? grudges[bare(rival)] ?? {};
  return Math.max(0, ...Object.values(row).filter((v) => Number.isFinite(v)));
}

/**
 * Each tier boss's rival this season (node id to qualified rival): tier by tier, the region rival
 * with the highest grudge not yet a boss this season; ties go to the boss node's seeded draw. The
 * region boss is left as it is.
 */
function seasonBosses(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  def: CareerDef,
  season: number,
  seed: number,
  grudges: Profile['grudges'],
): Map<string, string> {
  const out = new Map<string, string>();
  const { home } = rosterOf(reg, defs, def);
  const taken = new Set<string>();
  for (let t = 0; t < def.tiers.length; t++) {
    const boss = tierBoss(def, t);
    if (boss === null || boss === def.boss) continue;
    const node = def.nodes.find((n) => n.id === boss);
    const plan = node ? planOf(reg, node.event) : null;
    if (!plan || plan.kind !== 'grudge-match' || !plan.rules.rival) continue;
    const candidates = home.filter((r) => !taken.has(r));
    if (candidates.length === 0) continue;
    const top = Math.max(...candidates.map((r) => grudgeOf(grudges, r)));
    const tied = candidates.filter((r) => grudgeOf(grudges, r) === top);
    const rival = tied.length === 1 ? tied[0] : pick(tied, nodeRolls(seed, boss, season).tie);
    if (!rival) continue;
    taken.add(rival);
    out.set(boss, rival);
  }
  return out;
}

/** Whether an event is a drift event: a required style-cash objective counting drift. */
function isDrift(plan: EventPlan): boolean {
  return plan.objectives.some((o) => {
    const kinds = o.params['kinds'];
    return o.kind === 'style-cash' && o.required && Array.isArray(kinds) && kinds.includes('drift');
  });
}

/** The objectives a swapped node keeps whatever its kind: its optional shortcut and style bonuses. */
function keptBonuses(raw: readonly unknown[]): unknown[] {
  return raw.filter((o) => {
    const x = obj(o);
    return x['required'] !== true && (x['kind'] === 'ride-branch' || x['kind'] === 'style-cash');
  });
}

/** A swapped node's rules, required objective and fewest rivals, by kind (region tier 1 to 4). */
function kindTemplate(
  kind: SwapKind,
  regionTier: number,
  season: number,
  w: number,
): { rules: Json; objective: Json; minField: number } {
  const later = season >= 3 ? 1 : 0;
  switch (kind) {
    case 'takedown-hunt': {
      const count = 2 + Math.floor(regionTier / 2) + later;
      return {
        rules: { targetCount: count, targets: 'any', endOnCount: true },
        objective: { id: 'takedowns', kind: 'takedowns', params: { count }, required: true, rewardCash: w },
        minField: count + 1,
      };
    }
    case 'cop-escape':
      return {
        rules: { escapeBy: 'distance', escapeDistanceM: 2500 + 250 * regionTier, copsFromStart: 2 + later },
        objective: { id: 'escape', kind: 'escape', required: true, rewardCash: w },
        minField: 1,
      };
    case 'classic-race':
      return {
        rules: {},
        objective: { id: 'top-3', kind: 'finish-place', params: { maxPlace: 3 }, required: true },
        minField: CLASSIC_MIN_FIELD,
      };
  }
}

/**
 * A season's remix of one career node (see the header), or null in Season 1. `seed` is the
 * profile's `seasonSeed`, `grudges` its grudge table. app/ applies the patch to the event before
 * anything reads it (`applyEventPatch`); the career reads the patched plan (`seasonRace`).
 */
export function remixPatch(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  def: CareerDef,
  node: CareerNode,
  season: number,
  seed: number,
  grudges: Profile['grudges'],
): EventPatch | null {
  if (season <= 1) return null;
  const plan = planOf(reg, node.event);
  const raw = reg.events[node.event];
  if (!plan || !raw) return null;
  const rolls = nodeRolls(seed, node.id, season);
  const regionTier = node.tier + 1;
  const patch: EventPatch = {};

  // 1. The time of day.
  const light = pick(
    TIMES_OF_DAY.filter((t) => t !== plan.timeOfDay),
    rolls.timeOfDay,
  );
  if (light) patch.timeOfDay = light;
  // 2. The length.
  if (regionTier >= 3 && plan.lengths.some((l) => l.id === 'long') && rolls.long < LONG_SHARE)
    patch.lengthId = 'long';

  const regionBoss = node.id === def.boss;
  const isTierBoss = !regionBoss && tierBoss(def, node.tier) === node.id;
  const rawObjectives = Array.isArray(raw.objectives) ? (raw.objectives as unknown[]) : [];
  if (isTierBoss && plan.kind === 'grudge-match' && plan.rules.rival) {
    // 5. New grudges.
    const old = plan.rules.rival;
    const rival = seasonBosses(reg, defs, def, season, seed, grudges).get(node.id);
    if (rival && rival !== old) {
      const rules: Json = { ...obj(raw.rules), rival };
      const rule = plan.rules.rule;
      if (rule && !ruleOwners(reg).get(rule)?.has(rival)) delete rules['rule'];
      patch.rules = rules;
      patch.riders = [...new Set(plan.field.map((r) => (r === old ? rival : r)))];
      if (!patch.riders.includes(rival)) patch.riders.unshift(rival);
    }
  } else if (!regionBoss && !isTierBoss && plan.kind !== 'grudge-match') {
    // 4. Kind swaps.
    let kind: SwapKind | null = null;
    const from = SWAP_KINDS.find((k) => k === plan.kind);
    if (from && !isDrift(plan) && rolls.swap < SWAP_SHARE)
      kind =
        pick(
          SWAP_KINDS.filter((k) => k !== from),
          rolls.swapTo,
        ) ?? null;
    // 3. The field.
    const { home, guests } = rosterOf(reg, defs, def);
    const template = kind
      ? kindTemplate(kind, regionTier, season, tierPurse(globalTier(defs, def, node.tier)))
      : null;
    const fixedTargets = !kind && Array.isArray(plan.rules.targets);
    const count = Math.max(plan.field.length, template?.minField ?? 0);
    if (count > 0 && !fixedTargets) {
      const guestCount = season >= 3 ? Math.min(2, Math.floor(rolls.guests * 3), guests.length, count) : 0;
      const homeDrawn = shuffled(home, rolls.rest);
      const guestsDrawn = shuffled(guests, rolls.rest).slice(0, guestCount);
      const riders = [...homeDrawn.slice(0, count - guestCount), ...guestsDrawn];
      if (riders.length > 0) patch.riders = riders;
    }
    if (kind && template) {
      patch.kind = kind;
      patch.rules = template.rules;
      patch.objectives = [template.objective, ...keptBonuses(rawObjectives)];
      patch.byPlaceCash = kindPurse(
        kind,
        globalTier(defs, def, node.tier),
        patch.riders?.length ?? plan.field.length,
      );
    }
  }
  // 7. The drift target.
  if (isDrift(plan)) {
    const k = DRIFT_TARGET_PER_SEASON ** (season - 1);
    patch.objectives = rawObjectives.map((o) => {
      const x = obj(o);
      const params = obj(x['params']);
      const kinds = params['kinds'];
      if (
        x['kind'] !== 'style-cash' ||
        x['required'] !== true ||
        !Array.isArray(kinds) ||
        !kinds.includes('drift')
      )
        return o;
      return { ...x, params: { ...params, cash: round50(num(params['cash'], 0) * k) } };
    });
  }
  // 6. Weird events.
  const mods = obj(raw.modifiers);
  if (raw.modifiers) {
    const chance = num(mods['chanceScale'], 1);
    const scale = 1 + 0.5 * (season - 1);
    patch.modifierChanceScale = r3(
      Math.max(1, chance > 0 ? Math.min(scale, MODIFIER_CHANCE_CAP / chance) : scale),
    );
    const max = num(mods['maxPerRace'], 0);
    patch.maxModifiers = Math.max(max, Math.min(MODIFIER_MAX_CAP, max + 1));
  }
  return patch;
}

/**
 * An event file with a season's patch applied (null: the file as it is): its kind, rules,
 * objectives, time of day, field, weird-event chance and count, and prizes by place. The length is
 * the node's, read by `seasonRace`.
 */
export function applyEventPatch<E>(event: E, patch: EventPatch | null): E {
  if (!patch) return event;
  const e: Json = { ...obj(event) };
  if (patch.kind) e['kind'] = patch.kind;
  if (patch.rules) e['rules'] = patch.rules;
  if (patch.objectives) e['objectives'] = patch.objectives;
  if (patch.timeOfDay) e['timeOfDay'] = patch.timeOfDay;
  if (patch.riders) e['field'] = { ...obj(e['field']), riders: patch.riders };
  if (patch.modifierChanceScale !== undefined || patch.maxModifiers !== undefined) {
    const mods = obj(e['modifiers']);
    e['modifiers'] = {
      ...mods,
      ...(patch.modifierChanceScale !== undefined
        ? { chanceScale: r3(num(mods['chanceScale'], 1) * patch.modifierChanceScale) }
        : {}),
      ...(patch.maxModifiers !== undefined ? { maxPerRace: patch.maxModifiers } : {}),
    };
  }
  if (patch.byPlaceCash) e['rewards'] = { ...obj(e['rewards']), byPlaceCash: patch.byPlaceCash };
  return e as E;
}

/** A career node's race this season: the patch (null in Season 1), the plan it reads, its length. */
export interface SeasonRace {
  patch: EventPatch | null;
  plan: EventPlan;
  length: { id: string; route: string } | null;
}

/**
 * The race a career node runs this season, for the map cards, the race setup and the settle: the
 * season's patch, the event plan with it applied, and the length it races.
 */
export function seasonRace(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  profile: Profile,
  def: CareerDef,
  node: CareerNode,
): SeasonRace {
  const patch = remixPatch(reg, defs, def, node, profile.season, profile.seasonSeed, profile.grudges);
  const event = reg.events[node.event];
  const plan =
    patch && event
      ? eventPlan(
          { ...reg, events: { ...reg.events, [node.event]: applyEventPatch(event, patch) } },
          node.event,
        )
      : eventPlan(reg, node.event);
  const length = nodeLength(plan, patch?.lengthId ? { ...node, length: patch.lengthId } : node);
  return { patch, plan, length };
}
