---
kind: dev
audience: dev
---
A main run that went red only because a test slice ran out of time is now re-run once, like a main run that failed. GitHub ends a timed-out job "cancelled" and the whole run with it, and the re-run job acted only on "failure", so main run 37423758824 (85c747dd) stayed red on 2026-10-06 when browser slice 5/7 hit its 10-minute limit. The job now reads the runner's "exceeded the maximum execution time" note on each cancelled job, so a timeout counts but a run somebody cancelled, or a waiting run a newer push replaced, still does not. The decision moved from shell lines in `rerun-main.yml` into `scripts/rerun-main.mjs`, with a unit test built on real runs' shapes. The job now checks out main's own `scripts/` folder and gets one more read-only permission (`checks: read`) for those notes. A cancelled main run now starts this job for about half a minute, even when it only logs "not re-run". Not phone-verified (no game change).
