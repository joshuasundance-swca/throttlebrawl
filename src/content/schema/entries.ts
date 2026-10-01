// Zod schemas for the M1 minimum (docs/content-packs.md, "What M1 needs"). Each type's fields
// follow its section in that doc; everything beyond the M1 minimum is optional or passes through.
// The reserved types (event-modifier, station, patch) are claimed here so nothing else takes the
// names; cross-file rules live in the content lint (src/content/lint.ts).
import { z } from 'zod';
import { entry, idSchema, nonNegative, refSchema, statusSchema, unit01 } from './common';
import { BARK_OPS, BIKE_CLASSES, EVENT_KINDS, MODIFIER_KINDS, TIMES_OF_DAY } from './vocab';

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
  defaults: z.looseObject({ tuning: z.string(), hud: z.string(), look: z.string().optional() }),
  idAliases: z.record(z.string(), z.string()).optional(),
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

export const bikeSchema = entry('bike', {
  class: z.enum(BIKE_CLASSES),
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
  engineSound: z.looseObject({ preset: z.string() }),
});

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

export const riderSchema = entry('rider', {
  role: z.enum(['rival', 'cop', 'player-preset', 'extra']),
  roster: z.enum(['regular', 'local']).optional(),
  region: idSchema.optional(),
  crew: refSchema.optional(),
  blurb: z.string().optional(),
  bike: refSchema,
  stats: z
    .looseObject({
      massKg: z.number().positive().optional(),
      healthMax: z.number().positive().optional(),
      skill: unit01.optional(),
    })
    .optional(),
  startingWeapon: refSchema.optional(),
  personality: z.looseObject({ style: z.enum(AI_STYLES) }).optional(),
  law: z
    .looseObject({
      agency: refSchema,
      bustRadiusM: z.number().positive(),
      bustDwellS: z.number().positive(),
      fineCash: z.number().int().min(0),
      pursuitSpeedScale: z.number().positive(),
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

export const eventSchema = entry('event', {
  kind: z.enum(EVENT_KINDS),
  region: idSchema,
  timeOfDay: z.enum(TIMES_OF_DAY),
  lengths: z.array(z.looseObject({ id: idSchema, route: refSchema, laps: z.number().int().min(1) })).min(1),
  field: z.looseObject({
    riders: z.array(refSchema).optional(),
    rubberband: unit01.optional(),
    paceMps: z.number().positive().optional(),
  }),
  cops: z.looseObject({ mode: z.enum(['none', 'every-race', 'tier-rising', 'chaos-summoned']) }),
  rules: z.looseObject({}),
  objectives: z
    .array(
      z.looseObject({
        id: idSchema,
        kind: z.string(),
        required: z.boolean(),
        rewardCash: z.number().int().optional(),
      }),
    )
    .min(1),
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
  }),
  modifiers: z
    .looseObject({
      pool: z.union([z.literal('region-default'), z.array(refSchema)]),
      maxPerRace: z.number().int().min(0),
      chanceScale: nonNegative.optional(),
    })
    .optional(),
});

/**
 * A barrier span along a road (docs/content-packs.md, "Road file"; M2 content-2): a `rail` lets a
 * tumble body above `heightM` cross it, a `wall` does not. Water is the region's sea level, world
 * y = 0, so there is no per-road water height. The road lint checks the span lies inside the road.
 */
export const barrierSchema = z
  .looseObject({
    s0: nonNegative,
    s1: nonNegative,
    side: z.enum(['left', 'right', 'both']),
    kind: z.enum(['rail', 'wall']),
    heightM: z.number().positive(),
  })
  .refine((b) => b.s1 > b.s0, { message: 's1 must be past s0', path: ['s1'] });

const laneSchema = z.looseObject({
  id: z.string(),
  dCenterM: z.number(),
  widthM: z.number().positive(),
  direction: z.union([z.literal(1), z.literal(-1)]),
  kind: z.enum(['drive', 'shoulder', 'shortcut']),
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
  laneSections: z.array(z.looseObject({ s0: nonNegative, lanes: z.array(laneSchema).min(1) })).min(1),
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
  }),
  signs: z.array(signSchema).optional(),
  billboards: z.array(signSchema).optional(),
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
});

export const trafficTypeSchema = entry('traffic-type', {
  category: z.enum(['car', 'truck', 'rv', 'oddity', 'pedestrian', 'animal']),
  lengthM: z.number().positive(),
  widthM: z.number().positive(),
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
      ]),
    }),
  ),
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

/** Reserved types: valid files, but not loaded into the registry yet. */
export const RESERVED_TYPES: readonly EntryType[] = ['patch'];

/**
 * Top-level fields left out of the sim content hash, per type (docs/content-packs.md, "Which
 * fields count as sim-facing"). Everything else in an entry of that type is sim-facing, so a field
 * a later lane adds counts toward the sim hash until it is listed here: a missed presentation
 * field only renews the replay key, while a missed sim field would let replays silently diverge.
 * `null` means the whole type is presentation-only (full hash only).
 */
export const SIM_EXCLUDED_FIELDS: Readonly<Record<EntryType, readonly string[] | null>> = {
  bike: ['name', 'tags', 'meta', 'look', 'engineSound', 'blurb'],
  rider: ['name', 'tags', 'meta', 'look', 'paint', 'blurb'],
  crew: ['name', 'tags', 'meta'],
  weapon: ['name', 'tags', 'meta', 'look', 'sounds'],
  event: ['name', 'tags', 'meta', 'interludes'],
  region: ['name', 'tags', 'meta', 'blurb', 'chapter', 'palette', 'timeOfDayOptions', 'signs', 'billboards'],
  'road-network': ['name', 'meta', 'provenance'],
  road: ['name', 'realName', 'meta', 'provenance'],
  route: ['name', 'meta'],
  'traffic-type': ['name', 'tags', 'meta', 'look'],
  'tuning-preset': ['name', 'tags', 'meta'],
  'event-modifier': ['name', 'tags', 'meta', 'announce'],
  'bark-set': null,
  'hud-layout': null,
  station: null,
  patch: null,
};

/**
 * The lists of vetoable items per type (docs/content-packs.md, "In-game veto"): each item has an
 * id unique in its entry and an optional `status`; the loader drops vetoed (and, in release
 * builds, draft) items, and the file keeps them as the taste log.
 */
export const VETOABLE_ITEMS: Readonly<Partial<Record<EntryType, readonly string[]>>> = {
  'bark-set': ['lines'],
  region: ['signs', 'billboards'],
  station: ['tracks'],
};
export type PackManifest = z.infer<typeof packSchema>;
export type Bike = z.infer<typeof bikeSchema>;
export type Rider = z.infer<typeof riderSchema>;
export type Weapon = z.infer<typeof weaponSchema>;
export type RaceEvent = z.infer<typeof eventSchema>;
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
