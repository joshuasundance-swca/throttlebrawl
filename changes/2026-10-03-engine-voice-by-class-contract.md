---
kind: dev
audience: dev
---
Contract: the base pack's `pack.json` may now carry `defaults.engineSoundByClass`, the engine voice of each bike class (chopper thump, scooter buzz and so on; playtest 2, "a voice per bike"). Until now that table lived in audio's code (`ENGINE_BY_CLASS`), so a new voice for a class needed a code change. The schema takes a patch per class from the closed class list, each the same shape as a bike's `engineSound`, and rejects an unknown class or a patch with no preset. Nothing reads it yet: the follow-up PR moves the table into the base pack and has the app read it. content-packs.md documents the field.
