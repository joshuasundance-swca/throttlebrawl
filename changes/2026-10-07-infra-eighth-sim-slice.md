---
kind: dev
audience: dev
---
The sim tests run in eight slices, not seven, on a refreshed timing table. Main went red on f13f6d0 (#650): `sim (4/7)` ran past its 10-minute limit on both attempts of run 37585327862, planned at 364 s by a table that priced 15 newer sim files at the mean file. `tests/timings.json` is refreshed from train run 37583841936 and main run 37581242850 (`node scripts/timings.mjs`); on it seven slices plan at 423 s, past the 420 s line (70 % of the timeout), and eight plan at 374 to 408 s, the 408 being `traffic-cart-live.test.ts` alone (389 s), the floor. A full suite is now 19 jobs and a full-gate push 21; AGENTS.md, `docs/engineering.md`, the `ci.yml` and `suite.yml` headers and `scripts/contributing-docs.test.ts` say so.
