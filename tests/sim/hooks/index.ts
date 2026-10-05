// Batch hooks (docs/milestones/M2.md, dev-4): a lane that needs per-tick numbers from the shared
// seeded races that the RaceResult does not already keep registers a hook here, instead of running
// races of its own. Separate batches would duplicate the sim time and crowd the 10-minute gate.
//
// A hook sees every race of every batch (Normal, Easy, Hard): `create` is called at the race's
// start, `onTick` after every step with the snapshot and that tick's events, and `result` once at
// the end. The result must be plain JSON (it is cached on disk with the batch) and lands in
// `race.hooks[<id>]`. Keep hooks cheap: they run inside every batch race.
//
// To add one: write tests/sim/hooks/<lane>.ts exporting a BatchHook, add it to BATCH_HOOKS below,
// and assert over `race.hooks['<id>']` in your tests/sim/<lane>-*.test.ts. Editing a hook changes
// the batch's cache key, so the batch recomputes.
import type { DifficultyPreset } from '../../../src/core';
import type { SimConfig, SimEvent, SimSnapshot } from '../../../src/sim/api';
import { aiRivalsHook } from './ai-rivals';
import { devHook } from './dev';
import { respawnHook } from './respawn';

export interface BatchRaceInfo {
  seed: number;
  difficulty: DifficultyPreset;
  playerId: number;
  config: SimConfig;
}

export interface BatchHookRun {
  onTick(snap: SimSnapshot, events: readonly SimEvent[]): void;
  /** Plain JSON, stored with the batch. */
  result(): unknown;
}

export interface BatchHook {
  /** The key in `race.hooks`; the lane id, or `<lane>-<topic>`. */
  id: string;
  create(race: BatchRaceInfo): BatchHookRun;
}

export const BATCH_HOOKS: readonly BatchHook[] = [devHook, aiRivalsHook, respawnHook];
