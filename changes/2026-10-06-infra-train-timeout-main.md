---
kind: dev
audience: dev
---
The train now waits on a main that timed out, and CI's timing table measures the eight sim files it used to time at 0 s.

- **A timed-out main is red to the train.** A job that hits its time limit ends "cancelled", and GitHub then marks the whole run cancelled, not failed. The train read that as "no verdict" and could send a bundle onto a main that was not known green. It now reads the cancelled run's jobs and their notes. If a job hit its time limit, main is red. The train then waits for rerun-main's second attempt, as it does for a failed first attempt. If that attempt is red too, the train waits for a fix. A run a person cancelled, or one a newer push replaced, still means no verdict. That is the same rule rerun-main uses, and a test checks the two agree.
- **Whole-file sim times.** Vitest's own per-file time leaves out the time to load a file. Eight sim files run their races while loading, so Vitest timed them at a few milliseconds and the table at 0 s. A small Vitest reporter (`tests/file-times.ts`) now prints each sim file's whole time, and `scripts/timings.mjs` reads it. The sim table is averaged only over runs that have those lines.
- **The table is refreshed** from this PR's first green run (37463464769) and two green main runs (37457079930 and 37456288864). The sim times come from the PR run only, the one that has the new lines.
  - Only three of the eight are slow: `app-cast-and-law` takes 72 s, `riders-race` 46 s and `ai-briefcase-throw` 15 s. The other five take under 1.1 s each.
  - Priced as the mean file (58 s), the eight came to about 463 s, against about 138 s measured.
  - The plan now puts unit at 225 s (47% of 8 minutes), sim at 330 to 360 s (60% of 10, the batch readers' slice the longest) and browser at 327 to 329 s (55% of 10).
  - A test fails if the checked-in table times any sim file at 0 s.
- **One shared-config edit rides here:** `vitest.config.ts` adds the reporter beside Vitest's own default reporters, which it keeps.

Not phone-verified (no game change).
