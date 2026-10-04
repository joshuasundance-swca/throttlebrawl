---
kind: fixed
audience: player
---
Regions now go in order for real. On a fresh career the Pacific Northwest and San Francisco could be raced before the Keys boss fell, and one race there opened that region's bike shop. Now no button starts a race in a region that is still shut: Ride, Next, Race it again and restart all stop with the line "Opens when Mother Rust falls." (the Pacific Northwest) or "Opens when Old Growth falls." (San Francisco). A locked event in an open region is refused the same way. Places you already raced stay open, as before.

For devs: `rideRefusal` in `src/career/map.ts` is the gate (the region's `regionOpen`, then the node's `lockReason`); `rideLock` in `src/app/career-flow.ts` names the events, and `startCareerRace` in `src/app/index.ts` asks it before anything starts, so the `rideCareer` dev hook is gated too. Tests: `src/career/progression.test.ts` (hand-made maps) and `tests/sim/career-content.test.ts` (the real packs, every event of every shut region). The look of the lock on the map is T7.4's. Not phone-verified.
