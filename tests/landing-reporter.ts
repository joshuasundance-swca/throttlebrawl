import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Reporter, TestModule, TestProject, TestSpecification } from 'vitest/node';
import type { LandingCase } from './sim/landing-inventory.ts';
import { LANDING_FILES, LANDING_VERSION } from './sim/landing-group.mjs';
import { assertLandings, foldLandings, landingLine, type LandingResult } from './sim/landing-oracle.ts';
import { SIDEWALK_FILES, SIDEWALK_VERSION } from './sim/sidewalk-group.mjs';
import type { SidewalkCase } from './sim/sidewalk-inventory.ts';
import { assertSidewalk, foldSidewalk, sidewalkLines, type SidewalkResult } from './sim/sidewalk-oracle.ts';

interface Marker {
  version: number;
  token: string;
}
export interface LandingMetadata extends LandingResult, Marker {
  key: string;
}
export interface SidewalkMetadata extends SidewalkResult, Marker {
  key: string;
}
declare module 'vitest' {
  interface ProvidedContext {
    landingSurvey: Marker | null;
    sidewalkSurvey: Marker | null;
  }
  interface TaskMeta {
    landingSurvey?: LandingMetadata;
    sidewalkSurvey?: SidewalkMetadata;
  }
}
interface Manifest<C> {
  files: readonly string[];
  cases: (C & { key: string; file: string; seed: number })[];
}
interface Source {
  files: readonly string[];
  inventoryModule: string;
}
interface Group<C, R> extends Source {
  name: string;
  prefix: string;
  context: 'landingSurvey' | 'sidewalkSurvey';
  version: number;
  manifestExport: string;
  check(manifest: Manifest<C>, rows: R[]): void;
}
const DEFAULT_SOURCE: Source = { files: LANDING_FILES, inventoryModule: 'tests/sim/landing-inventory.ts' };
const SIDEWALK_SOURCE: Source = { files: SIDEWALK_FILES, inventoryModule: 'tests/sim/sidewalk-inventory.ts' };

/** Existing complete-group mechanism, shared by both surveys without a disk result channel. */
class GroupReporter<C, R> {
  private serial = 0;
  private readonly instance = randomUUID();
  private active: { project: TestProject; manifest: Manifest<C>; marker: Marker } | undefined;
  private readonly source: Group<C, R>;
  constructor(source: Group<C, R>) {
    this.source = source;
  }
  clear() {
    this.active?.project.provide(this.source.context, null);
    this.active = undefined;
  }
  private relative(project: TestProject, file: string) {
    return path.relative(project.config.root, file).split(path.sep).join('/');
  }
  async start(specifications: readonly TestSpecification[]) {
    this.clear();
    const selected = specifications.filter(
      (s) => s.project.name === 'sim' && this.source.files.includes(this.relative(s.project, s.moduleId)),
    );
    if (selected.length === 0) return;
    const project = selected[0]!.project;
    const name = this.source.name;
    const files = selected.map((s) => this.relative(s.project, s.moduleId)).sort();
    if (
      selected.some((s) => s.project !== project) ||
      JSON.stringify(files) !== JSON.stringify([...this.source.files].sort())
    )
      throw new Error(`Incomplete ${name} group: select the complete ${name} survey`);
    const module = await project.import<Record<string, () => Manifest<C>>>(
      path.resolve(project.config.root, this.source.inventoryModule),
    );
    const manifest = module[this.source.manifestExport]!();
    if (
      JSON.stringify([...manifest.files].sort()) !== JSON.stringify([...this.source.files].sort()) ||
      new Set(manifest.cases.map((c) => c.key)).size !== manifest.cases.length ||
      manifest.cases.some((c) => !this.source.files.includes(c.file)) ||
      this.source.files.some((file) => !manifest.cases.some((c) => c.file === file))
    )
      throw new Error(`Invalid complete ${name} manifest`);
    const marker = { version: this.source.version, token: `${this.instance}:${++this.serial}` };
    this.active = { project, manifest, marker };
    project.provide(this.source.context, marker);
  }
  end(modules: readonly TestModule[], errors: readonly unknown[], reason: string) {
    const active = this.active;
    if (!active) return;
    const name = this.source.name;
    try {
      if (reason !== 'passed' || errors.length) throw new Error(`${name} survey run failed or interrupted`);
      const selected = modules.filter(
        (m) =>
          m.project === active.project && this.source.files.includes(this.relative(m.project, m.moduleId)),
      );
      const files = selected.map((m) => this.relative(m.project, m.moduleId)).sort();
      if (JSON.stringify(files) !== JSON.stringify([...this.source.files].sort()))
        throw new Error(`Missing or duplicate ${name} result files`);
      const required = new Map(active.manifest.cases.map((c) => [c.key, c]));
      const rows = new Map<string, R>();
      for (const module of selected) {
        if (module.errors().length) throw new Error(`${name} module failed collection`);
        for (const test of module.children.allTests()) {
          const diagnostic = test.diagnostic();
          if (
            test.result().state !== 'passed' ||
            !diagnostic ||
            diagnostic.retryCount > 0 ||
            diagnostic.repeatCount > 0 ||
            diagnostic.flaky
          )
            throw new Error(`${name} case did not pass once: ${test.name}`);
          const row = test.meta()[this.source.context] as (R & Marker & { key: string }) | undefined;
          if (
            !row ||
            row.version !== this.source.version ||
            row.token !== active.marker.token ||
            typeof row.key !== 'string'
          )
            throw new Error(`Missing or stale ${name} metadata`);
          const c = required.get(row.key);
          if (!c || c.file !== this.relative(module.project, module.moduleId) || rows.has(row.key))
            throw new Error(`Unknown, duplicate or wrong-file ${name} key`);
          rows.set(row.key, row);
        }
      }
      if (rows.size !== required.size) throw new Error(`Missing required ${name} cases`);
      this.source.check(
        active.manifest,
        active.manifest.cases.map((c) => rows.get(c.key)!),
      );
      console.log(
        `[${this.source.prefix}] ACCEPTED complete pooled survey: ${rows.size} unique races in ${selected.length} files`,
      );
    } finally {
      this.clear();
    }
  }
}

