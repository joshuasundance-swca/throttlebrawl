---
kind: dev
audience: dev
---

The check that every route network's edges match what is drawn there no longer keeps every network in memory at once. With Longview and Iowa added it had outgrown the test worker's memory and crashed a CI run on main; it now frees each network after checking it, with the same assertions.
