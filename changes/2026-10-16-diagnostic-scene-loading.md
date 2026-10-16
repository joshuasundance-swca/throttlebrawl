---
kind: fixed
audience: dev
---

Diagnostic scene preparation loads only when a measurement is requested, through the existing
retrying chunk loader. A cancelled preparation cannot replace a later race, and a failed code
load releases measurement ownership so another request can start.
