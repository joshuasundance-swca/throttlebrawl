---
kind: fixed
audience: dev
---

While a passed train waits for auto-merge, its existing pull-request reads now log the
first observation, changes in public merge readiness, and the last observed state when
the landing deadline expires. The logs include the head, draft and auto-merge flags, mergeability,
request duration and elapsed wait, without dumping the successful pull response or account identities.
Identical readiness observations stay quiet. The deadline log distinguishes the last read's
time from the elapsed wait. Request duration includes existing retries
and response decoding; it does not establish what caused a merge delay. The landing
settings, success withdrawal, next-train dispatch and exact-tree acceptance stay the same;
bounded synchronous diagnostic logging adds some overhead. Malformed merge timestamps
also stay out of the existing merged-at log line.
