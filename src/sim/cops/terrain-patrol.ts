import { DEFAULT_HITBOX } from '../../core';
import { gapAt, lanesUnderOf, raceStructures, terrainAt, type RoadPos } from '../../road';
import { structuresNear } from '../riders/structures';
import { riderHitbox } from '../world';
import type { SimConfig } from '../types';

/**
 * Explicit author permission, never inferred from grass. All of the body stays within 4 m of
 * its lane edge. The terrain-tree planner keeps its full silhouette at least 8 m off every
 * lane (terrain-trees.ts RECOVERY_M); the actual shipped cohorts verify this belt in tests.
 */
export function terrainPatrolSpot(config: SimConfig, pos: RoadPos): RoadPos | null {
  const { road } = config;
  if (!road.terrain) return null;
  const edge = road.edges[pos.edge];
  if (!edge) return null;
  const side = pos.dir > 0 ? 1 : -1;
  const name = side > 0 ? 'right' : 'left';
  let halfLength = DEFAULT_HITBOX.lengthM / 2;
  let halfWidth = DEFAULT_HITBOX.widthM / 2;
  config.riders.forEach((r, i) => {
    if (r.controller.kind !== 'cop') return;
    const box = riderHitbox(config, i);
    halfLength = Math.max(halfLength, box.lengthM / 2);
    halfWidth = Math.max(halfWidth, box.widthM / 2);
  });
  const radius = Math.sqrt(halfLength * halfLength + halfWidth * halfWidth);
  const permitted = edge.tags.some(
    (t) =>
      t.tag === 'patrol-verge' &&
      (t.side === 'both' || t.side === name) &&
      t.s0 <= pos.s - halfLength &&
      t.s1 >= pos.s + halfLength,
  );
  if (!permitted || pos.s < halfLength || pos.s + halfLength > edge.length) return null;
  const lane = road.lanesAt(pos.edge, pos.s).find((l) => l.kind === 'drive' && l.direction === pos.dir);
  if (!lane) return null;
  const outer = side > 0 ? edge.dMax : -edge.dMin;
  const lanes = lanesUnderOf(road);
  const frame = road.frameAt(pos.edge, pos.s);
  for (let move = 0; move <= 1.5; move += 0.5) {
    const off = radius + 0.3 + move;
    if (off + radius > 4) break; // Reject a body too large for the protected belt.
    const d = side * (outer + off);
    const at = road.toWorld(pos.edge, pos.s, d, 0);
    const grass = terrainAt(road.terrain, at.x, at.z);
    if (!grass || grass.surface !== 'grass' || Math.abs(grass.y - at.y) > 0.15 || grass.normal.y < 0.99)
      continue;
    if (lanes.at(at.x, grass.y, at.z, radius + 0.3)) continue;
    let safe = true;
    for (const along of [-halfLength, 0, halfLength]) {
      const s = pos.s + along;
      const verge = road.vergeAt(pos.edge, s, name);
      if (
        verge.edge !== 'soft' ||
        verge.surface !== 'grass' ||
        road.barrierAt(pos.edge, s, name) ||
        gapAt(road, pos.edge, s, d)
      ) {
        safe = false;
        break;
      }
      for (const across of [-halfWidth, 0, halfWidth]) {
        const x = at.x + frame.tx * along - frame.tz * across;
        const z = at.z + frame.tz * along + frame.tx * across;
        const ground = terrainAt(road.terrain, x, z);
        // All rectangle corners lie in one convex solid face: the complete body is supported,
        // rather than bridging a hole between independently supported wheels/corners.
        if (
          !ground ||
          ground.surface !== 'grass' ||
          ground.patch !== grass.patch ||
          ground.triangle !== grass.triangle ||
          Math.abs(ground.y - grass.y) > 0.15
        ) {
          safe = false;
          break;
        }
      }
      if (!safe) break;
    }
    if (!safe) continue;
    const plan = raceStructures(road, config.seed);
    if (
      structuresNear(plan, at.x, at.z, radius + 0.3).some(
        (st) =>
          st.baseY < grass.y + 1.6 &&
          Math.max(st.baseY + (st.roof.kind === 'flat' ? st.roof.topM : st.roof.ridgeM), st.baseY) >
            grass.y - 0.15,
      )
    )
      continue;
    return { ...pos, d };
  }
  return null;
}
