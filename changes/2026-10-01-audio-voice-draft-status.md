---
kind: dev
audience: dev
---
The docs and `tools/voices` now say what a voice's `audioStatus: "draft"` does today: nothing yet. The game finds a line's clip by its file, so a draft clip still plays; to keep a voice silent, set `audioStatus` to `vetoed` and run `tbvoices apply`, which removes the clip. The earlier wording promised that a draft clip stays out of release builds, which no code does.
