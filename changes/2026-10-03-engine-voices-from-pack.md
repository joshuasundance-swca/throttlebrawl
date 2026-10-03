---
kind: dev
audience: dev
---
The engine voice of each bike class (chopper thump, scooter buzz, sport scream, dirt-bike rasp and the rest; playtest 2, "a voice per bike") now lives in the base pack's `pack.json` (`defaults.engineSoundByClass`) instead of audio's code. A pack edit can now retune a class's voice, or give a class a new one, without a code change. The app hands audio each rider's patch: its drawn class's voice from the pack, else its bike's own, as before. The ten voices are the same values the code held, so nothing sounds different. Audio's `ENGINE_BY_CLASS` is removed, and its tests read the table from the pack; a new app test covers which patch each rider gets.
