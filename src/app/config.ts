// buildSimConfig: resolves content into the plain data a race starts from (docs/architecture.md,
// "Sim contract"). The sim never imports content/ or tuning/; everything arrives here. M2 adds the
// Easy/Normal/Hard preset resolution to `difficulty` without any reader changing.
import { lookup, type ContentRegistry, type Rider } from '../content';
import {
  SIM_TUNING,
  secondsToTicks,
  tuningDefaults,
  type SimAiPersonality,
  type SimConfig,
  type SimController,
  type SimRiderDef,
  type SimWeaponDef,
} from '../sim/api';
import { activateRegion, type RegionStream } from '../stream';

export const DEFAULT_EVENT = 'm1-skeleton-sprint';
export const PLAYER_PRESET = 'player';
/** Race-end timeout after the player finishes (M1 starting numbers: 30 s). */
export const RACE_END_TIMEOUT_S = 30;

export interface RaceSetup {
  seed: number;
  eventId?: string;
  /** Sim-affecting tuning values; missing ids take their declared defaults. */
  tuning?: Readonly<Record<string, number>>;
}

/** Activates the region stream for an event's route network (one per network, cached by caller). */
export function streamForEvent(reg: ContentRegistry, eventId = DEFAULT_EVENT): RegionStream {
  const event = lookup(reg.events, eventId);
  const length = event.lengths[0];
  if (!length) throw new Error(`event ${eventId} has no length`);
  const route = lookup(reg.routes, length.route);
  const network = lookup(reg.networks, route.network);
  return activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
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
  return { kind: 'ai', style: personality?.style ?? 'racer', personality: own };
}

function riderDef(
  reg: ContentRegistry,
  id: string,
  controller: SimRiderDef['controller'],
  paceMps: number,
): SimRiderDef {
  const rider = lookup(reg.riders, id);
  const bike = lookup(reg.bikes, rider.bike);
  const h = bike.handling;
  // Rival pace comes from the event, not the bike: a rival's bike is raised to at least the pace.
  const floor = controller.kind === 'ai' ? paceMps : 0;
  return {
    contentId: `base:${rider.id}`,
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
      contentId: `base:${bike.id}`,
      topSpeedMps: Math.max(h.topSpeedMps, floor),
      accelMps2: h.accelMps2,
      brakeMps2: h.brakeMps2,
      steerRateMps: h.steerRateMps,
      massKg: h.massKg,
    },
    massKg: rider.stats?.massKg ?? 80,
    healthMax: rider.stats?.healthMax ?? 100,
  };
}

export function buildSimConfig(reg: ContentRegistry, stream: RegionStream, setup: RaceSetup): SimConfig {
  const eventId = setup.eventId ?? DEFAULT_EVENT;
  const event = lookup(reg.events, eventId);
  const length = event.lengths[0];
  if (!length) throw new Error(`event ${eventId} has no length`);
  const route = stream.routeFor(lookup(reg.routes, length.route));
  const pace = event.field.paceMps ?? 30;
  const rivals = (event.field.riders ?? []).map((id) =>
    riderDef(reg, id, aiController(lookup(reg.riders, id).personality), pace),
  );
  // Grid order: rivals ahead, the player at the back of the grid.
  const riders = [...rivals, riderDef(reg, PLAYER_PRESET, { kind: 'player', slot: 0 }, pace)];
  const weapons: SimWeaponDef[] = Object.values(reg.weapons).map((w) => ({
    contentId: `base:${w.id}`,
    unarmed: w.unarmed,
    reachSM: w.reach.sM,
    reachDM: w.reach.dM,
    windupTicks: secondsToTicks(w.windupS),
    activeTicks: secondsToTicks(w.activeS),
    recoveryTicks: secondsToTicks(w.recoveryS),
    cooldownTicks: w.cooldownS ? secondsToTicks(w.cooldownS) : 0,
    damage: w.damage,
    hitStopMs: w.hitStopMs ?? 0,
    steal: w.steal?.allowed
      ? { startTick: Math.round(w.steal.windowStartS * 60), endTick: Math.round(w.steal.windowEndS * 60) }
      : null,
  }));
  const tuning = { ...tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)), ...(setup.tuning ?? {}) };
  return {
    seed: setup.seed >>> 0,
    event: {
      contentId: `base:${event.id}`,
      kind: event.kind,
      paceMps: pace,
      byPlaceCash: event.rewards.byPlaceCash,
      raceEndTimeoutTicks: secondsToTicks(RACE_END_TIMEOUT_S),
    },
    riders,
    weapons,
    trafficTypes: Object.values(reg.trafficTypes).map((t) => ({
      contentId: `base:${t.id}`,
      category: t.category,
      lengthM: t.lengthM,
      widthM: t.widthM,
      cruiseMps: t.cruiseMps,
      hazard: t.hazard,
    })),
    road: stream.road,
    route,
    modifiers: [],
    grudges: {},
    tuning,
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 1,
  };
}
