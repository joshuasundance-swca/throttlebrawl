---
kind: dev
audience: dev
---
Each deploy now checks, after its upload, that the game's host serves the compressed copies the offline helper downloads (playtest 4 run B's live check, punch item 8). The step waits up to 4 minutes for the game to serve the new build. It then fetches the entry script and one lazy chunk, each plain and as its `.gz` copy, and checks that each copy unpacks to its file byte for byte. It only reports. The game falls back to the plain files, so a failed check leaves a warning on the run and its lines in the run summary; it never fails the deploy, skips the release notes or turns main red. Before the copies ship (the platform PR that adds `scripts/gzip-probe.mjs`), the step prints that the tree has no probe and does nothing. Not phone-verified (no game change).
