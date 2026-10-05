// buildSimConfig: resolves settings and content into the plain data a race starts from
// (docs/architecture.md, "Sim contract"; docs/milestones/M2.md, app-3 item 3). The sim never
// imports content/ or tuning/; everything arrives here. It is the one place that resolves the
// difficulty preset (from its `difficulty.<preset>.*` tuning values), the per-slot assists, the
// speed multiplier, the slow-motion toggle and the race length. Settings that feed SimConfig apply
// at the next race start or restart: a mid-race change would break the replay.
import {
  lookup,
  packClosure,
  packOf,
  packSubset,
  type ContentRegistry,
  type RaceEvent,
  type Rider,
  type TrafficType,
  type Weapon,
} from '../content';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_SCALES,
  DIFFICULTY_TUNING,
  SIGNATURE_IDS,
  SIM_TUNING,
  difficultyTuningId,
  secondsToTicks,
  tuningDefaults,
  type DifficultyPreset,
  type EventPatch,
  type FieldLevel,
  type SimAiPersonality,
  type SimAssists,
  type SimConfig,
  type SimController,
  type SimDifficulty,
  type SimEventCops,
  type SimEventDef,
  type SimLawHabit,
  type SimRiderDef,
  type SimSlotConfig,
  type SimSmashableDef,
  type SimStyleRewards,
  type SimTrafficBehaviour,
  type SimWeaponDef,
  type TuningParamDecl,
} from '../sim/api';
import { activateRegion, type RegionStream } from '../stream';
import { eventModifiers } from './modifiers';

export const DEFAULT_EVENT = 'm1-skeleton-sprint';

/**
 * A reference qualified by the pack that holds it: a bare id names an entry of that same pack
 * (docs/content-packs.md, "IDs and references"; "Region packs at runtime").
 */
export function qualifyIn(packId: string, ref: string): string {
  return ref.includes(':') ? ref : `${packId}:${ref}`;
}

/** An event id as the registry keys it: bare ids are base's (`m1-skeleton-sprint`). */
export const eventKey = (eventId: string): string => qualifyIn('base', eventId);
export const PLAYER_PRESET = 'player';
/** Race-end timeout after the player finishes (M1 starting numbers: 30 s). */
export const RACE_END_TIMEOUT_S = 30;

