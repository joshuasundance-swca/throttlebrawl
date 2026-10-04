// The career map's rules (interview, 2026-10-02, round 4: "Network map, tiered"; round 6: "The
// map": claiming roads, finding secrets and shortcuts, a set-piece finale per region). A region's
// road network is its career map: events sit on its roads; a win claims roads (they glow) and opens
// nearby ones; a tier opens after enough wins in the one before; the boss in the last tier ends
// the region, and free play continues after it. Pure functions over the profile's RegionProgress.
// DOM-free. [default] for the exact gate:
// - a node is open when its tier is open and every node it `requires` is won;
// - a tier opens after `requiredWins` wins in the tier before it (the first tier is always open);
// - a won node stays open to replay (for cash), and once the boss falls every node is open.
//
// Playtest 3 (the maintainer, 2026-10-03: "I won a few easy races and then bought the fastest bike.
// No struggle"; round 1: "the boss of each tier must be beaten first"; round 3: regions "In order:
// the Keys first, the PNW after the Keys boss, SF after the PNW boss; places already raced stay
// open"), [default] for the exact gate:
// - a tier that names a `boss`: its `requiredWins` wins among its other nodes open the boss, and
//   only the boss's win opens the next tier (the last tier's boss is the region's);
// - the profile's `tier` is a high-water mark: a tier once open stays open, so no save loses one;
// - a region opens when the previous chapter's region boss has fallen, or once a career race was
//   played there this season (a won node, or a result from one of its nodes).
import { emptyRegion, type Profile, type RegionProgress } from '../save';
import type { CareerDef, CareerNode } from './defs';

export type NodeState = 'locked' | 'open' | 'won';

/** A region's progress, or a fresh one with the region's start roads open. */
export function progressOf(
  def: CareerDef,
  regions: Readonly<Record<string, RegionProgress>>,
): RegionProgress {
  const p = regions[def.regionId];
  if (p) return p;
  return { ...emptyRegion(), unlockedRoads: [...def.startRoads] };
}

/** Tier `t`'s boss node id (a node of that tier), or null when the tier names none. */
export function tierBoss(def: CareerDef, t: number): string | null {
  const boss = def.tiers[t]?.boss;
  return boss !== undefined && def.nodes.some((n) => n.id === boss && n.tier === t) ? boss : null;
}

/** Whether a node is its tier's boss (the region boss is the last tier's) or the region boss. */
export function isBossNode(def: CareerDef, node: CareerNode): boolean {
  return node.id === def.boss || tierBoss(def, node.tier) === node.id;
}

/** Wins in tier `t`, its boss not counted (the wins that open the boss). */
export function winsInTier(def: CareerDef, progress: RegionProgress, t: number): number {
  const boss = tierBoss(def, t);
  return def.nodes.filter((n) => n.tier === t && n.id !== boss && progress.won.includes(n.id)).length;
}

/** Wins tier `t` still needs before its boss (or, with no boss, the next tier) opens. */
const winsLeft = (def: CareerDef, progress: RegionProgress, t: number): number =>
  Math.max(0, (def.tiers[t]?.requiredWins ?? 0) - winsInTier(def, progress, t));

/** Whether tier `t` (an index) is open. */
export function tierOpen(def: CareerDef, progress: RegionProgress, t: number): boolean {
  if (t <= 0) return true;
  if (progress.finaleBeaten) return true;
  // The high-water mark: the profile counts tiers from 1, so index t is open below it.
  if (t < progress.tier) return true;
  if (!def.tiers[t - 1] || !tierOpen(def, progress, t - 1)) return false;
  const boss = tierBoss(def, t - 1);
  if (boss !== null) return progress.won.includes(boss);
  return winsLeft(def, progress, t - 1) === 0;
}

/** The highest open tier, as the profile counts it (1 = the first). */
export function tierReached(def: CareerDef, progress: RegionProgress): number {
  let t = 0;
  while (t + 1 < def.tiers.length && tierOpen(def, progress, t + 1)) t++;
  return t + 1;
}

export function nodeState(def: CareerDef, progress: RegionProgress, node: CareerNode): NodeState {
  if (progress.won.includes(node.id)) return 'won';
  if (progress.finaleBeaten) return 'open';
  if (!tierOpen(def, progress, node.tier)) return 'locked';
  if (tierBoss(def, node.tier) === node.id && winsLeft(def, progress, node.tier) > 0) return 'locked';
  return node.requires.every((r) => progress.won.includes(r)) ? 'open' : 'locked';
}

/**
 * Why a locked node is locked, in plain words, or null when it is not. `nameOf` names a node (its
 * event's name); the node id by default. A tier boss is named by its tier's `bossName`.
 */
export function lockReason(
  def: CareerDef,
  progress: RegionProgress,
  node: CareerNode,
  nameOf: (nodeId: string) => string = (id) => id,
): string | null {
  if (nodeState(def, progress, node) !== 'locked') return null;
  const t = node.tier;
  if (!tierOpen(def, progress, t)) {
    const before = def.tiers[t - 1];
    if (before && tierOpen(def, progress, t - 1)) {
      const left = winsLeft(def, progress, t - 1);
      const boss = tierBoss(def, t - 1);
      if (boss === null) return `Win ${left} more in ${before.name}.`;
      const who = before.bossName || nameOf(boss);
      return left > 0
        ? `Win ${left} more in ${before.name}, then beat ${who}.`
        : `Beat ${who} in ${before.name}.`;
    }
    return `Opens with ${def.tiers[t]?.name ?? 'a later tier'}.`;
  }
  if (tierBoss(def, t) === node.id && winsLeft(def, progress, t) > 0)
    return `Win ${winsLeft(def, progress, t)} more in ${def.tiers[t]?.name ?? 'this tier'}.`;
  const missing = node.requires.filter((r) => !progress.won.includes(r));
  return `Win ${missing.map(nameOf).join(' and ')} first.`;
}

