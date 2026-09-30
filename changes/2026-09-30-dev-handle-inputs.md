---
kind: dev
audience: dev
---
The browser test handle (`window.__game`, test builds only) gains `inputs(from?)`: the player slot's recorded per-tick commands in the current race. The input lane's browser specs use it to prove that real pointer and key events reach the sim as the expected commands. Read-only, and it adds nothing to normal play.
