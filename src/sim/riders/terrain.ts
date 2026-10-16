import { atan2, cos, sin } from '../../core';
import { roadBandHeight, terrainAt, type RoadNetwork, type RoadPos, type TerrainSample } from '../../road';

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

/** Move over land in world metres, then retain a road reference for race and interaction queries. */
export function moveOnTerrain(
  road: RoadNetwork,
  at: RoadPos,
  yaw: number,
  distance: number,
  turn: number,
): number {
  const f = road.frameAt(at.edge, at.s);
  const p = road.toWorld(at.edge, at.s, at.d, 0);
  const angle = yaw + turn;
  const hx = at.dir * (cos(angle) * f.tx - sin(angle) * f.tz);
  const hz = at.dir * (cos(angle) * f.tz + sin(angle) * f.tx);
  const x = p.x + hx * distance,
    z = p.z + hz * distance;
  const next = { ...at };
  // Keep the current pass of a looping road. A globally nearest sample can choose a distant pass
  // (or even the finish) merely because its chord lies a millimetre closer to the same field.
  // Finish the local perpendicular foot with the inverse derivative, not the driving-rate clamp.
  for (let i = 0; i < 12; i++) {
    const f = road.frameAt(next.edge, next.s);
    const dx = x - f.x,
      dz = z - f.z;
    const across = -dx * f.tz + dz * f.tx;
    const along = dx * f.tx + dz * f.tz;
    const derivative = 1 - f.kappa * across;
    if (Math.abs(along) < 1e-9 || Math.abs(derivative) < 1e-9) break;
    next.s += along / derivative;
    next.d = across;
    // Carry the local reference through its legal link instead of losing motion at an endpoint.
    // The next iteration solves against that edge's own world frame, including shifted connectors.
    if (road.advance(next) === 'deadEnd') break;
  }
  const frame = road.frameAt(next.edge, next.s);
  next.d = -(x - frame.x) * frame.tz + (z - frame.z) * frame.tx;
  next.dir = hx * frame.tx + hz * frame.tz >= 0 ? 1 : -1;
  at.edge = next.edge;
  at.s = next.s;
  at.d = next.d;
  at.dir = next.dir;
  const tx = frame.tx * at.dir,
    tz = frame.tz * at.dir;
  return atan2(-hx * tz + hz * tx, hx * tx + hz * tz);
}
