// The road lint as a packs:check hook (docs/content-packs.md, "Validation": other lanes' rules plug
// in without editing the validator). tools/packs/run.ts lists this module in HOOK_MODULES and
// loads it through Vite's module runner. For every road network in the packs it gathers the
// network's roads and routes and runs src/road/validate.ts on them: samples, curvature, grade,
// width, features, junction ends, connector rows and split zones, the jump rule, and routes. Each
// road issue becomes an error that names the pack file and the JSON pointer.
import type { Finding } from '../../src/content/findings';
import type { LintContext, PackRule } from '../../src/content/lint';
import type { ParsedEntry } from '../../src/content/parse';
import type { BakedNetwork, BakedRoad, BakedRoute } from '../../src/road/types';
import { lintRoadNetwork } from '../../src/road/validate';

function checkRoads(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  const roads = ctx.entries('road');
  const routes = ctx.entries('route');
  for (const net of ctx.entries('road-network')) {
    const mine = (e: ParsedEntry) => e.packId === net.packId && e.data['network'] === net.id;
    const netRoads = roads.filter(mine);
    const netRoutes = routes.filter(mine);
    // The lint labels files by kind and id; map them back to the pack files.
    const files = new Map<string, string>([[`network:${net.id}`, net.path]]);
    for (const r of netRoads) files.set(`road:${r.id}`, r.path);
    for (const r of netRoutes) files.set(`route:${r.id}`, r.path);
    // Roads the network lists but whose files name no network still count as its roads.
    const listed = new Set((net.data['roads'] as unknown[] | undefined)?.map(String) ?? []);
    for (const r of roads) {
      if (r.packId === net.packId && listed.has(r.id) && !netRoads.includes(r)) {
        netRoads.push(r);
        files.set(`road:${r.id}`, r.path);
      }
    }
    const issues = lintRoadNetwork(
      {
        network: net.data as unknown as BakedNetwork,
        roads: netRoads.map((r) => r.data as unknown as BakedRoad),
        routes: netRoutes.map((r) => r.data as unknown as BakedRoute),
      },
      (kind, id) => files.get(`${kind}:${id}`) ?? `${kind}:${id}`,
    );
    for (const i of issues) {
      out.push({
        level: 'error',
        rule: `road-${i.rule}`,
        file: i.file,
        pointer: i.pointer,
        message: i.message,
      });
    }
  }
  return out;
}

/**
 * The lap-count rule (docs/content-packs.md, "Event" and "Route file"): an event length with
 * `laps` above 1 must name a `closed` route. A point-to-point route runs once. A reference that
 * does not resolve is left to the built-in reference rule.
 */
function checkLaps(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  for (const ev of ctx.entries('event')) {
    const lengths = ev.data['lengths'];
    if (!Array.isArray(lengths)) continue;
    lengths.forEach((l: unknown, i) => {
      if (typeof l !== 'object' || l === null) return;
      const { laps, route } = l as { laps?: unknown; route?: unknown };
      if (typeof laps !== 'number' || laps <= 1 || typeof route !== 'string') return;
      const target = ctx.resolve(ev.packId, route, 'route').entry;
      if (!target || target.data['closed'] === true) return;
      out.push({
        level: 'error',
        rule: 'road-laps',
        file: ev.path,
        pointer: `/lengths/${i}/laps`,
        message: `${laps} laps need a closed route, and route ${route} is point to point (closed: false)`,
      });
    });
  }
  return out;
}

export const packRules: PackRule[] = [
  {
    id: 'roads',
    description:
      'the road lint on every network: samples, curvature, grade, width, features, junctions and connectors, jumps, routes',
    check: checkRoads,
  },
  {
    id: 'laps',
    description: 'an event length with laps > 1 names a closed route',
    check: checkLaps,
  },
];
