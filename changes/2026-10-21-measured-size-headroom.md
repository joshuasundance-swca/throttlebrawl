---
kind: changed
audience: dev
---

First-load JavaScript below the inherited 10 KiB headroom reserve now prints a warning on every measured build instead of failing growing PRs. The 500 KiB hard cap, failures for missing current measurements, full acceptance and deployment safeguards remain. Diagnostics name the actual checkout commit/tree and say when comparison data is unavailable. The train measures its final bundle; intermediate merges can still make main red and must pass its existing exact-tree proof or full-suite fallback before deployment. This keeps composition risk visible while allowing useful content within the hard cap; the limits remain provisional CI proxies pending device measurements, with no numeric budget increase or phone-performance claim.
