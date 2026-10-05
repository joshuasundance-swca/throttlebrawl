import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { estimateSeconds, presetUsers, readTimings } from '../scripts/shard-plan.mjs';

const isSeconds = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * The order the runner starts `items` in, each described by its project and repo-relative file.
 * Projects keep their first-seen order. Within a project that has a table in `timings` (the unit
 * tests since 2026-10-05, and the sim batch), the sim files that read the Easy or Hard batch
 * (presetBatch) start first, so those batches compute beside the Normal one; then files start longest
 * first, an unmeasured file counting as the table's mean. A project with no table keeps the given
 * order. scripts/shard-plan.mjs simulates this same order when it plans CI's sim slices.
 */
export function timedOrder<T>(
  items: T[],
  describe: (item: T) => { project: string; file: string },
  timings: Record<string, unknown>,
  read: (file: string) => string,
): T[] {
  const info = items.map(describe);
  const projectRank = new Map<string, number>();
  for (const { project } of info) if (!projectRank.has(project)) projectRank.set(project, projectRank.size);
  const tableOf = (project: string): Record<string, unknown> | null => {
    const t = timings[project];
    return t && typeof t === 'object' ? (t as Record<string, unknown>) : null;
  };
  const estimates = new Map<string, number>();
  const seconds = ({ project, file }: { project: string; file: string }): number => {
    const table = tableOf(project);
    if (!table) return 0;
    const own = table[file];
    if (isSeconds(own)) return own;
    let estimate = estimates.get(project);
    if (estimate === undefined) {
      estimate = estimateSeconds(Object.values(table).filter(isSeconds));
      estimates.set(project, estimate);
    }
    return estimate;
  };
  const simFiles = info.filter((x) => x.project === 'sim' && tableOf(x.project)).map((x) => x.file);
  const early = new Set<string>(presetUsers(simFiles, read) as string[]);
  const rank = (x: { project: string; file: string }) => (x.project === 'sim' && early.has(x.file) ? 0 : 1);
  const order = info.map((x, i) => ({ x, i }));
  order.sort(
    (a, b) =>
      (projectRank.get(a.x.project) ?? 0) - (projectRank.get(b.x.project) ?? 0) ||
      rank(a.x) - rank(b.x) ||
      seconds(b.x) - seconds(a.x) ||
      a.i - b.i,
  );
  return order.map(({ i }) => items[i] as T);
}

/**
 * Vitest's file order, with the measured slow files first (docs/engineering.md, "CI on GitHub
 * Actions"): timedOrder above over Vitest's own order, from tests/timings.json. A long file never
 * starts last and holds its runner up alone. Nothing here adds, drops or splits a file. [default]
 */
export default class TimedSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const base = await super.sort(files);
    const root = this.ctx.config.root;
    return timedOrder(
      base,
      (spec) => ({
        project: spec.project.name,
        file: path.relative(root, spec.moduleId).split(path.sep).join('/'),
      }),
      readTimings() as Record<string, unknown>,
      (file) => readFileSync(path.join(root, file), 'utf8'),
    );
  }
}
