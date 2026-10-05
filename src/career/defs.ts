// The career files resolved for play (docs/content-packs.md, "Career"; interview, 2026-10-02:
// "Network map, tiered" and "The map"). A career file is one region's map: tiers, event nodes on the
// region's roads, the boss, secrets, the shop and paint. Here every reference is qualified by the
// pack that holds it, tiers become indexes, and the fields the schema keeps loose (paints, the
// ending's lines, a secret's name and cash) are read defensively. DOM-free.
import { packOf, type Career, type ContentRegistry } from '../content';
import { GRUDGE_RULE_IDS, TIER_RIVAL_BIKES, type TierRivalBike } from '../core';
import { OBJECTIVE_KINDS, type ObjectiveSpec, type RaceRules } from './race-log';

/** A reference qualified by the pack that holds it (a bare id names an entry of that pack). */
export const qualify = (pack: string, ref: string): string => (ref.includes(':') ? ref : `${pack}:${ref}`);
/** The id without its pack (`base:florida-keys` -> `florida-keys`). */
export const bare = (ref: string): string => ref.slice(ref.indexOf(':') + 1);

/**
 * A tier's own field level (the career file's `tiers[].field`, playtest 3): each part overrides the
 * career's default for that tier (level.ts); absent parts keep it.
 */
export interface TierField {
  paceShare?: number;
  aggression?: number;
  signatureGap?: number;
  health?: number;
  power?: number;
  rivalBike?: TierRivalBike;
}

export interface CareerTier {
  id: string;
  name: string;
  /**
   * Wins in this tier that open the next one, or, when the tier has a `boss`, that open the boss
   * (the boss's own win is not one of them).
   */
  requiredWins: number;
  /**
   * The tier's boss, a node of this tier (playtest 3: "the boss of each tier must be beaten first"):
   * beating it opens the next tier. Absent on a map from before playtest 3, where wins alone do.
   */
  boss?: string;
  /** Who the boss is, in plain words (the grudge's rival, else its event's name). */
  bossName?: string;
  /** The tier's field level overrides; absent means the career's defaults. */
  field?: TierField;
}

export interface CareerNode {
  id: string;
  /** The event, qualified (`base:keys-t1-shakedown`). */
  event: string;
  /** Which of the event's lengths the node races; null means the event's first. */
  length: string | null;
  /** Index into `tiers`. */
  tier: number;
  /** The map point: a road of the region's networks and the distance along it. */
  road: string;
  s: number;
  requires: readonly string[];
  opens: readonly string[];
  claims: readonly string[];
}

export interface CareerSecret {
  id: string;
  kind: 'shortcut' | 'road' | 'station' | 'stash';
  name: string;
  road: string;
  s: number;
  /** A shortcut's `<route>#<branch>`; a road, station or stash id otherwise; '' when none. */
  ref: string;
  /** Cash found with it (a stash), 0 otherwise. */
  cash: number;
  /**
   * A pirate station's spot as the audio lane places it: a fraction of any route's length (run W-Q's
   * pirate stations), or null. Riding past it in a race in the region finds it.
   */
  atFraction: number | null;
  /**
   * Roads the map leaves undrawn until the secret is found (a loose field, run W-U): a secret
   * `road`'s own roads. The map marks the secret with a '?' there until then.
   */
  hides?: readonly string[];
}

export interface CareerShopItem {
  /** Qualified bike id. */
  bike: string;
  priceCash: number;
  /** Index into `tiers`: the tier that must be open before it is for sale. */
  unlockTier: number;
}

export interface CareerPaint {
  id: string;
  name: string;
  /** The colour, `#rrggbb`. */
  hex: string;
  priceCash: number;
  unlockTier: number;
  /** The first season it is for sale in (playtest 3's season paints); 1 when the file names none. */
  unlockSeason?: number;
}

export interface CareerUnlock {
  /** Qualified bike (or rider) id granted. */
  grant: string;
  kind: 'boss-beaten' | 'event-won';
  /** The boss node id, or a qualified event id. */
  ref: string;
}

