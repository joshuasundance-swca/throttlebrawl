/// <reference types="vite/client" />
// Geometry invariants, the scenery (quality-confidence rec 3): on every network a route races on,
// for every sweep seed, each scenery spot the road scene places is where it belongs, as the camera
// sees it (straight down onto the scene actually built):
// - nothing over water: a land spot (palm, mangrove, shack, pole, conifer, house, sawmill) never
//   has the bare sea, a road, a deck or nothing under any point of its footprint, and never stands
//   on a bridge; a boat never has dry land under it;
// - every prop on drawn land: a land spot stands on the drawn land at its height, never floating
//   over it (a house on a hill may sink into its slope, as the terraces step down).
// Before this, the same checks ran on four networks (src/render/scenery-sweep.test.ts) and the
// real roads (tools/gis/region-routes.test.ts), each from a hand-written list. The seeds are split
// over two test files (named and spread) so the sim tier's slices can share the work.
import { describe, expect, it } from 'vitest';
import type { RoadNetwork } from '../../src/road';
import { modelKindsFor } from '../../src/render/models';
import { buildRoadScene, networkTags } from '../../src/render/road-mesh';
import { KITS, scatterRoadside, type RoadsideItem, type RoadsideKit } from '../../src/render/roadside';
import { DEPTH_M, HALF_ALONG_M, SCENERY_RADIUS_M, type ScenerySpot } from '../../src/render/scenery';
import {
  against,
  DownIndex,
  look,
  onBridge,
  print,
  routeFileCount,
  routeNetworks,
  track,
  type KnownViolation,
  type Track,
} from './geometry-routes';

const LAND = new Set<ScenerySpot['kind']>([
  'palm',
  'mangrove',
  'shack',
  'pole',
  'conifer',
  'house',
  'sawmill',
  // playtest 4 (P4-19, C2): the headlands' battery (a house-like footprint), brush and chert
  'battery',
  'brush',
  'outcrop',
]);
const BOATS = new Set<ScenerySpot['kind']>(['skiff', 'boat']);
/** The share of its clearance radius a wide spot's footprint ring must stand on land. */
const RING = 0.6;
const WIDE = new Set<ScenerySpot['kind']>(['shack', 'mangrove']);
/** A land spot this far over the ground under it floats, m. */
export const FLOAT_M = 0.35;

/** The points of a spot that must stand on land: the anchor, a ring, or a building's corners. */
export function footprint(s: ScenerySpot, road: RoadNetwork): { x: number; z: number }[] {
  const pts = [{ x: s.p.x, z: s.p.z }];
  const depth = DEPTH_M[s.kind];
  const along = HALF_ALONG_M[s.kind];
  if (depth !== undefined && along !== undefined) {
    const out = Math.sign(s.d);
    for (const u of [-along + 0.3, along - 0.3])
      for (const back of [0.3, depth - 0.3]) {
        const w = road.toWorld(s.edge, s.s + u, s.d + out * back, 0);
        pts.push({ x: w.x, z: w.z });
      }
  } else if (WIDE.has(s.kind)) {
    const r = SCENERY_RADIUS_M[s.kind] * RING;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      pts.push({ x: s.p.x + r * Math.cos(a), z: s.p.z + r * Math.sin(a) });
    }
  }
  return pts;
}

export interface SpotFindings {
  /** `<key>: <what>`, the key naming the place without the seed. */
  water: string[];
  land: string[];
  examined: { land: number; points: number; boats: number };
}

/** The spots of one built scene that break an invariant. */
export function badSpots(t: Track, spots: readonly ScenerySpot[], ground: DownIndex): SpotFindings {
  const water: string[] = [];
  const land: string[] = [];
  const examined = { land: 0, points: 0, boats: 0 };
  for (const s of spots) {
    const id = t.road.edges[s.edge]?.id ?? '?';
    const key = `${t.id} ${s.kind} ${id} s ${s.s.toFixed(0)}`;
    if (BOATS.has(s.kind)) {
      examined.boats++;
      // Seen from above (a bridge's deck may pass over it): never land above the sea where it floats.
      const hit = ground.at(s.p.x, s.p.z, s.p.y + 30);
      if (hit?.name.startsWith('road-land') && hit.y > -0.05) water.push(`${key}: a boat on ${hit.name}`);
      continue;
    }
    if (!LAND.has(s.kind)) continue;
    examined.land++;
    if (onBridge(t, s.edge, s.s)) {
      water.push(`${key}: on a bridge`);
      continue;
    }
    let anchor: { y: number; name: string } | null = null;
    let off: string | null = null;
    for (const p of footprint(s, t.road)) {
      examined.points++;
      const hit = ground.at(p.x, p.z, s.p.y + 30);
      anchor ??= hit ?? { y: -Infinity, name: 'nothing' };
      if (!hit?.name.startsWith('road-land')) {
        off = hit?.name ?? 'nothing';
        break;
      }
    }
    if (off) water.push(`${key}: over ${off}`);
    else if (anchor && s.p.y - anchor.y > FLOAT_M)
      land.push(`${key}: floats ${(s.p.y - anchor.y).toFixed(2)} m over the land`);
  }
  return { water, land, examined };
}

/** The roadside kit a network draws (render/index.ts buildRoadside: its own region's, or none). */
export function kitOf(t: Track): RoadsideKit | null {
  const { tropical, tags } = networkTags(t.road, t.dressing);
  const needed = modelKindsFor({ tropical, tags, palette: new Set(Object.keys(t.palette)), traffic: [] });
  const kind = needed.find((k) => k in KITS);
  return kind ? KITS[kind]! : null;
}