export interface RaceSetup {
  seed: number;
  eventId?: string;
  /**
   * Tuning values in force; missing ids take their declared defaults. Sim-affecting ids go into
   * SimConfig.tuning; the `difficulty.*` ids resolve the chosen preset (see `raceStartValues`).
   */
  tuning?: Readonly<Record<string, number>>;
  /** Easy, Normal or Hard (default Normal). */
  difficulty?: DifficultyPreset;
  /**
   * The event length id (`short`, `standard`, `long`). Left out, or one the event lacks: its
   * `standard` length, else its first.
   */
  length?: string;
  /**
   * A real-road route to race instead of the length's (qualified, `region-pnw:osm-chuckanut-run`):
   * one of the event region's `realRoutes` (the maintainer, 2026-10-01: "Yes, add as routes").
   * Left out, or not one of them: the length's route. The route lands in `SimConfig.event.routeId`,
   * so the recording's header carries it with the seed and a replay rebuilds the same road.
   */
  route?: string;
  /** Assists per human slot, index = slot; a missing slot gets none. */
  assists?: readonly SimAssists[];
  /** The lower-overall-speed multiplier in (0, 1]; anything else means 1 (default 1). */
  speedMultiplier?: number;
  /** The takedown slow motion (default on [decided]). */
  slowMo?: boolean;
  /**
   * The career's bike for the player (run W-R: the garage), qualified (`base:superbike-1000`). Left
   * out, or a bike the registry lacks: the player preset's own bike.
   */
  playerBike?: string;
  /**
   * The career's grudge table (rival content id to rider content id to points), saved with the
   * profile [decided] (cockpit answer, 2026-09-29). Left out: none, as before M4.
   */
  grudges?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * A free-play race (W-Q, the pitch deck's item 8, "A different field and light each race"): the
   * rivals are drawn from the region's whole cast, and the time of day from the region's list, both
   * by the seed (`raceField`, `raceTimeOfDay`). Left out or false: the event's own field and time
   * (the career sets its own field per event; tests and the shared batch race the event's).
   */
  freePlay?: boolean;
  /**
   * The career field's level for this race (playtest 3, round 1: "the field levels up every tier
   * (tier 3 rivals ride bikes as good as your best)"): the pace, the rivals' and cops' bikes, and
   * the rivals' health, power, aggression and signature rate (docs/product-spec.md, "Rivals"). Left
   * out: the event file's field as it is, so a config is byte-identical to before. The career
   * computes it; buildSimConfig applies it (the app-wiring task).
   */
  fieldLevel?: FieldLevel;
  /**
   * A season's remix of the node (playtest 3, round 2: "Season 2+ with a harder field and remixed
   * events"), applied to the event before anything reads it. Left out: the event file as it is.
   */
  eventPatch?: EventPatch;
}

type Json = Record<string, unknown>;
const asObject = (v: unknown): Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {};
const asNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * An event with a season's remix applied (`EventPatch`, src/core/career-race.ts), before anything
 * reads it: the kind, rules, objectives, time of day, field, weird-event chance and cap, and prizes
 * by place. Absent fields keep the file's; no patch (null or undefined) gives the event itself. The
 * patch's `lengthId` is the length to race, which the caller passes on as the race length. This is
 * the same application as the career's `applyEventPatch` (src/career/season.ts, which app/ cannot
 * import in first-load code), and tests/sim/app-field-level.test.ts holds the two equal.
 */
export function withEventPatch(event: RaceEvent, patch: EventPatch | null | undefined): RaceEvent {
  if (!patch) return event;
  const e: Json = { ...(event as unknown as Json) };
  if (patch.kind) e['kind'] = patch.kind;
  if (patch.rules) e['rules'] = patch.rules;
  if (patch.objectives) e['objectives'] = patch.objectives;
  if (patch.timeOfDay) e['timeOfDay'] = patch.timeOfDay;
  if (patch.riders) e['field'] = { ...asObject(e['field']), riders: patch.riders };
  if (patch.modifierChanceScale !== undefined || patch.maxModifiers !== undefined) {
    const mods = asObject(e['modifiers']);
    e['modifiers'] = {
      ...mods,
      ...(patch.modifierChanceScale !== undefined
        ? {
            chanceScale:
              Math.round(asNumber(mods['chanceScale'], 1) * patch.modifierChanceScale * 1000) / 1000,
          }
        : {}),
      ...(patch.maxModifiers !== undefined ? { maxPerRace: patch.maxModifiers } : {}),
    };
  }
  if (patch.byPlaceCash) e['rewards'] = { ...asObject(e['rewards']), byPlaceCash: patch.byPlaceCash };
  return e as unknown as RaceEvent;
}

/**
 * A small seeded generator for the free-play draws (mulberry32): app-side, outside the sim and its
 * streams, a pure function of the seed and the salt, so a replay's seed draws the same again.
 */
function seededDraw(seed: number, salt: number): () => number {
  let a = (seed ^ salt) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FIELD_SALT = 0x6669656c; // 'fiel'
const LIGHT_SALT = 0x6c696768; // 'ligh'

/**
 * The rival ids a race fields (qualified): the event's own field, or for a free-play race as many
 * drawn from the region's whole cast (every live rival with no region, or this event's region, in
 * the race's packs), shuffled by the seed (seededDraw, never the sim's streams).
 */
export function raceField(
  race: ContentRegistry,
  eventId: string,
  seed: number,
  freePlay = false,
  /** The event with a season's patch applied (`withEventPatch`); left out: the registry's own. */
  patched?: RaceEvent,
): string[] {
  const id = eventKey(eventId);
  const event = patched ?? lookup(race.events, id);
  const eventPack = packOf(id);
  const own = (event.field.riders ?? []).map((ref) => qualifyIn(eventPack, ref));
  if (!freePlay || own.length === 0) return own;
  const region = qualifyIn(eventPack, event.region);
  const cast = Object.keys(race.riders)
    .filter((rid) => {
      const r = race.riders[rid];
      return !!r && r.role === 'rival' && (!r.region || qualifyIn(packOf(rid), r.region) === region);
    })
    .sort();
  const next = seededDraw(seed, FIELD_SALT);
  for (let i = cast.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [cast[i], cast[j]] = [cast[j] as string, cast[i] as string];
  }
  return cast.length >= own.length ? cast.slice(0, own.length) : own;
}

/**
 * A race's time of day: the event's own, or for a free-play race one of its region's
 * `timeOfDayOptions` drawn by the seed (seededDraw). It feeds the road events' eligibility and
 * the light; presentation reads it again from the seed, as the recording carries the seed.
 */
export function raceTimeOfDay(
  reg: ContentRegistry,
  eventId: string,
  seed: number,
  freePlay = false,
  /** The event with a season's patch applied (`withEventPatch`); left out: the registry's own. */
  patched?: RaceEvent,
): string {
  const id = eventKey(eventId);
  const event = patched ?? lookup(reg.events, id);
  const own = String(event.timeOfDay);
  if (!freePlay) return own;
  const region = reg.regions[qualifyIn(packOf(id), event.region)];
  const options = (region?.timeOfDayOptions ?? []).map((o) => o.id).sort();
  if (options.length === 0) return own;
  return options[Math.floor(seededDraw(seed, LIGHT_SALT)() * options.length)] ?? own;
}

/** The length a race runs when none is chosen (docs/content-packs.md, "Event"). */
const STANDARD_LENGTH = 'standard';
const NO_ASSISTS: SimAssists = { steer: 'off', autoThrottle: false };
const DIFFICULTY_PREFIX = 'difficulty.';

/**
 * Playtest 3's moves pay per second at these multiples of the event's oncoming rate when its file
 * names no rate of its own [default]: a clean wheelie 2x, a banked drift 3x (Keys tier 3's
 * oncoming 10 gives 20 and 30), so every existing event pays them at its own tier's scale.
 */
export const WHEELIE_CASH_PER_ONCOMING = 2;
export const DRIFT_CASH_PER_ONCOMING = 3;

/**
 * The event's style-cash values (its `rewards` style fields), each 0 when the file leaves it out,
 * except the wheelie's and the drift's, which default from the oncoming rate.
 */
function styleRewards(rewards: RaceEvent['rewards']): SimStyleRewards {
  const oncoming = rewards.perOncomingSecondCash ?? 0;
  return {
    perNearMissCash: rewards.perNearMissCash ?? 0,
    perAirtimeCash: rewards.perAirtimeCash ?? 0,
    perOncomingSecondCash: oncoming,
    perTakedownCash: rewards.perTakedownCash ?? 0,
    takedownComboScale: rewards.takedownComboScale ?? 0,
    perStealCash: rewards.perStealCash ?? 0,
    perWheelieSecondCash: rewards.perWheelieSecondCash ?? WHEELIE_CASH_PER_ONCOMING * oncoming,
    perDriftSecondCash: rewards.perDriftSecondCash ?? DRIFT_CASH_PER_ONCOMING * oncoming,
  };
}

/**
 * The event length a race uses: the chosen one; else its `standard` (a region's main race, such as
 * the Pacific Northwest's 2 to 3 minute run, not its short sprint); else its first. [default]
 */
export function eventLength(event: RaceEvent, lengthId?: string): RaceEvent['lengths'][number] {
  const length =
    event.lengths.find((l) => l.id === lengthId) ??
    event.lengths.find((l) => l.id === STANDARD_LENGTH) ??
    event.lengths[0];
  if (!length) throw new Error(`event ${event.id} has no length`);
  return length;
}

/**
 * The values `buildSimConfig` reads at race start besides the sim's own: every `difficulty.*`
 * declaration's value from the panel (`get`, normally the tuning registry's).
 */
export function raceStartValues(
  decls: readonly TuningParamDecl[],
  get: (id: string) => number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of decls) if (d.id.startsWith(DIFFICULTY_PREFIX)) out[d.id] = get(d.id);
  return out;
}

/** Resolves a difficulty preset from its tuning values (declared defaults for missing ids). */
export function resolveDifficulty(
  preset: DifficultyPreset,
  values: Readonly<Record<string, number>> = {},
): SimDifficulty {
  const defaults = tuningDefaults(DIFFICULTY_TUNING);
  const scale = (s: (typeof DIFFICULTY_SCALES)[number]) => {
    const id = difficultyTuningId(preset, s);
    const v = values[id];
    return v !== undefined && Number.isFinite(v) && v >= 0 ? v : (defaults[id] ?? 1);
  };
  return {
    presetId: preset,
    riderAggression: scale('riderAggression'),
    copFrequency: scale('copFrequency'),
    rubberBand: scale('rubberBand'),
  };
}

const validSpeed = (m: number | undefined) =>
  m !== undefined && Number.isFinite(m) && m > 0 && m <= 1 ? m : 1;

/** True when a network was baked from public map data (tools/gis), not drawn by hand. */
function isRealRoad(network: unknown): boolean {
  const provenance = (network as { provenance?: { origin?: unknown } } | undefined)?.provenance;
  return provenance?.origin === 'gis-pipeline';
}

/**
 * The event region's real-road routes, by qualified id, in id order (the maintainer, 2026-10-01:
 * "Yes, add as routes"): every route in the race's packs (the event's pack and its dependencies)
 * whose network was baked from map data (`provenance.origin` "gis-pipeline") and names the event's
 * region. A region pack's routes are road data, so they are listed once its roads are fetched.
 * Run W-R (interview, 2026-10-02: "SF first = downtown towers"): a hand-made route on ANOTHER of the
 * region's networks (San Francisco's downtown) is offered the same way; the hand-made spares on
 * the event's own network (the Keys' other lengths) still are not. [default]
 */
export function realRoutes(reg: ContentRegistry, eventId = DEFAULT_EVENT): string[] {
  const key = eventKey(eventId);
  const event = lookup(reg.events, key);
  const regionKey = qualifyIn(packOf(key), event.region);
  const packs = new Set(packClosure(reg, packOf(key)));
  const own = new Set(event.lengths.map((l) => qualifyIn(packOf(key), l.route)));
  const networkOf = (id: string) => qualifyIn(packOf(id), reg.routes[id]?.network ?? '');
  const ownNetworks = new Set([...own].filter((id) => reg.routes[id]).map(networkOf));
  return Object.keys(reg.routes)
    .filter((id) => {
      if (!packs.has(packOf(id)) || own.has(id)) return false;
      const networkKey = networkOf(id);
      const network = reg.networks[networkKey];
      if (!network || qualifyIn(packOf(networkKey), network.region) !== regionKey) return false;
      return isRealRoad(network) || (ownNetworks.size > 0 && !ownNetworks.has(networkKey));
    })
    .sort();
}

/** Whether a route runs on a network baked from map data (the picker says "real road"). */
export function isRealRoute(reg: ContentRegistry, routeKey: string): boolean {
  const route = reg.routes[routeKey];
  return !!route && isRealRoad(reg.networks[qualifyIn(packOf(routeKey), route.network)]);
}

/**
 * The route a race runs, as its registry key: `route` when it is one of the event's real routes
 * (qualified or bare in the event's pack), else the chosen length's route.
 */
export function raceRouteKey(
  reg: ContentRegistry,
  eventId = DEFAULT_EVENT,
  lengthId?: string,
  route?: string | null,
): string {
  const key = eventKey(eventId);
  if (route) {
    const wanted = qualifyIn(packOf(key), route);
    if (realRoutes(reg, key).includes(wanted)) return wanted;
  }
  return qualifyIn(packOf(key), eventLength(lookup(reg.events, key), lengthId).route);
}

/** Activates the region stream for an event's route network (one per network, cached by caller). */
export function streamForEvent(
  reg: ContentRegistry,
  eventId = DEFAULT_EVENT,
  lengthId?: string,
  route?: string | null,
): RegionStream {
  return streamForRoute(reg, raceRouteKey(reg, eventId, lengthId, route));
}

/** The network a route runs on, as its registry key. */
export function networkKeyOf(reg: ContentRegistry, routeKey: string): string {
  return qualifyIn(packOf(routeKey), lookup(reg.routes, routeKey).network);
}

/** Activates the region stream for a route's network (by the route's qualified id). */
export function streamForRoute(reg: ContentRegistry, routeKey: string): RegionStream {
  const networkKey = networkKeyOf(reg, routeKey);
  const network = lookup(reg.networks, networkKey);
  const pack = packOf(networkKey);
  return activateRegion({
    network,
    roads: network.roads.map((id) => lookup(reg.roads, qualifyIn(pack, id))),
  });
}

const PERSONALITY_NUMBERS = ['aggression', 'dirtiness', 'courage', 'riskTaking', 'chatter', 'weave'] as const;
const SIDES = ['left', 'right', 'either'] as const;

/**
 * A rival's AI controller: its style id plus its own personality numbers, which override the style
 * preset in sim/ai (docs/content-packs.md, "Rider"). Fields of the wrong type are left out.
 */
export function aiController(personality: Rider['personality']): SimController {
  const own: SimAiPersonality = {};
  for (const key of PERSONALITY_NUMBERS) {
    const value: unknown = personality?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) own[key] = value;
  }
  const prefs: unknown = personality?.['targetPreference'];
  if (Array.isArray(prefs) && prefs.every((p) => typeof p === 'string')) own.targetPreference = [...prefs];
  const side = SIDES.find((s) => s === personality?.['preferredSide']);
  if (side) own.preferredSide = side;
  // rivals-1 (M4, built early): authored rivalries and the weapon this rider goes out of its way
  // for. Ids stay as the file spells them; sim/ai matches them by bare id.
  const rivals: unknown = personality?.['rivals'];
  if (Array.isArray(rivals) && rivals.every((r) => typeof r === 'string') && rivals.length > 0)
    own.rivals = [...rivals];
  const preferred: unknown = personality?.['preferredWeapon'];
  if (typeof preferred === 'string' && preferred) own.preferredWeapon = preferred;
  // Playtest 2 ("Visible personalities", interview 2026-10-02): the rival's one signature move.
  const signature = SIGNATURE_IDS.find((m) => m === personality?.['signature']);
  if (signature) own.signature = signature;
  return { kind: 'ai', style: personality?.style ?? 'racer', personality: own };
}

