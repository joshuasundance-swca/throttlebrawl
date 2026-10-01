---
kind: dev
audience: dev
---
Contract PR for M4 rivals-1 (the cast, built early): the sim's `SimAiPersonality` gains two optional fields, `rivals` (a rider's authored rivalries, as bare rider ids) and `preferredWeapon` (the weapon id it goes out of its way to pick up), and `targetPreference` documents a `rival` entry. Nothing reads them yet and nothing sets them, so no race changes. sim/ai reads them in the rivals-1 PR; `buildSimConfig`'s `aiController` passes them through from the rider file's `personality` block in a follow-up by the app lane.
