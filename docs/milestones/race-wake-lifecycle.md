# Race screen wake lock

`[default]` Complete the existing M2 platform-2 wake-lock requirement by wiring
the app's real race lifecycle to the public `keepAwake` capability. Request a
screen lock only for a race with no pause screen, hidden-page hold or lost-context
hold. Release it when that condition stops. Keep browser support and refusal
handling in the existing platform implementation.

## Automated acceptance

1. Boot, Start, menu and results never request a race wake lock.
2. Starting either race flow uses the shared race transition to request the lock;
   unchanged running state never issues repeated requests.
3. Pause releases the lock; Resume requests it again. Hidden-page and context
   holds release it, and overlapping holds cannot reacquire it before all clear.
4. Returning to a visible page leaves the existing pause screen up and does not
   request a lock until the player resumes. Restoring an unpaused context hold
   re-requests the lock.
5. Paused Quit changes state before resuming the loop, so it cannot transiently
   reacquire a lock. Paused Restart requests once for the replacement race,
   without an old-race request before its menu transition.
6. Race results release the lock, and Menu remains released.
7. A CI browser regression installs a mocked navigator wake-lock API before boot,
   proves the mock with a manual request/release control, and then uses the real
   Start, Race, Pause, Resume, Restart, Quit, visibility and WebGL context paths.
   A bot race reaches results by sim ticks and checks release there. Request logs
   prove the actual app wiring and no per-tick requests. No timed/frame waits.

Unit tests cover the app's shared wake state seam; browser acceptance establishes
that production app paths call it. This does not establish physical screen-awake
behavior on a phone, measure battery life, or add M5 soak tooling.
