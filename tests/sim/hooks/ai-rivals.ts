// ai-1's batch hook (docs/milestones/M1.md, "ai-1 · Four box rivals"): the per-tick numbers its
// seeded-race assertions need that the RaceResult does not keep. tests/sim/ai-rivals.test.ts reads
// them from the shared batch instead of racing 50 races of its own (the determinism run, R9).
// A rival is a rider with an `ai` controller (the cops have their own controller kind).
import type { EntitySnapshot, SimSnapshot } from '../../../src/sim/api';
import type { BatchHook } from './index';

/** A stall is progress of less than this along the route, m. */
export const STALL_PROGRESS_M = 1;

export interface AiRivalsHookResult {
  /** The rivals' entity ids, in grid order, and their content ids in the same order. */
  rivals: number[];
  contentIds: string[];
  /**
   * Per rival (same order): the longest stretch, in ticks, without STALL_PROGRESS_M of progress
   * toward the finish while riding (not down, not finished, not busted).
   */
  longestStall: number[];
  /** Per rival (same order): its mode on the last tick. */
  endMode: string[];
  /** Metres from first to last rider when the first rider finished (-1: nobody finished). */
  spreadAtFirstFinish: number;
}

const isDown = (e: EntitySnapshot | undefined) => e?.mode === 'Tumble' || e?.mode === 'OnFoot';

export const aiRivalsHook: BatchHook = {
  id: 'ai-rivals',
  create({ config }) {
    const rivals = config.riders.flatMap((r, i) => (r.controller.kind === 'ai' ? [i] : []));
    const best = rivals.map(() => Infinity);
    const since = rivals.map(() => 0);
    const longestStall = rivals.map(() => 0);
    const busted = new Set<number>();
    let spread = -1;
    let last: SimSnapshot | null = null;
    return {
      onTick(snap, events) {
        last = snap;
        for (const e of events) if (e.type === 'bust' && e.target !== undefined) busted.add(e.target);
        if (spread < 0 && snap.race.finishOrder.length > 0) {
          const dists = snap.entities.filter((e) => e.kind === 'rider').map((e) => e.distanceToFinish);
          spread = Math.max(...dists) - Math.min(...dists);
        }
        rivals.forEach((id, k) => {
          const e = snap.entities[id];
          if (!e) return;
          const b = best[k] ?? Infinity;
          if (e.distanceToFinish < b - STALL_PROGRESS_M || isDown(e) || e.finished || busted.has(id)) {
            best[k] = Math.min(b, e.distanceToFinish);
            since[k] = snap.tick;
          }
          longestStall[k] = Math.max(longestStall[k] ?? 0, snap.tick - (since[k] ?? 0));
        });
      },
      result: (): AiRivalsHookResult => ({
        rivals,
        contentIds: rivals.map((id) => config.riders[id]?.contentId ?? ''),
        longestStall: [...longestStall],
        endMode: rivals.map((id) => last?.entities[id]?.mode ?? ''),
        spreadAtFirstFinish: spread,
      }),
    };
  },
};
