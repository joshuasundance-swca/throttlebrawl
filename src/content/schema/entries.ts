// Zod schemas for the M1 minimum (docs/content-packs.md, "What M1 needs"). Each type's fields
// follow its section in that doc; everything beyond the M1 minimum is optional or passes through.
// content-1 adds the reserved type names, the refinements and the lint.
import { z } from 'zod';
import { entry, idSchema, nonNegative, refSchema, statusSchema, unit01 } from './common';

export const packSchema = z.looseObject({
  type: z.literal('pack'),
  id: idSchema,
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'must be a semantic version'),
  formatVersion: z.number().int().min(1),
  license: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  defaults: z.looseObject({ tuning: z.string(), hud: z.string(), look: z.string().optional() }),
  idAliases: z.record(z.string(), z.string()).optional(),
});

export const bikeSchema = entry('bike', {
  class: z.enum([
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
  ]),
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
  hitStopMs: nonNegative.optional(),
  steal: z
    .looseObject({ allowed: z.boolean(), windowStartS: nonNegative, windowEndS: nonNegative })
    .optional(),
});

export const eventSchema = entry('event', {
  kind: z.enum(['classic-race', 'takedown-hunt', 'cop-escape', 'grudge-match']),
  region: idSchema,
  timeOfDay: z.enum(['dawn', 'noon', 'golden-hour', 'dusk', 'night']),
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
  rewards: z.looseObject({ byPlaceCash: z.array(z.number().int().min(0)) }),
});

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
        kind: z.enum(['ramp', 'gap', 'hazard', 'roadsideZone', 'copSpawn', 'raceMarker', 'billboard']),
        id: idSchema,
        s0: z.number(),
        s1: z.number(),
        d0: z.number(),
        d1: z.number(),
      }),
    )
    .optional(),
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

export const regionSchema = entry('region', {
  networks: z.array(idSchema).min(1),
  timeOfDayOptions: z.array(z.looseObject({ id: z.string(), lighting: z.string() })).min(1),
  palette: z.record(z.string(), z.string()).optional(),
  traffic: z.looseObject({
    mix: z.array(z.looseObject({ kind: refSchema, weight: z.number().positive() })),
  }),
});

export const trafficTypeSchema = entry('traffic-type', {
  category: z.enum(['car', 'truck', 'rv', 'oddity', 'pedestrian', 'animal']),
  lengthM: z.number().positive(),
  widthM: z.number().positive(),
  cruiseMps: nonNegative,
  hazard: z.enum(['normal', 'big']),
});

export const barkSetSchema = entry('bark-set', {
  lines: z.array(
    z.looseObject({
      id: idSchema,
      trigger: z.string(),
      text: z.string().min(1),
      status: statusSchema.optional(),
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

/** Every M1 entry type, keyed by its `type` string. */
export const ENTRY_SCHEMAS = {
  bike: bikeSchema,
  rider: riderSchema,
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
} as const;

export type EntryType = keyof typeof ENTRY_SCHEMAS;
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
