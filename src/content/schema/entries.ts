// Zod schemas for the M1 minimum (docs/content-packs.md, "What M1 needs"). Each type's fields
// follow its section in that doc; everything beyond the M1 minimum is optional or passes through.
// The reserved types (event-modifier, station, patch) are claimed here so nothing else takes the
// names; cross-file rules live in the content lint (src/content/lint.ts).
import { z } from 'zod';
import {
  BARRIER_LOOKS,
  GRUDGE_RULE_IDS,
  MAX_HEIGHT_M,
  MAX_SEASON,
  MEDIAN_KINDS,
  ROAD_SURFACES,
  ROUTE_BRANCH_KINDS,
  SMASHABLE_KINDS,
  TIER_RIVAL_BIKES,
  VERGE_EDGES,
  VERGE_SURFACES,
} from '../../core';
import { entry, idSchema, nonNegative, refSchema, statusSchema, unit01 } from './common';
import {
  AI_STYLES,
  BARK_OPS,
  BIKE_CLASSES,
  EVENT_KINDS,
  LAW_HABITS,
  MODIFIER_KINDS,
  OBJECTIVE_KINDS,
  SECRET_KINDS,
  SIGNATURE_MOVES,
  TIMES_OF_DAY,
} from './vocab';

/**
 * A synth engine patch (docs/content-packs.md, "Bike"): a preset name from audio's code-made patches,
 * shaped by optional numbers that audio clamps. Presentation-only.
 */
export const engineSoundSchema = z.looseObject({ preset: z.string() });

export const packSchema = z.looseObject({
  type: z.literal('pack'),
  id: idSchema,
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'must be a semantic version'),
  formatVersion: z.number().int().min(1),
  gameVersion: z.string().optional(),
  description: z.string().optional(),
  authors: z.array(z.string()).optional(),
  license: z.string(),
  licenseRules: z
    .array(
      z.looseObject({
        paths: z.array(z.string()).min(1),
        spdx: z.string(),
        attribution: z.string(),
        licenseFile: z.string().optional(),
      }),
    )
    .optional(),
  assetSources: z
    .looseObject({
      default: z.enum(['baked', 'remote']),
      rules: z.array(z.looseObject({ match: z.string(), source: z.enum(['baked', 'remote']) })),
    })
    .optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  defaults: z.looseObject({
    tuning: z.string(),
    hud: z.string(),
    look: z.string().optional(),
    /**
     * The engine voice of each bike class a rider is drawn on (`look.bikeClass`; playtest 2,
     * 2026-10-02: "a voice per bike"). A drawn class's voice replaces the sim bike's own
     * `engineSound`; a class with no entry keeps it. Only base's is read, like the rest of `defaults`.
     */
    engineSoundByClass: z.partialRecord(z.enum(BIKE_CLASSES), engineSoundSchema).optional(),
  }),
  idAliases: z.record(z.string(), z.string()).optional(),
});

/**
 * A height in metres (docs/content-packs.md, "Heights and hitboxes"): above zero and below
 * `MAX_HEIGHT_M`, a bound that catches a typo (a stair tower is 6.4 m, a tram 3.5 m).
 */
const heightSchema = z.number().positive().max(MAX_HEIGHT_M);

/**
 * A rider's contact box on its bike, in metres (docs/content-packs.md, "Heights and hitboxes"):
 * length along the heading and width across. Absent, the box is `DEFAULT_HITBOX` (2.0 x 0.8).
 */
const hitboxSchema = z.looseObject({
  lengthM: z.number().min(0.5).max(4),
  widthM: z.number().min(0.3).max(3),
});

/** A vetoable item inside an entry: a sign, a billboard, a bark line or a station track. */
const itemStatus = { status: statusSchema.optional(), note: z.string().optional() };

/** A sign or billboard in a region file (docs/content-packs.md, "Region"). */
const signSchema = z.looseObject({
  id: idSchema,
  text: z.string().min(1),
  tags: z.array(z.string()).optional(),
  imageAsset: z.string().optional(),
  ...itemStatus,
});

