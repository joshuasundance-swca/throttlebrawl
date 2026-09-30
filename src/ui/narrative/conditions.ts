// Bark `when` conditions and specificity (docs/content-packs.md, "Line fields" and "Selection
// algorithm"). A condition is `{ fact, op, value }` over a closed fact list: no free-form
// expressions, so mods stay safe. Every condition must hold for a line to play.
//
// Unknown values never match: a fact the game cannot answer yet (the career memory facts before
// M4, a setting the app has not passed) makes its condition fail, whatever the op, so a line that
// needs it stays quiet instead of playing out of context. A malformed `when` drops the line.

import { BARK_OPS, barkFact, type BarkOp } from '../../content';

/** The `op` values a condition may use: content/'s closed list, the one packs:check lints against. */
export const CONDITION_OPS = BARK_OPS;
export type ConditionOp = BarkOp;

export interface BarkCondition {
  readonly fact: string;
  readonly op: ConditionOp;
  readonly value: unknown;
}

/** What a fact resolves to; `undefined` is "the game does not know", which never matches. */
export type FactValue = number | string | boolean | null | readonly (string | number)[] | undefined;

/** Answers facts for one speaker and target. */
export type FactResolver = (fact: string) => FactValue;

/**
 * True for a fact in content/'s vocabulary (src/content/schema/vocab.ts), story flags included.
 * The narrative reads the same registry the pack lint checks, so the two never disagree.
 */
export function isKnownFact(fact: string): boolean {
  return barkFact(fact) !== undefined;
}

/** Memory facts: grudges, history and story flags (the ones that weigh 1.0 more in specificity). */
export function isMemoryFact(fact: string): boolean {
  return barkFact(fact)?.memory === true;
}

const isOp = (v: unknown): v is ConditionOp =>
  typeof v === 'string' && (CONDITION_OPS as readonly string[]).includes(v);

/**
 * Reads a line's `when` field. Absent means no conditions; anything malformed (not an array, an
 * entry without a string fact, an unknown op, an unknown fact) returns null and drops the line.
 */
export function conditionsFrom(raw: unknown): BarkCondition[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: BarkCondition[] = [];
  for (const c of raw as unknown[]) {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return null;
    const { fact, op, value } = c as Record<string, unknown>;
    if (typeof fact !== 'string' || !isKnownFact(fact) || !isOp(op) || value === undefined) return null;
    if (op === 'in' && !Array.isArray(value)) return null;
    out.push({ fact, op, value });
  }
  return out;
}

/** A bare content id in a condition refers to the line's own pack, like every bare id. */
function sameId(factValue: string, condValue: string, packId: string): boolean {
  if (factValue === condValue) return true;
  return factValue.includes(':') && !condValue.includes(':') && factValue === `${packId}:${condValue}`;
}

function equal(a: unknown, b: unknown, packId: string): boolean {
  if (typeof a === 'string' && typeof b === 'string') return sameId(a, b, packId);
  return a === b;
}

/** Evaluates one condition against a known fact value. */
export function conditionHolds(cond: BarkCondition, value: FactValue, packId = 'base'): boolean {
  if (value === undefined) return false;
  const v = cond.value;
  switch (cond.op) {
    case 'eq':
      return equal(value, v, packId);
    case 'neq':
      return !equal(value, v, packId);
    case 'gt':
      return typeof value === 'number' && typeof v === 'number' && value > v;
    case 'gte':
      return typeof value === 'number' && typeof v === 'number' && value >= v;
    case 'lt':
      return typeof value === 'number' && typeof v === 'number' && value < v;
    case 'lte':
      return typeof value === 'number' && typeof v === 'number' && value <= v;
    case 'in':
      return Array.isArray(v) && (v as unknown[]).some((x) => equal(value, x, packId));
    case 'has':
      return Array.isArray(value) && (value as readonly unknown[]).some((x) => equal(x, v, packId));
    default:
      return false;
  }
}

/** How many conditions matched, and how many of those were memory facts. */
export interface ConditionMatch {
  matched: number;
  memory: number;
}

/** All conditions hold: the counts for specificity. Any failure: null. */
export function matchConditions(
  conds: readonly BarkCondition[],
  facts: FactResolver | undefined,
  packId = 'base',
): ConditionMatch | null {
  let memory = 0;
  for (const c of conds) {
    if (!conditionHolds(c, facts?.(c.fact), packId)) return null;
    if (isMemoryFact(c.fact)) memory++;
  }
  return { matched: conds.length, memory };
}

/**
 * `specificity = 1 + 0.5 × (matched when-conditions) + 1.0 × (matched memory conditions)`, ×1.5
 * when the line names an exact rider rather than a selector (docs/content-packs.md, "Selection
 * algorithm", read literally: a memory condition counts in both terms, 1.5 in all). [default]
 */
export function specificity(match: ConditionMatch, exactSpeaker: boolean): number {
  const base = 1 + 0.5 * match.matched + 1.0 * match.memory;
  return exactSpeaker ? base * 1.5 : base;
}

/** `novelty = 0.5 ^ (times heard)`, floored at 0.05. */
export function novelty(timesHeard: number): number {
  return Math.max(0.05, 0.5 ** Math.max(0, timesHeard));
}
