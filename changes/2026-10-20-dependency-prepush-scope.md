---
kind: dev
audience: dev
---
Pushing a lockfile update, or a manifest update confined to standard dependency maps, now runs the local typecheck without the full unit tier. The hook compares the manifest at the merge base and push head; changes to scripts or other package configuration, and missing or invalid manifests, keep the full local unit tier. CI still runs every test. If a push also changes source files, the hook runs their named unit tests and existing bounded checks. Global test or type configuration changes and a missing base reference retain the hook's full-tier fallback.