/**
 * How a career race's field level reshapes one rider (`FieldLevel`, src/core/career-race.ts): a
 * rival's health and power, a cop's top-speed cap and fines. Absent: the rider file's own numbers.
 */
interface RiderLevel {
  healthScale?: number;
  powerScale?: number;
  topCapMps?: number | null;
  fineScale?: number;
}

/** Rounds a scaled value to the 0.001 the career rounds its scales to, so equal inputs agree. */
const round3 = (x: number) => Math.round(x * 1000) / 1000;

function riderDef(
  reg: ContentRegistry,
  id: string,
  controller: SimRiderDef['controller'],
  paceMps: number,
  bikeOverride?: string,
  level: RiderLevel = {},
): SimRiderDef {
  // `id` is qualified; the rider's own references resolve from the rider's pack.
  const pack = packOf(id);
  const rider = lookup(reg.riders, id);
  const bikeKey = bikeOverride && reg.bikes[bikeOverride] ? bikeOverride : qualifyIn(pack, rider.bike);
  const bike = lookup(reg.bikes, bikeKey);
  const h = bike.handling;
  // Rival pace comes from the event, not the bike: a rival's bike is raised to at least the pace.
  const floor = controller.kind === 'ai' ? paceMps : 0;
  // A cop rides his bike scaled by his pursuit speed, with no pace floor, and carries his law
  // block (cops-1; docs/content-packs.md, "Rider").
  const law = controller.kind === 'cop' ? rider.law : undefined;
  const speedScale = law?.pursuitSpeedScale ?? 1;
  return {
    contentId: id,
    name: rider.name ?? rider.id,
    role:
      rider.role === 'player-preset'
        ? 'player'
        : rider.role === 'cop'
          ? 'cop'
          : rider.role === 'extra'
            ? 'extra'
            : 'rival',
    faction: rider.role === 'cop' ? 'law' : 'rider',
    controller,
    bike: {
      contentId: bikeKey,
      topSpeedMps: Math.min(Math.max(h.topSpeedMps * speedScale, floor), level.topCapMps ?? Infinity),
      accelMps2: h.accelMps2,
      brakeMps2: h.brakeMps2,
      steerRateMps: h.steerRateMps,
      massKg: h.massKg,
      knockbackResistance: bike.combat?.knockbackResistance ?? 0,
      hitPowerScale: bike.combat?.hitPowerScale ?? 1,
    },
    massKg: rider.stats?.massKg ?? 80,
    healthMax: Math.round((rider.stats?.healthMax ?? 100) * (level.healthScale ?? 1)),
    toughness: rider.stats?.toughness ?? 1,
    power: rider.stats?.power ?? 1,
    // The field level's power scale rides apart from the rider's own power (playtest 3, gentle
    // climb): the sim lets it reach the player's fights by combat.levelPowerOnPlayer. Left out at 1,
    // so a level of 1 builds the race a free-play race builds.
    ...(level.powerScale !== undefined && round3(level.powerScale) !== 1
      ? { levelPower: round3(level.powerScale) }
      : {}),
    // The weapon the rider starts holding (M4 cops-3: a cop's baton or taser, which can be stolen),
    // only when the race carries it: a live rider naming a draft weapon rides bare-handed in a
    // release build, as before.
    ...((w) => (w && reg.weapons[w] ? { startingWeapon: w } : {}))(
      rider.startingWeapon ? qualifyIn(pack, rider.startingWeapon) : undefined,
    ),
    ...(law
      ? {
          law: {
            agency: qualifyIn(pack, law.agency),
            bustRadiusM: law.bustRadiusM,
            bustDwellS: law.bustDwellS,
            fineCash:
              level.fineScale === undefined ? law.fineCash : Math.round(law.fineCash * level.fineScale),
            pursuitSpeedScale: law.pursuitSpeedScale,
            ...(law.habit ? { habit: lawHabit(law.habit, level.fineScale) } : {}),
          },
        }
      : {}),
  };
}