/**
 * A roadside smashable in a region file (docs/content-packs.md, "Region"; run W-T, "the road fights
 * back"): a kind from the closed list, its takedown name (a short headline in capitals, read in a
 * blink), how often it is picked, and the road tags it stands on (absent: any open road).
 */
const smashableSchema = z.looseObject({
  id: idSchema,
  kind: z.enum(SMASHABLE_KINDS),
  text: z.string().min(1).max(32),
  // Overrides the kind's drawn height (`SMASHABLE_HEIGHT_M`).
  heightM: heightSchema.optional(),
  weight: z.number().positive().optional(),
  tags: z.array(z.string().min(1)).optional(),
  ...itemStatus,
});

export const bikeSchema = entry('bike', {
  class: z.enum(BIKE_CLASSES),
  // The rider's contact box on this bike where it is not the default 2.0 x 0.8 (the lawnmower).
  hitbox: hitboxSchema.optional(),
  handling: z.looseObject({
    topSpeedMps: z.number().positive(),
    accelMps2: z.number().positive(),
    brakeMps2: z.number().positive(),
    steerRateMps: z.number().positive(),
    massKg: z.number().positive(),
    grip: unit01.optional(),
    airControl: unit01.optional(),
    wobble: unit01.optional(),
  }),
  combat: z
    .looseObject({ hitPowerScale: z.number().optional(), knockbackResistance: unit01.optional() })
    .optional(),
  engineSound: engineSoundSchema,
});

export const riderSchema = entry('rider', {
  role: z.enum(['rival', 'cop', 'player-preset', 'extra']),
  roster: z.enum(['regular', 'local']).optional(),
  region: idSchema.optional(),
  crew: refSchema.optional(),
  blurb: z.string().optional(),
  bike: refSchema,
  // The contact box when this rider's drawn bike (`look.bikeModel`) is not the default size; it
  // overrides the sim bike's own `hitbox`.
  hitbox: hitboxSchema.optional(),
  stats: z
    .looseObject({
      massKg: z.number().positive().optional(),
      healthMax: z.number().positive().optional(),
      skill: unit01.optional(),
      // Fight stats (playtest 2, "Visible personalities"): moderate multipliers, 1 when absent.
      // toughness divides the damage and the stagger this rider takes; power multiplies the
      // damage of every hit it lands. [default]
      toughness: z.number().min(0.5).max(2).optional(),
      power: z.number().min(0.5).max(2).optional(),
    })
    .optional(),
  startingWeapon: refSchema.optional(),
  personality: z
    .looseObject({ style: z.enum(AI_STYLES), signature: z.enum(SIGNATURE_MOVES).optional() })
    .optional(),
  law: z
    .looseObject({
      agency: refSchema,
      bustRadiusM: z.number().positive(),
      bustDwellS: z.number().positive(),
      fineCash: z.number().int().min(0),
      pursuitSpeedScale: z.number().positive(),
      habit: z
        .looseObject({ kind: z.enum(LAW_HABITS) })
        .catchall(z.number().nonnegative())
        .optional(),
    })
    .optional(),
});

export const weaponSchema = entry('weapon', {
  category: z.enum(['unarmed', 'blunt', 'chain', 'junk', 'shock', 'improvised']),
  behaviour: z.string(),
  unarmed: z.boolean(),
  reach: z.looseObject({ sM: z.number().positive(), dM: z.number().positive() }),
  windupS: nonNegative,
  activeS: z.number().positive(),
  recoveryS: nonNegative,
  cooldownS: nonNegative.optional(),
  damage: nonNegative,
  knockback: z
    .looseObject({ lateralMps: nonNegative, staggerS: nonNegative, takedownBonus: unit01.optional() })
    .optional(),
  hitStopMs: nonNegative.optional(),
  steal: z
    .looseObject({ allowed: z.boolean(), windowStartS: nonNegative, windowEndS: nonNegative })
    .optional(),
});

/** A whole-cash amount. */
const cash = z.number().int().min(0);

/**
 * The `rules` block by event kind (docs/content-packs.md, "Event"): every field optional here, and
 * the event's refinement below asks for the ones its `kind` needs.
 */
