---
kind: dev
audience: dev
---
Two small wires for dev-2's perf probe and self-test. The app times every sim step and hands the last ~600 durations to dev/ through `AppHandle.stepTimes()`, so the perf probe and the `?debug=1` overlay can show sim step time. `createHeadlessRace` takes an `includeDrafts` option, so the seeded batch and the self-test can load draft content the way the dev and staging builds do (the default stays live-only, like prod).
