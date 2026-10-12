import type { ContentHashes, ContentRegistry } from '../content';
import type { ReplayConfig } from '../replay';
import type { RaceWeather } from '../save';
import type { SimConfig, SimTrafficTypeDef } from '../sim/api';
import type { RegionStream } from '../stream';
import type { Garage } from './race-options';
import type { RaceSky } from './regions';
import { contentHashes, packClosure, packOf, packSubset } from '../content';
import { replayHeader } from '../replay';
import { DEFAULT_RACE_OPTIONS, DEFAULT_SETTINGS, settingsAssists } from '../save';
import {
  buildSimConfig,
  copIds,
  PLAYER_PRESET,
  qualifyIn,
  raceField,
  raceTimeOfDay,
  realRoutes,
  streamForRoute,
} from './config';
import { quickPlayEvents } from './quick-play-events';
import { menuBikes } from './race-options';
import { raceSky } from './regions';

export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export interface MeasurementSceneSelection {
  regionId: string;
  routeId: string | null;
  seed: number;
  garage: Readonly<Garage>;
  bike: string | null;
  timeOfDay: string | null;
  weather: RaceWeather;
}
export type BikeSelectionSource = 'menu' | 'garage' | 'starter';
export type TrafficDirection = 'same' | 'oncoming';
export type CopMode = NonNullable<SimConfig['event']['cops']>['mode'];
export type SeedIssue = 'not-finite' | 'not-uint32' | null;

export interface MeasurementRequestSummary {
  regionId: string;
  routeId: string | null;
  bikeId: string | null;
  garageCurrentBikeId: string | null;
  timeOfDay: string | null;
  weather: RaceWeather;
  seed: number | null;
  seedIssue: SeedIssue;
}
export interface MeasurementTrafficTypeCapability {
  contentId: string;
  category: SimTrafficTypeDef['category'];
  globalWeight: number;
  areaWeights: Readonly<Record<string, number>>;
  initializationCompatible: boolean;
  rollingOddity: boolean;
  usableDirections: readonly TrafficDirection[];
}
export interface MeasurementTrafficCapability {
  inputs: {
    master: number | null;
    same: number | null;
    oncoming: number | null;
    oddities: number | null;
    oncomingEaseInS: number | null;
  };
  clampedDensity: { master: number | null; same: number | null; oncoming: number | null };
  effectiveDensity: { same: number | null; oncomingTarget: number | null; oncomingAtStart: number | null };
  oncomingEase: { enabled: boolean; startFactor: number; finalFactor: 1 };
  enabledDirections: readonly TrafficDirection[];
  types: readonly MeasurementTrafficTypeCapability[];
  capable: boolean;
}
export interface MeasurementSceneDescription {
  requested: MeasurementRequestSummary;
  eventId: string;
  regionId: string;
  route: {
    requestedId: string | null;
    actualId: string;
    networkId: string;
    standardLengthId: 'standard';
    lengthM: number;
  };
  seed: number;
  bike: { intendedId: string; actualId: string; source: BikeSelectionSource };
  field: {
    productLimit: 9;
    eligibleCount: number;
    maximumRivals: number;
    actualRivalIds: readonly string[];
    actualRivalCount: number;
  };
  law: { riderIds: readonly string[]; mode: CopMode; copFrequency: number };
  traffic: MeasurementTrafficCapability;
  light: { requestedId: string | null; actualId: string };
  weather: { requested: RaceWeather; sky: RaceSky };
  contentIdentity: {
    eventPackIds: readonly string[];
    effectivePlayerBikeId: string;
    hashes: ContentHashes;
  };
  configProjection: DeepReadonly<ReplayConfig>;
  presentation: { graphicsPolicy: 'retain-current-graphics'; requiredFrameDivisor: 1 };
}
export type MeasurementSceneRefusal =
  | 'invalid-seed'
  | 'region-unavailable'
  | 'classic-unavailable'
  | 'standard-length-unavailable'
  | 'bike-unavailable'
  | 'light-unavailable'
  | 'route-unavailable'
  | 'route-incompatible'
  | 'content-not-ready'
  | 'empty-field'
  | 'law-unavailable'
  | 'traffic-unavailable'
  | 'resolved-scene-mismatch';
