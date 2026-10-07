---
kind: dev
audience: dev
---
Cancelling a failed train now stops its diagnostic control suite. The control still runs when a lone branch fails, but no longer uses an unconditional cancellation-resistant condition. This avoids starting or continuing a second full runner wave after the keeper has deliberately cancelled a stale run. Acceptance, permissions and the reporting job are unchanged.

The regression evaluates the control condition read from the real workflow. It checks ordinary failure, cancellation, success, timeout and multi-branch cases; the cancellation case failed before the fix. A cancelled train supplies no passing gate and must be replaced by a newly accepted run.
