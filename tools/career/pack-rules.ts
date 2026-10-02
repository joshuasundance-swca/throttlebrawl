// The career map lint as a packs:check hook (W-Q contracts; interview, 2026-10-02: "Network map,
// tiered", and "The map": claim roads, find secrets and shortcuts, a set-piece finale per region).
// tools/packs/run.ts lists this module in HOOK_MODULES. For every career file it checks the map
// against its region: each node's event is the region's and has the length it names, each node and
// secret sits on a road of the region's networks within that road's length, the roads a win opens
// or claims are the region's, tiers and nodes are unique and well ordered, a tier's gate asks no
// more wins than it has nodes, and the boss is a node in the last tier whose event is the region's
// finale (the only one). References (region, bikes, events) are the built-in refs rule's.
import { error, warning, type Finding } from '../../src/content/findings';
import type { LintContext, PackRule } from '../../src/content/lint';
import type { ParsedEntry } from '../../src/content/parse';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The roads of a region's networks, by id, with their lengths. */
function regionRoads(ctx: LintContext, career: ParsedEntry, region: ParsedEntry): Map<string, number> {
  const out = new Map<string, number>();
  for (const netRef of list(region.data['networks']).map(str)) {
    const net = ctx.resolve(region.packId, netRef, 'road-network').entry;
    if (!net) continue;
    for (const roadId of list(net.data['roads']).map(str)) {
      const road = ctx.resolve(net.packId, roadId, 'road').entry;
      const len = road?.data['lengthM'];
      if (typeof len === 'number') out.set(roadId, len);
    }
  }
  // A career may also sit on its own pack's roads of the region (a region pack adding to base's).
  for (const road of ctx.entries('road')) {
    if (out.has(road.id) || road.packId !== career.packId) continue;
    const net = ctx.resolve(road.packId, str(road.data['network']), 'road-network').entry;
    if (net && str(net.data['region']) === region.id && typeof road.data['lengthM'] === 'number')
      out.set(road.id, road.data['lengthM']);
  }
  return out;
}

