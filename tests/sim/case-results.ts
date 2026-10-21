// In-file soak results only: no disk cache, runner hooks or cross-job state.
// Keep a failed case failed, and never let a partial collection masquerade as pooled success.
export function memoCases<K, R>(keys: readonly K[], run: (key: K) => R) {
  const required = new Set(keys);
  if (required.size !== keys.length) throw new Error('Duplicate required case');
  const rows = new Map<K, { ok: true; value: R } | { ok: false; error: unknown }>();
  const read = (key: K): R => {
    const row = rows.get(key);
    if (!row) throw new Error(`Missing required case: ${String(key)}`);
    if (!row.ok) throw row.error;
    return row.value;
  };
  const get = (key: K): R => {
    if (!required.has(key)) throw new Error(`Unknown required case: ${String(key)}`);
    if (!rows.has(key)) {
      try {
        const value = run(key);
        if (value === undefined) throw new Error(`Missing required case output: ${String(key)}`);
        rows.set(key, { ok: true, value });
      } catch (error) {
        rows.set(key, { ok: false, error });
      }
    }
    return read(key);
  };
  return {
    get,
    results: () => keys.map(read),
    // The aggregate can run by name without any preceding case having executed.
    complete: () => keys.map(get),
  };
}

/** One call advances at most one next ordered candidate, never an unused future candidate. */
export function qualifyingCases<K, R>(
  keys: readonly K[],
  needed: number,
  run: (key: K) => R,
  qualifies: (row: R) => boolean,
) {
  const cases = memoCases(keys, run);
  const selected: R[] = [];
  let next = 0;
  let failed = false;
  let error: unknown;
  const done = () => selected.length >= needed || next >= keys.length;
  const advance = () => {
    if (failed) throw error;
    if (done()) return;
    try {
      const row = cases.get(keys[next]!);
      if (qualifies(row)) selected.push(row);
      next++;
    } catch (fault) {
      failed = true;
      error = fault;
      throw fault;
    }
  };
  const results = () => {
    if (failed) throw error;
    if (!done()) throw new Error('Missing ordered candidate cases before aggregate');
    return [...selected];
  };
  return {
    advance,
    results,
    complete() {
      while (!done()) advance();
      return results();
    },
  };
}