const eventRulesSchema = z.looseObject({
  // takedown-hunt
  targetCount: z.number().int().min(1).optional(),
  timeLimitS: z.number().positive().optional(),
  targets: z.union([z.literal('any'), z.array(refSchema)]).optional(),
  endOnCount: z.boolean().optional(),
  // cop-escape
  escapeBy: z.enum(['distance', 'survive']).optional(),
  escapeDistanceM: z.number().positive().optional(),
  surviveS: z.number().positive().optional(),
  startHeat: unit01.optional(),
  copsFromStart: z.number().int().min(0).optional(),
  // grudge-match
  rival: refSchema.optional(),
  winBy: z.enum(['finish-ahead', 'knockdowns']).optional(),
  knockdownsToWin: z.number().int().min(1).optional(),
  grudgeStakes: z.number().int().min(0).optional(),
  // Run W-T (the pitch deck's #14, "grudges with rules"): the rival's own rule, from core's closed
  // list (`audit`, `bad-connection`, `collab`, `timber`). Only a grudge match may carry one.
  rule: z.enum(GRUDGE_RULE_IDS).optional(),
});

/** The rules fields an event kind needs (W-Q contracts: the career's four event types). */
const RULES_NEEDED: Readonly<Record<(typeof EVENT_KINDS)[number], (r: Record<string, unknown>) => string[]>> =
  {
    'classic-race': () => [],
    'takedown-hunt': () => ['targetCount'],
    'cop-escape': (r) => ['escapeBy', r['escapeBy'] === 'survive' ? 'surviveS' : 'escapeDistanceM'],
    'grudge-match': (r) => ['rival', 'winBy', ...(r['winBy'] === 'knockdowns' ? ['knockdownsToWin'] : [])],
  };

export const eventSchema = entry('event', {
  kind: z.enum(EVENT_KINDS),
  region: idSchema,
  timeOfDay: z.enum(TIMES_OF_DAY),
  // Playtest 4 (the identity sheets, cause 10): the weather this event's own light is drawn in, when
  // it differs from what the light does by itself (a region time-of-day option's palette `rain`).
  // Render only: it never reaches the sim, so it is out of the sim hash.
  weather: z.enum(['dry', 'rain']).optional(),
  lengths: z.array(z.looseObject({ id: idSchema, route: refSchema, laps: z.number().int().min(1) })).min(1),
  field: z.looseObject({
    riders: z.array(refSchema).optional(),
    rubberband: unit01.optional(),
    paceMps: z.number().positive().optional(),
  }),
  cops: z.looseObject({ mode: z.enum(['none', 'every-race', 'tier-rising', 'chaos-summoned']) }),
  rules: eventRulesSchema,
  objectives: z
    .array(
      z.looseObject({
        id: idSchema,
        kind: z.enum(OBJECTIVE_KINDS),
        required: z.boolean(),
        rewardCash: z.number().int().optional(),
      }),
    )
    .min(1),
  // W-Q career (interview, 2026-10-02: a tiered network map per region, a finale per region): the
  // career tier the event belongs to (1 = the first), and whether it is a region's finale (the boss).
  tier: z.number().int().min(1).max(9).optional(),
  finale: z.boolean().optional(),
  // The style fields are optional and default to 0, so adding them is not a format bump
  // (docs/content-packs.md, "Event"; M2 content-2).
  rewards: z.looseObject({
    byPlaceCash: z.array(cash),
    perTakedownCash: cash.optional(),
    perNearMissCash: cash.optional(),
    perAirtimeCash: cash.optional(),
    perOncomingSecondCash: cash.optional(),
    takedownComboScale: nonNegative.optional(),
    perStealCash: cash.optional(),
    // Playtest 3's moves ("a way to do wheelies"; the drift as "a first class experience"): a clean
    // wheelie's and a banked drift's cash per second. Absent: 2 and 3 times the oncoming rate
    // [default] (app/config.ts).
    perWheelieSecondCash: cash.optional(),
    perDriftSecondCash: cash.optional(),
  }),
  modifiers: z
    .looseObject({
      pool: z.union([z.literal('region-default'), z.array(refSchema)]),
      maxPerRace: z.number().int().min(0),
      chanceScale: nonNegative.optional(),
    })
    .optional(),
}).superRefine((e, ctx) => {
  const rules = e.rules as Record<string, unknown>;
  for (const field of RULES_NEEDED[e.kind](rules)) {
    if (rules[field] === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['rules', field],
        message: `a ${e.kind} event needs rules.${field}`,
      });
  }
  if (rules['rule'] !== undefined && e.kind !== 'grudge-match')
    ctx.addIssue({
      code: 'custom',
      path: ['rules', 'rule'],
      message: 'only a grudge-match event plays by a rival rule (rules.rule)',
    });
});