export type MeasurementFailedCheck =
  | 'seed'
  | 'region'
  | 'classic'
  | 'standard-length'
  | 'bike'
  | 'light'
  | 'route-entry'
  | 'route-membership'
  | 'content-dependencies'
  | 'field'
  | 'law'
  | 'traffic'
  | 'resolved-event'
  | 'resolved-region'
  | 'resolved-route'
  | 'resolved-bike'
  | 'resolved-field';
export type MeasurementMissingContentKind =
  'pack' | 'event' | 'region' | 'route' | 'network' | 'road' | 'rider' | 'bike';
export interface MeasurementSceneRefusalEvidence {
  requested: MeasurementRequestSummary;
  failedCheck: MeasurementFailedCheck;
  expectedEventId: string | null;
  actualEventId: string | null;
  expectedEventKind: 'classic-race';
  actualEventKind: SimConfig['event']['kind'] | null;
  expectedRegionId: string;
  actualEventRegionId: string | null;
  expectedRouteId: string | null;
  actualRouteId: string | null;
  expectedNetworkId: string | null;
  actualNetworkId: string | null;
  actualNetworkRegionId: string | null;
  intendedBikeId: string | null;
  bikeSource: BikeSelectionSource | null;
  actualBikeId: string | null;
  actualTimeOfDay: string | null;
  field: {
    productLimit: 9;
    eligibleCount: number | null;
    maximumRivals: number | null;
    actualRivalIds: readonly string[] | null;
    actualRivalCount: number | null;
  };
  law: { riderIds: readonly string[]; mode: CopMode | null; copFrequency: number | null } | null;
  traffic: MeasurementTrafficCapability | null;
  missingContent: readonly { kind: MeasurementMissingContentKind; id: string }[];
}
export type MeasurementSceneResult =
  | {
      kind: 'ready';
      config: SimConfig;
      stream: RegionStream;
      scene: DeepReadonly<MeasurementSceneDescription>;
    }
  | {
      kind: 'refused';
      reason: MeasurementSceneRefusal;
      evidence: DeepReadonly<MeasurementSceneRefusalEvidence>;
    };

/** Freeze only owned metadata; the fresh config and stream remain runtime handles. */
function immutable<T>(value: T): DeepReadonly<T> {
  const copy = structuredClone(value);
  const freeze = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  };
  freeze(copy);
  return copy as DeepReadonly<T>;
}

const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);
const positive = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
const clampDensity = (n: number | null): number | null => (n === null ? null : Math.min(10, Math.max(0, n)));