/** Same mandatory registration; each active survey retains independent markers and pooled oracle. */
export default class LandingReporter implements Reporter {
  readonly source: Source;
  private readonly landing: GroupReporter<LandingCase, LandingResult>;
  private readonly sidewalk: GroupReporter<SidewalkCase, SidewalkResult>;
  constructor(source: Source = DEFAULT_SOURCE, sidewalkSource: Source = SIDEWALK_SOURCE) {
    this.source = source;
    this.landing = new GroupReporter<LandingCase, LandingResult>({
      ...source,
      name: 'landing',
      prefix: 'landings',
      context: 'landingSurvey',
      version: LANDING_VERSION,
      manifestExport: 'landingManifest',
      check(manifest, rows) {
        const pooled = foldLandings(manifest.cases, rows);
        console.log(
          `[landings] ${rows.length} races, seeds ${[...new Set(manifest.cases.map((c) => c.seed))].join(' ')}`,
        );
        for (const [name, t] of Object.entries(pooled)) console.log('[landings] ' + landingLine(name, t));
        assertLandings(pooled);
      },
    });
    this.sidewalk = new GroupReporter<SidewalkCase, SidewalkResult>({
      ...sidewalkSource,
      name: 'sidewalk',
      prefix: 'sidewalk',
      context: 'sidewalkSurvey',
      version: SIDEWALK_VERSION,
      manifestExport: 'sidewalkManifest',
      check(manifest, rows) {
        const pooled = foldSidewalk(manifest.cases, rows);
        for (const line of sidewalkLines(pooled)) console.log('[sidewalk] ' + line);
        assertSidewalk(pooled);
      },
    });
  }
  private reject(error: unknown): never {
    console.error('[surveys] REJECTED ' + (error instanceof Error ? error.message : String(error)));
    if (!process.exitCode) process.exitCode = 1;
    throw error instanceof Error ? error : new Error(String(error));
  }
  async onTestRunStart(specifications: readonly TestSpecification[]) {
    this.landing.clear();
    this.sidewalk.clear();
    try {
      if (typeof this.onTestRunEnd !== 'function') throw new Error('Missing landing aggregate end hook');
      await this.landing.start(specifications);
      await this.sidewalk.start(specifications);
    } catch (error) {
      this.landing.clear();
      this.sidewalk.clear();
      this.reject(error);
    }
  }
  onTestRunEnd(
    modules: readonly TestModule[],
    errors: readonly unknown[],
    reason: 'passed' | 'failed' | 'interrupted',
  ) {
    try {
      this.landing.end(modules, errors, reason);
      this.sidewalk.end(modules, errors, reason);
    } catch (error) {
      this.reject(error);
    } finally {
      this.landing.clear();
      this.sidewalk.clear();
    }
  }
}
