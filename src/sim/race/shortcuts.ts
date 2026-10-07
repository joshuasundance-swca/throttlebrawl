// sim/race: the 'found it' stamp (W-Q, the pitch deck's item 9: "your first time down a shortcut
// stamps the seconds it really saved"). A player who rides off the main path onto one of the
// route's shortcuts (RouteProgress.shortcuts, entered through its split zone's link) is timed and
// measured along it, in world time and metres ridden; back on the main path, the first time this
// race for that shortcut, a `shortcutFound` event says what it saved: its gainM (the main stretch
// it skipped less its own length) at the rider's average speed along it. [default]
// A respawn is never a find (run A's live check: a rider who missed the Seven Mile's staging hop,
// splashed and woke on the highway was stamped FOUND IT with a negative saving): a rider who
// respawns while timed gives the run up, and is timed afresh only by entering a shortcut again. So
// does one handed over through the air onto another road (over the barrier, 2026-10-06).
import type { EntityId } from '../../core';
import { hoppedRoads } from '../riders';
import type { SimConfig } from '../types';
import { emit, systemState, type World } from '../world';

interface ShortcutRun {
  /** By entity id: the shortcut being ridden (index into route.shortcuts), or -1. */
  on: number[];
  /** By entity id: world seconds and metres on it so far. */
  seconds: number[];
  metres: number[];
  /** By entity id: shortcuts already stamped this race, as bits (index < 30). */
  stamped: number[];
}

function runState(world: World): ShortcutRun {
  return systemState<ShortcutRun>(world, 'race.shortcuts', () => ({
    on: [],
    seconds: [],
    metres: [],
    stamped: [],
  }));
}

/** Most shortcuts a race tracks (bits in `stamped`). */
const MAX_SHORTCUTS = 30;
/** `on` for a rider off the main path by air: no run until it is back on the main path. */
const OFF_BY_AIR = -2;

/** Times and stamps each player's shortcuts; `isPlayer` says who counts (racing players). */
export function stampShortcuts(world: World, config: SimConfig, isPlayer: (id: EntityId) => boolean): void {
  const list = config.route.shortcuts;
  if (list.length === 0) return;
  const st = runState(world);
  const main = config.route.mainEdges;
  const dt = world.timeScale / 60;
  // Who woke from a crash this tick (sim/tumble's `respawn`): wherever it wakes, it did not ride there.
  const respawned = new Set<EntityId>();
  for (const e of world.events) if (e.type === 'respawn') respawned.add(e.actor);
  for (const m of world.movers) {
    if (m.kind !== 'rider' || !isPlayer(m.id)) continue;
    const id = m.id;
    if (respawned.has(id)) {
      st.on[id] = -1;
      continue;
    }
    const onMain = main.includes(m.pos.edge);
    // Over the barrier onto another road (2026-10-06, sim/riders/gap.ts): a run that leaves its
    // shortcut through the air is given up, and none starts until the rider is back on the main
    // path, so a road reached by air (the old Seven Mile Bridge from the new one) is never a find.
    if (hoppedRoads(world, id)) {
      st.on[id] = onMain ? -1 : OFF_BY_AIR;
      continue;
    }
    const current = st.on[id] ?? -1;
    if (current === OFF_BY_AIR) {
      if (onMain) st.on[id] = -1;
      continue;
    }
    if (current < 0) {
      if (onMain) continue;
      const k = list.findIndex((z) => z.toEdge === m.pos.edge);
      if (k < 0) continue;
      st.on[id] = k;
      st.seconds[id] = 0;
      st.metres[id] = 0;
      continue;
    }
    if (!onMain) {
      st.seconds[id] = (st.seconds[id] ?? 0) + dt;
      st.metres[id] = (st.metres[id] ?? 0) + m.speed * dt;
      continue;
    }
    // Back on the main path: the stamp, once per shortcut per race.
    st.on[id] = -1;
    const z = list[current];
    const seconds = st.seconds[id] ?? 0;
    const metres = st.metres[id] ?? 0;
    const bit = current < MAX_SHORTCUTS ? 1 << current : 0;
    if (!z || bit === 0 || ((st.stamped[id] ?? 0) & bit) !== 0 || seconds <= 0 || metres <= 0) continue;
    st.stamped[id] = (st.stamped[id] ?? 0) | bit;
    const speed = metres / seconds;
    const savedS = Math.round((z.gainM / speed) * 10) / 10;
    emit(world, 'shortcutFound', id, {
      toEdge: z.toEdge,
      gainM: Math.round(z.gainM * 10) / 10,
      savedS,
      shortcutS: Math.round(seconds * 10) / 10,
    });
  }
}