/**
 * A cop's `law.habit` as the sim reads it (run W-T, law with a personality): the kind, and every
 * other field that is a finite number, by name (sim/cops documents each and has its own defaults).
 */
function lawHabit(
  habit: { kind: SimLawHabit['kind'] } & Record<string, unknown>,
  fineScale?: number,
): SimLawHabit {
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(habit))
    if (k !== 'kind' && typeof v === 'number' && Number.isFinite(v)) params[k] = v;
  // A citation habit's cash rides the same scale as the fine, so the banner and the ledger agree.
  const each = params['cashEach'];
  if (fineScale !== undefined && each !== undefined) params['cashEach'] = Math.round(each * fineScale);
  return { kind: habit.kind, params };
}

/**
 * The END OF JURISDICTION sign for a race (run W-T): the `jurisdiction.sign` of the first fielded
 * cop's agency crew, with that crew's qualified id; undefined when there is no cop or no sign.
 */
function jurisdictionOf(
  reg: ContentRegistry,
  cops: readonly SimRiderDef[],
): { label: string; agency: string } | undefined {
  const agency = cops.find((c) => c.law)?.law?.agency;
  const crew = agency ? reg.crews[agency] : undefined;
  const sign = crew?.jurisdiction?.sign;
  return agency && sign ? { label: sign, agency } : undefined;
}

