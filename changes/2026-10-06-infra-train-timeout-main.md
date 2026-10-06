---
kind: dev
audience: dev
---
The train now waits on a main that timed out, and CI's timing table measures the eight sim files it used to time at 0 s.

- **A timed-out main is red to the train.** A job that hits its time limit ends "cancelled", and GitHub then marks the whole run cancelled, not failed. The train read that as "no verdict" and could send a bundle onto a main that was not known green. It now reads the cancelled run's jobs and their notes. If a job hit its time limit, main is red. The train then waits for rerun-main's second attempt, as it does for a failed first attempt. If that attempt is red too, the train waits for a fix. A run a person cancelled, or one a newer push replaced, still means no verdict. That is the same rule rerun-main uses, and a test checks the two agree.
- **Whole-file sim times.** Vitest's own per-file time leaves out the time to load a file. Eight sim files run their races while loading, so Vitest timed them at a few milliseconds and the table at 0 s. A small Vitest reporter (`tests/file-times.ts`) now prints each sim file's whole time, and `scripts/timings.mjs` reads it. The sim table is averaged only over runs that have those lines.
- **The table is refreshed** from this PR's first two green runs (37463464769 and 37467350363) and a green main run (37457079930). The sim times come from the two PR runs only, the ones that have the new lines.
  - Only three of the eight are slow: `app-cast-and-law` takes 72 s, `riders-race` 40 s and `ai-briefcase-throw` 14 s. The other five take 0.4 to 1.1 s each.
  - Priced as the mean file (58 s), the eight came to about 463 s, against about 130 s measured.
  - The plan now puts unit at 223 s (46% of 8 minutes), sim at 323 to 368 s (61% of 10, the batch readers' slice the longest) and browser at 335 to 340 s (57% of 10).
  - A test fails if the checked-in table times any sim file at 0 s.
  - Runners still vary. On this PR's second run, one sim job took 443 s (74% of 10 minutes) against a plan of 330. Between the PR's two runs, each sim file over 20 s took 0.53 to 2.09 times as long on the second (median 1.04).
- **One shared-config edit rides here:** `vitest.config.ts` adds the reporter beside Vitest's own default reporters, which it keeps.

Not phone-verified (no game change).
