/**
 * Caller must establish complete jobs from the same workflow attempt.
 * @param {unknown} jobs
 */
export function hasSuccessfulMainGate(jobs) {
  if (
    !Array.isArray(jobs) ||
    jobs.some((job) => !job || typeof job !== 'object' || typeof job.name !== 'string')
  )
    return false;
  const gates = jobs.filter((job) => job.name === 'gate');
  return gates.length === 1 && gates[0].status === 'completed' && gates[0].conclusion === 'success';
}
