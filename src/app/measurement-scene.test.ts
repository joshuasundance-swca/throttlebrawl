import { afterEach, describe, expect, it, vi } from 'vitest';
import * as content from '../content';
import {
  contentHashes,
  packClosure,
  packOf,
  packSubset,
  registryFromGlob,
  type ContentRegistry,
  type RaceEvent,
} from '../content';
import { replayHeader } from '../replay';
import * as replay from '../replay';
import { DEFAULT_SETTINGS, settingsAssists } from '../save';
import type { SimConfig, SimTrafficTypeDef } from '../sim/api';
import * as builder from './config';
import { qualifyIn, raceField, raceTimeOfDay, realRoutes } from './config';
import {
  resolveMeasurementScene,
  type DeepReadonly,
  type MeasurementSceneSelection,
  type MeasurementSceneResult,
  type MeasurementSceneDescription,
  type MeasurementSceneRefusal,
  type MeasurementSceneRefusalEvidence,
  type MeasurementFailedCheck,
} from './measurement-scene';
import { quickPlayEvent, quickPlayEvents } from './quick-play-events';
import * as quickPlay from './quick-play-events';
import { menuBikes } from './race-options';
import { raceSky } from './regions';

const ALL = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const regionId = Object.keys(ALL.regions).find((id) =>
  quickPlayEvents(ALL, id).some((e) => e.kind === 'race'),
)!;
const selection: MeasurementSceneSelection = {
  regionId,
  routeId: null,
  seed: 123,
  garage: { owned: [], current: null },
  bike: null,
  timeOfDay: null,
  weather: 'local',
};
const eventId = quickPlayEvents(ALL, regionId).find((e) => e.kind === 'race')!.eventId;
const event = ALL.events[eventId]!;
const routeId = qualifyIn(packOf(eventId), event.lengths.find((l) => l.id === 'standard')!.route);
const networkId = qualifyIn(packOf(routeId), ALL.routes[routeId]!.network);
const ready = (
  reg = ALL,
  pick: Partial<MeasurementSceneSelection> = {},
): Extract<MeasurementSceneResult, { kind: 'ready' }> => {
  const result = resolveMeasurementScene(reg, { ...selection, ...pick });
  expect(result.kind, JSON.stringify(result.kind === 'refused' ? result : null)).toBe('ready');
  if (result.kind !== 'ready') throw new Error(result.reason);
  return result;
};
const evidenceKeys = [
  'requested',
  'failedCheck',
  'expectedEventId',
  'actualEventId',
  'expectedEventKind',
  'actualEventKind',
  'expectedRegionId',
  'actualEventRegionId',
  'expectedRouteId',
  'actualRouteId',
  'expectedNetworkId',
  'actualNetworkId',
  'actualNetworkRegionId',
  'intendedBikeId',
  'bikeSource',
  'actualBikeId',
  'actualTimeOfDay',
  'field',
  'law',
  'traffic',
  'missingContent',
].sort();
function refused(
  reg: ContentRegistry,
  pick: Partial<MeasurementSceneSelection>,
  reason: MeasurementSceneRefusal,
  check: MeasurementFailedCheck,
): DeepReadonly<MeasurementSceneRefusalEvidence> {
  const result = resolveMeasurementScene(reg, { ...selection, ...pick });
  expect(result.kind).toBe('refused');
  if (result.kind !== 'refused') throw new Error('expected refusal');
  expect(result.reason).toBe(reason);
  expect(result.evidence.failedCheck).toBe(check);
  expect(Object.keys(result.evidence).sort()).toEqual(evidenceKeys);
  expect(Object.keys(result.evidence.field).sort()).toEqual([
    'actualRivalCount',
    'actualRivalIds',
    'eligibleCount',
    'maximumRivals',
    'productLimit',
  ]);
  expect(result.evidence.expectedRegionId).toBe(pick.regionId ?? regionId);
  expect(result.evidence.expectedEventKind).toBe('classic-race');
  expect(result.evidence.field.productLimit).toBe(9);
  return result.evidence;
}
const withEvent = (patch: Partial<RaceEvent>): ContentRegistry => ({
  ...ALL,
  events: { ...ALL.events, [eventId]: { ...event, ...patch } },
});
const without = <T>(table: Readonly<Record<string, T>>, id: string): Record<string, T> =>
  Object.fromEntries(Object.entries(table).filter(([key]) => key !== id));
function substitute(change: (config: SimConfig) => SimConfig) {
  const real = builder.buildSimConfig;
  vi.spyOn(builder, 'buildSimConfig').mockImplementation((...args) => change(real(...args)));
}
const noActual = (e: DeepReadonly<MeasurementSceneRefusalEvidence>) => {
  for (const key of [
    'actualEventId',
    'actualEventKind',
    'actualEventRegionId',
    'actualRouteId',
    'actualNetworkId',
    'actualNetworkRegionId',
    'actualBikeId',
    'actualTimeOfDay',
  ] as const)
    expect(e[key], key).toBeNull();
  expect(e.field.actualRivalIds).toBeNull();
  expect(e.field.actualRivalCount).toBeNull();
  expect(e.law).toBeNull();
  expect(e.traffic).toBeNull();
};
function frozenTree(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) frozenTree(child);
}
afterEach(() => vi.restoreAllMocks());

