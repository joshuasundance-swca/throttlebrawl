---
kind: dev
audience: dev
---
Reverts the browser-tier split (#166): the e2e slices and the separate `perf` job go back to one `browser` job that runs build, e2e and then perf. On its own runner, the kodak look's perf probe got slower and failed its soft limit (frame p95 133.2 ms) on main and on three lane PRs. Its frame p95 was 116.6 to 149.9 ms in 8 of the 9 perf-job runs, 4 of them over the limit. With the old layout it was 50 to 100.1 ms in 22 of the 23 runs since 00:06Z on 2026-10-01; the exception, 200 ms, came before the probes ran one at a time (#152). The classic probe did not move. The sim slices (#158) stay. The browser split comes back once the cause is understood.
