import { describe, expect, it } from 'vitest';
import { selectControlJobs } from './control-selection.mjs';

type Job = {
  id: number;
  run_id: number;
  run_attempt: number;
  name: string;
  status: string;
  conclusion: string | null;
};

type SelectionInput = {
  expectedNames: string[];
  runId: number;
  attempt: number;
  totalCount: number;
  jobs: Job[];
};

type Selection = { scope: 'full' | 'targeted'; jobs?: string[]; reason: string };

const choose = (input: unknown): Selection => selectControlJobs(input) as unknown as Selection;

describe('selectControlJobs', () => {
  const tierCounts = { static: 1, sim: 2, unit: 2 };
  const expectedNames = [
    ...Array.from({ length: tierCounts.static }, () => 'suite / static'),
    ...Array.from({ length: tierCounts.sim }, (_, index) => `suite / sim (${index + 1}/${tierCounts.sim})`),
    ...Array.from(
      { length: tierCounts.unit },
      (_, index) => `suite / unit (${index + 1}/${tierCounts.unit})`,
    ),
  ];

  const makeInput = (overrides: Partial<SelectionInput> = {}): SelectionInput => {
    const jobs = expectedNames.map((name, index) => ({
      id: index + 1,
      run_id: 42,
      run_attempt: 1,
      name,
      status: 'completed',
      conclusion: 'success',
    }));
    return { expectedNames, runId: 42, attempt: 1, totalCount: jobs.length, jobs, ...overrides };
  };

  it('selects failed first-suite rows in canonical order despite shuffled rows and irrelevant work', () => {
    const input = makeInput();
    input.jobs[1].conclusion = 'failure';
    input.jobs[4].conclusion = 'failure';
    input.jobs.push({
      id: 99,
      run_id: 42,
      run_attempt: 1,
      name: 'route',
      status: 'in_progress',
      conclusion: null,
    });
    input.totalCount = input.jobs.length;
    const result = choose({ ...input, jobs: [...input.jobs].reverse() });
    expect(result).toMatchObject({ scope: 'targeted', jobs: [expectedNames[1], expectedNames[4]] });
  });

  it.each<[string, (input: SelectionInput) => SelectionInput]>([
    ['zero failures', (input) => input],
    [
      'all failures',
      (input) => ({ ...input, jobs: input.jobs.map((job) => ({ ...job, conclusion: 'failure' })) }),
    ],
  ])('falls back for %s', (_label, mutate) => {
    expect(choose(mutate(makeInput()))).toMatchObject({ scope: 'full' });
    expect(choose(mutate(makeInput()))).not.toHaveProperty('jobs');
  });

  it.each<[string, (input: SelectionInput) => SelectionInput]>([
    [
      'missing suite row',
      (input) => ({ ...input, jobs: input.jobs.slice(1), totalCount: input.jobs.length - 1 }),
    ],
    [
      'duplicate suite row',
      (input) => ({
        ...input,
        jobs: [...input.jobs, { ...input.jobs[0], id: 99 }],
        totalCount: input.jobs.length + 1,
      }),
    ],
    [
      'unexpected suite row',
      (input) => ({
        ...input,
        jobs: [...input.jobs, { ...input.jobs[0], id: 99, name: 'suite / extra' }],
        totalCount: input.jobs.length + 1,
      }),
    ],
    [
      'cancelled suite sibling',
      (input) => ({
        ...input,
        jobs: input.jobs.map((job, index) =>
          index === 0 ? { ...job, status: 'completed', conclusion: 'cancelled' } : job,
        ),
      }),
    ],
  ])('falls back for %s', (_label, mutate) => {
    expect(choose(mutate(makeInput()))).toMatchObject({ scope: 'full' });
  });

  it.each<[string, (input: SelectionInput) => SelectionInput]>([
    ['bad total', (input) => ({ ...input, totalCount: input.totalCount + 1 })],
    [
      'zero id',
      (input) => ({
        ...input,
        jobs: input.jobs.map((job, index) => (index === 0 ? { ...job, id: 0 } : job)),
      }),
    ],
    [
      'duplicate id',
      (input) => ({
        ...input,
        jobs: input.jobs.map((job, index) => (index === 1 ? { ...job, id: 1 } : job)),
      }),
    ],
    [
      'wrong run id',
      (input) => ({
        ...input,
        jobs: input.jobs.map((job, index) => (index === 0 ? { ...job, run_id: 43 } : job)),
      }),
    ],
    [
      'invalid run attempt',
      (input) => ({
        ...input,
        jobs: input.jobs.map((job, index) => (index === 0 ? { ...job, run_attempt: 0 } : job)),
      }),
    ],
    [
      'wrong suite attempt',
      (input) => ({
        ...input,
        jobs: input.jobs.map((job, index) => (index === 0 ? { ...job, run_attempt: 2 } : job)),
      }),
    ],
    [
      'non-string name',
      (input) => ({
        ...input,
        jobs: input.jobs.map((job, index) => (index === 0 ? { ...job, name: 7 } : job)),
      }),
    ],
    ['non-object row', (input) => ({ ...input, jobs: [null, ...input.jobs.slice(1)] })],
  ])('falls back for %s collection shape', (_label, mutate) => {
    expect(choose(mutate(makeInput()))).toMatchObject({ scope: 'full' });
  });

  it.each<unknown>([
    null,
    [],
    { expectedNames: [] },
    { expectedNames: ['suite / static', 'suite / static'] },
    { expectedNames: ['static'] },
  ])('falls back without throwing for malformed input %#', (input) => {
    expect(() => choose(input)).not.toThrow();
    expect(choose(input)).toMatchObject({ scope: 'full' });
  });

  it('preserves the input object and arrays', () => {
    const input = makeInput();
    input.jobs[1].conclusion = 'failure';
    const before = structuredClone(input);
    expect(choose(input)).toMatchObject({ scope: 'targeted' });
    expect(input).toEqual(before);
  });
});