/** Configured initialization and directional capability, never observed spawning. */
function trafficCapability(config: SimConfig): MeasurementTrafficCapability {
  const read = (id: string, fallback: number) => finite(config.tuning[id] ?? fallback);
  const inputs = {
    master: read('traffic.density', 1),
    same: read('traffic.densitySame', 1),
    oncoming: read('traffic.densityOncoming', 1),
    oddities: read('traffic.oddities', 1),
    oncomingEaseInS: read('traffic.oncomingEaseInS', 0),
  };
  const clampedDensity = {
    master: clampDensity(inputs.master),
    same: clampDensity(inputs.same),
    oncoming: clampDensity(inputs.oncoming),
  };
  const product = (n: number | null) =>
    clampedDensity.master === null || n === null ? null : clampedDensity.master * n;
  const same = product(clampedDensity.same);
  const oncomingTarget = product(clampedDensity.oncoming);
  const enabled = (config.tuning['traffic.oncomingEaseInS'] ?? 0) > 0;
  const startFactor = enabled ? 0.25 : 1;
  const enabledDirections: TrafficDirection[] = [];
  if (same !== null && same > 0) enabledDirections.push('same');
  if (oncomingTarget !== null && oncomingTarget > 0) enabledDirections.push('oncoming');
  const weights: Partial<Record<SimTrafficTypeDef['category'], number>> = {
    car: 5,
    truck: 2,
    rv: 1.5,
    oddity: 0.5,
  };
  const types = config.trafficTypes.map((type): MeasurementTrafficTypeCapability => {
    const fallback = weights[type.category];
    const globalWeight = positive(type.weight ?? fallback ?? 0);
    const areaWeights = Object.fromEntries(
      Object.entries(type.areaWeights ?? {}).map(([id, weight]) => [id, positive(weight)]),
    );
    const initializationCompatible =
      fallback !== undefined && (globalWeight > 0 || Object.values(areaWeights).some((w) => w > 0));
    const rollingOddity = type.category === 'oddity' && type.cruiseMps > 0;
    const usableDirections = !initializationCompatible
      ? []
      : type.category !== 'oddity'
        ? [...enabledDirections]
        : (inputs.oddities ?? 0) > 0
          ? enabledDirections.filter((d) => !rollingOddity || d === 'oncoming')
          : [];
    return {
      contentId: type.contentId,
      category: type.category,
      globalWeight,
      areaWeights,
      initializationCompatible,
      rollingOddity,
      usableDirections,
    };
  });
  return {
    inputs,
    clampedDensity,
    effectiveDensity: {
      same,
      oncomingTarget,
      oncomingAtStart: oncomingTarget === null ? null : oncomingTarget * startFactor,
    },
    oncomingEase: { enabled, startFactor, finalFactor: 1 },
    enabledDirections,
    types,
    capable:
      inputs.master !== null &&
      inputs.master > 0 &&
      enabledDirections.length > 0 &&
      types.some((t) => t.usableDirections.length > 0),
  };
}

