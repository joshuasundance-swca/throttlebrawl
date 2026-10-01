import path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { median, readTimings } from '../scripts/shard-plan.mjs';

/**
 * Vitest's file order, with the measured slow files first (docs/engineering.md, "CI on GitHub
 * Actions"). Within a project that has a table in tests/timings.json (the sim batch), files start
 * longest first, so a long file never starts last and holds its runner up alone; an unmeasured file
 * counts as the table's median. Projects with no table keep Vitest's own order, and nothing here
 * adds, drops or splits a file. scripts/shard-plan.mjs assumes this order when it plans CI's sim
 * slices. [default]
 */
export default class TimedSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const base = await super.sort(files);
    const timings = readTimings() as Record<string, unknown>;
    const root = this.ctx.config.root;
    const index = new Map(base.map((spec, i) => [spec, i]));
    const projectRank = new Map<string, number>();
    for (const spec of base)
      if (!projectRank.has(spec.project.name)) projectRank.set(spec.project.name, projectRank.size);

    const medians = new Map<string, number>();
    const seconds = (spec: TestSpecification): number => {
      const table = timings[spec.project.name];
      if (!table || typeof table !== 'object') return 0;
      const values = table as Record<string, number>;
      const key = path.relative(root, spec.moduleId).split(path.sep).join('/');
      const own = values[key];
      if (typeof own === 'number') return own;
      let mid = medians.get(spec.project.name);
      if (mid === undefined) {
        mid = median(Object.values(values).filter((v) => typeof v === 'number')) as number;
        medians.set(spec.project.name, mid);
      }
      return mid;
    };
    return [...base].sort(
      (a, b) =>
        (projectRank.get(a.project.name) ?? 0) - (projectRank.get(b.project.name) ?? 0) ||
        seconds(b) - seconds(a) ||
        (index.get(a) ?? 0) - (index.get(b) ?? 0),
    );
  }
}
