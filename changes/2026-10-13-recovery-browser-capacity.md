---
kind: fixed
audience: dev
---

Recovery checks repeatedly completed successfully while their shared browser job ran out of time. The planner now accounts for the recovery file's observed work instead of treating it as an average missing file. Its estimate uses all fourteen completed cases from each of two jobs, with that limited provenance recorded explicitly; incomplete neighboring files are not imported.

One extra browser slice gives the existing seventy-spec inventory a predicted maximum of 376 seconds under the unchanged 400-second planning line. All tests remain selected exactly once. The full suite has 23 jobs and a full PR has 25 including routing and aggregation; the quick check is unchanged. Browser workers, deadlines, safety margin, budgets, permissions, caching and last-slice performance/build-artifact handling retain their existing rules. These are planning results, not a measured speed or cost claim.

The contributor-document checks now recognize eleven slices and the corresponding suite total. CI exposed their old pinned count and number-word parser; their live workflow comparisons and planted mismatch controls remain intact.
