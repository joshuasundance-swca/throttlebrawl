---
kind: fixed
audience: dev
---
Main preflight logs a bounded reason when it falls back to the full suite, including
request limits, deadlines, lookup failures and unavailable eligible train or successor
runs. Reasons use fixed text rather than API or error content. Routing, acceptance,
request and time limits, and workflow output fields stay the same. These diagnostics
provide evidence for investigation; they do not claim a reduction in CI work.
