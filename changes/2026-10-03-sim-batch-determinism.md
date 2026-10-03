---
kind: dev
audience: dev
---
Three seeded sim tests that kept failing on unrelated PRs now check their behaviour deterministically.

- **Rivals (ai-1):** `tests/sim/ai-rivals.test.ts` stops racing 50 races of its own (about 285 s of CI time, under a 5-minute, later 10-minute, wall-clock limit that timed out as content grew). It reads the shared seeded batch instead, plus a new batch hook (`tests/sim/hooks/ai-rivals.ts`) that keeps each rival's longest stall and end state per tick. The checks are the same: every rival finishes, is down or busted; none is stuck 10 s; rivals hit the player; and every one of the 50 races replays to the same hashes (it used to replay one). The wait is now only a hang guard.
- **Difficulty (riders-5):** "Hard shows more rival hits on the player than Easy" compared race totals that sat inside the seed noise (it failed 82 > 82 and 52 > 55). It now checks the mechanism: the presets resolve in the declared direction through the app's config path, and in a staged encounter on a straight road, Hard rivals start at least 1.05x the attacks of Easy ones (1.13x measured; 1.00x when the preset is cut out of the AI) and land more hits. The race totals and the cop-spawn direction read the shared Easy and Hard batch. Measured on the way: when a hit shoves the player as usual, Easy and Hard rivals connect about equally often (83 against 86), because the re-approach after each shove sets the pace.
- **The parked cop (cops-1):** riders bump and traffic nudges, so a parked cop can be moved before his siren, and the exact "parked" check failed whenever a PR reshuffled a seed into that. The exact check now runs every tick in a quiet race (no traffic or fights), and in the batch it holds until the first contact that names him; the races where something touched him are printed and capped at 10 of 50 (0 today). "Gives chase" is unchanged.

Each new check was shown to fail once on purpose: a preset table with Easy above Hard, the AI ignoring the preset, rivals stopping after 20 s, and a parked cop on full throttle.
