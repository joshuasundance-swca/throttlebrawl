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
  // Law with a personality (the pitch deck's #11, run W-T): a cop's habit showing, spoken by him.
  // Sgt. Pruitt stepping it up the longer he chases; Trooper Dalrymple's radar clocking you on a
  // bridge; Deputy Lindqvist writing a citation, and billing them at your finish; Officer Meter's
  // pursuit budget running out; a chasing cop reaching his END OF JURISDICTION sign.
  'cop-relentless',
  'cop-radar',
  'cop-citation',
  'cop-bill',
  'cop-budget-out',
  'cop-jurisdiction',
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
  // Playtest 3 (round 3: "Six bikes"): the Grand Tourer 1100, a heavy touring bike.
  'tourer',
] as const;
export const EVENT_KINDS = ['classic-race', 'takedown-hunt', 'cop-escape', 'grudge-match'] as const;
/**
 * What an event objective asks (W-Q contracts; docs/content-packs.md, "Event"): finish at or above a
 * place (`params.maxPlace`), knock riders down (`params.count`), get away from the cops, finish ahead
 * of or knock down the grudge rival, score style cash (`params.cash`), or ride a route branch
 * (`params.branch`, a `RouteBranch` id).
 */
export const OBJECTIVE_KINDS = [
  'finish-place',
  'takedowns',
  'escape',
  'beat-rival',
  'style-cash',
  'ride-branch',
] as const;
/** What a career map secret is (W-Q: "find secrets and shortcuts"). */
export const SECRET_KINDS = ['shortcut', 'road', 'station', 'stash'] as const;
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

export const AI_STYLES = [
  'heavy-hitter',
  'weaver',
  'showboat',
  'grudge-keeper',
  'scrapper',
  'crowd-pleaser',
  'crew-boss',
  'cop',
  'racer',
] as const;

/**
 * Signature moves (interview, 2026-10-02: "Visible personalities"): the rider file's
 * `personality.signature`, one per rival. The same list as the sim contract's SIGNATURE_IDS (the app
 * tests check they agree; content never imports the sim).
 */
export const SIGNATURE_MOVES = [
  'selfie',
  'wave',
  'bell',
  'counter',
  'lag',
  'ram',
  'slow-burn',
  'sweet-talk',
  'cut-in',
  'timber',
  'pivot',
] as const;

/**
 * A cop's pursuit habit (the pitch deck's #11, "Law with a personality", run W-T): the rider file's
 * `law.habit.kind`. `relentless` closes in harder the longer he chases; `radar` waits at a long
 * bridge and clocks you; `citations` never rams but writes you up while alongside, billed at the
 * finish; `budget` chases on a pursuit budget that runs out. Its other fields are numbers the sim
 * reads by name (docs/content-packs.md, "Rider"). The same list as the sim contract's LAW_HABIT_IDS
 * (the app tests check they agree; content never imports the sim). [default]
 */
export const LAW_HABITS = ['relentless', 'radar', 'citations', 'budget'] as const;
