---
kind: changed
audience: dev
---

The optional frame-measurement runtime loads when measurement begins, through the existing
retrying chunk loader. A pending import owns its request immediately: aborts, ordinary navigation,
and lifecycle holds settle it before the import finishes. A failed load releases ownership so the
tool can be tried again. Ordinary race loading does not request this runtime.
