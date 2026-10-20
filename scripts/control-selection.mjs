const SUITE_PREFIX = 'suite / ';

const full = (reason) => ({ scope: 'full', reason });

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const positiveSafeInteger = (value) => Number.isSafeInteger(value) && value > 0;

const nonnegativeSafeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

export function selectControlJobs(input) {
  if (!isRecord(input)) return full('input must be an object');

  const { expectedNames, runId, attempt, totalCount, jobs } = input;
  if (
    !Array.isArray(expectedNames) ||
    expectedNames.length === 0 ||
    expectedNames.some(
      (name) =>
        typeof name !== 'string' ||
        name.trim() === '' ||
        !name.startsWith(SUITE_PREFIX) ||
        name.length === SUITE_PREFIX.length,
    ) ||
    new Set(expectedNames).size !== expectedNames.length
  ) {
    return full('expected suite inventory is malformed');
  }
  if (!positiveSafeInteger(runId) || !positiveSafeInteger(attempt)) {
    return full('run identity is malformed');
  }
  if (!nonnegativeSafeInteger(totalCount) || !Array.isArray(jobs) || jobs.length !== totalCount) {
    return full('job collection is incomplete');
  }

  const seenIds = new Set();
  const suiteRows = new Map();
  for (const job of jobs) {
    if (!isRecord(job)) return full('job row is malformed');
    if (!positiveSafeInteger(job.id) || seenIds.has(job.id)) {
      return full('job identity is malformed');
    }
    seenIds.add(job.id);
    if (
      typeof job.name !== 'string' ||
      job.name.trim() === '' ||
      !positiveSafeInteger(job.run_id) ||
      job.run_id !== runId ||
      !positiveSafeInteger(job.run_attempt)
    ) {
      return full('job identity fields are malformed');
    }
    if (job.name.startsWith(SUITE_PREFIX)) {
      if (!expectedNames.includes(job.name) || suiteRows.has(job.name)) {
        return full('suite inventory does not match');
      }
      suiteRows.set(job.name, job);
    }
  }

  if (suiteRows.size !== expectedNames.length || expectedNames.some((name) => !suiteRows.has(name))) {
    return full('suite inventory is incomplete');
  }

  const failures = [];
  for (const name of expectedNames) {
    const job = suiteRows.get(name);
    if (
      job.run_attempt !== attempt ||
      job.status !== 'completed' ||
      (job.conclusion !== 'success' && job.conclusion !== 'failure')
    ) {
      return full('suite rows are not a complete settled attempt');
    }
    if (job.conclusion === 'failure') failures.push(name);
  }

  if (failures.length === 0 || failures.length === expectedNames.length) {
    return full('failure set is not a proper subset');
  }
  return {
    scope: 'targeted',
    jobs: failures,
    reason: `rerun ${failures.length} failed suite jobs from ${expectedNames.length}`,
  };
}