export interface CareerEnding {
  /** The teaser's lines (at most 3), shown after the boss falls. */
  lines: readonly string[];
  /** The region it points to (qualified), or null when none is carried yet. */
  next: string | null;
  freePlayAfter: boolean;
}

export interface CareerDef {
  /** The career file, qualified (`base:keys-circuit`). */
  key: string;
  pack: string;
  name: string;
  /** The region, qualified (`base:florida-keys`), and bare (the profile's key, `florida-keys`). */
  regionKey: string;
  regionId: string;
  regionName: string;
  /** The region's chapter, for ordering (1 is the first). */
  chapter: number;
  startingCash: number;
  /** Qualified bike id. */
  startingBike: string;
  /** The tutorial event's node (its prompts teach the controls), or null. */
  tutorialNode: string | null;
  /**
   * The first run's shape as the file writes it. Since playtest 4 nothing reads it: a new device
   * opens on the menu ("Menu first", P4-5), and the career's first race starts from the map like
   * any other. Kept as the seam for a later intro.
   */
  firstRun: 'race-first' | 'intro-first';
  tiers: readonly CareerTier[];
  nodes: readonly CareerNode[];
  boss: string;
  /** Who the region boss is, in plain words ("Mother Rust"): the line that says what opens the next region. */
  bossName?: string;
  secrets: readonly CareerSecret[];
  shop: readonly CareerShopItem[];
  paints: readonly CareerPaint[];
  unlocks: readonly CareerUnlock[];
  ending: CareerEnding;
  /** Roads open from the start: the roads of the first tier's nodes that need no other win. */
  startRoads: readonly string[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const HEX = /^#[0-9a-f]{6}$/i;
const SECRET_KINDS = ['shortcut', 'road', 'station', 'stash'] as const;

/**
 * Who a boss node is, in plain words: its grudge's rival ("Kevin from Accounting"), else its event's
 * name, else the node id.
 */
function bossNameOf(reg: ContentRegistry, nodes: readonly CareerNode[], id: string): string {
  const node = nodes.find((n) => n.id === id);
  if (!node) return id;
  const event = reg.events[node.event];
  const rival = str(obj(event?.rules)['rival']);
  const rider = rival ? obj(reg.riders[qualify(packOf(node.event), rival)]) : {};
  return str(rider['name']) || str(event?.name) || id;
}

/** A tier's `field` block, read defensively (a bad part is dropped), or null when it has none. */
function tierField(v: unknown): TierField | null {
  const raw = obj(v);
  const out: TierField = {};
  const pos = (k: string): number | undefined => {
    const x = raw[k];
    return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined;
  };
  const share = pos('paceShare');
  if (share !== undefined) out.paceShare = Math.min(1, share);
  for (const k of ['aggression', 'signatureGap', 'health', 'power'] as const) {
    const x = pos(k);
    if (x !== undefined) out[k] = x;
  }
  const bike = TIER_RIVAL_BIKES.find((b) => b === raw['rivalBike']);
  if (bike) out.rivalBike = bike;
  return Object.keys(out).length > 0 ? out : null;
}

/** One career file, resolved. `key` is its registry key. */
export function resolveCareer(reg: ContentRegistry, key: string): CareerDef {
  const c = reg.careers[key];
  if (!c) throw new Error(`no career ${key}`);
  return fromFile(reg, key, c);
}

function fromFile(reg: ContentRegistry, key: string, c: Career): CareerDef {
  const pack = packOf(key);
  const loose = c as unknown as Json;
  const regionKey = qualify(pack, c.region);
  const region = obj(reg.regions[regionKey]);
  const tierIds = c.tiers.map((t) => t.id);
  const tierOf = (id: string) => Math.max(0, tierIds.indexOf(id));
  const nodes: CareerNode[] = c.nodes.map((n) => ({
    id: n.id,
    event: qualify(pack, n.event),
    length: n.length ?? null,
    tier: tierOf(n.tier),
    road: n.at.road,
    s: n.at.s,
    requires: [...(n.requires ?? [])],
    opens: [...(n.opens ?? [])],
    claims: [...(n.claims ?? [])],
  }));
  const tiers: CareerTier[] = c.tiers.map((t, i) => {
    const raw = t as unknown as Json;
    const tier: CareerTier = { id: t.id, name: t.name ?? t.id, requiredWins: t.advance.requiredWins };
    // A boss that is no node of this tier gates nothing (the career lint reports it).
    const boss = str(raw['boss']);
    if (nodes.some((n) => n.id === boss && n.tier === i)) {
      tier.boss = boss;
      tier.bossName = bossNameOf(reg, nodes, boss);
    }
    const field = tierField(raw['field']);
    if (field) tier.field = field;
    return tier;
  });
  const tutorialEvent = c.tutorialEvent ? qualify(pack, c.tutorialEvent) : null;
  const secrets: CareerSecret[] = (c.secrets ?? []).map((s) => {
    const raw = s as unknown as Json;
    return {
      id: s.id,
      kind: SECRET_KINDS.find((k) => k === s.kind) ?? 'stash',
      name: str(raw['name'], s.id),
      road: s.at.road,
      s: s.at.s,
      ref: s.ref ?? '',
      cash: Math.max(0, Math.round(num(raw['cash'], 0))),
      hides: list(raw['roads']).filter((r): r is string => typeof r === 'string'),
      atFraction:
        typeof raw['atFraction'] === 'number' && raw['atFraction'] >= 0 && raw['atFraction'] <= 1
          ? raw['atFraction']
          : null,
    };
  });
  const paints: CareerPaint[] = list(loose['paints'])
    .map(obj)
    .filter((p) => typeof p['id'] === 'string' && HEX.test(str(p['hex'])))
    .map((p) => ({
      id: str(p['id']),
      name: str(p['name'], str(p['id'])),
      hex: str(p['hex']).toLowerCase(),
      priceCash: Math.max(0, Math.round(num(p['priceCash'], 0))),
      unlockTier: tierOf(str(p['unlockTier'], tiers[0]?.id ?? '')),
      unlockSeason: Math.max(1, Math.round(num(p['unlockSeason'], 1))),
    }));
  const ending = obj(c.ending);
  const next = str(ending['next']);
  const firstTierFree = nodes.filter((n) => n.tier === 0 && n.requires.length === 0).map((n) => n.road);
  return {
    key,
    pack,
    name: c.name ?? c.id,
    regionKey,
    regionId: c.region.slice(c.region.indexOf(':') + 1),
    regionName: str(region['name'], c.region),
    chapter: num(region['chapter'], Number.MAX_SAFE_INTEGER),
    startingCash: c.startingCash,
    startingBike: qualify(pack, c.startingBike),
    tutorialNode: (tutorialEvent && nodes.find((n) => n.event === tutorialEvent)?.id) ?? null,
    firstRun: c.firstRun ?? 'race-first',
    tiers,
    nodes,
    boss: c.boss,
    bossName: bossNameOf(reg, nodes, c.boss),
    secrets,
    shop: (c.shop ?? []).map((s) => ({
      bike: qualify(pack, s.bike),
      priceCash: s.priceCash,
      unlockTier: tierOf(s.unlockTier),
    })),
    paints,
    unlocks: (c.unlocks ?? []).map((u) => ({
      grant: qualify(pack, u.grant),
      kind: u.when.kind,
      ref: u.when.kind === 'event-won' ? qualify(pack, u.when.ref) : u.when.ref,
    })),
    ending: {
      lines: list(ending['lines'])
        .map((l) => str(l))
        .filter((l) => l.length > 0)
        .slice(0, 3),
      next: next ? qualify(pack, next) : null,
      freePlayAfter: ending['freePlayAfter'] !== false,
    },
    startRoads: [...new Set(firstTierFree)].sort(),
  };
}

/**
 * Every live career the registry carries, one per region, in the regions' chapter order (the Keys
 * first). A region with two careers keeps the first by id.
 */
export function careerDefs(reg: ContentRegistry): CareerDef[] {
  const byRegion = new Map<string, CareerDef>();
  for (const key of Object.keys(reg.careers).sort()) {
    const c = reg.careers[key];
    if (!c) continue;
    const def = fromFile(reg, key, c);
    if (!byRegion.has(def.regionKey)) byRegion.set(def.regionKey, def);
  }
  return [...byRegion.values()].sort((a, b) => a.chapter - b.chapter || (a.regionKey < b.regionKey ? -1 : 1));
}

/** The career of a region (qualified or bare id), or null. */
export function careerOf(defs: readonly CareerDef[], region: string): CareerDef | null {
  return defs.find((d) => d.regionKey === region || d.regionId === region) ?? null;
}

/** A node by id, or null. */
export function nodeOf(def: CareerDef, id: string): CareerNode | null {
  return def.nodes.find((n) => n.id === id) ?? null;
}

/** What a career race needs from its event file: its name, kind, rules, objectives and prizes. */
export interface EventPlan {
  /** Qualified. */
  key: string;
  name: string;
  kind: RaceRules['kind'];
  rules: RaceRules;
  objectives: ObjectiveSpec[];
  /** The career tier the event belongs to (1 = the first). */
  tier: number;
  finale: boolean;
  byPlaceCash: readonly number[];
  timeOfDay: string;
  /** Length ids with their routes (qualified). */
  lengths: readonly { id: string; route: string }[];
  /** The rivals in the field (qualified). */
  field: readonly string[];
}

const KINDS = ['classic-race', 'takedown-hunt', 'cop-escape', 'grudge-match'] as const;
const RULE_NUMBERS = [
  'targetCount',
  'timeLimitS',
  'escapeDistanceM',
  'surviveS',
  'knockdownsToWin',
  'grudgeStakes',
] as const;

/** An event file read for the career (rules by kind; rider references qualified in its pack). */
export function eventPlan(reg: ContentRegistry, key: string): EventPlan {
  const e = reg.events[key];
  if (!e) throw new Error(`no event ${key}`);
  const pack = packOf(key);
  const raw = obj(e.rules);
  const rules: RaceRules = { kind: KINDS.find((k) => k === e.kind) ?? 'classic-race' };
  for (const k of RULE_NUMBERS) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) rules[k] = v;
  }
  if (raw['endOnCount'] === true) rules.endOnCount = true;
  if (raw['escapeBy'] === 'distance' || raw['escapeBy'] === 'survive') rules.escapeBy = raw['escapeBy'];
  if (raw['winBy'] === 'finish-ahead' || raw['winBy'] === 'knockdowns') rules.winBy = raw['winBy'];
  // The rival's own rule (run W-T): only on a grudge match, from the closed list.
  const rule = GRUDGE_RULE_IDS.find((g) => g === raw['rule']);
  if (rule && rules.kind === 'grudge-match') rules.rule = rule;
  if (typeof raw['rival'] === 'string') rules.rival = qualify(pack, raw['rival']);
  if (Array.isArray(raw['targets'])) rules.targets = raw['targets'].map((t) => qualify(pack, str(t)));
  else if (raw['targets'] === 'any') rules.targets = 'any';
  const objectives: ObjectiveSpec[] = e.objectives.map((o) => ({
    id: o.id,
    kind: OBJECTIVE_KINDS.find((k) => k === o.kind) ?? 'finish-place',
    required: o.required,
    rewardCash: Math.round(o.rewardCash ?? 0),
    params: obj((o as unknown as Json)['params']),
  }));
  return {
    key,
    name: e.name ?? e.id,
    kind: rules.kind,
    rules,
    objectives,
    tier: e.tier ?? 1,
    finale: e.finale === true,
    byPlaceCash: e.rewards.byPlaceCash,
    timeOfDay: e.timeOfDay,
    lengths: e.lengths.map((l) => ({ id: l.id, route: qualify(pack, l.route) })),
    field: (e.field.riders ?? []).map((r) => qualify(pack, r)),
  };
}

/** The length a node races: its own, else the event's first. */
export function nodeLength(plan: EventPlan, node: CareerNode | null): { id: string; route: string } | null {
  return plan.lengths.find((l) => l.id === node?.length) ?? plan.lengths[0] ?? null;
}
