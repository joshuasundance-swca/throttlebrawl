// The career map's rules (interview, 2026-10-02, round 4: "Network map, tiered"; round 6: "The
// map": claiming roads, finding secrets and shortcuts, a set-piece finale per region). A region's
// road network is its career map: events sit on its roads; a win claims roads (they glow) and opens
// nearby ones; a tier opens after enough wins in the one before; the boss in the last tier ends
// the region, and free play continues after it. Pure functions over the profile's RegionProgress.
// DOM-free. [default] for the exact gate:
// - a node is open when its tier is open and every node it `requires` is won;
// - a tier opens after `requiredWins` wins in the tier before it (the first tier is always open);
// - a won node stays open to replay (for cash), and once the boss falls every node is open.
import { emptyRegion, type RegionProgress } from '../save';
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

/** Wins in tier `t`. */
export function winsInTier(def: CareerDef, progress: RegionProgress, t: number): number {
  return def.nodes.filter((n) => n.tier === t && progress.won.includes(n.id)).length;
}

/** Whether tier `t` (an index) is open. */
export function tierOpen(def: CareerDef, progress: RegionProgress, t: number): boolean {
  if (t <= 0) return true;
  if (progress.finaleBeaten) return true;
  const before = def.tiers[t - 1];
  if (!before || !tierOpen(def, progress, t - 1)) return false;
  return winsInTier(def, progress, t - 1) >= before.requiredWins;
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
  return node.requires.every((r) => progress.won.includes(r)) ? 'open' : 'locked';
}

/**
 * Why a locked node is locked, in plain words, or null when it is not. `nameOf` names a node (its
 * event's name); the node id by default.
 */
export function lockReason(
  def: CareerDef,
  progress: RegionProgress,
  node: CareerNode,
  nameOf: (nodeId: string) => string = (id) => id,
): string | null {
  if (nodeState(def, progress, node) !== 'locked') return null;
  if (!tierOpen(def, progress, node.tier)) {
    const before = def.tiers[node.tier - 1];
    if (before && tierOpen(def, progress, node.tier - 1)) {
      const left = before.requiredWins - winsInTier(def, progress, node.tier - 1);
      return `Win ${left} more in ${before.name}.`;
    }
    return `Opens with ${def.tiers[node.tier]?.name ?? 'a later tier'}.`;
  }
  const missing = node.requires.filter((r) => !progress.won.includes(r));
  return `Win ${missing.map(nameOf).join(' and ')} first.`;
}

/** The nodes the player can ride now (open, won ones included for replays), in map order. */
export function openNodes(def: CareerDef, progress: RegionProgress): CareerNode[] {
  return def.nodes.filter((n) => nodeState(def, progress, n) !== 'locked');
}

/**
 * The node the career suggests next: the tutorial until it is won, then the first open node not yet
 * won (lowest tier first), the boss once it is open, else null (everything won).
 */
export function suggestedNode(def: CareerDef, progress: RegionProgress): CareerNode | null {
  const fresh = def.nodes.filter((n) => nodeState(def, progress, n) === 'open');
  const tutorial = fresh.find((n) => n.id === def.tutorialNode);
  if (tutorial) return tutorial;
  return [...fresh].sort((a, b) => a.tier - b.tier)[0] ?? null;
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
  next.tier = tierReached(def, next);
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