/** The nodes the player can ride now (open, won ones included for replays), in map order. */
export function openNodes(def: CareerDef, progress: RegionProgress): CareerNode[] {
  return def.nodes.filter((n) => nodeState(def, progress, n) !== 'locked');
}

/**
 * The node the career suggests next: the tutorial until it is won, then the first open node not yet
 * won (lowest tier first, a tier's regular events before its boss), else null (everything won).
 */
export function suggestedNode(def: CareerDef, progress: RegionProgress): CareerNode | null {
  const fresh = def.nodes.filter((n) => nodeState(def, progress, n) === 'open');
  const tutorial = fresh.find((n) => n.id === def.tutorialNode);
  if (tutorial) return tutorial;
  const rank = (n: CareerNode) => n.tier * 2 + Number(isBossNode(def, n));
  return [...fresh].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * Whether a region's map is open (playtest 3, round 3: regions "In order"): the first chapter
 * always; a later one once the previous chapter's region boss has fallen, or once a career race was
 * played there this season. `defs` are in chapter order (careerDefs).
 */
export function regionOpen(defs: readonly CareerDef[], profile: Profile, def: CareerDef): boolean {
  const i = defs.findIndex((d) => d.key === def.key);
  const before = defs[i - 1];
  if (i <= 0 || !before) return true;
  if (progressOf(before, profile.regions).finaleBeaten) return true;
  if (progressOf(def, profile.regions).won.length > 0) return true;
  const season = profile.season;
  return profile.history.some(
    (r) => r.region === def.regionId && r.node !== null && (r.season ?? 1) === season,
  );
}

/** Why a region's map is shut ("Opens when Mother Rust falls."), or null when it is open. */
export function regionLockReason(
  defs: readonly CareerDef[],
  profile: Profile,
  def: CareerDef,
): string | null {
  if (regionOpen(defs, profile, def)) return null;
  const before = defs[defs.findIndex((d) => d.key === def.key) - 1];
  const who = before?.bossName || `${before?.regionName ?? 'the last region'}'s boss`;
  return `Opens when ${who} falls.`;
}

/**
 * Why a career race at `node` may not start, in plain words, or null when it may (playtest 3, round
 * 3: regions "In order"; the wave A live check rode a shut region's events). The one gate of the
 * ride path, so no button (Ride, Next, Race it again, a restart) can bypass it: the region's map
 * must be open (regionOpen), and the node open or won (nodeState, which is per region and so cannot
 * see the chapter order alone). `nameOf` names a node, as lockReason does.
 */
export function rideRefusal(
  defs: readonly CareerDef[],
  profile: Profile,
  def: CareerDef,
  node: CareerNode,
  nameOf: (nodeId: string) => string = (id) => id,
): string | null {
  const shut = regionLockReason(defs, profile, def);
  if (shut !== null) return shut;
  return lockReason(def, progressOf(def, profile.regions), node, nameOf);
}

export interface WinApplied {
  progress: RegionProgress;
  /** True when this node was not won before. */
  firstWin: boolean;
  opened: string[];
  claimed: string[];
  /** The tier names that opened with this win. */
  tiersOpened: string[];
  /** The boss fell for the first time. */
  finale: boolean;
}

const addAll = (into: readonly string[], more: readonly string[]) => [...new Set([...into, ...more])].sort();

/** The progress after winning `node`: it is won, its roads open and are claimed, tiers may open. */
export function applyWin(def: CareerDef, progress: RegionProgress, node: CareerNode): WinApplied {
  const firstWin = !progress.won.includes(node.id);
  const tiersBefore = def.tiers.map((_, t) => tierOpen(def, progress, t));
  const opened = node.opens.filter((r) => !progress.unlockedRoads.includes(r));
  // A claimed road is the player's on the map, and open for free play too.
  const claimed = [...node.claims, node.road].filter((r) => !progress.claimedRoads.includes(r));
  const isBoss = node.id === def.boss;
  const next: RegionProgress = {
    ...progress,
    won: addAll(progress.won, [node.id]),
    unlockedRoads: addAll(progress.unlockedRoads, [...node.opens, ...node.claims, node.road]),
    claimedRoads: addAll(progress.claimedRoads, [...node.claims, node.road]),
    finaleBeaten: progress.finaleBeaten || isBoss,
  };
  next.tier = Math.max(progress.tier, tierReached(def, next));
  const tiersOpened = def.tiers
    .filter((_, t) => !tiersBefore[t] && tierOpen(def, next, t) && !(isBoss && !progress.finaleBeaten))
    .map((t) => t.name);
  return {
    progress: next,
    firstWin,
    opened: [...new Set(opened)].sort(),
    claimed: [...new Set(claimed)].sort(),
    tiersOpened,
    finale: isBoss && !progress.finaleBeaten,
  };
}

/** Counts for the map's header: nodes won of all, roads claimed, secrets found. */
export function mapTally(def: CareerDef, progress: RegionProgress) {
  const shortcuts = def.secrets.filter((s) => s.kind === 'shortcut');
  return {
    won: def.nodes.filter((n) => progress.won.includes(n.id)).length,
    nodes: def.nodes.length,
    claimed: progress.claimedRoads.length,
    secretsFound: def.secrets.filter((s) => progress.secrets.includes(s.id)).length,
    secrets: def.secrets.length,
    shortcutsFound: shortcuts.filter((s) => progress.secrets.includes(s.id)).length,
    shortcuts: shortcuts.length,
  };
}
