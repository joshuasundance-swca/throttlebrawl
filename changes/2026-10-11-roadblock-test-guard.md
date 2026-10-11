---
kind: fixed
audience: dev
---

The bounded Pacific Northwest roadblock test now has its own 190-second execution guard. Two CI
runs found the required roadblock at seed 10 after 47,914 ticks, but took 95.9 and 92.5 seconds
against the former 90-second default. The slower observation extrapolates to 120.1 seconds for the
unchanged 60,000-tick budget; a 1.5-times slowdown allowance rounds up to 190 seconds.

The twelve-seed search, 5,000-tick per-race cap, 60,000-tick total cap, full-world race and all
assertions remain. No game rule, performance budget, CI job deadline or global test timeout changes.
Independent review checked the failure logs, arithmetic and remaining job headroom. The touched sim
test, normal hooks and complete CI gate remain required. The next timing-table refresh should use
the successful file runtime rather than its older estimate.
