// Train-route quick feedback only; this adapts the existing planner, not its selection rules.
import { planPushFromRevisions } from './push-plan.mjs';

const unitFile = (file) =>
  typeof file === 'string' &&
  /^(src|scripts|tools)\/.+\.test\.ts$/.test(file) &&
  !file.includes('\\') &&
  !file.includes('\0') &&
  file.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
const commit = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

/** Runner inventory remains authoritative; uncertainty retains the entire unit project. */
export function planQuickUnits({ git, exists, inventory, planner = planPushFromRevisions }) {
  if (
    !Array.isArray(inventory) ||
    !inventory.length ||
    inventory.some((f) => !unitFile(f)) ||
    new Set(inventory).size !== inventory.length
  )
    throw new Error('invalid or unavailable full unit inventory');
  const full = (reason) => ({ mode: 'full', tests: inventory, reason });
  try {
    const head = git(['rev-parse', '--verify', 'HEAD^{commit}']).trim();
    if (!commit(head)) return full('could not resolve checked-out commit');
    const base = git(['rev-parse', '--verify', `${head}^1^{commit}`]).trim();
    if (!commit(base)) return full('could not resolve first parent');
    const parents = git(['rev-list', '--parents', '-n', '1', head]).trim().split(/\s+/);
    if (parents.length !== 3 || parents[0] !== head || parents[1] !== base || !parents.every(commit))
      return full('checkout is not a verified two-parent merge');
    const raw = git(['diff', '--name-only', '-z', '--no-renames', base, head, '--']);
    if (typeof raw !== 'string' || !raw.endsWith('\0')) return full('empty or invalid first-parent diff');
    const changed = raw.slice(0, -1).split('\0');
    if (changed.some((f) => !f || f.startsWith('/') || f.split('/').some((p) => p === '..')))
      return full('invalid changed paths');
    if (changed.includes('package.json') || changed.includes('package-lock.json'))
      return full(`root manifest or lock changed; comparison ${base}..${head}`);
    const plan = planner(changed, exists, base, head, (ref, file) => git(['show', `${ref}:${file}`]));
    if (
      !plan ||
      !['full', 'files', 'skip'].includes(plan.mode) ||
      !Array.isArray(plan.tests) ||
      typeof plan.reason !== 'string' ||
      (plan.mode !== 'files' && plan.tests.length)
    )
      return full('malformed named-unit plan');
    if (plan.mode === 'full') return full(`${plan.reason}; comparison ${base}..${head}`);
    const available = new Set(inventory);
    if (plan.tests.some((f) => !unitFile(f) || !available.has(f) || !exists(f)))
      return full('selected tests do not match the unit runner inventory');
    return { mode: 'files', tests: [...new Set(plan.tests)].sort(), reason: plan.reason, base, head };
  } catch {
    return full('first-parent comparison or named-unit planning failed');
  }
}
