// Closed vocabularies that pack files name and code interprets (docs/content-packs.md, "The base
// game as pack zero": game code holds the closed vocabularies). A contract, like the rest of this
// folder: the bark trigger list and the fact vocabulary for `when` conditions (docs/content-packs.md,
// "Line fields"). The content lint checks bark files against them; the narrative lane reads them.

/** The closed v1 bark trigger list (docs/content-packs.md, "Line fields"). */
export const BARK_TRIGGERS = [
  'race-start',
  'race-end-win',
  'race-end-lose',
  'overtake',
  'overtaken',
  'alongside-idle',
  'hit-landed',
  'hit-taken',
  'weapon-stolen-by-speaker',
  'weapon-stolen-from-speaker',
  'knocked-down-target',
  'knocked-down-by-target',
  'takedown-into-traffic',
  'near-miss',
  'crash-self',
  'busted',
  'cop-siren',
  'grudge-spotted',
  'gang-up-join',
  'interlude',
  'modifier-start',
] as const;
export type BarkTrigger = (typeof BARK_TRIGGERS)[number];

/** The comparison operators a `when` condition may use (docs/content-packs.md, "Line fields"). */
export const BARK_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'has'] as const;
export type BarkOp = (typeof BARK_OPS)[number];

/** Closed lists that some string facts draw from, shared with the entry schemas. */
export const BIKE_CLASSES = [
  'scooter',
  'moped',
  'dirt',
  'rat',
  'sport',
  'super',
  'chopper',
  'lawnmower',
  'mobility-scooter',
  'golf-cart',
] as const;
export const EVENT_KINDS = ['classic-race', 'takedown-hunt', 'cop-escape', 'grudge-match'] as const;
export const TIMES_OF_DAY = ['dawn', 'noon', 'golden-hour', 'dusk', 'night'] as const;
export const MODIFIER_KINDS = ['nature', 'human', 'wasteland', 'league'] as const;

/**
 * What one fact holds. `memory` facts come from the save (grudges, history, story flags) and count
 * double in specificity scoring (docs/content-packs.md, "Selection algorithm"); until M4 they read
 * from the current race. `range` bounds a number fact, `values` closes a string fact. [default]
 */
export interface BarkFactDecl {
  readonly kind: 'number' | 'boolean' | 'string';
  readonly memory?: boolean;
  readonly range?: readonly [number, number];
  readonly values?: readonly string[];
}

const GRUDGE = { kind: 'number', memory: true, range: [0, 10] } as const;
const COUNT = { kind: 'number', memory: true, range: [0, Number.MAX_SAFE_INTEGER] } as const;
const FRACTION = { kind: 'number', range: [0, 1] } as const;
const PLACE = { kind: 'number', range: [1, Number.MAX_SAFE_INTEGER] } as const;

/** The v1 fact vocabulary for `when` conditions (docs/content-packs.md, "Line fields"). */
export const BARK_FACTS: Readonly<Record<string, BarkFactDecl>> = {
  // Memory (from the save; the current race until M4).
  'grudge.speakerTowardTarget': GRUDGE,
  'grudge.targetTowardSpeaker': GRUDGE,
  'history.takedowns.targetOnSpeaker': COUNT,
  'history.takedowns.speakerOnTarget': COUNT,
  'history.lastRace.targetBeatSpeaker': { kind: 'boolean', memory: true },
  'history.racesTogether': COUNT,
  // Race state.
  'race.progress': FRACTION,
  'race.position.speaker': PLACE,
  'race.position.target': PLACE,
  'speaker.healthFrac': FRACTION,
  'target.healthFrac': FRACTION,
  'speaker.weapon': { kind: 'string' },
  'target.weapon': { kind: 'string' },
  'target.bikeClass': { kind: 'string', values: BIKE_CLASSES },
  'heat.level': FRACTION,
  'modifier.kind': { kind: 'string', values: MODIFIER_KINDS },
  'modifier.id': { kind: 'string' },
  // Setting.
  'event.kind': { kind: 'string', values: EVENT_KINDS },
  'region.id': { kind: 'string' },
  timeOfDay: { kind: 'string', values: TIMES_OF_DAY },
};

/** Story flags: `flags.<name>`, a boolean memory fact, one per name. [default] */
const FLAG_FACT = /^flags\.[A-Za-z0-9][A-Za-z0-9-]*$/;
const FLAG_DECL: BarkFactDecl = { kind: 'boolean', memory: true };

/** The declaration for a fact name, or undefined when the name is not in the vocabulary. */
export function barkFact(name: string): BarkFactDecl | undefined {
  if (Object.hasOwn(BARK_FACTS, name)) return BARK_FACTS[name];
  return FLAG_FACT.test(name) ? FLAG_DECL : undefined;
}