/**
 * A barrier span along a road (docs/content-packs.md, "Road file"; M2 content-2): a `rail` lets a
 * tumble body above `heightM` cross it, a `wall` does not. Water is the region's sea level, world
 * y = 0, so there is no per-road water height. The road lint checks the span lies inside the road.
 * Playtest 3: a `wall` may be `jumpable` (an airborne rider above it flies over: the static ramp
 * trucks' shortcuts), and any barrier may draw with a `look` (`railing`: the Golden Gate's).
 */
export const barrierSchema = z
  .looseObject({
    s0: nonNegative,
    s1: nonNegative,
    side: z.enum(['left', 'right', 'both']),
    kind: z.enum(['rail', 'wall']),
    heightM: z.number().positive(),
    jumpable: z.boolean().optional(),
    look: z.enum(BARRIER_LOOKS).optional(),
  })
  .refine((b) => b.s1 > b.s0, { message: 's1 must be past s0', path: ['s1'] })
  .refine((b) => b.jumpable !== true || b.kind === 'wall', {
    message: 'only a wall barrier can be jumpable',
    path: ['jumpable'],
  });

const laneSchema = z.looseObject({
  id: z.string(),
  dCenterM: z.number(),
  widthM: z.number().positive(),
  direction: z.union([z.literal(1), z.literal(-1)]),
  kind: z.enum(['drive', 'shoulder', 'shortcut']),
});

/**
 * A verge band beside the road (W-Q cross-section; interview, 2026-10-02: "Anywhere with ground"):
 * `widthM` of `surface` past the outermost lane, ending at an `edge`. 0 m means the road's own edge
 * is the edge. A side a section leaves out is derived from the road's tags and barriers at runtime.
 */
export const vergeSchema = z.looseObject({
  widthM: z.number().min(0).max(40),
  surface: z.enum(VERGE_SURFACES),
  edge: z.enum(VERGE_EDGES),
});

/** What divides the two directions; the lanes' dCenterM leave its gap (the road lint checks it). */
export const medianSchema = z.looseObject({
  widthM: z.number().positive().max(30),
  kind: z.enum(MEDIAN_KINDS),
});

const laneSectionSchema = z.looseObject({
  s0: nonNegative,
  lanes: z.array(laneSchema).min(1),
  median: medianSchema.optional(),
  verges: z.looseObject({ left: vergeSchema.optional(), right: vergeSchema.optional() }).optional(),
});

export const roadNetworkSchema = entry('road-network', {
  region: idSchema,
  crs: z.looseObject({ kind: z.literal('tmerc'), originLatDeg: z.number(), originLonDeg: z.number() }),
  roads: z.array(idSchema).min(1),
  junctions: z.array(
    z.looseObject({
      id: idSchema,
      x: z.number(),
      y: z.number(),
      z: z.number(),
      ends: z.array(z.looseObject({ road: idSchema, end: z.enum(['from', 'to']) })).min(1),
      connectors: z.array(z.looseObject({ id: idSchema, road: idSchema })),
    }),
  ),
});

