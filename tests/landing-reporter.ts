import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Reporter, TestModule, TestProject, TestSpecification } from 'vitest/node';
import type { LandingCase } from './sim/landing-inventory.ts';
import { LANDING_FILES, LANDING_VERSION } from './sim/landing-group.mjs';
import { assertLandings, foldLandings, landingLine, type LandingResult } from './sim/landing-oracle.ts';

interface Marker {
  version: number;
  token: string;
}
export interface LandingMetadata extends LandingResult, Marker {
  key: string;
}
declare module 'vitest' {
  interface ProvidedContext {
    landingSurvey: Marker | null;
  }
  interface TaskMeta {
    landingSurvey?: LandingMetadata;
  }
}
interface Manifest {
  files: readonly string[];
  cases: (LandingCase & { key: string; file: string })[];
}
interface Source {
  files: readonly string[];
  inventoryModule: string;
}
const DEFAULT_SOURCE: Source = { files: LANDING_FILES, inventoryModule: 'tests/sim/landing-inventory.ts' };

/** Same-process public metadata only. Inactive for every selection outside the exact group. */
export default class LandingReporter implements Reporter {
  private serial = 0;
  private readonly instance = randomUUID();
  private active: { project: TestProject; manifest: Manifest; marker: Marker } | undefined;
  readonly source: Source;
  constructor(source: Source = DEFAULT_SOURCE) {
    this.source = source;
  }
  private clear() {
    this.active?.project.provide('landingSurvey', null);
    this.active = undefined;
  }
  private reject(error: unknown): never {
    console.error('[landings] REJECTED ' + (error instanceof Error ? error.message : String(error)));
    if (!process.exitCode) process.exitCode = 1;
    throw error instanceof Error ? error : new Error(String(error));
  }
  private relative(project: TestProject, file: string) {
    return path.relative(project.config.root, file).split(path.sep).join('/');
  }
  async onTestRunStart(specifications: readonly TestSpecification[]) {
    this.clear();
    const selected = specifications.filter(
      (s) => s.project.name === 'sim' && this.source.files.includes(this.relative(s.project, s.moduleId)),
    );
    if (selected.length === 0) return;
    const project = selected[0]!.project;
    try {
      if (typeof this.onTestRunEnd !== 'function') throw new Error('Missing landing aggregate end hook');
      const files = selected.map((s) => this.relative(s.project, s.moduleId)).sort();
      if (
        selected.some((s) => s.project !== project) ||
        JSON.stringify(files) !== JSON.stringify([...this.source.files].sort())
      )
        throw new Error('Incomplete landing group: select the complete landing survey');
      const module = await project.import<{ landingManifest(): Manifest }>(
        path.resolve(project.config.root, this.source.inventoryModule),
      );
      const manifest = module.landingManifest();
      if (
        JSON.stringify([...manifest.files].sort()) !== JSON.stringify([...this.source.files].sort()) ||
        new Set(manifest.cases.map((c) => c.key)).size !== manifest.cases.length ||
        manifest.cases.some((c) => !this.source.files.includes(c.file)) ||
        this.source.files.some((file) => !manifest.cases.some((c) => c.file === file))
      )
        throw new Error('Invalid complete landing manifest');
      const marker = { version: LANDING_VERSION, token: `${this.instance}:${++this.serial}` };
      this.active = { project, manifest, marker };
      project.provide('landingSurvey', marker);
    } catch (error) {
      project.provide('landingSurvey', null);
      this.clear();
      this.reject(error);
    }
  }
  onTestRunEnd(
    modules: readonly TestModule[],
    errors: readonly unknown[],
    reason: 'passed' | 'failed' | 'interrupted',
  ) {
    const active = this.active;
    if (!active) return;
    try {
      if (reason !== 'passed' || errors.length) throw new Error('Landing survey run failed or interrupted');
      const selected = modules.filter(
        (m) =>
          m.project === active.project && this.source.files.includes(this.relative(m.project, m.moduleId)),
      );
      const files = selected.map((m) => this.relative(m.project, m.moduleId)).sort();
      if (JSON.stringify(files) !== JSON.stringify([...this.source.files].sort()))
        throw new Error('Missing or duplicate landing result files');
      const required = new Map(active.manifest.cases.map((c) => [c.key, c]));
      const rows = new Map<string, LandingResult>();
      for (const module of selected) {
        if (module.errors().length) throw new Error('Landing module failed collection');
        for (const test of module.children.allTests()) {
          const diagnostic = test.diagnostic();
          if (
            test.result().state !== 'passed' ||
            !diagnostic ||
            diagnostic.retryCount > 0 ||
            diagnostic.repeatCount > 0 ||
            diagnostic.flaky
          )
            throw new Error(`Landing case did not pass once: ${test.name}`);
          const row = test.meta().landingSurvey;
          if (
            !row ||
            row.version !== LANDING_VERSION ||
            row.token !== active.marker.token ||
            typeof row.key !== 'string'
          )
            throw new Error('Missing or stale landing metadata');
          const c = required.get(row.key);
          if (!c || c.file !== this.relative(module.project, module.moduleId) || rows.has(row.key))
            throw new Error('Unknown, duplicate or wrong-file landing key');
          rows.set(row.key, row);
        }
      }
      if (rows.size !== required.size) throw new Error('Missing required landing cases');
      const pooled = foldLandings(
        active.manifest.cases,
        active.manifest.cases.map((c) => rows.get(c.key)!),
      );
      console.log(
        `[landings] ${rows.size} races, seeds ${[...new Set(active.manifest.cases.map((c) => c.seed))].join(' ')}`,
      );
      for (const [name, t] of Object.entries(pooled)) console.log('[landings] ' + landingLine(name, t));
      assertLandings(pooled);
      console.log(
        `[landings] ACCEPTED complete pooled survey: ${rows.size} unique races in ${selected.length} files`,
      );
    } catch (error) {
      this.reject(error);
    } finally {
      this.clear();
    }
  }
}
