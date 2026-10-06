---
kind: dev
audience: dev
---
Six slow sim test files now do the same checks with less riding, about 9 minutes less CI test time in all (an estimate: each file's CI seconds scaled by its measured local drop). Every assertion stays, and every printed line still prints. For each cut, a one-line bug planted in the game code failed the file both before and after the cut, with the same tests failing.

- **road-setpieces-live**: the solo ride takes one sim snapshot a tick instead of two. The snapshot after a step places that tick's events and is the next tick's view. Every printed jump, landing and boost is the same. Locally 240 s to 162 s.
- **events-trigger**: each ride stops at the moving piece's beat. Whether the piece was placed, the beat and the gap at the beat are all settled by then. Same printed results. Locally 137 s to 46 s.
- **cops-steal-chance**: each race stops at the first steal off the cop. The checks ask only whether a race had a steal and whether it was made with a road weapon in hand. The same as main: stole in 8 of 10 (Keys), 9 of 10 (Pacific Northwest) and 12 of 20 (San Francisco) races, 7, 6 and 5 of them with a weapon in hand. Wind-ups, busts and finishes are now counted up to the stop, and the line says so. Locally 160 s to 87 s.
- **camera-crests**: each route and seed is raced once, with one follow camera per screen shape. The camera only reads the sim, so the race is the same for both shapes. Every printed frame count is the same. Locally 112 s to 57 s.
- **drift-room**: the Twin Peaks and Lombard rides asserted nothing (a check that is always true), so they now run only with `DRIFT_ROOM_EXAMINE=1`. The Crown Point check is unchanged. Locally 127 s to 90 s.
- **road-real-routes**: the replay check compares the seed-1 race kept from the Russian Hill finish check with a fresh seed-1 race, instead of racing seed 4 twice. Seed 5 rides only the first minute it is compared on. The replay test went from 15.0 s to 6.7 s.

`tests/timings.json` has the new estimates for these six files, so the CI slices stay balanced. Not phone-verified (no game change).
