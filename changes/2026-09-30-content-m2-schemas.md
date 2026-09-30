---
kind: dev
audience: dev
---
Contract change for content-2 (the M2 data formats). A road file's optional `barriers` list is now checked by the schema: each span has `s0` before `s1`, a `side` of left, right or both, a `kind` of `rail` or `wall`, and a positive `heightM`. An event's `rewards` block names the optional style cash fields (`perTakedownCash`, `perNearMissCash`, `perAirtimeCash`, `perOncomingSecondCash`, `takedownComboScale`, `perStealCash`); they default to 0, so no format bump. Bark lines gain the doc's `when` conditions (`{ fact, op, value }`, where `in` takes a list and every other op one value), `chance`, `priority`, `oncePerCareer`, `audioAsset` and `replyTo`, and a set's `defaults` may carry `chance` and `priority`. The closed bark trigger list and the fact vocabulary for `when` now live in `src/content/schema/vocab.ts`, exported from `content/`, so the linter and the narrative lane read one list.
