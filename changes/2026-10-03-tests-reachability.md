---
kind: dev
audience: dev
---
New reachability tests catch work that is built but never reached:
- every `*_TUNING` declaration is in the tuning registry;
- every key and pad binding has a handler and a settings echo;
- every set-piece slot in the packs has 2 or more candidates;
- no live entry names a draft.

The live-to-draft check holds a named list that can only shrink. It has 5 entries, all the Keys' drawn but still-draft animals and the runaway mobile home, so the public game never shows them.

Seeded tests now take their expected content from the packs instead of hand-written lists: road-event pieces, sign words, gator count and smashable kinds and routes. The every-piece race now uses `firstSeed` instead of a hand-picked seed.

The set-piece test now rides Chinatown/North Beach and the Mission too. Both carried slots but were missing from its list, and a new check fails on any shipped route with slots that the list leaves out. The Mission's Semigloss pad is 64 m before its truck, inside the 400 m feed rule. That is now a named exception, also shrink-only.
