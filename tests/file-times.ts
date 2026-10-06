// Each sim file's whole time on its worker, for scripts/timings.mjs (docs/engineering.md, "CI on
// GitHub Actions"). Vitest's own per-file line times a file's tests and hooks only, not its
// collection: the import and the describe callbacks. Eight sim files race at describe time
// (app-cast-and-law, riders-race and six more), so Vitest timed them at 4 to 30 ms on main run
// 37457079930 (2026-10-06) and tests/timings.json at 0 s, and the slice plan could only guess them.
// This reporter prints one line per sim file when it ends, collect plus tests, which timings.mjs
// reads in place of Vitest's line. It sits beside Vitest's default reporters (vitest.config.ts) and
// prints nothing for the unit project. [default]
import path from 'node:path';
import type { Reporter, TestModule, Vitest } from 'vitest/node';

/** The line's tag; scripts/timings.mjs matches it (FILE_TIME_LINE). */
export const FILE_TIME = 'file-time';

const secs = (ms: number) => (ms / 1000).toFixed(2);

export default class FileTimes implements Reporter {
  private log: (line: string) => void = (line) => console.log(line);

  onInit(vitest: Vitest): void {
    this.log = (line) => vitest.logger.log(line);
  }

  onTestModuleEnd(module: TestModule): void {
    if (module.project.name !== 'sim') return;
    const { collectDuration, duration } = module.diagnostic();
    const file = path.relative(module.project.config.root, module.moduleId).split(path.sep).join('/');
    this.log(
      `${FILE_TIME} ${file}: ${secs(collectDuration + duration)} s (collect ${secs(collectDuration)} s, tests ${secs(duration)} s)`,
    );
  }
}