export const roadSchema = entry('road', {
  network: idSchema,
  from: idSchema,
  to: idSchema,
  lengthM: z.number().positive(),
  sampleSpacingM: z.number().min(1).max(10),
  // What the lanes are made of; asphalt when absent (W-Q: a dirt shortcut is a road with `dirt`).
  surface: z.enum(ROAD_SURFACES).optional(),
  laneSections: z.array(laneSectionSchema).min(1),
  // Road files carry scenery tags over s ranges, not the envelope's plain strings.
  tags: z
    .array(
      z.looseObject({
        s0: z.number(),
        s1: z.number(),
        side: z.enum(['left', 'right', 'both']),
        tag: z.string(),
      }),
    )
    .optional(),
  features: z
    .array(
      z.looseObject({
        kind: z.enum([
          'ramp',
          'gap',
          'hazard',
          'roadsideZone',
          'copSpawn',
          'raceMarker',
          'billboard',
          // Playtest 1b quick wins (docs/content-packs.md, "Road file"): a speed-boost pad, and a
          // parked car-carrier whose rear deck is a jump ramp.
          'boostPad',
          'rampTruck',
          // Playtest 3 (round 1: "real landmarks"): a landmark beside or over the road, drawn by
          // render from `params.model`; the sim ignores it (docs/content-packs.md, "Road file").
          'landmark',
        ]),
        id: idSchema,
        s0: z.number(),
        s1: z.number(),
        d0: z.number(),
        d1: z.number(),
      }),
    )
    .optional(),
  barriers: z.array(barrierSchema).optional(),
  samples: z.looseObject({
    encoding: z.literal('json-columns'),
    columns: z.array(z.string()),
    data: z.record(z.string(), z.array(z.number())),
  }),
});

export const routeSchema = entry('route', {
  network: idSchema,
  start: z.looseObject({ road: idSchema, s: z.number(), dir: z.union([z.literal(1), z.literal(-1)]) }),
  finish: z.looseObject({ road: idSchema, s: z.number() }),
  mainPath: z.array(idSchema).min(1),
  allowedRoads: z.array(idSchema).min(1),
  closed: z.boolean(),
  startGrid: z
    .looseObject({
      rows: z.number().int().min(1),
      perRow: z.number().int().min(1),
      rowGapM: z.number().positive(),
    })
    .optional(),
  // W-Q (interview, 2026-10-02: "junction choices in races", marked dirt shortcuts): named branches
  // off the main path; the road lint checks their roads (docs/content-packs.md, "Route file").
  branches: z
    .array(
      z.looseObject({
        id: idSchema,
        roads: z.array(idSchema).min(1),
        kind: z.enum(ROUTE_BRANCH_KINDS).optional(),
        marked: z.boolean().optional(),
        sign: z.string().min(1).max(80).optional(),
        // Playtest 3 (round 3: "rivals and cops stay on the highway"): the share of rivals that
        // take it; absent, the AI's own rule decides.
        aiTake: unit01.optional(),
      }),
    )
    .optional(),
});

const trafficKindSchema = z.looseObject({ kind: refSchema, weight: z.number().positive() });

export const regionSchema = entry('region', {
  networks: z.array(idSchema).min(1),
  timeOfDayOptions: z.array(z.looseObject({ id: z.string(), lighting: z.string() })).min(1),
  palette: z.record(z.string(), z.string()).optional(),
  traffic: z.looseObject({
    mix: z.array(trafficKindSchema),
    pedestrians: z.array(trafficKindSchema).optional(),
    animals: z.array(trafficKindSchema).optional(),
    /**
     * Per-area traffic (run W-R; interview, 2026-10-02: distinct keys): where a road tag named
     * `tag` covers the spot a vehicle spawns at (a district tag such as `key-fishing`), its own
     * `mix` replaces the region's `mix`. Optional; absent everywhere means the region's mix.
     */
    areas: z
      .array(z.looseObject({ tag: z.string().min(1), mix: z.array(trafficKindSchema).min(1) }))
      .optional(),
  }),
  signs: z.array(signSchema).optional(),
  billboards: z.array(signSchema).optional(),
  smashables: z.array(smashableSchema).optional(),
  /**
   * The region's one-liners for a clean landing after real air (the pitch deck's #13, "Air that
   * pays": 'TEN OUT OF TEN, SAYS A PELICAN'), shaped like signs so the in-game veto can cut one.
   * Presentation only; optional.
   */
  landingLines: z.array(signSchema).optional(),
});

