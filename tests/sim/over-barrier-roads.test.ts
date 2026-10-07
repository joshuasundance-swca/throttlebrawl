/// <reference types="vite/client" />
// Over the barrier on every road (2026-10-06; road/beyond.ts): the one rule ("a barrier holds you only
// below its top; what lies beyond decides") reads the road's own data, so this sweep holds that data
// honest on every network a route races on, from the packs' route files:
// - every barrier has its height (the road lint refuses one with none; here, as baked);
// - every `hard` edge says what stands there: a barrier, a drawn top (the bluff's parapet, the
//   interstate's guard rail, the ferry's bulwark) or a building front, which stays a wall at any height
//   (the one known gap: buildings are not in the sim). A hard edge nothing names is listed, so it
//   cannot hide;
// - what lies past each edge, counted per network and printed;
// - each network's water level matches the water its backdrop draws (Lake Samish's 82.85 m).
import { describe, expect, it } from 'vitest';
import {
  BUILDING_FRONT_TAGS,
  edgeTopAt,
  EDGE_TOP_BY_TAG,
  pastAt,
  vergeTagAt,
  WATER_LEVEL_M,
  waterLevelOf,
} from '../../src/road';
import { print, routeNetworks, track } from './geometry-routes';

const backdrops = import.meta.glob<unknown>('/packs/*/assets/backdrop/*/networks/*.json', {
  eager: true,
  import: 'default',
});

/** The `floor` pieces of a backdrop file whose surface is water, anywhere in it. */
function waterFloors(v: unknown, out: number[] = []): number[] {
  if (Array.isArray(v)) for (const x of v) waterFloors(x, out);
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o['kind'] === 'floor' && o['surface'] === 'water') out.push(typeof o['y'] === 'number' ? o['y'] : 0);
    for (const x of Object.values(o)) if (x && typeof x === 'object') waterFloors(x, out);
  }
  return out;
}

/** Sides every this many metres along each road. */
const STEP_M = 10;

describe('over the barrier: the road data on every route network', () => {
  const nets = routeNetworks();

  it('every barrier has a height, and every tagged hard edge says what stands there (printed per network)', () => {
    /** Hard edges with no tag over them (no ground drawn there), by road: walls at any height, as before. */
    const untagged = new Map<string, number>();
    const unnamed: string[] = [];
    let sides = 0;
    let barriers = 0;
    for (const net of nets) {
      const { road } = track(net);
      const counts = new Map<string, number>();
      for (const e of road.edges) {
        for (const b of e.barriers) {
          barriers++;
          expect(Number.isFinite(b.heightM) && b.heightM > 0, `${e.id}: a ${b.kind} with no height`).toBe(
            true,
          );
        }
        for (let s = 0; s <= e.length; s += STEP_M) {
          for (const side of ['left', 'right'] as const) {
            sides++;
            const v = road.vergeAt(e.index, s, side);
            const top = edgeTopAt(road, e.index, s, side);
            const past = pastAt(road, e.index, s, side);
            const barrier = road.barrierAt(e.index, s, side);
            const tag = vergeTagAt(e, side, s);
            let what: string;
            if (top === null) what = `ground edge (${v.edge})`;
            else if (barrier) what = `${barrier.kind} ${barrier.heightM} m`;
            else if (v.edge === 'water') what = 'water edge';
            else if (top === Infinity && tag !== null && BUILDING_FRONT_TAGS.has(tag))
              what = 'building front';
            else if (tag !== null && Object.hasOwn(EDGE_TOP_BY_TAG, tag)) what = `${tag} ${top} m`;
            else if (tag === null) {
              // No tag over this side here: nothing is drawn to say what stands, so it is the old wall.
              what = 'untagged hard edge';
              untagged.set(`${net.id}/${e.id}`, (untagged.get(`${net.id}/${e.id}`) ?? 0) + 1);
            } else {
              what = 'UNNAMED hard edge';
              unnamed.push(`${net.id}/${e.id} s ${s} ${side} (${tag})`);
            }
            const key = `${what} -> ${past}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
      }
      print(
        `[over-barrier-roads] ${net.id} (water ${waterLevelOf(road)} m): ${[...counts].map(([k, n]) => `${k} x${n}`).join('; ')}`,
      );
    }
    print(
      `[over-barrier-roads] ${nets.length} networks, ${barriers} barriers, ${sides} sides every ${STEP_M} m; untagged hard edges (walls at any height, as before): ${[...untagged].map(([k, n]) => `${k} x${n}`).join(', ')}`,
    );
    expect(barriers).toBeGreaterThan(0);
    expect(unnamed.slice(0, 20)).toEqual([]);
  });

  it("each network's water level is the water its backdrop draws", () => {
    let checked = 0;
    for (const [path, file] of Object.entries(backdrops)) {
      const id = /networks\/([^/]+)\.json$/.exec(path)?.[1];
      if (!id) continue;
      const floors = waterFloors(file);
      if (floors.length === 0) continue;
      checked++;
      const highest = Math.max(...floors);
      const level = Object.hasOwn(WATER_LEVEL_M, id) ? WATER_LEVEL_M[id] : 0;
      print(
        `[over-barrier-roads] ${id}: backdrop water at ${[...new Set(floors)].join(', ')} m; the road's level ${level} m`,
      );
      expect(level, id).toBe(highest);
    }
    // The check can see a lake: Lake Samish's backdrop is one of them.
    expect(checked).toBeGreaterThan(0);
    expect(WATER_LEVEL_M['osm-pnw-samish']).toBe(82.85);
  });
});
