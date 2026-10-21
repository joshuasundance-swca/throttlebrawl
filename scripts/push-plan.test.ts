// What the pre-push hook tests (scripts/push-plan.mjs, docs/engineering.md "Pre-commit hooks and
// leak scan"): nothing for a docs-only or dependency-only push, the whole unit tier when a global
// test or type configuration file changed, and otherwise only the unit test files the push names:
// changed test files and tests named after changed source files, plus bounded contact and road
// content contracts for their shared inputs. CI runs every test on the PR.
import { describe, expect, it } from 'vitest';
import { planPush, planPushFromRevisions } from './push-plan.mjs';

/** A fake tree: the test files that exist. */
const tree = (...files: string[]) => {
  const set = new Set(files);
  return (f: string) => set.has(f);
};

const roadContracts = [
  'tools/road/board-slots-on-land.test.ts',
  'tools/road/lane-drops-live.test.ts',
  'src/render/backdrop/backdrop.test.ts',
  'src/render/scenes/scenes.test.ts',
].sort();

describe('planPush', () => {
  it.each(['.github/workflows/suite.yml', '.github/workflows/ci.yml', '.github\\workflows\\suite.yml'])(
    'checks contributor guidance when its CI capacity source changes: %s',
    (source) => {
      const contract = 'scripts/contributing-docs.test.ts';
      expect(planPush([source], tree(contract))).toMatchObject({ mode: 'files', tests: [contract] });
    },
  );

  it('keeps CI guidance selection bounded, deduplicated and compatible with missing tests', () => {
    const contract = 'scripts/contributing-docs.test.ts';
    expect(
      planPush(['.github/workflows/ci.yml', '.github/workflows/suite.yml', contract], tree(contract)).tests,
    ).toEqual([contract]);
    expect(planPush(['.github/workflows/suite.yml'], tree()).tests).toEqual([]);
    for (const source of [
      '.github/workflows/deploy.yml',
      'docs/engineering.md',
      'AGENTS.md',
      'package-lock.json',
      'src/ui/menu.ts',
    ]) {
      expect(planPush([source], tree(contract)).tests, source).toEqual([]);
    }
  });

  it.each(['packs/future-pack/modifiers/harvest.json', 'packs\\future-pack\\modifiers\\harvest.json'])(
    'checks warning copy and eligible road-event barks for modifier input %s',
    (source) => {
      const contracts = ['src/audio/road-event-barks.test.ts', 'src/render/event-signs.test.ts'];
      expect(planPush([source], tree(...contracts))).toMatchObject({ mode: 'files', tests: contracts });
    },
  );

  it.each(['packs/future-pack/events/county-race.json', 'packs/future-pack/barks/road-events-county.json'])(
    'checks road-event bark coverage for its input %s without adding unrelated contracts',
    (source) => {
      const barks = 'src/audio/road-event-barks.test.ts';
      expect(planPush([source], tree(barks, 'src/render/event-signs.test.ts')).tests).toEqual([barks]);
    },
  );

  it('deduplicates content feedback checks, omits missing files and leaves unrelated content alone', () => {
    const contracts = ['src/audio/road-event-barks.test.ts', 'src/render/event-signs.test.ts'];
    const modifier = 'packs/future-pack/modifiers/harvest.json';
    expect(planPush([modifier, ...contracts, modifier], tree(...contracts)).tests).toEqual(contracts);
    expect(planPush([modifier], tree()).tests).toEqual([]);
    expect(planPush([modifier], tree(contracts[0]!)).tests).toEqual([contracts[0]]);
    for (const source of [
      'packs/future-pack/barks/rival-core.json',
      'packs/future-pack/traffic/truck.json',
      'packs/future-pack/regions/county/roads/main.json',
      'src/ui/menu.ts',
      'docs/roadmap.md',
    ]) {
      expect(planPush([source], tree(...contracts)).tests, source).toEqual([]);
    }
  });
  it('selects the cheap patrol placement contract for pack JSON and keeps it deduplicated', () => {
    const patrol = 'tools/road/patrol-placement.test.ts';
    const source = 'packs/future-pack/regions/future-ridge/roads/serpentine.json';
    expect(planPush([source], tree(patrol)).tests).toEqual([patrol]);
    expect(planPush([source, patrol], tree(patrol)).tests).toEqual([patrol]);
    expect(planPush([source], tree()).tests).toEqual([]);
    expect(planPush(['src/ui/menu.ts'], tree(patrol)).tests).toEqual([]);
  });
  it('selects the quick career configuration contract for any pack JSON when present', () => {
    const career = 'src/app/career-content.test.ts';
    for (const source of [
      'packs/future-pack/pack.json',
      'packs/future-pack/events/new-race.json',
      'packs/future-pack/careers/new-career.json',
      'packs/future-pack/regions/future-ridge/routes/new-route.json',
      'packs\\future-pack\\bikes\\new-bike.json',
    ]) {
      const plan = planPush([source], tree(career));
      expect(plan.tests, source).toEqual([career]);
      expect(plan.reason, source).toContain('pack configuration');
    }
    expect(planPush(['packs/future-pack/pack.json'], tree()).tests).toEqual([]);
    for (const source of ['src/ui/menu.ts', 'packs/future-pack/poster.png', 'docs/roadmap.md'])
      expect(planPush([source], tree(career)).tests, source).toEqual([]);
  });

  it('combines pack configuration and road contracts once without selecting a whole tier', () => {
    const career = 'src/app/career-content.test.ts';
    const expected = [...roadContracts, career].sort();
    const plan = planPush(
      ['packs/future-pack/regions/future-ridge/routes/new-route.json', career],
      tree(...expected),
    );
    expect(plan.mode).toBe('files');
    expect(plan.tests).toEqual(expected);
  });

  it('runs no tests for a push of docs, notes and Markdown only', () => {
    const plan = planPush(
      ['docs/engineering.md', 'changes/2026-10-03-x.md', 'AGENTS.md', 'docs/playtests/README.md'],
      tree(),
    );
    expect(plan.mode).toBe('skip');
    expect(plan.tests).toEqual([]);
  });

  it('keeps lockfile and valid dependency-map changes out of local unit selection while retaining named source tests', () => {
    const source = 'src/render/verge.ts';
    const namedTest = 'src/render/verge.test.ts';
    const exists = tree(namedTest);
    const before = JSON.stringify({ name: 'game', scripts: { test: 'vitest' } });
    for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const after = JSON.stringify({
        scripts: { test: 'vitest' },
        name: 'game',
        [key]: { example: '1.0.0' },
      });
      const plan = planPushFromRevisions(
        ['package.json'],
        exists,
        'base-revision',
        'head-revision',
        (ref: string) => (ref === 'base-revision' ? before : after),
      );
      expect(plan, key).toMatchObject({ mode: 'files', tests: [] });
      expect(planPush(['package.json', source], exists, { before, after }), key).toMatchObject({
        mode: 'files',
        tests: [namedTest],
      });
    }
    expect(planPush(['package-lock.json'], exists)).toMatchObject({ mode: 'files', tests: [] });
    expect(planPush(['package-lock.json', source], exists)).toMatchObject({
      mode: 'files',
      tests: [namedTest],
    });
    expect(planPush([source], exists)).toMatchObject({ mode: 'files', tests: [namedTest] });
  });

  it('runs the full local unit tier when manifest configuration changes, even alongside dependencies', () => {
    const before = JSON.stringify({
      name: 'game',
      scripts: { test: 'vitest' },
      dependencies: { example: '1.0.0' },
    });
    for (const changed of [
      { scripts: { test: 'other' } },
      { type: 'module' },
      { engines: { node: '>=22' } },
      { 'simple-git-hooks': { 'pre-push': 'node scripts/pre-push.mjs' } },
    ]) {
      const after = JSON.stringify({ ...JSON.parse(before), dependencies: { example: '2.0.0' }, ...changed });
      expect(planPush(['package.json'], tree(), { before, after }).mode, Object.keys(changed)[0]).toBe(
        'full',
      );
    }
  });

  it('defaults new, deleted, malformed and unreadable manifests to the full tier', () => {
    const valid = JSON.stringify({ name: 'game', dependencies: { example: '1.0.0' } });
    for (const manifests of [
      undefined,
      { before: '', after: valid },
      { before: valid, after: '' },
      { before: '{oops', after: valid },
      { before: valid, after: '[]' },
    ]) {
      expect(planPush(['package.json'], tree(), manifests).mode).toBe('full');
    }
    const reads: string[] = [];
    const plan = planPushFromRevisions(
      ['package.json'],
      tree(),
      'actual-base',
      'actual-head',
      (ref: string, file: string) => {
        reads.push(`${ref}:${file}`);
        if (ref === 'actual-head') throw new Error('unreadable blob');
        return valid;
      },
    );
    expect(reads).toEqual(['actual-base:package.json', 'actual-head:package.json']);
    expect(plan.mode).toBe('full');
  });

  it('rejects invalid dependency-map values in either compared revision', () => {
    const valid = JSON.stringify({ name: 'game', dependencies: { example: '1.0.0' } });
    for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const value of [null, [], { example: 1 }]) {
        const invalid = JSON.stringify({ name: 'game', [key]: value });
        for (const manifests of [
          { before: valid, after: invalid },
          { before: invalid, after: valid },
        ]) {
          expect(planPush(['package.json'], tree(), manifests).mode, key).toBe('full');
        }
      }
    }
  });

  it('accepts manifest formatting and key order changes without treating them as configuration changes', () => {
    const before = '{"name":"game","scripts":{"test":"vitest"},"dependencies":{"a":"1"}}';
    const after = '{\n  "dependencies": {"a": "2"}, "scripts": {"test": "vitest"}, "name": "game"\n}';
    expect(planPush(['package.json'], tree(), { before, after }).mode).toBe('files');
  });

  it('runs the whole unit tier when a global test or type config file changed', () => {
    for (const f of [
      'vitest.config.ts',
      'vite.config.ts',
      'tsconfig.json',
      'tsconfig.sim.json',
      'tests/setup/base-roads.ts',
    ]) {
      const plan = planPush(
        ['package-lock.json', 'src/render/verge.ts', f],
        tree('src/render/verge.test.ts'),
      );
      expect(plan.mode, f).toBe('full');
      expect(plan.reason, f).toContain(f);
    }
  });

  it('runs the changed unit test files and the tests named after changed source files', () => {
    const plan = planPush(
      [
        'src/render/verge.test.ts',
        'src/render/scenery.ts',
        'src/sim/cops/index.ts',
        'scripts/notes.mjs',
        'tools/road/tracks/pnw-c1.ts',
        'packs/region-pnw/region.json',
        'changes/2026-10-03-x.md',
      ],
      tree(
        'src/render/verge.test.ts',
        'src/render/scenery.test.ts',
        'src/sim/cops/cops.test.ts',
        'src/sim/cops/heat.test.ts',
        'scripts/notes.test.ts',
      ),
    );
    expect(plan.mode).toBe('files');
    expect(plan.tests).toEqual([
      'scripts/notes.test.ts',
      'src/render/scenery.test.ts',
      'src/render/verge.test.ts',
      'src/sim/cops/cops.test.ts',
    ]);
  });

  it('leaves out tests outside the unit project (sim batch, browser specs) and deleted test files', () => {
    const plan = planPush(
      ['tests/sim/events-setpieces.test.ts', 'tests/e2e/road-events.spec.ts', 'src/render/gone.test.ts'],
      tree(),
    );
    expect(plan.mode).toBe('files');
    expect(plan.tests).toEqual([]);
  });

  it('runs nothing for a push with no files', () => {
    expect(planPush([], tree()).mode).toBe('skip');
  });

  it('accepts Windows-style separators', () => {
    const plan = planPush(['src\\render\\verge.ts'], tree('src/render/verge.test.ts'));
    expect(plan.tests).toEqual(['src/render/verge.test.ts']);
  });

  it('finds a track generator’s authored test one folder above it', () => {
    const plan = planPush(['tools/road/tracks/pnw-c1.ts'], tree('tools/road/pnw-c1.test.ts'));
    expect(plan.mode).toBe('files');
    expect(plan.tests).toEqual(['tools/road/pnw-c1.test.ts']);
  });

  it('rechecks the bounded authored contact controls when shared physics or track data changes', () => {
    const controls = [
      'tools/road/pnw-c1.test.ts',
      'tools/road/sf-downtown.test.ts',
      'tools/road/truck-shortcuts.test.ts',
    ];
    for (const source of [
      'src/sim/riders/carrier-shape.ts',
      'src/sim/riders/step.ts',
      'src/sim/modifiers/moving.ts',
      'src/road/beyond.ts',
      'src/road/structures/trucks.ts',
      'tools/road/tracks/sf-downtown.ts',
      'tools/road/tracks/pnw-c1.ts',
      'packs/region-pnw/regions/pacific-northwest/roads/pnw-sawmill-end.json',
      'packs/region-sf/regions/san-francisco/networks/sf-downtown.json',
    ]) {
      const plan = planPush([source], tree(...controls));
      expect(plan.mode, source).toBe('files');
      expect(plan.tests, source).toEqual(controls);
    }
  });

  it('does not add contact controls for unrelated sources, test-only changes, or missing files', () => {
    const exists = tree('tools/road/truck-shortcuts.test.ts');
    for (const source of ['src/ui/menu.ts', 'src/sim/riders/step.test.ts', 'src/road/beyond.test.ts']) {
      expect(planPush([source], exists).tests, source).toEqual([]);
    }
    expect(planPush(['src/sim/riders/step.ts'], tree()).tests).toEqual([]);
  });

  it.each([
    'packs/future-pack/regions/future-ridge/roads/serpentine.json',
    'packs/future-pack/regions/future-ridge/networks/serpentine.json',
    'packs/future-pack/regions/future-ridge/routes/serpentine.json',
    'packs/future-pack/regions/future-ridge/region.json',
  ])('selects existing road-content contracts for %s without a pack inventory', (source) => {
    const plan = planPush([source], tree(...roadContracts));
    expect(plan.mode).toBe('files');
    expect(plan.tests).toEqual(roadContracts);
  });

  it.each([
    [
      'packs/future-pack/assets/backdrop/future-ridge/networks/serpentine.json',
      'src/render/backdrop/backdrop.test.ts',
    ],
    ['packs/future-pack/assets/scenes/future-ridge.json', 'src/render/scenes/scenes.test.ts'],
  ])('selects the matching asset contract for %s', (source, test) => {
    expect(planPush([source], tree(...roadContracts)).tests).toEqual([test]);
  });

  it('combines road contracts with existing contact and named controls in sorted deduplicated order', () => {
    const contact = [
      'tools/road/pnw-c1.test.ts',
      'tools/road/sf-downtown.test.ts',
      'tools/road/truck-shortcuts.test.ts',
    ];
    const named = 'src/ui/menu.test.ts';
    const expected = [...roadContracts, ...contact, named].sort();
    const plan = planPush(
      [
        'packs/region-pnw/regions/pacific-northwest/roads/new-road.json',
        'packs/future-pack/regions/future-ridge/region.json',
        'packs/future-pack/assets/backdrop/future-ridge/networks/new-road.json',
        'src/ui/menu.ts',
        roadContracts[0]!,
      ],
      tree(...expected),
    );
    expect(plan.mode).toBe('files');
    expect(plan.tests).toEqual(expected);
  });

  it('normalizes Windows road paths and omits every missing contract file', () => {
    const available = 'tools/road/board-slots-on-land.test.ts';
    const source = 'packs\\future-pack\\regions\\future-ridge\\routes\\serpentine.json';
    expect(planPush([source], tree(available)).tests).toEqual([available]);
    expect(planPush([source], tree()).tests).toEqual([]);
    expect(planPush(['packs/future-pack/assets/scenes/future-ridge.json'], tree()).tests).toEqual([]);
    expect(
      planPush(['packs/future-pack/assets/backdrop/future-ridge/networks/serpentine.json'], tree()).tests,
    ).toEqual([]);
  });

  it('does not add road contracts to unrelated sources, other pack content, or test-only paths', () => {
    for (const source of [
      'src/ui/menu.ts',
      'src/audio/index.ts',
      'packs/future-pack/pack.json',
      'packs/future-pack/riders/switchback.json',
      'packs/future-pack/events/ridge-race.json',
      'packs/future-pack/regions/future-ridge/traffic.json',
      'packs/future-pack/assets/backdrop/future-ridge/poster.png',
      'packs/future-pack/assets/scenes/future-ridge/readme.md',
      'tests/sim/road-course.test.ts',
    ]) {
      expect(planPush([source], tree(...roadContracts)).tests, source).toEqual([]);
    }
    for (const test of roadContracts) {
      expect(planPush([test], tree(...roadContracts)).tests, test).toEqual([test]);
    }
  });
});
