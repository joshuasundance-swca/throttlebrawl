// The respawn lane's batch hook (playtest 4; the maintainer, 2026-10-05: "I've respawned behind stuck
// traffic and crashed repeatedly"). Per race, every moment a rider is back on the bike (a remount
// after the run-back or a skip, or a splash respawn: its mode goes from OnFoot or Tumble to Road), how
// long the sim kept it a ghost to traffic (EntitySnapshot.ghost), and whether it crashed again within
// 5 s, and how. tests/sim/traffic-respawn-ghost.test.ts asserts over it, and runs the same tracker on
// races in the other regions.
import type { SimEvent, SimSnapshot } from '../../../src/sim/api';
import type { BatchHook } from './index';

/** "Again" means a crash this soon after being back on the bike, ticks (5 s). */
const AGAIN_TICKS = 300;

export interface RespawnHookResult {
  /** Back-on-the-bike moments, and how many of them were splash respawns. */
  backs: number;
  respawns: number;
  /** Backs followed by a riding crash within AGAIN_TICKS, and by a traffic crash in particular. */
  again: number;
  againTraffic: number;
  /** Riding crashes (a rider on the road or in the air goes down), and those within AGAIN_TICKS of a back. */
  crashes: number;
  crashesSoonAfter: number;
  /** Ticks each back stayed a ghost (snapshots with `ghost` on, counted from the back's own). */
  ghostTicks: number[];
  /** Ghosts that ended while the rider was riding and before the minimum, one line each (should be none). */
  shortGhosts: string[];
  /** Traffic crashes or wobbles of a rider while its ghost was on, one line each (should be none). */
  touchedWhileGhost: string[];
}

/** Riding modes: a crash event on a rider in one of these starts a tumble. */
const RIDING = new Set(['Road', 'Airborne']);

/**
 * The tracker: feed it every step's snapshot and events, in order. `minGhostTicks` is the shortest a
 * ghost may be while its rider keeps riding (traffic.respawnGhostS in ticks).
 */
export function respawnTracker(minGhostTicks: number) {
  const r: RespawnHookResult = {
    backs: 0,
    respawns: 0,
    again: 0,
    againTraffic: 0,
    crashes: 0,
    crashesSoonAfter: 0,
    ghostTicks: [],
    shortGhosts: [],
    touchedWhileGhost: [],
  };
  const mode = new Map<number, string>();
  const ghost = new Map<number, boolean>();
  /** By rider: the tick it was last back on the bike, whether that back has crashed again, and its ghost count. */
  const back = new Map<number, { tick: number; crashed: boolean; ghost: number; open: boolean }>();
  return {
    onTick(snap: SimSnapshot, events: readonly SimEvent[]): void {
      // A ghost on after this tick was on through its traffic phase: a ghost only ends in traffic's
      // phase, before its contacts, and only starts after them (at a remount, in tumble's phase).
      for (const e of snap.entities) if (e.kind === 'rider') ghost.set(e.id, e.ghost === true);
      // Crashes and touches this tick; riding or not is judged on the modes the last tick left.
      const down = new Set<number>();
      for (const e of events) {
        const traffic = e.data['cause'] === 'traffic';
        if (traffic && (e.type === 'crash' || e.type === 'wobble') && ghost.get(e.actor) === true)
          r.touchedWhileGhost.push(`tick ${e.tick} rider ${e.actor}: ${e.type} ${String(e.data['hit'])}`);
        if (e.type !== 'crash' || e.data['contact'] === 'tumble' || down.has(e.actor)) continue;
        if (!RIDING.has(mode.get(e.actor) ?? '')) continue;
        down.add(e.actor);
        r.crashes++;
        const b = back.get(e.actor);
        if (b && snap.tick - b.tick <= AGAIN_TICKS) {
          r.crashesSoonAfter++;
          if (!b.crashed) {
            b.crashed = true;
            r.again++;
            if (traffic) r.againTraffic++;
          }
        }
      }
      for (const e of snap.entities) {
        if (e.kind !== 'rider') continue;
        const was = mode.get(e.id);
        if (e.mode === 'Road' && (was === 'OnFoot' || was === 'Tumble')) {
          const prev = back.get(e.id);
          if (prev?.open) r.ghostTicks.push(prev.ghost);
          r.backs++;
          if (was === 'Tumble') r.respawns++;
          back.set(e.id, { tick: snap.tick, crashed: false, ghost: 0, open: true });
        }
        const b = back.get(e.id);
        const on = e.ghost === true;
        if (b?.open) {
          if (on) b.ghost++;
          else {
            b.open = false;
            r.ghostTicks.push(b.ghost);
            if (b.ghost < minGhostTicks && RIDING.has(e.mode))
              r.shortGhosts.push(`tick ${snap.tick} rider ${e.id}: ghost for ${b.ghost} ticks`);
          }
        }
        mode.set(e.id, e.mode);
      }
    },
    result(): RespawnHookResult {
      const out = { ...r, ghostTicks: [...r.ghostTicks] };
      for (const b of back.values()) if (b.open) out.ghostTicks.push(b.ghost);
      return out;
    },
  };
}

export const respawnHook: BatchHook = {
  id: 'respawn',
  create({ config }) {
    const s = config.tuning['traffic.respawnGhostS'] ?? 1.5;
    return respawnTracker(Math.round(s * 60));
  },
};
