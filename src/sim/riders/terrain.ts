import { cos, sin } from '../../core';
import { roadBandHeight, terrainAt, type RoadNetwork, type TerrainSample } from '../../road';

type Position = { readonly edge: number; readonly s: number; readonly d: number };

/** Authored natural land outside the actual drawn road/shoulder band; never the old road plane. */
export function terrainGroundAt(road: RoadNetwork, at: Position, maxY = Infinity): TerrainSample | null {
  if (!road.terrain || roadBandHeight(road, at.edge, at.s, at.d) !== null) return null;
  const p = road.toWorld(at.edge, at.s, at.d, 0);
  const ground = terrainAt(road.terrain, p.x, p.z, maxY);
  return ground && ground.surface !== 'water' ? ground : null;
}

/** Height change per metre along the bike's real world heading, including cross-slope and reverse. */
export function terrainGrade(
  road: RoadNetwork,
  at: Position & { readonly dir: 1 | -1 },
  yaw: number,
  ground: TerrainSample,
): number {
  const f = road.frameAt(at.edge, at.s);
  const tx = f.tx * at.dir,
    tz = f.tz * at.dir;
  return ground.dyDx * (cos(yaw) * tx - sin(yaw) * tz) + ground.dyDz * (cos(yaw) * tz + sin(yaw) * tx);
}
