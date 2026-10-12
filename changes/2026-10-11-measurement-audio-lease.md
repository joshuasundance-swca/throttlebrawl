---
kind: dev
audience: dev
---
The audio module now lends a cancellable suspension lease to the planned measurement runtime.
It observes a quiet audio context before granting the lease and restores only the running intent
it still owns. Delayed sound-engine loads remain private until reconciled, and retries retain
queued configuration in order. Existing radio keys and ordinary callers keep their behavior.
This prerequisite does not yet add the measurement session or a phone measurement verdict.
