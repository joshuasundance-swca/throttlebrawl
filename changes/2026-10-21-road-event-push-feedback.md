---
kind: changed
audience: dev
---

Local pre-push selection now includes the existing warning-sign and road-event bark checks when their pack inputs change. Modifier files select both; event and road-event bark files select the bark check. This catches misleading warnings, missing eligible lines and overlong copy before a remote CI round. Selection stays bounded and deduplicated; unrelated content, dependency-only pushes and the hosted gate keep their existing coverage.
