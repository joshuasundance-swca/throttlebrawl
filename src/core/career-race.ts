// The career race contract (playtest 3, the maintainer, 2026-10-03: "The progression doesn't feel
// right. I won a few easy races and then bought the fastest bike. No struggle, no increasing
// difficulty"; round 1: "the field levels up every tier (tier 3 rivals ride bikes as good as your
// best)"; round 2: "Longer + seasons"). The career works out, per race, how strong the field is
// (`FieldLevel`) and, from Season 2 on, how the event is remixed (`EventPatch`); app/'s
// buildSimConfig applies both before anything reads the event. Shared by career/ (which computes
// them) and app/ (which applies them, reaching core through sim/api), so they are written once.
// Types only: a race given neither builds exactly the config it built before.

/**
 * How strong a career race's field is (docs/product-spec.md, "Rivals"). Every scale is a multiplier
 * on what the content files say; 1 leaves a value as it is.
 */
export interface FieldLevel {
  /** The event's pace, m/s: the tier's pace share of the best step-up bike open at that tier. */
  paceMps: number;
  /** The bike every rival rides (qualified bike id), or null to keep each rider file's own. */
  rivalBike: string | null;
  /** The bike the fielded cops ride (qualified), or null to keep their own. */
  copBike: string | null;
  /**
   * The cops' top speed cap, m/s, or null for none: below the best open bike's top, so a player on
   * that bike can always outrun the law on a straight.
   */
  copTopCapMps: number | null;
  /** Multiplies each rival's `healthMax`. */
  healthScale: number;
  /** Multiplies each rival's hit `power`. */
  powerScale: number;
  /** Multiplies each rival's aggression, on top of the difficulty preset (SimEventDef.level). */
  aggressionScale: number;
  /** Multiplies each signature move's `gap` and `spread`: below 1 means more often (SimEventDef.level). */
  signatureGapScale: number;
  /** Multiplies each fielded cop's fine and a citation habit's cash, so the banner and the ledger agree. */
  fineScale: number;
}

/**
 * A season's remix of one career node (Season 2 on; Season 1 is never remixed): the fields of the
 * event file it replaces. Absent fields keep the file's value.
 */
export interface EventPatch {
  kind?: 'classic-race' | 'takedown-hunt' | 'cop-escape' | 'grudge-match';
  /** Replaces the event's `rules` block whole. */
  rules?: Record<string, unknown>;
  /** Replaces the event's `objectives` whole. */
  objectives?: unknown[];
  /** A time of day id (`dawn`, `noon`, `golden-hour`, `dusk`, `night`). */
  timeOfDay?: string;
  /** The rivals in the field, qualified, in grid order. */
  riders?: string[];
  /** The event length to race. */
  lengthId?: string;
  /** Multiplies the event's weird-event `chanceScale`. */
  modifierChanceScale?: number;
  /** Replaces the event's weird-event `maxPerRace`. */
  maxModifiers?: number;
  /** Replaces the event's `rewards.byPlaceCash`. */
  byPlaceCash?: number[];
}

/**
 * What a career tier's `field.rivalBike` asks for [default]: `best`, the best step-up bike open at
 * that tier ("tier 3 rivals ride bikes as good as your best"), or `step-down`, the rank below it.
 */
export const TIER_RIVAL_BIKES = ['best', 'step-down'] as const;
export type TierRivalBike = (typeof TIER_RIVAL_BIKES)[number];

/** The highest season a save holds (docs/architecture.md, "Save format"). */
export const MAX_SEASON = 99;
