---
kind: fixed
audience: player
---
Fights keep up with a busy thumb (playtest 4: "reduce delay between tap and attack"; "too mechanically constrained and timed"). Three rough edges from run A's live check:

- Mash the attack button and no press is lost. A tap or swipe made any time after a blow has gone out (while the arm or leg comes back) fires the moment it is back. Before, only the last 0.17 s counted, so a third kick swiped a little early was dropped. If you press twice while waiting, the second press is the one that fires.
- Hit back sooner after a rival hits you. Your attack now comes back when your bike stops shaking: about 0.13 s after a rival's kick and 0.08 s after a punch, plus the brief freeze of the hit. Before, the attack stayed locked for 0.35 s after a kick, well after the shake had stopped, so a tap right after a hit took about half a second to land. You still can't swing while the bike is shaking. Rivals you hit stay staggered as long as before.
- A clear sideways swipe only ever hits that side. A swipe to the left, with nobody on your left, could kick the rider rubbing your right side. Now it swings at the left and misses. A straight-down swipe still aims itself, and a swipe toward the rider you are rubbing still lands.

For devs: `src/sim/combat/index.ts`. Item 3: the press buffer covers the whole recovery (`PRESS_BUFFER_TICKS`, 10, is gone), and `keep` now replaces an earlier kept press, so the latest press wins (a kick or side flag recognised after that press still sticks to it while it waits). Presses in the wind-up or the active moment are the same swing and are still ignored, and rivals' presses are still never kept. Item 4: in `land`, a hit locks its target's attacks for `wobble` (the stagger times `combat.onPlayerScale` for a non-player's hit on a player, 1 for everyone else) instead of the data stagger, so the lock and the riders phase's wobble start equal and count down together. A rival's kick on the player locks him 8 ticks, not 21 (a tap on the hit tick starts 12 ticks later, not 25), and a punch 5, not 12. Rivals, the player's hits on them and the taser's stun keep their numbers. The player's weapon snatch (`stealPass`) reads the same lock. Item 5: `setAim` with one side flag drops the attack's `touched` rider when he is on the other side, so the bump rule (`landBump`) can no longer land a punch's contact on the right through the left kick it was converted into. The rest of the bump rule is unchanged. There is no new state, the recorded-input format is unchanged, and new recordings replay exactly. Recorded races where the player pressed early in a recovery, pressed while hit, or swiped sideways while rubbing a rider will play out differently.

Tests: `src/sim/combat/press-flow.test.ts` (sim ticks, the combat harness):
- every press tick of each recovery (punch and kick, in each order) starts as it ends;
- the live case, a third kick 12 ticks early, fires the tick the leg is back;
- the latest press wins, both ways;
- controls: wind-up and active presses and a rival's recovery presses still make no second swing;
- every press tick from a rival's kick or punch until the player's wobble ends starts exactly when it ends (19 and 16);
- the lock equals the wobble on the hit tick;
- controls: `combat.onPlayerScale` 1 gives the full 21 ticks, and a mashing rival kicked by the player still starts no attack for 21 ticks;
- a tap turned into a left kick swipe while rubbing a rider on the right does not hit him;
- controls: a right swipe and a straight-down swipe at him land, a left swipe at a rider rubbing the left lands, and a fresh left kick press and a left swipe with no rubbing miss.

Before the fix, the 10 non-control cases failed: the press was dropped, the start came on tick 32 and 23 instead of 19 and 16, and the hit landed on rider 1. `timing.test.ts`'s "press before the buffer opens is dropped" case now expects the press to be kept. `feel.test.ts`'s two stagger-queue cases now expect the 8-tick lock. Not phone-verified.
