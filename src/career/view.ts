// What the career screens show, as plain data (run W-R): the region's map drawn from its road
// network, its tiers and event cards in plain words, and the player's cash and bike. app/ builds
// it from the registry and the profile; ui/ only draws it (the career-show lane dresses it). The
// map is the career's personality (interview, 2026-10-02, round 6: "The map"): claimed roads glow,
// open roads are drawn, locked ones are dim, events are pins, found secrets are marked. DOM-free.
//
// Playtest 3 (round 2: "Longer + seasons"; round 1: "the boss of each tier must be beaten first";
// round 3: regions "In order"): the view names the season, offers the next one as a card once
// every region boss has fallen, pins each tier's boss, says why a region is shut, and from Season
// 2 shows each card as the season remixed it, with the node's best from this season only.
import { packOf, type ContentRegistry } from '../content';
import type { Profile } from '../save';
import { bare, careerOf, qualify, type CareerDef, type CareerNode, type EventPlan } from './defs';
import { currentPaintHex } from './garage';
import {
  lockReason,
  mapTally,
  nodeState,
  progressOf,
  regionLockReason,
  regionOpen,
  suggestedNode,
  tierBoss,
  tierOpen,
  winsInTier,
  type NodeState,
} from './map';
import { AUDIT_MAX_LINE_ITEMS } from './race-log';
import { canStartSeason, seasonCardLines, seasonLabel, seasonRace } from './season';

export type RoadState = 'claimed' | 'open' | 'locked';

export interface MapRoad {
  id: string;
  name: string;
  state: RoadState;
  /** A secret's road not found yet (run W-U): kept for the player's marker, never drawn. */
  hidden?: boolean;
  /** Map points (x east, z south), metres in the network's own frame, at most MAP_POINTS. */
  points: readonly (readonly [number, number])[];
}

export interface MapPin {
  id: string;
  x: number;
  z: number;
  state: NodeState;
  /** The region boss. */
  boss: boolean;
  /** A tier's boss (the region boss is not one): beating it opens the next tier. */
  tierBoss: boolean;
  suggested: boolean;
}

export interface MapSecret {
  id: string;
  kind: string;
  name: string;
  x: number;
  z: number;
  found: boolean;
  /** Drawn as a '?' until found (run W-U: a secret road, such as the Keys' Unlisted Key). */
  hinted: boolean;
}

/** One road network of the region, drawn on its own (each network has its own frame). */
export interface MapPanel {
  id: string;
  name: string;
  roads: MapRoad[];
  pins: MapPin[];
  secrets: MapSecret[];
  /** Bounds of everything drawn: min x, min z, max x, max z. */
  bounds: [number, number, number, number];
}

export interface NodeCard {
  id: string;
  name: string;
  /** `Classic race`, `Takedown hunt`, `Cop escape`, `Grudge match`, or `Boss` for the finale. */
  kindLabel: string;
  /** What wins it, in plain words. */
  objective: string;
  /** The optional bonuses, in plain words. */
  bonuses: string[];
  route: string;
  /** Kilometres, or null while the region's road data is not in. */
  km: number | null;
  timeOfDay: string;
  /** Cash for a win: first place and the win bonus. */
  prize: number;
  state: NodeState;
  /** Why it is locked, or ''. */
  reason: string;
  /** The region boss. */
  boss: boolean;
  /** A tier's boss (the region boss is not one): beating it opens the next tier. */
  tierBoss: boolean;
  /**
   * The best this node has gone this season, from the history: `won`, `placed`, `lost`, `busted`,
   * or null.
   */
  best: string | null;
  /** The road it sits on, by name. */
  where: string;
  rivals: string[];
}

export interface TierView {
  name: string;
  open: boolean;
  wins: number;
  requiredWins: number;
  nodes: NodeCard[];
}