/**
 * The most cops a race fields, whatever the mix asks (cops-3: at most 2 chase at once, plus playtest
 * 2's patrol and heat cops). [default]
 */
export const MAX_FIELDED_COPS = 5;
/** The event's career tier until career-1 lands: the first. */
export const DEFAULT_TIER = 1;

const finiteOr = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * The event's `cops` block as the sim reads it (M4 cops-3; docs/content-packs.md, "Event").
 * `baseCount` defaults to 1 for `every-race` and 0 otherwise; the other fields to 0 or off.
 */
export function eventCops(event: RaceEvent): SimEventCops {
  const c = event.cops as Record<string, unknown> & { mode: SimEventCops['mode'] };
  return {
    mode: c.mode,
    baseCount: Math.max(0, finiteOr(c['baseCount'], c.mode === 'every-race' ? 1 : 0)),
    tierScale: Math.max(0, finiteOr(c['tierScale'], 0)),
    chaosSummon: c['chaosSummon'] === true,
    randomness: Math.min(1, Math.max(0, finiteOr(c['randomness'], 0))),
    // Playtest 2: a patrol up the road (sim/cops), 1 to patrolMax cops, and the heat meter.
    ...((p) => (p > 0 ? { patrolMax: p } : {}))(Math.floor(finiteOr(c['patrolMax'], 0))),
    ...(c['heat'] === true ? { heat: true } : {}),
  };
}

/**
 * The event's law (docs/content-packs.md, "Event": `cops`): the region's cop riders, by qualified
 * id, at the back of the grid behind the player. The pool is the race's packs' cops whose `region`
 * resolves to the event's region (a cop with no region rides everywhere), cycled. The field holds
 * enough cops for the most the mix can bring out (M4 cops-3): `baseCount` plus `tierScale` per tier
 * above the first for `tier-rising`, plus `patrolMax` for playtest 2's patrol, plus one more
 * whenever chaos can summon, a patrol rides or the heat meter runs (a speed trap's or the heat's cop), at most
 * MAX_FIELDED_COPS; `none` fields nobody. sim/cops decides which of them leave the lot, and when.
 * [default] Returns qualified rider ids.
 */
