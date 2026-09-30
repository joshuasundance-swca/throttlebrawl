---
kind: dev
audience: dev
---
The build now puts the simulation, the road model and the shared core into their own file, and the replay key's code part is a hash of that file instead of the build commit. A deploy that only changes menus, sound or visuals keeps the key, so a race saved before the deploy can still be resumed after it (M2's resume after a reload); a change to the sim changes the key. A test builds the game three times in memory (as is, with a UI-only change, with a sim change) and checks the hash stays, stays, and moves. Dev servers and tests keep using the build id.
