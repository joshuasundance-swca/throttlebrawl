---
kind: dev
audience: dev
---
The local `npm run check` now agrees with CI. Every browser spec renders WebGL in software, and Playwright's default ran 12 of them at once on the dev machine, which starved the specs that time real presses and frames: a different few failed on each run while CI (2 workers) stayed green. Locally Playwright now runs at most 4 workers (CI keeps its default). The tuning panel's short-press check now counts only presses the page itself saw as short, and its long-press check holds until the panel opens instead of for a fixed 800 ms, so load cannot fake either result. The gate summary's e2e row now prints the failed and flaky counts, not only the passed count.