export function copIds(reg: ContentRegistry, eventId = DEFAULT_EVENT, tier = DEFAULT_TIER): string[] {
  const key = eventKey(eventId);
  const event = lookup(reg.events, key);
  const cops = eventCops(event);
  if (cops.mode === 'none') return [];
  const starting =
    cops.mode === 'tier-rising' ? cops.baseCount + cops.tierScale * (Math.max(1, tier) - 1) : cops.baseCount;
  const chaos = cops.chaosSummon || cops.mode === 'chaos-summoned';
  // Playtest 2: a patrol adds its most (patrolMax), plus one in the lot for a speed trap, chaos or
  // the heat meter (whose cops also reuse any cop whose chase ended: more would crowd the lot).
  const patrol = cops.patrolMax ?? 0;
  const lot = chaos || patrol > 0 || cops.heat ? 1 : 0;
  const count = Math.min(MAX_FIELDED_COPS, Math.floor(starting) + patrol + lot);
  const regionKey = qualifyIn(packOf(key), event.region);
  const race = packSubset(reg, packClosure(reg, packOf(key)));
  const pool = Object.entries(race.riders)
    .filter(
      ([id, r]) => r.role === 'cop' && r.law && (!r.region || qualifyIn(packOf(id), r.region) === regionKey),
    )
    .map(([id]) => id)
    .sort();
  if (pool.length === 0 || count <= 0) return [];
  return Array.from({ length: count }, (_, i) => pool[i % pool.length] ?? '');
}

/**
 * The event region's traffic weights by qualified traffic-type id (M2 traffic-3): `traffic.mix`
 * for road vehicles, `pedestrians` and `animals` for peds. A type the region lists nowhere gets 0,
 * so it is never picked. Null when the event's region is not in the registry, which leaves the
 * sim's own category defaults.
 */
function regionTrafficWeights(
  reg: ContentRegistry,
  event: RaceEvent,
  eventPack: string,
): Map<string, number> | null {
  const regionKey = qualifyIn(eventPack, event.region);
  const region = reg.regions[regionKey];
  if (!region) return null;
  const regionPack = packOf(regionKey);
  const out = new Map<string, number>();
  const t = region.traffic;
  for (const k of [...t.mix, ...(t.pedestrians ?? []), ...(t.animals ?? [])]) {
    const id = qualifyIn(regionPack, k.kind);
    out.set(id, (out.get(id) ?? 0) + k.weight);
  }
  return out;
}

/**
 * The event region's live roadside smashables (run W-T, "the road fights back"), in file order,
 * each named by its veto reference (`<packId>:region/<regionId>#<itemId>`). Empty when the region
 * lists none (or is not in the registry). The loader already dropped vetoed ones.
 */
function regionSmashables(reg: ContentRegistry, event: RaceEvent, eventPack: string): SimSmashableDef[] {
  const regionKey = qualifyIn(eventPack, event.region);
  const region = reg.regions[regionKey];
  if (!region) return [];
  const pack = packOf(regionKey);
  const bare = regionKey.slice(regionKey.indexOf(':') + 1);
  return (region.smashables ?? []).map((item) => ({
    contentId: `${pack}:region/${bare}#${item.id}`,
    kind: item.kind,
    name: item.text,
    weight: item.weight ?? 1,
    tags: [...(item.tags ?? [])],
  }));
}

/** A type's `areaWeights` field for SimTrafficTypeDef: present only when an area lists it. */
function areaWeightsOf(
  areas: ReadonlyMap<string, Record<string, number>>,
  contentId: string,
): { areaWeights?: Record<string, number> } {
  const w = areas.get(contentId);
  return w ? { areaWeights: w } : {};
}

/**
 * The event region's per-area road-vehicle weights (run W-R; interview, 2026-10-02: each key its
 * own traffic), by qualified traffic-type id, then by area tag: each `traffic.areas` entry's mix.
 * Empty when the region has no areas (or is not in the registry).
 */
function regionTrafficAreas(
  reg: ContentRegistry,
  event: RaceEvent,
  eventPack: string,
): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const regionKey = qualifyIn(eventPack, event.region);
  const region = reg.regions[regionKey];
  if (!region) return out;
  const regionPack = packOf(regionKey);
  for (const area of region.traffic.areas ?? []) {
    for (const k of area.mix) {
      const id = qualifyIn(regionPack, k.kind);
      const row = out.get(id) ?? {};
      row[area.tag] = (row[area.tag] ?? 0) + k.weight;
      out.set(id, row);
    }
  }
  return out;
}

/**
 * A traffic type's behaviour flags as the sim reads them (W-P, 2026-10-01): only the flags the sim
 * acts on, and only those the content sets, so an absent flag keeps the category's default. A
 * type with none of them gets no `behaviour` field at all.
 */
export function trafficBehaviour(b: TrafficType['behaviour']): { behaviour?: SimTrafficBehaviour } {
  if (!b) return {};
  const out: SimTrafficBehaviour = {};
  if (b.laneChanges !== undefined) out.laneChanges = b.laneChanges;
  if (b.kerb !== undefined) out.kerb = b.kerb;
  if (b.weaveM !== undefined) out.weaveM = b.weaveM;
  if (b.convoy !== undefined) out.convoy = b.convoy;
  if (b.strolls !== undefined) out.strolls = b.strolls;
  if (b.chases !== undefined) out.chases = b.chases;
  return Object.keys(out).length > 0 ? { behaviour: out } : {};
}