function checkCareer(ctx: LintContext, c: ParsedEntry): Finding[] {
  const out: Finding[] = [];
  const err = (ptr: string, msg: string) => out.push(error('careers', c.path, ptr, msg));
  const warn = (ptr: string, msg: string) => out.push(warning('careers', c.path, ptr, msg));
  const d = c.data;
  const region = ctx.resolve(c.packId, str(d['region']), 'region').entry;
  if (!region) return out; // the refs rule reports it
  const roads = regionRoads(ctx, c, region);
  const onMap = (ptr: string, at: unknown) => {
    if (!isObj(at)) return;
    const road = str(at['road']);
    const len = roads.get(road);
    if (len === undefined) err(`${ptr}/road`, `road ${road} is not on ${region.id}'s networks`);
    else if (typeof at['s'] === 'number' && at['s'] > len)
      err(`${ptr}/s`, `s ${at['s']} is past the end of ${road} (${len} m)`);
  };

  const tiers = list(d['tiers']).filter(isObj);
  const tierIndex = new Map<string, number>();
  tiers.forEach((t, i) => {
    const id = str(t['id']);
    if (tierIndex.has(id)) err(`/tiers/${i}/id`, `tier ${id} is listed twice`);
    tierIndex.set(id, i);
  });
  const nodes = list(d['nodes']).filter(isObj);
  const nodeTier = new Map<string, number>();
  const perTier = new Map<number, number>();
  nodes.forEach((n, i) => {
    const id = str(n['id']);
    if (nodeTier.has(id)) err(`/nodes/${i}/id`, `node ${id} is listed twice`);
    const t = tierIndex.get(str(n['tier']));
    if (t === undefined) err(`/nodes/${i}/tier`, `no tier ${str(n['tier'])}`);
    nodeTier.set(id, t ?? -1);
    if (t !== undefined) perTier.set(t, (perTier.get(t) ?? 0) + 1);
  });
  const finales: string[] = [];
  nodes.forEach((n, i) => {
    const ptr = `/nodes/${i}`;
    onMap(`${ptr}/at`, n['at']);
    const event = ctx.resolve(c.packId, str(n['event']), 'event').entry;
    if (event) {
      if (str(event.data['region']) !== region.id)
        err(`${ptr}/event`, `event ${event.id} is in ${str(event.data['region'])}, not ${region.id}`);
      const lengths = list(event.data['lengths'])
        .filter(isObj)
        .map((l) => str(l['id']));
      if (n['length'] !== undefined && !lengths.includes(str(n['length'])))
        err(`${ptr}/length`, `event ${event.id} has no length ${str(n['length'])} (${lengths.join(', ')})`);
      if (event.data['finale'] === true) finales.push(str(n['id']));
      const tier = nodeTier.get(str(n['id'])) ?? -1;
      const eventTier = event.data['tier'];
      if (typeof eventTier === 'number' && tier >= 0 && eventTier !== tier + 1)
        warn(`${ptr}/tier`, `event ${event.id} says tier ${eventTier}, the map puts it in tier ${tier + 1}`);
    }
    list(n['requires']).forEach((r, k) => {
      const need = nodeTier.get(str(r));
      if (need === undefined) err(`${ptr}/requires/${k}`, `no node ${str(r)}`);
      else if (need > (nodeTier.get(str(n['id'])) ?? -1))
        err(`${ptr}/requires/${k}`, `node ${str(r)} is in a later tier`);
    });
    for (const key of ['opens', 'claims'] as const) {
      list(n[key]).forEach((r, k) => {
        if (!roads.has(str(r))) err(`${ptr}/${key}/${k}`, `road ${str(r)} is not on ${region.id}'s networks`);
      });
    }
  });
  tiers.forEach((t, i) => {
    const wins = isObj(t['advance']) ? t['advance']['requiredWins'] : undefined;
    const count = perTier.get(i) ?? 0;
    if (count === 0) err(`/tiers/${i}`, `tier ${str(t['id'])} has no nodes`);
    else if (typeof wins === 'number' && wins > count)
      err(`/tiers/${i}/advance/requiredWins`, `${wins} wins asked, but the tier has ${count} nodes`);
  });
  const boss = str(d['boss']);
  const bossTier = nodeTier.get(boss);
  if (bossTier === undefined) err('/boss', `no node ${boss}`);
  else {
    if (bossTier !== tiers.length - 1) err('/boss', `the boss ${boss} is not in the last tier`);
    if (!finales.includes(boss)) err('/boss', `the boss ${boss}'s event is not marked finale: true`);
  }
  for (const f of finales)
    if (f !== boss) err('/nodes', `node ${f}'s event is a finale, but the boss is ${boss}`);
  const secretIds = new Set<string>();
  list(d['secrets'])
    .filter(isObj)
    .forEach((s, i) => {
      const id = str(s['id']);
      if (secretIds.has(id)) err(`/secrets/${i}/id`, `secret ${id} is listed twice`);
      secretIds.add(id);
      onMap(`/secrets/${i}/at`, s['at']);
    });
  list(d['shop'])
    .filter(isObj)
    .forEach((s, i) => {
      if (!tierIndex.has(str(s['unlockTier'])))
        err(`/shop/${i}/unlockTier`, `no tier ${str(s['unlockTier'])}`);
    });
  return out;
}

function checkCareers(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  const byRegion = new Map<string, string>();
  for (const c of ctx.entries('career')) {
    out.push(...checkCareer(ctx, c));
    const region = str(c.data['region']);
    const other = byRegion.get(region);
    if (other && c.status !== 'draft')
      out.push(warning('careers', c.path, '/region', `${region} already has the career ${other}`));
    if (c.status !== 'draft') byRegion.set(region, c.id);
  }
  return out;
}

export const packRules: PackRule[] = [
  {
    id: 'careers',
    description: "career maps sit on their region's roads, tiers and nodes are well ordered, one finale boss",
    check: checkCareers,
  },
];
