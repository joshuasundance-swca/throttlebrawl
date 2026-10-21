---
kind: fixed
audience: dev
---
Main CI now keeps enough lookup requests to fully check a descendant that appears
during its bounded wait. It checks main before repeating other lookups and recognizes
GitHub's pending concurrency state. An observed active train allows waiting within
the original deadline; it never proves acceptance. If main stays unchanged, CI checks
once more for its exact tested-tree proof before choosing the full suite. The request
and time limits stay unchanged. Changed runs, missing proof and uncertain API results
still require the full suite; superseded commits remain unaccepted.