/**
 * A weapon file's M4 weapons-2 fields as the sim reads them: its behaviour, charges and durability
 * (`uses`), its stun (the `stun` entry of `effects`) and its roadside weight (`spawn`). The cops
 * lane's oracle is `simWeapon` in tests/sim/weapons-pack.test.ts.
 *
 * `spawn.regions` (docs/content-packs.md, "Weapon": "an empty `regions` list means every region"),
 * read from W-T's local weapons on (the pitch deck's #4: a lawn flamingo in the Keys, a canoe paddle
 * in the PNW, a dead rental scooter in SF): given the race's region (`regionKey`, qualified) and the
 * weapon's pack, a weapon whose list names other regions only lies nowhere on this race's road
 * (roadsideWeight 0). It still exists in the race, so a rider can start with it or steal it.
 */
export function weaponBehaviour(w: Weapon, regionKey?: string, weaponPack = 'base'): Partial<SimWeaponDef> {
  const loose = w as unknown as Record<string, unknown>;
  const rec = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const uses = rec(loose['uses']);
  const out: Partial<SimWeaponDef> = {
    behaviour: w.behaviour,
    charges: num(uses['charges']),
    durabilityHits: num(uses['durabilityHits']),
  };
  const effects = Array.isArray(loose['effects']) ? loose['effects'].map(rec) : [];
  const stunS = num(effects.find((e) => e['kind'] === 'stun')?.['durationS']);
  if (stunS) out.stunTicks = secondsToTicks(stunS);
  const spawn = rec(loose['spawn']);
  const weight = num(spawn['roadsideWeight']);
  if (weight !== null) out.roadsideWeight = weight;
  const regions = Array.isArray(spawn['regions'])
    ? spawn['regions'].filter((r): r is string => typeof r === 'string' && r !== '')
    : [];
  if (regionKey !== undefined && regions.length > 0) {
    if (!regions.some((r) => qualifyIn(weaponPack, r) === regionKey)) out.roadsideWeight = 0;
  }
  return out;
}

/**
 * The career's grudge table as SimConfig carries it: finite points only, rows in id order (the
 * replay header writes it as given), empty rows dropped.
 */
export function cleanGrudges(g: RaceSetup['grudges']): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const rival of Object.keys(g ?? {}).sort()) {
    const row: Record<string, number> = {};
    const given = g?.[rival] ?? {};
    for (const rider of Object.keys(given).sort()) {
      const v = given[rider];
      if (typeof v === 'number' && Number.isFinite(v) && v !== 0) row[rider] = v;
    }
    if (Object.keys(row).length > 0) out[rival] = row;
  }
  return out;
}

/**
 * A grudge match's rival rule (run W-T, the pitch deck's #14: the event file's `rules.rule`), with
 * its rival qualified as the riders are, or nothing (so an event without one keeps its hash).
 */
export function eventGrudgeRule(event: RaceEvent, eventPack: string): Pick<SimEventDef, 'grudgeRule'> {
  const rule = event.rules.rule;
  const rival = event.rules.rival;
  if (event.kind !== 'grudge-match' || !rule || typeof rival !== 'string') return {};
  return { grudgeRule: { rule, rival: qualifyIn(eventPack, rival) } };
}

/** A race's registry with the named bikes (qualified keys) added from the full registry. */
function withBikes(
  race: ContentRegistry,
  reg: ContentRegistry,
  keys: readonly (string | null | undefined)[],
): ContentRegistry {
  const extra = keys.flatMap((k) => {
    const bike = k && !race.bikes[k] ? reg.bikes[k] : undefined;
    return k && bike ? [[k, bike] as const] : [];
  });
  if (extra.length === 0) return race;
  return { ...race, bikes: { ...race.bikes, ...Object.fromEntries(extra) } };
}