/** Prepare a diagnostic scene from loaded content, without starting a race or touching normal state. */
export function resolveMeasurementScene(
  reg: ContentRegistry,
  selection: Readonly<MeasurementSceneSelection>,
): MeasurementSceneResult {
  const seedIssue: SeedIssue = !Number.isFinite(selection.seed)
    ? 'not-finite'
    : !Number.isInteger(selection.seed) || selection.seed < 0 || selection.seed > 0xffffffff
      ? 'not-uint32'
      : null;
  const requested: MeasurementRequestSummary = {
    regionId: selection.regionId,
    routeId: selection.routeId,
    bikeId: selection.bike,
    garageCurrentBikeId: selection.garage.current,
    timeOfDay: selection.timeOfDay,
    weather: selection.weather,
    seed: finite(selection.seed),
    seedIssue,
  };
  const missing: { kind: MeasurementMissingContentKind; id: string }[] = [];
  const evidence: MeasurementSceneRefusalEvidence = {
    requested,
    failedCheck: 'seed',
    expectedEventId: null,
    actualEventId: null,
    expectedEventKind: 'classic-race',
    actualEventKind: null,
    expectedRegionId: selection.regionId,
    actualEventRegionId: null,
    expectedRouteId: null,
    actualRouteId: null,
    expectedNetworkId: null,
    actualNetworkId: null,
    actualNetworkRegionId: null,
    intendedBikeId: null,
    bikeSource: null,
    actualBikeId: null,
    actualTimeOfDay: null,
    field: {
      productLimit: 9,
      eligibleCount: null,
      maximumRivals: null,
      actualRivalIds: null,
      actualRivalCount: null,
    },
    law: null,
    traffic: null,
    missingContent: missing,
  };
  const absent = (kind: MeasurementMissingContentKind, id: string) => {
    if (!missing.some((m) => m.kind === kind && m.id === id)) missing.push({ kind, id });
  };
  const refuse = (
    reason: MeasurementSceneRefusal,
    failedCheck: MeasurementFailedCheck,
  ): MeasurementSceneResult => {
    evidence.failedCheck = failedCheck;
    missing.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    return { kind: 'refused', reason, evidence: immutable(evidence) };
  };
  const visitedPacks = new Set<string>();
  const checkPack = (id: string): void => {
    if (visitedPacks.has(id)) return;
    visitedPacks.add(id);
    const manifest = reg.packs.find((p) => p.id === id);
    if (!manifest) {
      absent('pack', id);
      return;
    }
    for (const dep of Object.keys(manifest.dependencies ?? {})) checkPack(dep);
  };
  if (seedIssue) return refuse('invalid-seed', 'seed');
  const region = reg.regions[selection.regionId];
  if (!selection.regionId.includes(':') || !region) {
    absent('region', selection.regionId);
    return refuse('region-unavailable', 'region');
  }
  // The public selector inspects Escape law before returning its complete family list.
  // Preflight only the manifests those eligible Escape filters can send to copIds.
  for (const [id, event] of Object.entries(reg.events)) {
    if (
      event.kind === 'cop-escape' &&
      !event.finale &&
      qualifyIn(packOf(id), event.region) === selection.regionId &&
      !event.objectives.some((o) => o.required && o.kind === 'ride-branch') &&
      event.cops?.mode !== 'none'
    )
      checkPack(packOf(id));
  }
  if (missing.length) return refuse('content-not-ready', 'content-dependencies');
  const choice = quickPlayEvents(reg, selection.regionId).find((c) => c.kind === 'race');
  if (!choice) return refuse('classic-unavailable', 'classic');
  const eventId = choice.eventId;
  evidence.expectedEventId = eventId;
  const event = reg.events[eventId];
  if (
    !event ||
    event.kind !== 'classic-race' ||
    qualifyIn(packOf(eventId), event.region) !== selection.regionId
  )
    return refuse('classic-unavailable', 'classic');
  const standard = event.lengths.find((l) => l.id === 'standard');
  if (!standard) return refuse('standard-length-unavailable', 'standard-length');
  const starterId = qualifyIn('base', PLAYER_PRESET);
  const source: BikeSelectionSource =
    selection.bike !== null ? 'menu' : selection.garage.current !== null ? 'garage' : 'starter';
  evidence.bikeSource = source;
  const starter = reg.riders[starterId];
  const bikeId =
    selection.bike ??
    selection.garage.current ??
    (starter ? qualifyIn(packOf(starterId), starter.bike) : null);
  evidence.intendedBikeId = bikeId;
  if (!bikeId) {
    absent('rider', starterId);
    return refuse('content-not-ready', 'content-dependencies');
  }
  if (source === 'starter' && !reg.bikes[bikeId]) {
    absent('bike', bikeId);
    return refuse('content-not-ready', 'content-dependencies');
  }
  if (
    !bikeId.includes(':') ||
    !reg.bikes[bikeId] ||
    !menuBikes(reg, selection.garage.owned).includes(bikeId)
  ) {
    if (!reg.bikes[bikeId]) absent('bike', bikeId);
    return refuse('bike-unavailable', 'bike');
  }
  if (selection.timeOfDay !== null && !region.timeOfDayOptions.some((t) => t.id === selection.timeOfDay))
    return refuse('light-unavailable', 'light');
  const routeId = selection.routeId ?? qualifyIn(packOf(eventId), standard.route);
  evidence.expectedRouteId = routeId;
  const target = reg.routes[routeId];
  if (!routeId.includes(':') || !target) {
    absent('route', routeId);
    return refuse(
      selection.routeId !== null ? 'route-unavailable' : 'content-not-ready',
      selection.routeId !== null ? 'route-entry' : 'content-dependencies',
    );
  }
  evidence.expectedNetworkId = qualifyIn(packOf(routeId), target.network);
  // Preflight the closure without suppressing unexpected selector or builder errors.
  checkPack(packOf(eventId));
  const checkRoute = (id: string): void => {
    const route = reg.routes[id];
    if (!route) {
      absent('route', id);
      return;
    }
    const networkId = qualifyIn(packOf(id), route.network);
    const network = reg.networks[networkId];
    if (!network) absent('network', networkId);
    else {
      const regionId = qualifyIn(packOf(networkId), network.region);
      if (!reg.regions[regionId]) absent('region', regionId);
      for (const road of network.roads) {
        const key = qualifyIn(packOf(networkId), road);
        if (!reg.roads[key]) absent('road', key);
      }
    }
    const roads = [
      route.start.road,
      route.finish.road,
      ...route.mainPath,
      ...route.allowedRoads,
      ...((route as Parameters<RegionStream['routeFor']>[0]).checkpoints ?? []).map((c) => c.road),
      ...(route.branches ?? []).flatMap((b) => b.roads),
    ];
    for (const road of roads) {
      const key = qualifyIn(packOf(id), road);
      if (!reg.roads[key]) absent('road', key);
    }
  };
  for (const length of event.lengths) checkRoute(qualifyIn(packOf(eventId), length.route));
  checkRoute(routeId);
  if (!starter) absent('rider', starterId);
  if (missing.length) return refuse('content-not-ready', 'content-dependencies');
  const eventPackIds = packClosure(reg, packOf(eventId));
  const eventReg = packSubset(reg, eventPackIds);
  const field = raceField(eventReg, eventId, selection.seed, true, undefined, 9);
  const checkRider = (id: string, overridden = false) => {
    const rider = eventReg.riders[id];
    if (!rider) {
      absent('rider', id);
      return;
    }
    if (!overridden) {
      const key = qualifyIn(packOf(id), rider.bike);
      if (!eventReg.bikes[key]) absent('bike', key);
    }
  };
  checkRider(starterId, true);
  for (const id of [...field, ...copIds(eventReg, eventId, event.tier ?? 1)]) checkRider(id);
  if (missing.length) return refuse('content-not-ready', 'content-dependencies');
  if (selection.routeId !== null && !realRoutes(reg, eventId).includes(routeId))
    return refuse('route-incompatible', 'route-membership');
  const eligibleCount = Object.entries(eventReg.riders).filter(
    ([id, r]) => r.role === 'rival' && (!r.region || qualifyIn(packOf(id), r.region) === selection.regionId),
  ).length;
  const maximumRivals = (event.field.riders ?? []).length === 0 ? 0 : Math.min(eligibleCount, 9);
  evidence.field.eligibleCount = eligibleCount;
  evidence.field.maximumRivals = maximumRivals;
  if (maximumRivals === 0) return refuse('empty-field', 'field');
  const stream = streamForRoute(reg, routeId);
  const config = buildSimConfig(reg, stream, {
    seed: selection.seed,
    eventId,
    length: DEFAULT_SETTINGS.raceLength,
    ...(selection.routeId !== null ? { route: routeId } : {}),
    playerBike: bikeId,
    ...(selection.timeOfDay !== null ? { timeOfDay: selection.timeOfDay } : {}),
    freePlay: true,
    rivals: 9,
    cops: DEFAULT_RACE_OPTIONS.cops,
    difficulty: DEFAULT_SETTINGS.difficulty,
    assists: [settingsAssists(DEFAULT_SETTINGS)],
    speedMultiplier: DEFAULT_SETTINGS.speedMultiplier,
    slowMo: DEFAULT_SETTINGS.slowMo,
  });
  // Resolve every independently observable built reference before the first comparison.
  evidence.actualEventId = config.event.contentId;
  evidence.actualEventKind = config.event.kind;
  evidence.actualRouteId = config.event.routeId ?? null;
  const actualEvent = reg.events[evidence.actualEventId];
  if (!actualEvent) absent('event', evidence.actualEventId);
  else {
    const id = qualifyIn(packOf(evidence.actualEventId), actualEvent.region);
    if (!reg.regions[id]) absent('region', id);
    else evidence.actualEventRegionId = id;
  }
  const actualRoute = evidence.actualRouteId === null ? undefined : reg.routes[evidence.actualRouteId];
  if (!actualRoute && evidence.actualRouteId !== null) absent('route', evidence.actualRouteId);
  if (actualRoute && evidence.actualRouteId !== null) {
    const id = qualifyIn(packOf(evidence.actualRouteId), actualRoute.network);
    evidence.actualNetworkId = id;
    const network = reg.networks[id];
    if (!network) absent('network', id);
    else {
      const regionId = qualifyIn(packOf(id), network.region);
      if (!reg.regions[regionId]) absent('region', regionId);
      else evidence.actualNetworkRegionId = regionId;
    }
  }
  const players = config.riders.filter((r) => r.role === 'player');
  evidence.actualBikeId = players.length === 1 ? (players[0]?.bike.contentId ?? null) : null;
  for (const rider of config.riders) {
    if (!reg.riders[rider.contentId]) absent('rider', rider.contentId);
    if (!reg.bikes[rider.bike.contentId]) absent('bike', rider.bike.contentId);
  }
  const actualRivalIds = config.riders.filter((r) => r.role === 'rival').map((r) => r.contentId);
  evidence.field.actualRivalIds = actualRivalIds;
  evidence.field.actualRivalCount = actualRivalIds.length;
  const actualLight = raceTimeOfDay(reg, eventId, selection.seed, true, undefined, selection.timeOfDay);
  evidence.actualTimeOfDay = actualLight;
  if (evidence.actualEventId !== eventId || evidence.actualEventKind !== 'classic-race')
    return refuse('resolved-scene-mismatch', 'resolved-event');
  if (
    evidence.actualEventRegionId !== selection.regionId ||
    evidence.actualNetworkRegionId !== selection.regionId
  )
    return refuse('resolved-scene-mismatch', 'resolved-region');
  if (
    evidence.actualRouteId !== routeId ||
    evidence.actualNetworkId !== evidence.expectedNetworkId ||
    config.road !== stream.road ||
    config.route !== stream.routeFor(target) ||
    config.route.routeId !== target.id
  )
    return refuse('resolved-scene-mismatch', 'resolved-route');
  if (evidence.actualBikeId !== bikeId) return refuse('resolved-scene-mismatch', 'resolved-bike');
  if (actualRivalIds.length !== maximumRivals || actualRivalIds.some((id, i) => id !== field[i]))
    return refuse('resolved-scene-mismatch', 'resolved-field');
  const lawIds = config.riders.filter((r) => r.role === 'cop' && r.law).map((r) => r.contentId);
  const mode = config.event.cops?.mode ?? null;
  const copFrequency = finite(config.difficulty.copFrequency);
  evidence.law = { riderIds: lawIds, mode, copFrequency };
  if (mode === null || mode === 'none' || lawIds.length === 0 || copFrequency === null || copFrequency <= 0)
    return refuse('law-unavailable', 'law');
  const traffic = trafficCapability(config);
  evidence.traffic = traffic;
  if (!traffic.capable) return refuse('traffic-unavailable', 'traffic');
  const effective = { ...eventReg, bikes: { ...eventReg.bikes, [bikeId]: reg.bikes[bikeId] } };
  const projection = replayHeader(config, 'measurement-scene').config;
  if (!projection) throw new Error('measurement scene: replay projection missing');
  return {
    kind: 'ready',
    config,
    stream,
    scene: immutable({
      requested,
      eventId,
      regionId: evidence.actualEventRegionId,
      route: {
        requestedId: selection.routeId,
        actualId: routeId,
        networkId: evidence.expectedNetworkId,
        standardLengthId: 'standard' as const,
        lengthM: config.route.length,
      },
      seed: selection.seed,
      bike: { intendedId: bikeId, actualId: bikeId, source },
      field: {
        productLimit: 9 as const,
        eligibleCount,
        maximumRivals,
        actualRivalIds,
        actualRivalCount: actualRivalIds.length,
      },
      law: { riderIds: lawIds, mode, copFrequency },
      traffic,
      light: { requestedId: selection.timeOfDay, actualId: actualLight },
      weather: { requested: selection.weather, sky: raceSky(reg, eventId, actualLight, selection.weather) },
      contentIdentity: { eventPackIds, effectivePlayerBikeId: bikeId, hashes: contentHashes(effective) },
      configProjection: projection,
      presentation: { graphicsPolicy: 'retain-current-graphics' as const, requiredFrameDivisor: 1 as const },
    }),
  };
}
