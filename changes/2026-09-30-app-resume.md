---
kind: dev
audience: dev
---
The game can now rebuild a race from its saved recording: `resumeFromRecording` builds a fresh sim from the settings stored in the recording (never today's settings), replays the recorded inputs and tuning changes to the saved moment, and checks the recorded state fingerprints on the way. The acceptance test records 600 ticks on Hard at 0.9 speed with a mid-race tuning change, saves and reloads the recording as the game would, fast-forwards (80 ms on the dev machine), matches all 10 fingerprints, then rides both copies 600 more ticks in lockstep. Nothing calls it yet: replay-2 saves the recording and app-4 adds the "Resume race" card.