describe('diagnostic measurement scene contract', () => {
  it('resolves an inspected loaded classic scene with configured workload', () => {
    const result = resolveMeasurementScene(ALL, selection);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error(result.reason);
    expect(result.config.event.kind).toBe('classic-race');
    expect(result.scene.field.actualRivalCount).toBeGreaterThan(0);
    expect(result.scene.law.riderIds.length).toBeGreaterThan(0);
    expect(result.scene.traffic.capable).toBe(true);
    expect(result.config.slowMo).toBe(true);
  });

  it('inspects loaded regional workload with an independent closure/role/region oracle', () => {
    let inspected = 0;
    for (const id of Object.keys(ALL.regions)) {
      const choice = quickPlayEvents(ALL, id).find((e) => e.kind === 'race');
      if (!choice) continue;
      const r = ready(ALL, { regionId: id });
      const closure = new Set(packClosure(ALL, packOf(choice.eventId)));
      const pool = Object.entries(ALL.riders).filter(
        ([rid, rider]) =>
          closure.has(packOf(rid)) &&
          rider.role === 'rival' &&
          (!rider.region || qualifyIn(packOf(rid), rider.region) === id),
      );
      const maximum = ALL.events[choice.eventId]!.field.riders!.length === 0 ? 0 : Math.min(pool.length, 9);
      expect(r.scene.field.eligibleCount).toBe(pool.length);
      expect(r.scene.field.maximumRivals).toBe(maximum);
      expect(r.config.riders.filter((a) => a.role === 'rival').map((a) => a.contentId)).toEqual(
        r.scene.field.actualRivalIds,
      );
      expect(r.scene.field.actualRivalCount).toBe(maximum);
      expect(r.scene.eventId).toBe(choice.eventId);
      expect(r.config.event.routeId).toBe(r.scene.route.actualId);
      expect(r.scene.route.lengthM).toBe(r.config.route.length);
      expect(r.config.riders.find((a) => a.role === 'player')!.bike.contentId).toBe(r.scene.bike.actualId);
      expect(r.config.difficulty).toEqual(builder.resolveDifficulty(DEFAULT_SETTINGS.difficulty));
      expect(r.config.slots?.[0]?.assists).toEqual(settingsAssists(DEFAULT_SETTINGS));
      expect(r.config.speedMultiplier).toBe(DEFAULT_SETTINGS.speedMultiplier);
      expect(r.config.event.level).toBeUndefined();
      expect(r.config.grudges).toEqual({});
      expect(r.scene.law.riderIds).toEqual(
        r.config.riders.filter((a) => a.role === 'cop' && a.law).map((a) => a.contentId),
      );
      expect(r.scene.law.mode).not.toBe('none');
      expect(r.scene.law.copFrequency).toBeGreaterThan(0);
      expect(r.scene.traffic.capable).toBe(true);
      inspected++;
    }
    console.log(`[examined] ${inspected} loaded regional diagnostic scenes`);
    expect(inspected).toBeGreaterThan(0);
  });

  it.each([1, 8, 10, 12])('fields the independent product maximum from a copied pool of %i', (count) => {
    const template = Object.values(ALL.riders).find((r) => r.role === 'rival')!;
    const others = Object.fromEntries(Object.entries(ALL.riders).filter(([, r]) => r.role !== 'rival'));
    const copies = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `${packOf(eventId)}:probe-rival-${i}`,
        { ...template, id: `probe-rival-${i}`, region: regionId, bike: qualifyIn('base', template.bike) },
      ]),
    );
    const reg = {
      ...ALL,
      riders: { ...others, ...copies, 'unrelated:outsider': { ...template, region: regionId } },
    };
    const r = ready(reg);
    expect(r.scene.field.eligibleCount).toBe(count);
    expect(r.scene.field.actualRivalCount).toBe(Math.min(count, 9));
    expect(r.scene.field.actualRivalIds).toEqual(
      raceField(
        packSubset(reg, packClosure(reg, packOf(eventId))),
        eventId,
        selection.seed,
        true,
        undefined,
        9,
      ),
    );
    expect(r.scene.field.actualRivalIds).not.toContain('unrelated:outsider');
  });

  it('refuses empty authored and eligible fields with evaluated zeros and no build', () => {
    const build = vi.spyOn(builder, 'buildSimConfig');
    const empty = withEvent({ field: { ...event.field, riders: [] } });
    const e = refused(empty, {}, 'empty-field', 'field');
    expect(e.field.eligibleCount).toBeGreaterThan(0);
    expect(e.field.maximumRivals).toBe(0);
    noActual(e);
    const noRivals = {
      ...ALL,
      riders: Object.fromEntries(Object.entries(ALL.riders).filter(([, r]) => r.role !== 'rival')),
    };
    const n = refused(noRivals, {}, 'empty-field', 'field');
    expect(n.field.eligibleCount).toBe(0);
    expect(n.field.maximumRivals).toBe(0);
    expect(build).not.toHaveBeenCalled();
  });

  it('refuses missing classics while an ordinary selector demonstrably falls back to another family', () => {
    const hunt = { ...event, kind: 'takedown-hunt' as const, rules: { targetCount: 1 }, objectives: [] };
    const reg = {
      ...ALL,
      events: {
        ...Object.fromEntries(Object.entries(ALL.events).filter(([, e]) => e.kind !== 'classic-race')),
        [eventId]: hunt,
      },
    };
    expect(quickPlayEvent(reg, regionId, 'race')?.kind).toBe('hunt');
    const e = refused(reg, {}, 'classic-unavailable', 'classic');
    expect(e.expectedEventId).toBeNull();
    expect(e.expectedRouteId).toBeNull();
    expect(e.field.eligibleCount).toBeNull();
    expect(e.intendedBikeId).toBeNull();
    noActual(e);
  });

  it.each(['finale', 'required-branch'] as const)('strict selection excludes %s-only classics', (kind) => {
    const reg = {
      ...ALL,
      events: Object.fromEntries(
        Object.entries(ALL.events).map(([id, e]) => [
          id,
          e.kind !== 'classic-race'
            ? e
            : {
                ...e,
                ...(kind === 'finale'
                  ? { finale: true }
                  : { objectives: [{ kind: 'ride-branch', required: true, params: { branch: 'probe' } }] }),
              },
        ]),
      ),
    } as ContentRegistry;
    refused(reg, {}, 'classic-unavailable', 'classic');
  });

  it('refuses missing region before selection, and missing standard before bike resolution', () => {
    const e = refused(ALL, { regionId: 'absent:region' }, 'region-unavailable', 'region');
    expect(e.missingContent).toEqual([{ kind: 'region', id: 'absent:region' }]);
    noActual(e);
    const n = refused(
      withEvent({ lengths: event.lengths.filter((l) => l.id !== 'standard') }),
      {},
      'standard-length-unavailable',
      'standard-length',
    );
    expect(n.expectedEventId).toBe(eventId);
    expect(n.expectedRouteId).toBeNull();
    expect(n.bikeSource).toBeNull();
    noActual(n);
  });

  it('accepts every carried compatible GIS and different-network handmade alternate without fallback', () => {
    let gis = 0,
      handmade = 0;
    for (const id of Object.keys(ALL.regions)) {
      const choice = quickPlayEvents(ALL, id).find((e) => e.kind === 'race');
      if (!choice) continue;
      for (const route of realRoutes(ALL, choice.eventId)) {
        const r = ready(ALL, { regionId: id, routeId: route });
        expect(r.scene.route.actualId).toBe(route);
        expect(r.scene.route.requestedId).toBe(route);
        expect(r.scene.route.networkId).toBe(qualifyIn(packOf(route), ALL.routes[route]!.network));
        if (builder.isRealRoute(ALL, route)) gis++;
        else handmade++;
      }
    }
    console.log(`[examined] ${gis} GIS and ${handmade} handmade alternate routes`);
    expect(gis).toBeGreaterThan(0);
    expect(handmade).toBeGreaterThan(0);
  });

  it('preflights missing explicit/default route, network, all network roads and route references before membership', () => {
    const probe = `${packOf(eventId)}:probe-route`;
    const net = `${packOf(eventId)}:probe-network`;
    const template = ALL.routes[routeId]!;
    const reg = {
      ...ALL,
      routes: { ...ALL.routes, [probe]: { ...template, id: 'probe-route', network: net } },
    };
    const e = refused(reg, { routeId: probe }, 'content-not-ready', 'content-dependencies');
    expect(e.expectedRouteId).toBe(probe);
    expect(e.expectedNetworkId).toBe(net);
    expect(e.missingContent).toContainEqual({ kind: 'network', id: net });
    noActual(e);
    const missingRoute = refused(ALL, { routeId: probe }, 'route-unavailable', 'route-entry');
    expect(missingRoute.expectedRouteId).toBe(probe);
    expect(missingRoute.expectedNetworkId).toBeNull();
    const noDefault = refused(
      { ...ALL, routes: without(ALL.routes, routeId) },
      {},
      'content-not-ready',
      'content-dependencies',
    );
    expect(noDefault.expectedRouteId).toBe(routeId);
    noActual(noDefault);
    const noNetwork = refused(
      { ...ALL, networks: without(ALL.networks, networkId) },
      {},
      'content-not-ready',
      'content-dependencies',
    );
    expect(noNetwork.expectedNetworkId).toBe(networkId);
    const road = qualifyIn(packOf(networkId), ALL.networks[networkId]!.roads[0]!);
    expect(ALL.roads[road]).toBeDefined();
    const missingRoad = refused(
      { ...ALL, roads: without(ALL.roads, road) },
      {},
      'content-not-ready',
      'content-dependencies',
    );
    expect(missingRoad.missingContent).toContainEqual({ kind: 'road', id: road });
    const attempted = {
      ...reg,
      routes: {
        ...reg.routes,
        [probe]: {
          ...template,
          id: 'probe-route',
          network: networkId,
          checkpoints: [{ road: 'missing-checkpoint-road', s: 1 }],
          branches: [{ id: 'probe', roads: ['missing-branch-road'] }],
        },
      },
    };
    const refs = refused(attempted, { routeId: probe }, 'content-not-ready', 'content-dependencies');
    expect(refs.missingContent).toContainEqual({
      kind: 'road',
      id: `${packOf(probe)}:missing-checkpoint-road`,
    });
    expect(refs.missingContent).toContainEqual({ kind: 'road', id: `${packOf(probe)}:missing-branch-road` });
    expect([...refs.missingContent]).toEqual(
      [...refs.missingContent].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
    );
    expect(new Set(refs.missingContent.map((m) => `${m.kind}:${m.id}`)).size).toBe(
      refs.missingContent.length,
    );
  });

  it('complete same-network unsupported and cross-region alternates refuse membership; partial candidate networks do not hide dependencies', () => {
    const probe = `${packOf(eventId)}:probe-route`;
    const own = ALL.routes[routeId]!;
    const reg = { ...ALL, routes: { ...ALL.routes, [probe]: { ...own, id: 'probe-route' } } };
    const same = refused(reg, { routeId: probe }, 'route-incompatible', 'route-membership');
    expect(same.expectedRouteId).toBe(probe);
    expect(same.expectedNetworkId).toBe(networkId);
    expect(same.missingContent).toEqual([]);
    noActual(same);
    const foreign = Object.keys(ALL.routes).find(
      (id) =>
        qualifyIn(
          packOf(qualifyIn(packOf(id), ALL.routes[id]!.network)),
          ALL.networks[qualifyIn(packOf(id), ALL.routes[id]!.network)]!.region,
        ) !== regionId,
    )!;
    expect(foreign).toBeDefined();
    refused(ALL, { routeId: foreign }, 'route-incompatible', 'route-membership');
    const second = event.lengths.find((l) => qualifyIn(packOf(eventId), l.route) !== routeId);
    expect(second).toBeDefined();
    const absentRoute = qualifyIn(packOf(eventId), second!.route);
    const partial = refused(
      { ...reg, routes: without(reg.routes, absentRoute) },
      { routeId: probe },
      'content-not-ready',
      'content-dependencies',
    );
    expect(partial.missingContent).toContainEqual({ kind: 'route', id: absentRoute });
  });

  it.each([
    'event-id',
    'event-kind',
    'event-region',
    'route-network',
    'network-region',
    'missing-event',
    'missing-route',
    'missing-network',
    'missing-region',
    'bike',
    'field',
    'road-handle',
    'route-handle',
  ] as const)('retains total expected/actual evidence for substituted %s mismatch', (kind) => {
    const alternateEventId = `${packOf(eventId)}:probe-event`;
    const alternateRouteId = `${packOf(eventId)}:probe-route`;
    const alternateNetworkId = `${packOf(eventId)}:probe-network`;
    const alternateRegionId = Object.keys(ALL.regions).find((id) => id !== regionId)!;
    let reg = ALL;
    let built = false;
    if (kind === 'event-id')
      reg = { ...ALL, events: { ...ALL.events, [alternateEventId]: { ...event, region: regionId } } };
    if (kind === 'event-region')
      reg = {
        ...ALL,
        events: new Proxy(
          { ...ALL.events },
          {
            get(table, key: string) {
              return built && key === eventId ? { ...event, region: alternateRegionId } : table[key];
            },
          },
        ),
      };
    if (
      kind === 'route-network' ||
      kind === 'network-region' ||
      kind === 'missing-network' ||
      kind === 'missing-region'
    )
      reg = {
        ...ALL,
        routes: {
          ...ALL.routes,
          [alternateRouteId]: { ...ALL.routes[routeId]!, network: alternateNetworkId },
        },
        networks:
          kind === 'missing-network'
            ? ALL.networks
            : {
                ...ALL.networks,
                [alternateNetworkId]: {
                  ...ALL.networks[networkId]!,
                  region:
                    kind === 'missing-region'
                      ? 'absent:region'
                      : kind === 'network-region'
                        ? alternateRegionId
                        : regionId,
                },
              },
      };
    substitute((c) => {
      built = true;
      return {
        ...c,
        event: {
          ...c.event,
          ...(kind === 'event-id' || kind === 'missing-event' ? { contentId: alternateEventId } : {}),
          ...(kind === 'event-kind' ? { kind: 'takedown-hunt' as const } : {}),
          ...([
            'route-network',
            'network-region',
            'missing-network',
            'missing-region',
            'missing-route',
          ].includes(kind)
            ? { routeId: alternateRouteId }
            : {}),
        },
        ...(kind === 'bike'
          ? {
              riders: c.riders.map((r) =>
                r.role === 'player' ? { ...r, bike: { ...r.bike, contentId: 'absent:bike' } } : r,
              ),
            }
          : {}),
        ...(kind === 'field' ? { riders: c.riders.filter((r) => r.role !== 'rival') } : {}),
        ...(kind === 'road-handle' ? { road: { ...c.road } } : {}),
        ...(kind === 'route-handle' ? { route: { ...c.route } } : {}),
      };
    });
    const check = ['event-id', 'event-kind', 'missing-event'].includes(kind)
      ? 'resolved-event'
      : ['event-region', 'network-region', 'missing-network', 'missing-region', 'missing-route'].includes(
            kind,
          )
        ? 'resolved-region'
        : kind === 'bike'
          ? 'resolved-bike'
          : kind === 'field'
            ? 'resolved-field'
            : 'resolved-route';
    const e = refused(reg, {}, 'resolved-scene-mismatch', check);
    expect(e.expectedEventId).toBe(eventId);
    expect(e.expectedRouteId).toBe(routeId);
    expect(e.expectedNetworkId).toBe(networkId);
    expect(e.actualEventId).toBe(['event-id', 'missing-event'].includes(kind) ? alternateEventId : eventId);
    expect(e.actualEventKind).toBe(kind === 'event-kind' ? 'takedown-hunt' : 'classic-race');
    expect(e.actualEventRegionId).toBe(
      kind === 'missing-event' ? null : kind === 'event-region' ? alternateRegionId : regionId,
    );
    expect(e.actualRouteId).toBe(
      ['route-network', 'network-region', 'missing-network', 'missing-region', 'missing-route'].includes(kind)
        ? alternateRouteId
        : routeId,
    );
    expect(e.actualNetworkId).toBe(
      kind === 'missing-route'
        ? null
        : ['route-network', 'network-region', 'missing-network', 'missing-region'].includes(kind)
          ? alternateNetworkId
          : networkId,
    );
    expect(e.actualNetworkRegionId).toBe(
      ['missing-route', 'missing-network', 'missing-region'].includes(kind)
        ? null
        : kind === 'network-region'
          ? alternateRegionId
          : regionId,
    );
    expect(e.field.actualRivalCount).toBe(kind === 'field' ? 0 : Math.min(e.field.eligibleCount!, 9));
    expect(e.actualBikeId).toBe(kind === 'bike' ? 'absent:bike' : e.intendedBikeId);
    expect(e.actualTimeOfDay).toBe(raceTimeOfDay(reg, eventId, selection.seed, true));
    expect(e.law).toBeNull();
    expect(e.traffic).toBeNull();
    if (kind === 'missing-event')
      expect(e.missingContent).toContainEqual({ kind: 'event', id: alternateEventId });
    if (kind === 'missing-route')
      expect(e.missingContent).toContainEqual({ kind: 'route', id: alternateRouteId });
    if (kind === 'missing-network')
      expect(e.missingContent).toContainEqual({ kind: 'network', id: alternateNetworkId });
    if (kind === 'missing-region')
      expect(e.missingContent).toContainEqual({ kind: 'region', id: 'absent:region' });
    frozenTree(e);
  });
  it('reports event mismatch first while retaining independently resolved later region/network mismatches', () => {
    const actualEventId = `${packOf(eventId)}:probe-other-event`;
    const actualRouteId = `${packOf(eventId)}:probe-other-route`;
    const actualNetworkId = `${packOf(eventId)}:probe-other-network`;
    const otherRegionId = Object.keys(ALL.regions).find((id) => id !== regionId)!;
    const reg = {
      ...ALL,
      events: { ...ALL.events, [actualEventId]: { ...event, region: otherRegionId } },
      routes: { ...ALL.routes, [actualRouteId]: { ...ALL.routes[routeId]!, network: actualNetworkId } },
      networks: {
        ...ALL.networks,
        [actualNetworkId]: { ...ALL.networks[networkId]!, region: otherRegionId },
      },
    };
    substitute((c) => ({
      ...c,
      event: { ...c.event, contentId: actualEventId, kind: 'takedown-hunt', routeId: actualRouteId },
    }));
    const e = refused(reg, {}, 'resolved-scene-mismatch', 'resolved-event');
    expect(e.expectedEventId).toBe(eventId);
    expect(e.actualEventId).toBe(actualEventId);
    expect(e.actualEventKind).toBe('takedown-hunt');
    expect(e.actualEventRegionId).toBe(otherRegionId);
    expect(e.expectedRouteId).toBe(routeId);
    expect(e.actualRouteId).toBe(actualRouteId);
    expect(e.expectedNetworkId).toBe(networkId);
    expect(e.actualNetworkId).toBe(actualNetworkId);
    expect(e.actualNetworkRegionId).toBe(otherRegionId);
  });

  it.each(['order', 'backfill'] as const)('refuses an equal-count built field with wrong %s', (kind) => {
    const original = ready().scene.field.actualRivalIds;
    expect(original.length).toBeGreaterThan(1);
    substitute((c) => {
      const rivals = c.riders.filter((r) => r.role === 'rival');
      const others = c.riders.filter((r) => r.role !== 'rival');
      const altered =
        kind === 'order'
          ? [...rivals].reverse()
          : rivals.map((r, i) => (i === 0 ? { ...r, contentId: 'unrelated:backfill' } : r));
      return { ...c, riders: [...altered, ...others] };
    });
    const e = refused(ALL, {}, 'resolved-scene-mismatch', 'resolved-field');
    expect(e.field.actualRivalCount).toBe(original.length);
    expect(e.field.actualRivalIds).not.toEqual(original);
    expect(e.field.maximumRivals).toBe(original.length);
  });

  it('requires configured authored law, preserving duplicate cop slots', () => {
    const cop = Object.entries(ALL.riders).find(([, r]) => r.role === 'cop' && r.law)!;
    const reg = {
      ...withEvent({
        cops: {
          ...event.cops,
          mode: 'every-race',
          baseCount: 3,
          patrolMax: 0,
          chaosSummon: false,
          heat: false,
        },
      }),
      riders: {
        ...Object.fromEntries(Object.entries(ALL.riders).filter(([, r]) => r.role !== 'cop')),
        [cop[0]]: { ...cop[1], region: regionId },
      },
    };
    const r = ready(reg);
    expect(r.scene.law.riderIds).toEqual([cop[0], cop[0], cop[0]]);
    substitute((c) => ({ ...c, difficulty: { ...c.difficulty, copFrequency: 0 } }));
    expect(refused(reg, {}, 'law-unavailable', 'law').law!.riderIds).toEqual([cop[0], cop[0], cop[0]]);
    vi.restoreAllMocks();
    const e = refused(withEvent({ cops: { ...event.cops, mode: 'none' } }), {}, 'law-unavailable', 'law');
    expect(e.law).toEqual({
      riderIds: [],
      mode: 'none',
      copFrequency:
        DEFAULT_SETTINGS.difficulty === 'normal'
          ? 1
          : builder.resolveDifficulty(DEFAULT_SETTINGS.difficulty).copFrequency,
    });
    expect(e.traffic).toBeNull();
    const noLaw = {
      ...ALL,
      riders: Object.fromEntries(Object.entries(ALL.riders).filter(([, rider]) => rider.role !== 'cop')),
    };
    expect(refused(noLaw, {}, 'law-unavailable', 'law').law!.riderIds).toEqual([]);
  });

  it.each([undefined, 0, -1, NaN, Infinity])(
    'refuses absent mode or nonpositive/nonfinite law frequency %s after evaluating law',
    (frequency) => {
      substitute((c) => {
        const { cops: _cops, ...noCops } = c.event;
        return {
          ...c,
          event: frequency === undefined ? noCops : c.event,
          difficulty: { ...c.difficulty, ...(frequency === undefined ? {} : { copFrequency: frequency }) },
        };
      });
      const e = refused(ALL, {}, 'law-unavailable', 'law');
      expect(e.law!.riderIds.length).toBeGreaterThan(0);
      expect(e.law!.mode).toBe(frequency === undefined ? null : event.cops.mode);
      expect(e.law!.copFrequency).toBe(
        frequency === undefined ? 1 : Number.isFinite(frequency) ? frequency : null,
      );
      expect(e.traffic).toBeNull();
    },
  );

  const trafficType = (patch: Partial<SimTrafficTypeDef> = {}): SimTrafficTypeDef => ({
    contentId: 'base:probe-traffic',
    category: 'car',
    lengthM: 4,
    widthM: 2,
    cruiseMps: 10,
    heightM: 2,
    hazard: 'normal',
    ...patch,
  });
  const trafficCases: {
    name: string;
    type: Partial<SimTrafficTypeDef>;
    tuning?: Record<string, number>;
    capable: boolean;
    directions?: string[];
  }[] = [
    { name: 'global-only', type: { weight: 2 }, capable: true },
    { name: 'area-only', type: { weight: 0, areaWeights: { urban: 2 } }, capable: true },
    { name: 'fallback car', type: {}, capable: true },
    { name: 'fallback truck', type: { category: 'truck' }, capable: true },
    { name: 'fallback rv', type: { category: 'rv' }, capable: true },
    {
      name: 'pedestrian-only',
      type: { category: 'pedestrian', weight: 10, areaWeights: { urban: 5 } },
      capable: false,
    },
    { name: 'animal-only', type: { category: 'animal', weight: 10 }, capable: false },
    { name: 'unweighted', type: { weight: 0, areaWeights: { urban: -1, rural: NaN } }, capable: false },
    { name: 'nonfinite weight', type: { weight: Infinity }, capable: false },
    { name: 'negative weight', type: { weight: -1 }, capable: false },
    {
      name: 'all directions off',
      type: {},
      tuning: { 'traffic.densitySame': 0, 'traffic.densityOncoming': 0 },
      capable: false,
      directions: [],
    },
    {
      name: 'rolling oddity same only',
      type: { category: 'oddity' },
      tuning: { 'traffic.densityOncoming': 0 },
      capable: false,
      directions: ['same'],
    },
    {
      name: 'rolling oddity oncoming',
      type: { category: 'oddity' },
      tuning: { 'traffic.densitySame': 0 },
      capable: true,
      directions: ['oncoming'],
    },
    {
      name: 'parked oddity same',
      type: { category: 'oddity', cruiseMps: 0 },
      tuning: { 'traffic.densityOncoming': 0 },
      capable: true,
      directions: ['same'],
    },
    {
      name: 'oddity disabled',
      type: { category: 'oddity' },
      tuning: { 'traffic.oddities': 0 },
      capable: false,
    },
    {
      name: 'oddity invalid',
      type: { category: 'oddity' },
      tuning: { 'traffic.oddities': NaN },
      capable: false,
    },
    { name: 'negative master', type: {}, tuning: { 'traffic.density': -1 }, capable: false },
    { name: 'zero master', type: {}, tuning: { 'traffic.density': 0 }, capable: false },
    { name: 'NaN master', type: {}, tuning: { 'traffic.density': NaN }, capable: false },
    { name: 'infinite master', type: {}, tuning: { 'traffic.density': Infinity }, capable: false },
    {
      name: 'valid same invalid oncoming',
      type: {},
      tuning: { 'traffic.densityOncoming': NaN },
      capable: true,
      directions: ['same'],
    },
    {
      name: 'valid oncoming invalid same',
      type: {},
      tuning: { 'traffic.densitySame': Infinity },
      capable: true,
      directions: ['oncoming'],
    },
  ];
  it.each(trafficCases)('analyzes configured traffic: $name', ({ type, tuning, capable, directions }) => {
    substitute((c) => ({ ...c, trafficTypes: [trafficType(type)], tuning: { ...c.tuning, ...tuning } }));
    const r = resolveMeasurementScene(ALL, selection);
    const t = r.kind === 'ready' ? r.scene.traffic : r.evidence.traffic;
    expect(r.kind).toBe(capable ? 'ready' : 'refused');
    if (!capable) {
      const e = refused(ALL, {}, 'traffic-unavailable', 'traffic');
      expect(e.law!.riderIds.length).toBeGreaterThan(0);
    }
    expect(t!.capable).toBe(capable);
    expect(t!.types).toHaveLength(1);
    if (directions) expect(t!.enabledDirections).toEqual(directions);
    if (type.areaWeights)
      expect(t!.types[0]!.areaWeights).toEqual(
        Object.fromEntries(
          Object.entries(type.areaWeights).map(([k, v]) => [k, Number.isFinite(v) && v > 0 ? v : 0]),
        ),
      );
    expect(t!.types[0]!.rollingOddity).toBe(type.category === 'oddity' && (type.cruiseMps ?? 10) > 0);
    frozenTree(t);
  });

  it('retains every traffic type, density clamps, absent defaults and the sim ease policy', () => {
    substitute((c) => ({
      ...c,
      tuning: {
        'traffic.density': 20,
        'traffic.densitySame': 2,
        'traffic.densityOncoming': 30,
        'traffic.oncomingEaseInS': 8,
      },
      trafficTypes: [
        trafficType(),
        trafficType({ category: 'pedestrian', weight: 9 }),
        trafficType({
          category: 'oddity',
          cruiseMps: 0,
          weight: 0,
          areaWeights: { a: 1, b: Infinity, c: -1 },
        }),
      ],
    }));
    const t = ready().scene.traffic;
    expect(t.inputs).toEqual({ master: 20, same: 2, oncoming: 30, oddities: 1, oncomingEaseInS: 8 });
    expect(t.clampedDensity).toEqual({ master: 10, same: 2, oncoming: 10 });
    expect(t.effectiveDensity).toEqual({ same: 20, oncomingTarget: 100, oncomingAtStart: 25 });
    expect(t.oncomingEase).toEqual({ enabled: true, startFactor: 0.25, finalFactor: 1 });
    expect(t.types.map((a) => a.globalWeight)).toEqual([5, 9, 0]);
    expect(t.types[1]!.initializationCompatible).toBe(false);
    expect(t.types[1]!.usableDirections).toEqual([]);
    expect(t.types[2]!.usableDirections).toEqual(['same', 'oncoming']);
    vi.restoreAllMocks();
    substitute((c) => ({ ...c, tuning: {}, trafficTypes: [trafficType()] }));
    const defaults = ready().scene.traffic;
    expect(defaults.inputs).toEqual({ master: 1, same: 1, oncoming: 1, oddities: 1, oncomingEaseInS: 0 });
    expect(defaults.effectiveDensity).toEqual({ same: 1, oncomingTarget: 1, oncomingAtStart: 1 });
    expect(defaults.oncomingEase).toEqual({ enabled: false, startFactor: 1, finalFactor: 1 });
  });

  it.each([Infinity, -Infinity, NaN])(
    'uses the raw sim ease predicate for nonfinite ease %s while disclosing a null numeric input',
    (ease) => {
      substitute((c) => ({
        ...c,
        tuning: { ...c.tuning, 'traffic.oncomingEaseInS': ease },
        trafficTypes: [trafficType()],
      }));
      const t = ready().scene.traffic;
      expect(t.inputs.oncomingEaseInS).toBeNull();
      expect(t.oncomingEase).toEqual({ enabled: ease > 0, startFactor: ease > 0 ? 0.25 : 1, finalFactor: 1 });
      expect(t.effectiveDensity.oncomingAtStart).toBe(
        t.effectiveDensity.oncomingTarget! * (ease > 0 ? 0.25 : 1),
      );
    },
  );

  it('validates menu/garage/starter precedence and secret ownership without changing the garage', () => {
    const bikes = menuBikes(ALL, []);
    const bike = bikes.find((id) => id !== ready().scene.bike.actualId)!;
    expect(ready(ALL, { bike, garage: { current: 'absent:bike', owned: [] } }).scene.bike).toEqual({
      intendedId: bike,
      actualId: bike,
      source: 'menu',
    });
    expect(ready(ALL, { garage: { current: bike, owned: [] } }).scene.bike.source).toBe('garage');
    expect(ready().scene.bike.source).toBe('starter');
    const unavailable = refused(ALL, { bike: 'absent:bike' }, 'bike-unavailable', 'bike');
    expect(unavailable.intendedBikeId).toBe('absent:bike');
    expect(unavailable.bikeSource).toBe('menu');
    noActual(unavailable);
    refused(ALL, { garage: { current: 'absent:bike', owned: [] } }, 'bike-unavailable', 'bike');
    const secret = Object.keys(ALL.bikes).find((id) => ALL.bikes[id]!.tags?.includes('secret'))!;
    expect(secret).toBeDefined();
    refused(ALL, { bike: secret }, 'bike-unavailable', 'bike');
    const garage = Object.freeze({ owned: Object.freeze([secret]), current: null });
    expect(ready(ALL, { bike: secret, garage }).scene.bike.actualId).toBe(secret);
    expect(garage.owned).toEqual([secret]);
    const starterId = qualifyIn('base', builder.PLAYER_PRESET);
    const absentStarter = refused(
      { ...ALL, riders: without(ALL.riders, starterId) },
      {},
      'content-not-ready',
      'content-dependencies',
    );
    expect(absentStarter.missingContent).toContainEqual({ kind: 'rider', id: starterId });
    const starterBike = qualifyIn(packOf(starterId), ALL.riders[starterId]!.bike);
    expect(
      refused(
        { ...ALL, bikes: without(ALL.bikes, starterBike) },
        {},
        'content-not-ready',
        'content-dependencies',
      ).missingContent,
    ).toContainEqual({ kind: 'bike', id: starterBike });
  });

  it('hashes an explicit effective registry with only the selected foreign player bike added', () => {
    const closure = packClosure(ALL, packOf(eventId));
    const foreignBike = menuBikes(ALL, []).find((id) => !closure.includes(packOf(id)))!;
    expect(foreignBike).toBeDefined();
    const hash = vi.spyOn(content, 'contentHashes');
    const r = ready(ALL, { bike: foreignBike });
    const effective = hash.mock.calls[0]![0];
    const eventReg = packSubset(ALL, closure);
    expect(effective.packs).toEqual(eventReg.packs);
    expect(effective.index).toEqual(eventReg.index);
    expect(Object.keys(effective.bikes).sort()).toEqual(
      [...new Set([...Object.keys(eventReg.bikes), foreignBike])].sort(),
    );
    for (const key of Object.keys(eventReg) as (keyof ContentRegistry)[])
      if (!['packs', 'index', 'bikes'].includes(key)) expect(effective[key]).toEqual(eventReg[key]);
    expect(effective.bikes[foreignBike]).toBe(ALL.bikes[foreignBike]);
    expect(r.scene.contentIdentity.hashes).toEqual(
      contentHashes({ ...eventReg, bikes: { ...eventReg.bikes, [foreignBike]: ALL.bikes[foreignBike]! } }),
    );
    const changeBike = (patch: Partial<ContentRegistry['bikes'][string]>) => ({
      ...ALL,
      bikes: { ...ALL.bikes, [foreignBike]: { ...ALL.bikes[foreignBike]!, ...patch } },
    });
    const bike = ALL.bikes[foreignBike]!;
    const acceleration = ready(
      changeBike({ handling: { ...bike.handling, accelMps2: bike.handling.accelMps2 + 1 } }),
      { bike: foreignBike },
    );
    expect(acceleration.scene.contentIdentity.hashes.sim).not.toBe(r.scene.contentIdentity.hashes.sim);
    expect(acceleration.scene.contentIdentity.hashes.full).not.toBe(r.scene.contentIdentity.hashes.full);
    expect(acceleration.scene.configProjection.riders.find((a) => a.role === 'player')!.bike.accelMps2).toBe(
      bike.handling.accelMps2 + 1,
    );
    const presentation = ready(changeBike({ name: `${bike.name} probe` }), { bike: foreignBike });
    expect(presentation.scene.contentIdentity.hashes.sim).toBe(r.scene.contentIdentity.hashes.sim);
    expect(presentation.scene.contentIdentity.hashes.full).not.toBe(r.scene.contentIdentity.hashes.full);
    const foreignPack = packOf(foreignBike);
    const otherBike = Object.keys(ALL.bikes).find((id) => packOf(id) === foreignPack && id !== foreignBike)!;
    expect(otherBike).toBeDefined();
    const unrelated = ready(
      {
        ...ALL,
        packs: ALL.packs.map((p) =>
          p.id !== foreignPack
            ? p
            : { ...p, defaults: { ...p.defaults, tuning: 'probe-unused' }, name: 'probe-unused' },
        ),
        bikes: {
          ...ALL.bikes,
          [otherBike]: {
            ...ALL.bikes[otherBike]!,
            handling: { ...ALL.bikes[otherBike]!.handling, accelMps2: 999 },
          },
        },
      },
      { bike: foreignBike },
    );
    expect(unrelated.scene.contentIdentity.hashes).toEqual(r.scene.contentIdentity.hashes);
    expect(unrelated.scene.configProjection).toEqual(r.scene.configProjection);
  });

  it('owns deeply immutable deterministic metadata and the complete public replay projection without recording', () => {
    const frozenSelection = Object.freeze({
      ...selection,
      garage: Object.freeze({ owned: Object.freeze([]), current: null }),
    });
    const before = structuredClone(frozenSelection);
    const regBefore = JSON.stringify(ALL);
    const begin = vi.spyOn(replay, 'replayHeader');
    const a = resolveMeasurementScene(ALL, frozenSelection);
    expect(a.kind).toBe('ready');
    if (a.kind !== 'ready') throw new Error(a.reason);
    const description: DeepReadonly<MeasurementSceneDescription> = a.scene;
    const b = ready();
    expect(description).toEqual(b.scene);
    expect(a.stream).not.toBe(b.stream);
    expect(a.config).not.toBe(b.config);
    expect(a.scene).not.toBe(b.scene);
    expect(a.scene.field.actualRivalIds).not.toBe(b.scene.field.actualRivalIds);
    expect(a.scene.configProjection).toEqual(replayHeader(a.config, 'measurement-scene').config);
    expect(a.scene.configProjection).not.toHaveProperty('road');
    expect(a.scene.configProjection).not.toHaveProperty('route');
    expect(a.scene.configProjection).not.toHaveProperty('replayKey');
    expect(a.scene.configProjection.riders).not.toBe(a.config.riders);
    expect(begin.mock.calls.every(([, key]) => key === 'measurement-scene')).toBe(true);
    expect(Object.isFrozen(a.config)).toBe(false);
    expect(Object.isFrozen(a.stream)).toBe(false);
    frozenTree(a.scene);
    expect(() => {
      (a.scene.field.actualRivalIds as string[]).push('probe');
    }).toThrow();
    expect(frozenSelection).toEqual(before);
    expect(JSON.stringify(ALL)).toBe(regBefore);
    const projection = structuredClone(a.scene.configProjection);
    a.config.riders[0]!.bike.accelMps2 += 1;
    expect(a.scene.configProjection).toEqual(projection);
  });

  it('does not fabricate a projection or swallow unexpected builder errors', () => {
    vi.spyOn(replay, 'replayHeader').mockImplementation((c, key) => ({
      formatVersion: 1,
      replayKey: key,
      seed: c.seed,
      eventId: c.event.contentId,
      tuning: {},
    }));
    expect(() => resolveMeasurementScene(ALL, selection)).toThrow('replay projection missing');
    vi.restoreAllMocks();
    vi.spyOn(builder, 'buildSimConfig').mockImplementation(() => {
      throw new Error('probe programmer error');
    });
    expect(() => resolveMeasurementScene(ALL, selection)).toThrow('probe programmer error');
  });

  it('reports exact total early-stage evidence and does not call network or random seed services', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const random = vi.spyOn(Math, 'random');
    const e = refused(ALL, { seed: NaN }, 'invalid-seed', 'seed');
    expect(e).toEqual({
      requested: {
        regionId,
        routeId: null,
        bikeId: null,
        garageCurrentBikeId: null,
        timeOfDay: null,
        weather: 'local',
        seed: null,
        seedIssue: 'not-finite',
      },
      failedCheck: 'seed',
      expectedEventId: null,
      actualEventId: null,
      expectedEventKind: 'classic-race',
      actualEventKind: null,
      expectedRegionId: regionId,
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
      missingContent: [],
    });
    ready();
    expect(fetch).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });

  it('checks event pack closure dependencies and rider bikes before constructing a stream', () => {
    const onlyClassic = { ...ALL, events: { [eventId]: event } };
    const missingPack = `${packOf(eventId)}-probe-missing`;
    const reg = {
      ...onlyClassic,
      packs: ALL.packs.map((p) =>
        p.id === packOf(eventId) ? { ...p, dependencies: { ...p.dependencies, [missingPack]: '*' } } : p,
      ),
    };
    const e = refused(reg, {}, 'content-not-ready', 'content-dependencies');
    expect(e.expectedEventId).toBe(eventId);
    expect(e.expectedRouteId).toBe(routeId);
    expect(e.expectedNetworkId).toBe(networkId);
    expect(e.missingContent).toEqual([{ kind: 'pack', id: missingPack }]);
    noActual(e);
    const cast = raceField(
      packSubset(ALL, packClosure(ALL, packOf(eventId))),
      eventId,
      selection.seed,
      true,
      undefined,
      9,
    );
    expect(cast.length).toBeGreaterThan(0);
    const riderId = cast[0]!;
    const missingBike = 'absent:rival-bike';
    const noBike = {
      ...ALL,
      riders: { ...ALL.riders, [riderId]: { ...ALL.riders[riderId]!, bike: missingBike } },
    };
    expect(refused(noBike, {}, 'content-not-ready', 'content-dependencies').missingContent).toContainEqual({
      kind: 'bike',
      id: missingBike,
    });
  });

  const escapePackId = 'probe-selector-escape';
  const escapeId = `${escapePackId}:probe-escape`;
  const escape = {
    ...event,
    id: 'probe-escape',
    region: regionId,
    kind: 'cop-escape' as const,
    cops: { ...event.cops, mode: 'every-race' as const, baseCount: 1 },
  };
  const escapeManifest = { ...ALL.packs[0]!, id: escapePackId, dependencies: { [packOf(eventId)]: '*' } };
  const selectorRegistry = (present = true): ContentRegistry => ({
    ...ALL,
    events: { [eventId]: event, [escapeId]: escape },
    packs: present ? [...ALL.packs, escapeManifest] : ALL.packs,
  });

  it('refuses absent eligible Escape manifests before invoking the strict selector, with total unevaluated evidence', () => {
    const positive = ready(selectorRegistry());
    expect(positive.scene.eventId).toBe(eventId);
    const selector = vi.spyOn(quickPlay, 'quickPlayEvents');
    const e = refused(selectorRegistry(false), {}, 'content-not-ready', 'content-dependencies');
    expect(selector).not.toHaveBeenCalled();
    const initialized = refused(ALL, { seed: NaN }, 'invalid-seed', 'seed');
    expect(e).toEqual({
      ...initialized,
      requested: { ...initialized.requested, seed: selection.seed, seedIssue: null },
      failedCheck: 'content-dependencies',
      missingContent: [{ kind: 'pack', id: escapePackId }],
    });
    noActual(e);
    frozenTree(e);
  });

  it('enumerates absent transitive selector manifests with sorted unique pack pairs and a complete control', () => {
    const relay = 'probe-selector-relay';
    const first = 'probe-selector-missing-a';
    const second = 'probe-selector-missing-b';
    const reg = {
      ...selectorRegistry(),
      packs: [
        ...ALL.packs,
        { ...escapeManifest, dependencies: { [relay]: '*', [second]: '*' } },
        {
          ...escapeManifest,
          id: relay,
          dependencies: { [packOf(eventId)]: '*', [first]: '*', [second]: '*' },
        },
      ],
    };
    const complete = {
      ...reg,
      packs: [
        ...reg.packs,
        { ...escapeManifest, id: first, dependencies: {} },
        { ...escapeManifest, id: second, dependencies: {} },
      ],
    };
    expect(ready(complete).scene.eventId).toBe(eventId);
    const e = refused(
      reg,
      { bike: 'absent:bike', timeOfDay: 'absent-light', routeId: 'absent:route' },
      'content-not-ready',
      'content-dependencies',
    );
    expect(e.missingContent).toEqual([
      { kind: 'pack', id: first },
      { kind: 'pack', id: second },
    ]);
    expect(e.expectedEventId).toBeNull();
    expect(e.expectedRouteId).toBeNull();
    expect(e.expectedNetworkId).toBeNull();
    expect(e.intendedBikeId).toBeNull();
    expect(e.bikeSource).toBeNull();
    expect(e.field.eligibleCount).toBeNull();
    expect(e.field.maximumRivals).toBeNull();
    noActual(e);
  });

  it('retains seed/region precedence and includes absent authored cops in selector preflight', () => {
    const incomplete = selectorRegistry(false);
    refused(incomplete, { seed: Infinity }, 'invalid-seed', 'seed');
    refused(incomplete, { regionId: 'absent:region' }, 'region-unavailable', 'region');
    const { cops: _cops, ...absentCops } = escape;
    const reg = { ...incomplete, events: { [eventId]: event, [escapeId]: absentCops } } as ContentRegistry;
    const e = refused(reg, {}, 'content-not-ready', 'content-dependencies');
    expect(e.missingContent).toEqual([{ kind: 'pack', id: escapePackId }]);
    expect(e.expectedEventId).toBeNull();
    noActual(e);
  });

  it.each(['other-region', 'finale', 'required-branch', 'law-none', 'other-family'] as const)(
    'does not preflight missing manifests on selector-excluded %s events',
    (exclusion) => {
      const patch =
        exclusion === 'other-region'
          ? { region: Object.keys(ALL.regions).find((id) => id !== regionId)! }
          : exclusion === 'finale'
            ? { finale: true }
            : exclusion === 'required-branch'
              ? { objectives: [{ kind: 'ride-branch', required: true }] }
              : exclusion === 'law-none'
                ? { cops: { ...escape.cops, mode: 'none' } }
                : { kind: 'classic-race', finale: true };
      const reg = {
        ...selectorRegistry(false),
        events: { [eventId]: event, [escapeId]: { ...escape, ...patch } },
      } as ContentRegistry;
      expect(ready(reg).scene.eventId).toBe(eventId);
    },
  );

  it('propagates selector programmer errors and invalid complete cyclic registries', () => {
    vi.spyOn(quickPlay, 'quickPlayEvents').mockImplementation(() => {
      throw new Error('probe selector programmer error');
    });
    expect(() => resolveMeasurementScene(selectorRegistry(), selection)).toThrow(
      'probe selector programmer error',
    );
    vi.restoreAllMocks();
    const cyclic = {
      ...selectorRegistry(),
      packs: [...ALL.packs, { ...escapeManifest, dependencies: { [escapePackId]: '*' } }],
    };
    expect(() => resolveMeasurementScene(cyclic, selection)).toThrow();
  });

  it.each([NaN, Infinity, -Infinity, -1, 1.5, 4294967296])(
    'reports invalid seed %s without coercion and fresh total evidence',
    (seed) => {
      const build = vi.spyOn(builder, 'buildSimConfig');
      const e = refused(ALL, { seed }, 'invalid-seed', 'seed');
      expect(e.requested.seed).toBe(Number.isFinite(seed) ? seed : null);
      expect(e.requested.seedIssue).toBe(Number.isFinite(seed) ? 'not-uint32' : 'not-finite');
      expect(e.expectedEventId).toBeNull();
      expect(e.field.eligibleCount).toBeNull();
      expect(e.field.maximumRivals).toBeNull();
      expect(e.bikeSource).toBeNull();
      expect(e.missingContent).toEqual([]);
      noActual(e);
      frozenTree(e);
      expect(e).not.toBe(refused(ALL, { seed }, 'invalid-seed', 'seed'));
      expect(build).not.toHaveBeenCalled();
    },
  );

  it.each([0, 4294967295])('retains exact valid uint32 seed %i', (seed) => {
    const r = ready(ALL, { seed });
    expect(r.scene.seed).toBe(seed);
    expect(r.config.seed).toBe(seed);
    expect(r.scene.requested.seed).toBe(seed);
    expect(r.scene.requested.seedIssue).toBeNull();
  });

  it('retains explicit light and seeded Any; weather remains metadata and full rate retains slow motion', () => {
    const region = ALL.regions[regionId]!;
    expect(region.timeOfDayOptions.length).toBeGreaterThan(0);
    for (const light of region.timeOfDayOptions) {
      for (const weather of ['local', 'dry', 'rain'] as const) {
        const r = ready(ALL, { timeOfDay: light.id, weather });
        expect(r.scene.light).toEqual({ requestedId: light.id, actualId: light.id });
        expect(r.scene.weather).toEqual({
          requested: weather,
          sky: raceSky(ALL, eventId, light.id, weather),
        });
        expect(r.scene.configProjection).toEqual(ready(ALL, { timeOfDay: light.id }).scene.configProjection);
        expect(r.scene.configProjection.slowMo).toBe(true);
        expect(r.scene.presentation).toEqual({
          graphicsPolicy: 'retain-current-graphics',
          requiredFrameDivisor: 1,
        });
      }
    }
    expect(ready().scene.light.actualId).toBe(raceTimeOfDay(ALL, eventId, selection.seed, true));
    const e = refused(ALL, { timeOfDay: 'unavailable-light' }, 'light-unavailable', 'light');
    expect(e.intendedBikeId).not.toBeNull();
    expect(e.expectedRouteId).toBeNull();
    noActual(e);
  });
});
