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
  // A cop rides his bike scaled by his pursuit speed, with no pace floor, and carries his law
  // block (cops-1; docs/content-packs.md, "Rider").
  const law = controller.kind === 'cop' ? rider.law : undefined;
  const speedScale = law?.pursuitSpeedScale ?? 1;
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
      topSpeedMps: Math.max(h.topSpeedMps * speedScale, floor),
      accelMps2: h.accelMps2,
      brakeMps2: h.brakeMps2,
      steerRateMps: h.steerRateMps,
      massKg: h.massKg,
    },
    massKg: rider.stats?.massKg ?? 80,
    healthMax: rider.stats?.healthMax ?? 100,
    ...(law
      ? {
          law: {
            agency: law.agency.includes(':') ? law.agency : `base:${law.agency}`,
            bustRadiusM: law.bustRadiusM,
            bustDwellS: law.bustDwellS,
            fineCash: law.fineCash,
            pursuitSpeedScale: law.pursuitSpeedScale,
          },
        }
      : {}),
  };
}

/**
 * The event's law (docs/content-packs.md, "Event": `cops`). `every-race` fields `baseCount` cops
 * (default 1): the region's cop riders, in id order, at the back of the grid behind the player.
 * `tier-rising` and `chaos-summoned` need the career and the chaos meter (M4), so they field none
 * in M1, like `none`. [default]
 */
export function copIds(reg: ContentRegistry, eventId = DEFAULT_EVENT): string[] {
  const event = lookup(reg.events, eventId);
  const cops = event.cops as { mode: string; baseCount?: unknown };
  if (cops.mode !== 'every-race') return [];
  const count =
    typeof cops.baseCount === 'number' && Number.isFinite(cops.baseCount)
      ? Math.max(0, Math.floor(cops.baseCount))
      : 1;
  const pool = Object.values(reg.riders)
    .filter((r) => r.role === 'cop' && r.law && (!r.region || r.region === event.region))
    .map((r) => r.id)
    .sort();
  if (pool.length === 0) return [];
  return Array.from({ length: count }, (_, i) => pool[i % pool.length] ?? '');
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
  // Grid order: rivals ahead, the player at the back of the racing grid, the law behind the player
  // (the race parks him a row back and he never takes a place).
  const cops = copIds(reg, eventId).map((id) => riderDef(reg, id, { kind: 'cop' }, pace));
  const riders = [...rivals, riderDef(reg, PLAYER_PRESET, { kind: 'player', slot: 0 }, pace), ...cops];
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
    knockbackMps: w.knockback?.lateralMps ?? 0,
    staggerTicks: w.knockback?.staggerS ? secondsToTicks(w.knockback.staggerS) : 0,
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
