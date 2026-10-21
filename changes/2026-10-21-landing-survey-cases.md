---
kind: dev
audience: dev
---

The landing survey now gives each route, seed and player policy its own scheduled race, so its timeout no longer covers the entire survey at once. It keeps every race, the same isolation and tick caps, and the original pooled landing checks. Missing, failed or malformed race results fail the pooled check; selecting that check alone does not rerun the survey. Each race keeps the former 15-minute limit; this increases the sum of per-test allowances without changing CI job deadlines.