/** The card that starts the next season (it resets the maps, so the player starts it). */
export interface SeasonCard {
  /** The season it starts. */
  season: number;
  /** "Season 2: Renewed". */
  title: string;
  lines: string[];
}

export interface CareerView {
  /** The season the career is in, and its name ("Season 2: Renewed"). */
  season: { n: number; label: string };
  /** The next season's card once every region boss of this one has fallen, else null. */
  seasonCard: SeasonCard | null;
  cash: number;
  bike: { key: string | null; name: string; paint: string | null };
  regions: {
    id: string;
    name: string;
    careerName: string;
    won: number;
    nodes: number;
    finaleBeaten: boolean;
    /** Whether its map is open (the regions open in order). */
    open: boolean;
    /** Why it is shut ("Opens when Mother Rust falls."), or ''. */
    lockReason: string;
  }[];
  region: {
    id: string;
    name: string;
    careerName: string;
    /** The highest open tier's name. */
    tierName: string;
    tally: ReturnType<typeof mapTally>;
    finaleBeaten: boolean;
  };
  tiers: TierView[];
  /** The node the career suggests next, or null. */
  suggested: string | null;
  /** The map, one panel per network; empty while the region's road data is not in. */
  map: MapPanel[];
}

/** The most points a road keeps on the map. */
export const MAP_POINTS = 40;