export function buildSimConfig(reg: ContentRegistry, stream: RegionStream, setup: RaceSetup): SimConfig {
  const eventId = eventKey(setup.eventId ?? DEFAULT_EVENT);
  const eventPack = packOf(eventId);
  // Only the race's packs (the event's pack and its dependencies) reach the race: carrying other
  // region packs never changes this race (docs/content-packs.md, "Region packs at runtime"). The one
  // exception is a bike the setup names: the garage is global and the career's field rides the best
  // bike open anywhere (playtest 3), so a Pacific Northwest bike rides in a Keys race too.
  const race = withBikes(packSubset(reg, packClosure(reg, eventPack)), reg, [
    setup.playerBike,
    setup.fieldLevel?.rivalBike,
    setup.fieldLevel?.copBike,
  ]);
  // A season's remix applies to the event before anything below reads it (the patch's length is the
  // one to race), then the career's field level sets the pace and reshapes the riders.
  const event = withEventPatch(lookup(race.events, eventId), setup.eventPatch);
  const level = setup.fieldLevel;
  const lengthId = setup.eventPatch?.lengthId ?? setup.length;
  const length = eventLength(event, lengthId);
  // The length's route, or a real-road route of the event's region when one is chosen.
  const routeId = raceRouteKey(race, eventId, lengthId, setup.route);
  const routeDef = lookup(race.routes, routeId);
  const route = stream.routeFor(routeDef);
  const pace = level?.paceMps ?? event.field.paceMps ?? 30;
  const rivalLevel: RiderLevel | undefined = level && {
    healthScale: level.healthScale,
    powerScale: level.powerScale,
  };
  const rivals = raceField(race, eventId, setup.seed, setup.freePlay, event).map((id) =>
    riderDef(
      race,
      id,
      aiController(lookup(race.riders, id).personality),
      pace,
      level?.rivalBike ?? undefined,
      rivalLevel,
    ),
  );
  // Grid order: rivals ahead, the player at the back of the racing grid, the law behind the player
  // (the race parks him a row back and he never takes a place).
  // The event's career tier (run W-R): 1 for an event without one (the free-play races).
  const tier = event.tier ?? DEFAULT_TIER;
  const copLevel: RiderLevel | undefined = level && {
    topCapMps: level.copTopCapMps,
    fineScale: level.fineScale,
  };
  const cops = copIds(race, eventId, tier).map((id) =>
    riderDef(race, id, { kind: 'cop' }, pace, level?.copBike ?? undefined, copLevel),
  );
  const player = riderDef(
    race,
    qualifyIn('base', PLAYER_PRESET),
    { kind: 'player', slot: 0 },
    pace,
    setup.playerBike,
  );
  const riders = [...rivals, player, ...cops];
  const weapons: SimWeaponDef[] = Object.entries(race.weapons).map(([contentId, w]) => ({
    contentId,
    unarmed: w.unarmed,
    reachSM: w.reach.sM,
    reachDM: w.reach.dM,
    windupTicks: secondsToTicks(w.windupS),
    activeTicks: secondsToTicks(w.activeS),
    recoveryTicks: secondsToTicks(w.recoveryS),
    cooldownTicks: w.cooldownS ? secondsToTicks(w.cooldownS) : 0,
    damage: w.damage,
    hitStopMs: w.hitStopMs ?? 0,
    knockbackMps: w.knockback?.lateralMps ?? 0,
    staggerTicks: w.knockback?.staggerS ? secondsToTicks(w.knockback.staggerS) : 0,
    steal: w.steal?.allowed
      ? { startTick: Math.round(w.steal.windowStartS * 60), endTick: Math.round(w.steal.windowEndS * 60) }
      : null,
    ...weaponBehaviour(w, qualifyIn(eventPack, event.region), packOf(contentId)),
  }));
  const weights = regionTrafficWeights(race, event, eventPack);
  const areaWeights = regionTrafficAreas(race, event, eventPack);
  // W-P: the road set pieces the event opts into (the sim rolls which fire, and where).
  const timeOfDay = raceTimeOfDay(race, eventId, setup.seed, setup.freePlay, event);
  const mods = eventModifiers(race, { ...event, timeOfDay: timeOfDay as RaceEvent['timeOfDay'] }, eventId);
  const given = setup.tuning ?? {};
  const tuning: Record<string, number> = tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim));
  for (const [id, value] of Object.entries(given)) if (!id.startsWith(DIFFICULTY_PREFIX)) tuning[id] = value;
  const playerSlots = 1;
  const slots: SimSlotConfig[] = Array.from({ length: playerSlots }, (_, i) => ({
    assists: { ...(setup.assists?.[i] ?? NO_ASSISTS) },
  }));
  return {
    seed: setup.seed >>> 0,
    event: {
      contentId: eventId,
      kind: event.kind,
      paceMps: pace,
      byPlaceCash: event.rewards.byPlaceCash,
      raceEndTimeoutTicks: secondsToTicks(RACE_END_TIMEOUT_S),
      lengthId: length.id,
      routeId,
      style: styleRewards(event.rewards),
      // M4 cops-3: the tier (1 until career-1) and the law's spawn mix, chaos meter and fines.
      tier,
      cops: ((c, j) => (j ? { ...c, jurisdiction: j } : c))(eventCops(event), jurisdictionOf(race, cops)),
      ...(mods.perRace !== undefined ? { modifiersPerRace: mods.perRace } : {}),
      ...eventGrudgeRule(event, eventPack),
      // The career field's fighting scales (absent: the sim reads 1 and 1, and the hash is as before).
      ...(level
        ? { level: { aggressionScale: level.aggressionScale, signatureGapScale: level.signatureGapScale } }
        : {}),
    },
    riders,
    weapons,
    trafficTypes: Object.entries(race.trafficTypes).map(([contentId, t]) => ({
      contentId,
      category: t.category,
      lengthM: t.lengthM,
      widthM: t.widthM,
      cruiseMps: t.cruiseMps,
      hazard: t.hazard,
      ...(weights ? { weight: weights.get(contentId) ?? 0 } : {}),
      ...areaWeightsOf(areaWeights, contentId),
      ...trafficBehaviour(t.behaviour),
    })),
    road: stream.road,
    route,
    modifiers: mods.modifiers,
    grudges: cleanGrudges(setup.grudges),
    tuning,
    difficulty: resolveDifficulty(setup.difficulty ?? DEFAULT_DIFFICULTY, given),
    assists: 'off',
    slowMo: setup.slowMo ?? true,
    playerSlots,
    slots,
    speedMultiplier: validSpeed(setup.speedMultiplier),
    smashables: regionSmashables(race, event, eventPack),
  };
}