/** A roadside prop's height tolerance against the land under it, m (roadside.test.ts's). */
const PROP_DY_M = 0.35;

/**
 * The roadside kit's props (roadside.ts) that break an invariant: on a bridge (5 m either side), or
 * any of its points (the anchor, a long prop's ends, a deep prop's back) not on the drawn land at its
 * own height.
 */
export function badProps(
  t: Track,
  kit: RoadsideKit,
  items: readonly RoadsideItem[],
  ground: DownIndex,
): { water: string[]; land: string[]; examined: { props: number; points: number } } {
  const water: string[] = [];
  const land: string[] = [];
  const examined = { props: 0, points: 0 };
  for (const it of items) {
    examined.props++;
    const e = t.road.edges[it.edge]!;
    const key = `${t.id} prop ${it.rule} ${e.id} s ${it.s.toFixed(0)}`;
    if (onBridge(t, it.edge, it.s, 5)) {
      water.push(`${key}: on a bridge`);
      continue;
    }
    const rule = kit.rules.find((r) => r.id === it.rule)!;
    const pts = [it.p];
    const out = Math.sign(it.d);
    const along = (rule.along ?? 0) * 0.95;
    if (along > rule.r)
      for (const u of [-along, along]) pts.push(t.road.toWorld(e.index, it.s + u, it.d, -0.09));
    const back = (rule.back ?? 0) * 0.95;
    if (back > rule.r) pts.push(t.road.toWorld(e.index, it.s, it.d + out * back, -0.09));
    for (const p of pts) {
      examined.points++;
      const hit = ground.at(p.x, p.z, p.y + 40);
      if (!hit?.name.startsWith('road-land')) {
        water.push(`${key}: over ${hit?.name ?? 'nothing'}`);
        break;
      }
      if (Math.abs(hit.y - p.y) >= PROP_DY_M) {
        land.push(`${key}: ${(p.y - hit.y).toFixed(2)} m off the land`);
        break;
      }
    }
  }
  return { water, land, examined };
}

/**
 * Known violations on main (2026-10-03), by key. The list may only shrink: a fix deletes its entry,
 * and an entry no longer seen fails the sweep until it is deleted. Empty: main has none.
 */
export const KNOWN_SCENERY: readonly KnownViolation[] = [];

/** Registers the sweep over every route network for these seeds. */
export function scenerySweep(label: string, seeds: readonly number[]): void {
  const networks = routeNetworks();
  describe(`geometry invariants: the scenery on every route's network (${label} seeds)`, () => {
    it('derives the networks from every route file in the packs', () => {
      const routes = networks.reduce((n, x) => n + x.routes.length, 0);
      print(
        `[examined] ${networks.length} networks from ${routes} route files: ${networks.map((n) => n.id).join(', ')}`,
      );
      expect(routes).toBe(routeFileCount());
      expect(networks.length).toBeGreaterThanOrEqual(14);
    });

    it.each(networks.map((n) => [n.id, n] as const))(
      '%s: nothing over water, and every land spot and roadside prop on the drawn land at its height',
      (_id, net) => {
        const t = track(net);
        const kit = kitOf(t);
        // The land is the same for every seed (only the scatter on it is seeded; measured the same on
        // all 14 networks, 2026-10-03), so the ground is read once; the land metres check it per seed.
        const first = buildRoadScene(t.road, look, t.dressing, { seed: seeds[0] ?? 1 });
        const ground = new DownIndex(first.group);
        const landM = first.stats.landM;
        first.dispose();
        const keys = new Map<string, string>();
        let spots = 0;
        let points = 0;
        let boats = 0;
        let floating = 0;
        let props = 0;
        let propPoints = 0;
        for (const seed of seeds) {
          const built = buildRoadScene(t.road, look, t.dressing, { seed });
          expect(built.stats.landM, `seed ${seed}: the land`).toBe(landM);
          const r = badSpots(t, built.spots, ground);
          const found = [...r.water, ...r.land];
          if (kit) {
            const items = scatterRoadside({
              road: t.road,
              dressing: t.dressing,
              seed,
              density: 1,
              kit,
              landReach: (e, side, s) => built.landReach(e, side, s),
              spots: built.spots,
            });
            const q = badProps(t, kit, items, ground);
            props += q.examined.props;
            propPoints += q.examined.points;
            floating += q.land.length;
            found.push(...q.water, ...q.land);
          }
          built.dispose();
          spots += r.examined.land;
          points += r.examined.points;
          boats += r.examined.boats;
          floating += r.land.length;
          for (const line of found) {
            const key = line.slice(0, line.indexOf(':'));
            if (!keys.has(key)) keys.set(key, `seed ${seed}: ${line}`);
          }
        }
        const { fresh, seen, stale } = against([...keys.keys()], KNOWN_SCENERY);
        print(
          `[examined] ${t.id}: ${seeds.length} seeds, ${spots} land spots (${points} points read down), ${boats} boats, ` +
            `${props} roadside props${kit ? '' : ' (no kit)'} (${propPoints} points); ` +
            `${keys.size} places wrong (${floating} off their height), ${seen.length} known` +
            `${
              fresh.length
                ? `; new: ${fresh
                    .slice(0, 6)
                    .map((k) => keys.get(k))
                    .join(' | ')}`
                : ''
            }`,
        );
        expect(fresh.map((k) => keys.get(k)).slice(0, 12)).toEqual([]);
        expect(stale.filter((k) => k.startsWith(`${t.id} `))).toEqual([]);
      },
      240_000,
    );
  });
}
