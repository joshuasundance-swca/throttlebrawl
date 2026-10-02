---
kind: dev
audience: dev
---
Main fix-forward: CI's third sim slice ran out of its 10-minute limit on main (run 37052696293, after #347). The slices are balanced from `tests/timings.json`, last measured before the merge burst that brought the career, the roadside weapons and more landings checks: the plan said 280 s per slice, while slice 3 really took about 9 minutes against 5 for the other two (riders-landings alone went from 184 s to 291 s, road-setpieces-live from 94 s to 171 s). The table is re-measured from the two latest complete runs (37051127244 and 37043493924) with `node scripts/timings.mjs`; the new plan is 315 s per slice. No test changes; every file still runs in exactly one slice.