export const crewSchema = entry('crew', {
  kind: z.enum(['gang', 'sponsor-team', 'law']),
  region: idSchema.optional(),
  stanceTowardPlayer: z.enum(['hostile', 'neutral', 'friendly']).optional(),
  gangUp: z
    .looseObject({
      enabled: z.boolean(),
      maxJoiners: z.number().int().min(0).optional(),
      joinRadiusM: z.number().positive().optional(),
      chance: unit01.optional(),
    })
    .optional(),
  rivalCrews: z.array(refSchema).optional(),
  // A law crew's END OF JURISDICTION sign (the pitch deck's #11, run W-T): its words, a headline
  // then a kicker ("END OF JURISDICTION. Keys County wishes you well."). In a race whose heat
  // meter runs, the region's first fielded cop's agency puts it up beside the road; crossing it
  // cools the player's heat and the chasing cops pull over. [default]
  jurisdiction: z.looseObject({ sign: z.string().min(1) }).optional(),
});

/**
 * A traffic type's behaviour flags (docs/content-packs.md, "Traffic type"). Sim-facing, so they
 * are in the sim content hash. The M1 flags plus W-P's (2026-10-01): `kerb`, `weaveM` and
 * `convoy` for road vehicles, `strolls` and `chases` for pedestrians and animals. Every flag is
 * optional; an absent one means the category's default.
 */
const trafficBehaviourSchema = z.looseObject({
  carFollowing: z.boolean().optional(),
  laneChanges: z.boolean().optional(),
  dives: z.boolean().optional(),
  kerb: z.boolean().optional(),
  weaveM: z.number().min(0).max(1.5).optional(),
  convoy: z.number().int().min(1).max(4).optional(),
  strolls: z.boolean().optional(),
  chases: z.boolean().optional(),
  roadside: z.enum(['dodges', 'yields', 'solid']).optional(),
});

export const trafficTypeSchema = entry('traffic-type', {
  category: z.enum(['car', 'truck', 'rv', 'oddity', 'pedestrian', 'animal']),
  lengthM: z.number().positive(),
  widthM: z.number().positive(),
  // How tall it is drawn; absent, the category's default (`TRAFFIC_HEIGHT_DEFAULT_M`).
  heightM: heightSchema.optional(),
  cruiseMps: nonNegative,
  hazard: z.enum(['normal', 'big']),
  behaviour: trafficBehaviourSchema.optional(),
});

/**
 * One `when` condition (docs/content-packs.md, "Line fields"): `{ fact, op, value }`, no free-form
 * expressions. `in` takes a list and every other op a single value; the content lint checks the
 * fact against the vocabulary (./vocab.ts) and the op and value against the fact's kind.
 */
export const barkConditionSchema = z
  .looseObject({
    fact: z.string().min(1),
    op: z.enum(BARK_OPS),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])).min(1)]),
  })
  .refine((c) => (c.op === 'in') === Array.isArray(c.value), {
    message: '"in" takes a list of values; every other op takes one value',
    path: ['value'],
  });

/** Line fields a set's `defaults` may fill in, and each line may override. */
const barkLineTuning = {
  cooldownS: nonNegative.optional(),
  weight: nonNegative.optional(),
  chance: unit01.optional(),
  priority: z.number().int().min(0).max(3).optional(),
};

export const barkSetSchema = entry('bark-set', {
  defaults: z
    .looseObject({
      speaker: z.string().optional(),
      ...barkLineTuning,
    })
    .optional(),
  lines: z.array(
    z.looseObject({
      id: idSchema,
      // A closed list in code, checked by the content lint rather than here, so a line with a
      // newer trigger than this build knows stays loadable (it simply never fires).
      trigger: z.string(),
      text: z.string().min(1),
      speaker: z.string().optional(),
      target: z.string().optional(),
      when: z.array(barkConditionSchema).optional(),
      oncePerCareer: z.boolean().optional(),
      audioAsset: z.string().nullable().optional(),
      replyTo: idSchema.optional(),
      ...barkLineTuning,
      ...itemStatus,
    }),
  ),
});

export const hudLayoutSchema = entry('hud-layout', {
  mirror: z.boolean(),
  elements: z.array(
    z.looseObject({
      element: z.string(),
      visible: z.boolean(),
      anchor: z.enum([
        'top-left',
        'top-center',
        'top-right',
        'center-left',
        'center',
        'center-right',
        'bottom-left',
        'bottom-center',
        'bottom-right',
      ]),
      offset: z.tuple([z.number(), z.number()]),
      size: z.tuple([z.number(), z.number()]).optional(),
      scale: z.number().positive().default(1),
      opacity: unit01,
      touchOnly: z.boolean().optional(),
    }),
  ),
});

