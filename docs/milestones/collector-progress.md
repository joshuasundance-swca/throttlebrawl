# Additive collector progress contract

`[default]` The upcoming real-frame consumer must stop at the canonical duration/overflow boundary
and show active elapsed time without generating and sorting a full report on every draw.

Add two readonly scalar getters to the exported internal DEV `SoakFrameCollector` interface:

```ts
readonly state: SoakFrameReport['state'];
readonly eligibleMs: number;
```

They expose the exact private collector state and eligible interval sum already used by report().
Each read is constant work, allocates no array/object, performs no sort and changes no state.
Implement exactly direct closure accessors: `get state() { return state; }` and
`get eligibleMs() { return eligibleMs; }`. Never delegate to report(), copy arrays or compute summaries.
Initial values are collecting and zero. No new progress clock, parallel interval arithmetic,
duration threshold, snapshot/report schema, percentile helper or qualification verdict is added.
Existing record/cancel/report signatures and every terminal/validation/overflow rule remain.

The consumer reads state immediately after record: target-reached means stop and generate one
final report; incomplete means stop and preserve its partial report. The consumer stays inside the
DEV-owned runner. Later screen progress requires separately reviewed composition-root wiring;
APP/UI must not import this internal module or DEV. No barrel export is added in this slice.
State alone never proves phone performance or identifies a cancellation reason; the
terminal report supplies detailed reasons and statistics. Reports remain owned snapshots.

## Automated acceptance

1. Initial getters match the initial report, and remain consistent after an accepted eligible
   interval, excluded interval and epoch transition. Drive exact sample data, not wall time.
2. Existing full-final-interval target/overrun and explicit cancellation cases assert the getters
   match the same canonical report after termination; later record/cancel/read cannot revive them.
3. Existing retention-overflow and invalid/backwards sample cases assert the getters preserve
   the same transaction boundary as report(), including no rejected interval contribution.
4. Repeated getter reads do not change the report or alias mutable data. Existing collector tests
   remain intact; no expanded arbitrary target override or successful synthetic phone verdict.
5. A focused synchronous guard replaces report with a throwing spy and observes Array sort/map
   during getter reads. Neither getter may call any of them. First run the original report as a
   positive control proving the sort/map spies detect its summary path; restore spies in finally.
   Source review enforces the exact direct-accessor shape and no allocation. Use no timing oracle.

Ownership: DEV collector interface/helper and its focused existing tests, plus a plain note.
The accepted collector milestone receives this additive API/acceptance section before the consumer
is built. No APP/frame/wake/UI/sim/replay/save/CI/dependency or budget policy change.
