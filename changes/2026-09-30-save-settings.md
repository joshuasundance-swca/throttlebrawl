---
kind: dev
audience: dev
---
save-1: the settings record is finished for M1. It is stored as the versioned envelope `{format: "settings", version: 1, build, savedAt, data}` under the name-neutral key `<app id>:settings`. Every storage read and write is wrapped: storage that throws or is missing boots with defaults, keeps this session's settings in memory and gives one plain notice (`takeNotice()` hands it out once). A record from a newer build is refused, never overwritten, and this session's changes stay in memory. Loaded fields are sanitised one by one (volumes clamped to 0..1, bad values back to defaults), and the first successful save asks the browser for persistent storage. The settings screen that calls `save()` is ui-1's; until it lands nothing writes the record.
