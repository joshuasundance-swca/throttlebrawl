// Telegraphs read straight from the snapshot: a horn from oncoming traffic about to meet you, and
// the siren while the cop is near (M1.md audio-1; the product spec's fairness rule wants a threat
// heard before it arrives). Presentation only: nothing here feeds back into the sim.
import type { EntitySnapshot } from '../sim/api';
import { HORN_DEFAULTS } from './tuning';

export interface HornOptions {
  /** How far ahead an oncoming vehicle honks, metres. */
  rangeM: number;
  /** Half-width of your line: vehicles further to the side are in another lane. */
  laneHalfWidthM: number;
  /** Seconds before the same vehicle may honk again. */
  cooldownS: number;
}

// Its numbers live in tuning.ts beside the slider that reads them, off the lazy audio engine.
export { HORN_DEFAULTS };

const BIG = /truck|rv|bus|semi|rig/i;

export interface Honk {
  id: number;
  truck: boolean;
  /** Metres between you and the vehicle. */
  distanceM: number;
}

/**
 * Oncoming vehicles in your line and within range that have not honked recently. `lastHonk` maps
 * vehicle id to the time it last honked and is updated here.
 */
export function findHonks(
  player: EntitySnapshot,
  entities: readonly EntitySnapshot[],
  now: number,
  lastHonk: Map<number, number>,
  opts: HornOptions = HORN_DEFAULTS,
): Honk[] {
  const fx = -Math.sin(player.heading);
  const fz = -Math.cos(player.heading);
  const out: Honk[] = [];
  for (const v of entities) {
    if (v.kind !== 'vehicle' || v.id === player.id) continue;
    const rx = v.x - player.x;
    const rz = v.z - player.z;
    const ahead = rx * fx + rz * fz;
    if (ahead <= 0 || ahead > opts.rangeM) continue;
    const side = Math.abs(rx * fz - rz * fx);
    if (side > opts.laneHalfWidthM) continue;
    // Coming at you: its facing points back along yours.
    const facing = -Math.sin(v.heading) * fx + -Math.cos(v.heading) * fz;
    if (facing > -0.5) continue;
    const last = lastHonk.get(v.id);
    if (last !== undefined && now - last < opts.cooldownS) continue;
    lastHonk.set(v.id, now);
    out.push({ id: v.id, truck: BIG.test(v.contentId), distanceM: Math.hypot(rx, rz) });
  }
  return out;
}

/** The nearest active law rider within range, or null. */
export function findSiren(
  player: EntitySnapshot,
  entities: readonly EntitySnapshot[],
  rangeM = 250,
): EntitySnapshot | null {
  let best: EntitySnapshot | null = null;
  let bestD = rangeM;
  for (const e of entities) {
    if (e.kind !== 'rider' || e.faction !== 'law' || e.id === player.id) continue;
    if (e.mode === 'Tumble' || e.mode === 'OnFoot') continue;
    const d = Math.hypot(e.x - player.x, e.z - player.z);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}