export const tuningPresetSchema = entry('tuning-preset', {
  base: z.string(),
  values: z.record(z.string(), z.number()),
});

// Reserved types (docs/content-packs.md): claimed now so the names cannot be taken, with the
// documented shape. No M1 content uses them.

/** A weird-event modifier (reserved, M4 or the shelf). */
export const eventModifierSchema = entry('event-modifier', {
  kind: z.enum(MODIFIER_KINDS),
  rarityWeight: nonNegative,
  eligibility: z
    .looseObject({
      regions: z.array(refSchema).optional(),
      eventKinds: z.array(z.string()).optional(),
      timeOfDay: z.array(z.string()).optional(),
    })
    .optional(),
  trigger: z.looseObject({ chance: unit01, atProgress: z.tuple([unit01, unit01]).optional() }),
  durationS: nonNegative,
  effects: z.array(
    z.looseObject({
      kind: z.enum([
        'lateral-gust',
        'spawn-hazard',
        'spawn-convoy',
        'traffic-override',
        'cash-multiplier-zone',
        'bounty-on-player',
        'guest-rider',
        'show-billboard',
        // W-P events (the maintainer, 2026-10-01b: "events and set pieces"): a road set piece,
        // `piece` from sim/modifiers' closed list (roadwork, crash-scene, parade, hay-spill,
        // speed-trap) with that piece's parameters.
        'set-piece',
      ]),
    }),
  ),
});

/** A point on a region's road network: a road of one of the region's networks, and s along it. */
const mapPointSchema = z.looseObject({ road: idSchema, s: nonNegative });

/**
 * A region's career (docs/content-packs.md, "Career"; W-Q contracts; interview, 2026-10-02: "Network
 * map, tiered", and "The map": claim roads, find secrets and shortcuts, a set-piece finale per
 * region). The map is the region's road network: each node is an event placed on a road; winning
 * it opens nearby roads and claims some; a tier opens after enough wins in the one before; the
 * `boss` node is the region's finale. The content lint checks it against the region's networks.
 */
export const careerSchema = entry('career', {
  region: idSchema,
  startingCash: cash,
  startingBike: refSchema,
  tutorialEvent: refSchema.optional(),
  firstRun: z.enum(['race-first', 'intro-first']).optional(),
  tiers: z
    .array(
      z.looseObject({
        id: idSchema,
        name: z.string().optional(),
        /**
         * Wins in this tier that open the next one, or, when the tier names a `boss`, that open the
         * boss (the boss's own win is not one of them).
         */
        advance: z.looseObject({ requiredWins: z.number().int().min(0) }),
        /**
         * Playtest 3 (round 1: "the boss of each tier must be beaten first"): the tier's boss, a node
         * of this tier whose event is a grudge match; beating it opens the next tier. The last
         * tier's boss is the region's (`boss`). The career lint checks both.
         */
        boss: idSchema.optional(),
        /**
         * Playtest 3 (round 1: "the field levels up every tier"): the tier's field level, each one
         * the career's default when absent (docs/product-spec.md, "Rivals").
         */
        field: z
          .looseObject({
            /** The event pace as a share of the best step-up bike open at this tier. */
            paceShare: z.number().positive().max(1).optional(),
            aggression: z.number().positive().max(3).optional(),
            signatureGap: z.number().positive().max(3).optional(),
            health: z.number().positive().max(3).optional(),
            power: z.number().positive().max(3).optional(),
            rivalBike: z.enum(TIER_RIVAL_BIKES).optional(),
          })
          .optional(),
      }),
    )
    .min(1),
  nodes: z
    .array(
      z.looseObject({
        id: idSchema,
        event: refSchema,
        /** Which of the event's lengths; its first when absent. */
        length: idSchema.optional(),
        tier: idSchema,
        at: mapPointSchema,
        /** Nodes to win first, besides the tier gate. */
        requires: z.array(idSchema).optional(),
        /** Roads a win opens on the map (for the next races and free play). */
        opens: z.array(idSchema).optional(),
        /** Roads a win claims: the map shows them as the player's. */
        claims: z.array(idSchema).optional(),
      }),
    )
    .min(1),
  /** The region's finale: a node in the last tier whose event has `finale: true`. */
  boss: idSchema,
  secrets: z
    .array(
      z.looseObject({
        id: idSchema,
        kind: z.enum(SECRET_KINDS),
        at: mapPointSchema,
        /** What it points at: a route branch (`<route>#<branch>`), a road, a station or a stash id. */
        ref: z.string().optional(),
      }),
    )
    .optional(),
  ending: z.looseObject({ teaser: z.string().optional(), freePlayAfter: z.boolean() }).optional(),
  shop: z.array(z.looseObject({ bike: refSchema, priceCash: cash, unlockTier: idSchema })).optional(),
  /**
   * The region's paints (run W-R): bought once, worn on any bike. Playtest 3 (round 2: "Longer +
   * seasons"): a paint may open only from a later season (`unlockSeason`; 1 when absent).
   */
  paints: z
    .array(
      z.looseObject({
        id: idSchema,
        name: z.string().optional(),
        hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #rrggbb'),
        priceCash: cash,
        unlockTier: idSchema,
        unlockSeason: z.number().int().min(1).max(MAX_SEASON).optional(),
      }),
    )
    .optional(),
  unlocks: z
    .array(
      z.looseObject({
        grant: refSchema,
        when: z.looseObject({ kind: z.enum(['boss-beaten', 'event-won']), ref: refSchema }),
      }),
    )
    .optional(),
});