const KIND_LABEL: Readonly<Record<string, string>> = {
  'classic-race': 'Classic race',
  'takedown-hunt': 'Takedown hunt',
  'cop-escape': 'Cop escape',
  'grudge-match': 'Grudge match',
};
const TIME_LABEL: Readonly<Record<string, string>> = {
  dawn: 'Dawn',
  noon: 'Noon',
  'golden-hour': 'Golden hour',
  dusk: 'Dusk',
  night: 'Night',
};
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const words = (n: number) => NUMBER_WORDS[n] ?? String(n);
const OUTCOME_RANK: Readonly<Record<string, number>> = {
  won: 4,
  placed: 3,
  lost: 2,
  busted: 1,
  wrecked: 1,
  quit: 0,
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {};

function riderName(reg: ContentRegistry, key: string): string {
  return reg.riders[key]?.name ?? bare(key);
}

/** What wins an event, in plain words. */
export function objectiveText(reg: ContentRegistry, plan: EventPlan): string {
  const r = plan.rules;
  const required = plan.objectives.filter((o) => o.required);
  const parts = required.map((o) => {
    const p = o.params;
    switch (o.kind) {
      case 'finish-place': {
        const max = typeof p['maxPlace'] === 'number' ? p['maxPlace'] : 3;
        return max > plan.field.length ? 'Finish the race' : `Finish in the top ${max}`;
      }
      case 'takedowns': {
        const n = typeof p['count'] === 'number' ? p['count'] : (r.targetCount ?? 1);
        return `Knock ${words(n)} riders off${r.endOnCount ? '' : ' before the finish'}`;
      }
      case 'escape':
        return r.escapeBy === 'distance'
          ? `Once a cop is on you, ride ${((r.escapeDistanceM ?? 0) / 1000).toFixed(1)} km without being knocked off, or lose him`
          : `Once a cop is on you, last ${r.surviveS ?? 60} s without being knocked off, or lose him`;
      case 'beat-rival': {
        // Worded by the rival's rule, the way the race log judges it, so the line under the rule
        // card never contradicts it (live check, 2026-10-03: the Collab read "Beat Chad Speedwell
        // to the line." under "Most style at the line wins").
        const name = r.rival ? riderName(reg, r.rival) : 'your rival';
        const or = num(p['orKnockdowns'], 0);
        const down = (k: number) =>
          r.rule === 'timber'
            ? `knock ${name} into traffic or scenery ${words(k)} times`
            : `knock ${name} down ${words(k)} times`;
        if ((p['winBy'] ?? r.winBy) === 'knockdowns') {
          const line = upper(down(Math.max(1, Math.round(num(p['knockdowns'], r.knockdownsToWin ?? 1)))));
          return r.rule === 'audit'
            ? `${line}, plus one per hit you take (up to ${words(AUDIT_MAX_LINE_ITEMS)} more)`
            : line;
        }
        if (r.rule === 'collab') return `Have more style cash than ${name} when you cross the line`;
        return or > 0 ? `Beat ${name} to the line, or ${down(or)}` : `Beat ${name} to the line`;
      }
      case 'style-cash':
        return `Score $${num(p['cash'], 0)} in style`;
      case 'ride-branch':
        return 'Ride the shortcut';
    }
    return '';
  });
  return parts.filter(Boolean).join('. ') + '.';
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const upper = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function bonusTexts(plan: EventPlan): string[] {
  return plan.objectives
    .filter((o) => !o.required && o.rewardCash > 0)
    .map((o) => {
      const p = o.params;
      switch (o.kind) {
        case 'finish-place':
          return `Top ${num(p['maxPlace'], 3)}: +$${o.rewardCash}`;
        case 'style-cash':
          return `$${num(p['cash'], 0)} of style: +$${o.rewardCash}`;
        case 'ride-branch':
          return `Ride the shortcut: +$${o.rewardCash}`;
        default:
          return `Bonus: +$${o.rewardCash}`;
      }
    });
}

/** A route's name: its own, else "<start road> to <finish road>". */
function routeName(reg: ContentRegistry, routeKey: string): string {
  const route = reg.routes[routeKey] as unknown as Json | undefined;
  if (!route) return '';
  if (typeof route['name'] === 'string' && route['name']) return route['name'];
  const pack = packOf(routeKey);
  const path = Array.isArray(route['mainPath']) ? (route['mainPath'] as string[]) : [];
  const name = (id: string | undefined) => (id ? (reg.roads[qualify(pack, id)]?.name ?? '') : '');
  const a = name(path[0]);
  const b = name(path[path.length - 1]);
  return a && b ? `${a} to ${b}` : '';
}

function routeKm(reg: ContentRegistry, routeKey: string): number | null {
  const route = reg.routes[routeKey];
  if (!route) return null;
  const pack = packOf(routeKey);
  let total = 0;
  for (const id of route.mainPath) {
    const road = reg.roads[qualify(pack, id)];
    if (!road) return null;
    total += road.lengthM;
  }
  const last = reg.roads[qualify(pack, route.mainPath[route.mainPath.length - 1] ?? '')];
  total -= route.start.s + ((last?.lengthM ?? 0) - route.finish.s);
  return Math.round(total / 100) / 10;
}

function bestOutcome(profile: Profile, def: CareerDef, node: CareerNode): string | null {
  let best: string | null = null;
  for (const h of profile.history) {
    // A quit is no result, and an earlier season's is not this map's.
    if (h.region !== def.regionId || h.node !== node.id || h.outcome === 'quit') continue;
    if ((h.season ?? 1) !== profile.season) continue;
    if (best === null || (OUTCOME_RANK[h.outcome] ?? 0) > (OUTCOME_RANK[best] ?? 0)) best = h.outcome;
  }
  return best;
}

/** The career screen's view of one region. */
export function careerView(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  profile: Profile,
  region: string,
): CareerView {
  const def = careerOf(defs, region) ?? defs[0];
  if (!def) throw new Error('no career');
  const progress = progressOf(def, profile.regions);
  const suggested = suggestedNode(def, progress);
  const races = new Map(def.nodes.map((n) => [n.id, seasonRace(reg, defs, profile, def, n)]));
  const nameOf = (id: string) => races.get(id)?.plan.name ?? id;
  const card = (n: CareerNode): NodeCard => {
    const race = races.get(n.id);
    const plan = race?.plan as EventPlan;
    const length = race?.length ?? null;
    const route = length?.route ?? '';
    const winBonus = plan.objectives.filter((o) => o.required).reduce((s, o) => s + o.rewardCash, 0);
    const roadKey = qualify(def.pack, n.road);
    return {
      id: n.id,
      name: plan.name,
      kindLabel: n.id === def.boss ? 'Boss' : (KIND_LABEL[plan.kind] ?? plan.kind),
      objective: objectiveText(reg, plan),
      bonuses: bonusTexts(plan),
      route: routeName(reg, route),
      km: routeKm(reg, route),
      timeOfDay: TIME_LABEL[plan.timeOfDay] ?? plan.timeOfDay,
      prize: (plan.byPlaceCash[0] ?? 0) + winBonus,
      state: nodeState(def, progress, n),
      reason: lockReason(def, progress, n, nameOf) ?? '',
      boss: n.id === def.boss,
      tierBoss: n.id !== def.boss && tierBoss(def, n.tier) === n.id,
      best: bestOutcome(profile, def, n),
      where: reg.roads[roadKey]?.name ?? '',
      rivals: plan.field.map((r) => riderName(reg, r)),
    };
  };
  const currentBike = profile.bikes.current;
  const next = profile.season + 1;
  return {
    season: { n: profile.season, label: seasonLabel(profile.season) },
    seasonCard: canStartSeason(defs, profile)
      ? { season: next, title: seasonLabel(next), lines: seasonCardLines(next) }
      : null,
    cash: profile.cash,
    bike: {
      key: currentBike,
      name: currentBike ? (reg.bikes[currentBike]?.name ?? bare(currentBike)) : '',
      paint: currentPaintHex(defs, profile),
    },
    regions: defs.map((d) => {
      const p = progressOf(d, profile.regions);
      return {
        id: d.regionId,
        name: d.regionName,
        careerName: d.name,
        won: d.nodes.filter((n) => p.won.includes(n.id)).length,
        nodes: d.nodes.length,
        finaleBeaten: p.finaleBeaten,
        open: regionOpen(defs, profile, d),
        lockReason: regionLockReason(defs, profile, d) ?? '',
      };
    }),
    region: {
      id: def.regionId,
      name: def.regionName,
      careerName: def.name,
      tierName: def.tiers[progress.tier - 1]?.name ?? '',
      tally: mapTally(def, progress),
      finaleBeaten: progress.finaleBeaten,
    },
    tiers: def.tiers.map((t, i) => ({
      name: t.name,
      open: tierOpen(def, progress, i),
      wins: winsInTier(def, progress, i),
      requiredWins: t.requiredWins,
      nodes: def.nodes.filter((n) => n.tier === i).map(card),
    })),
    suggested: suggested?.id ?? null,
    map: careerMap(reg, def, profile),
  };
}

/** A road's samples as map points (thinned to MAP_POINTS), or null while its data is not in. */
function roadPoints(reg: ContentRegistry, key: string): [number, number][] | null {
  const road = reg.roads[key] as unknown as Json | undefined;
  const data = obj(obj(road?.['samples'])['data']);
  const xs = data['x'];
  const zs = data['z'];
  if (!Array.isArray(xs) || !Array.isArray(zs) || xs.length < 2) return null;
  const n = Math.min(xs.length, zs.length);
  const step = Math.max(1, Math.ceil((n - 1) / (MAP_POINTS - 1)));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i += step) out.push([Number(xs[i]), Number(zs[i])]);
  if ((n - 1) % step !== 0) out.push([Number(xs[n - 1]), Number(zs[n - 1])]);
  return out;
}

/** The point at `s` metres along a road, from its samples. */
function pointAt(reg: ContentRegistry, key: string, s: number): [number, number] | null {
  const road = reg.roads[key] as unknown as Json | undefined;
  const data = obj(obj(road?.['samples'])['data']);
  const xs = data['x'];
  const zs = data['z'];
  const spacing = typeof road?.['sampleSpacingM'] === 'number' ? road['sampleSpacingM'] : 2;
  if (!Array.isArray(xs) || !Array.isArray(zs) || xs.length === 0) return null;
  const i = Math.max(0, Math.min(xs.length - 1, Math.round(s / spacing)));
  return [Number(xs[i]), Number(zs[i])];
}

// Run W-S: the network bakes (tools/gis `tbgis network`) end "(OSM network bake)".
const NETWORK_SUFFIX = / \((?:OSM bake|OSM network bake|hand-authored)\)$/;

/**
 * The region's map, one panel per road network that holds a node or a secret (each network has
 * its own frame). Empty while the region's road data is not loaded.
 */
export function careerMap(reg: ContentRegistry, def: CareerDef, profile: Profile): MapPanel[] {
  const progress = progressOf(def, profile.regions);
  const suggested = suggestedNode(def, progress)?.id ?? null;
  const region = obj(reg.regions[def.regionKey]);
  const regionPack = packOf(def.regionKey);
  const networkKeys = [
    ...(Array.isArray(region['networks']) ? (region['networks'] as string[]) : []).map((n) =>
      qualify(regionPack, n),
    ),
    ...Object.keys(reg.networks).filter(
      (k) => packOf(k) === def.pack && reg.networks[k]?.region === def.regionId,
    ),
  ];
  const panels: MapPanel[] = [];
  for (const netKey of [...new Set(networkKeys)]) {
    const net = reg.networks[netKey];
    if (!net) continue;
    const pack = packOf(netKey);
    const roadIds = new Set(net.roads);
    const nodes = def.nodes.filter((n) => roadIds.has(n.road));
    const secrets = def.secrets.filter((s) => roadIds.has(s.road));
    if (nodes.length === 0 && secrets.length === 0) continue;
    // Run W-U: a secret road stays off the map (a '?' marks it) until it is found.
    const hidden = new Set(
      def.secrets.filter((x) => !progress.secrets.includes(x.id)).flatMap((x) => x.hides ?? []),
    );
    const roads: MapRoad[] = [];
    let ok = true;
    for (const id of net.roads) {
      const points = roadPoints(reg, qualify(pack, id));
      if (!points) {
        ok = false;
        break;
      }
      const state: RoadState = progress.claimedRoads.includes(id)
        ? 'claimed'
        : progress.unlockedRoads.includes(id) || progress.finaleBeaten
          ? 'open'
          : 'locked';
      roads.push({
        id,
        name: reg.roads[qualify(pack, id)]?.name ?? id,
        state,
        points,
        ...(hidden.has(id) ? { hidden: true } : {}),
      });
    }
    if (!ok) continue;
    const pins: MapPin[] = [];
    for (const n of nodes) {
      const p = pointAt(reg, qualify(pack, n.road), n.s);
      if (p)
        pins.push({
          id: n.id,
          x: p[0],
          z: p[1],
          state: nodeState(def, progress, n),
          boss: n.id === def.boss,
          tierBoss: n.id !== def.boss && tierBoss(def, n.tier) === n.id,
          suggested: n.id === suggested,
        });
    }
    const marks: MapSecret[] = [];
    for (const s of secrets) {
      const p = pointAt(reg, qualify(pack, s.road), s.s);
      if (p)
        marks.push({
          id: s.id,
          kind: s.kind,
          name: s.name,
          x: p[0],
          z: p[1],
          found: progress.secrets.includes(s.id),
          hinted: s.kind === 'road',
        });
    }
    let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of roads)
      for (const [x, z] of r.points) {
        x0 = Math.min(x0, x);
        z0 = Math.min(z0, z);
        x1 = Math.max(x1, x);
        z1 = Math.max(z1, z);
      }
    const name = (net.name ?? net.id).replace(NETWORK_SUFFIX, '').replace(/^Keys M1 /, 'The Keys ');
    panels.push({ id: net.id, name, roads, pins, secrets: marks, bounds: [x0, z0, x1, z1] });
  }
  return panels;
}
