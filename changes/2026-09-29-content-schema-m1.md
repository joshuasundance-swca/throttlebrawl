---
kind: dev
audience: dev
---
Content schema contract for M1 (content-1, first step). The schema folder gains the `crew` type (a cop's `law.agency` points at one), claims the reserved type names `event-modifier`, `station` and `patch` with their documented shapes (patches validate but are not loaded), and adds the optional fields the docs already describe: the pack manifest's `authors`, `licenseRules` and `assetSources`, region `signs`, `billboards`, `pedestrians` and `animals`, bark-set `defaults` and per-line `speaker`, `target` and `note`, and an event's reserved `modifiers` block.

It also lists, per type, which top-level fields stay out of the sim content hash (`SIM_EXCLUDED_FIELDS`), and which lists hold vetoable items (`VETOABLE_ITEMS`). Fields not listed count as sim-facing, so a field a later lane adds renews the replay key rather than risking a silent replay divergence. The registry gains `crews`, `modifiers` and `stations` tables.