/** A radio station (reserved, later). Tracks are vetoable items. */
export const stationSchema = entry('station', {
  genre: z.string(),
  regions: z.array(refSchema),
  tracks: z.array(
    z.looseObject({
      id: idSchema,
      title: z.string().min(1),
      audioAsset: z.string().optional(),
      origin: z.enum(['human', 'agent', 'ai-batch']).optional(),
      ...itemStatus,
    }),
  ),
  djBarkSet: refSchema.nullable().optional(),
});

/** A JSON Merge Patch on another pack's entry (reserved; patches are not applied in v1). */
export const patchSchema = entry('patch', {
  target: refSchema,
  merge: z.record(z.string(), z.unknown()),
});

/** Every entry type, keyed by its `type` string. */
export const ENTRY_SCHEMAS = {
  bike: bikeSchema,
  rider: riderSchema,
  crew: crewSchema,
  weapon: weaponSchema,
  event: eventSchema,
  career: careerSchema,
  region: regionSchema,
  'road-network': roadNetworkSchema,
  road: roadSchema,
  route: routeSchema,
  'traffic-type': trafficTypeSchema,
  'bark-set': barkSetSchema,
  'hud-layout': hudLayoutSchema,
  'tuning-preset': tuningPresetSchema,
  'event-modifier': eventModifierSchema,
  station: stationSchema,
  patch: patchSchema,
} as const;

export type EntryType = keyof typeof ENTRY_SCHEMAS;

export type PackManifest = z.infer<typeof packSchema>;
export type Bike = z.infer<typeof bikeSchema>;
export type Rider = z.infer<typeof riderSchema>;
export type Weapon = z.infer<typeof weaponSchema>;
export type RaceEvent = z.infer<typeof eventSchema>;
export type Career = z.infer<typeof careerSchema>;
export type Region = z.infer<typeof regionSchema>;
export type RoadNetworkFile = z.infer<typeof roadNetworkSchema>;
export type RoadFile = z.infer<typeof roadSchema>;
export type RouteFile = z.infer<typeof routeSchema>;
export type TrafficType = z.infer<typeof trafficTypeSchema>;
export type BarkSet = z.infer<typeof barkSetSchema>;
export type HudLayout = z.infer<typeof hudLayoutSchema>;
export type TuningPreset = z.infer<typeof tuningPresetSchema>;
export type Crew = z.infer<typeof crewSchema>;
export type EventModifier = z.infer<typeof eventModifierSchema>;
export type Station = z.infer<typeof stationSchema>;
export type Patch = z.infer<typeof patchSchema>;
