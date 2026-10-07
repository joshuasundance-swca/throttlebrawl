---
kind: fixed
audience: player
---
Oncoming cars no longer wait for good at a tight bend because a cop is parked on the shoulder past it. A car that waits for riders coming round a hairpin now waits only for riders who are actually moving. Before, a deputy parked within reach of the bend held the cars at their wait line for the rest of the race, and the riders who came up the road stopped nose to nose with them: one rival stood there for 97 seconds.

For devs: polish H's live check, punch item 5. The dev bot sat still on Broadway in Bridge City for 4,000+ ticks with throttle 0, brake 0.5 and full left lock. The check's scripted thumb was not the cause: replayed headless (Bridge City's quick race, seeds 1 to 24, the bot alone and the bot with a scripted thumb handing control back and forth, 48 races of the full world), three states could stick:

- **The bot stopped in front of oncoming cars on the Broadway cut's approach** (`src/dev/bot`). The cut leaves across the oncoming lanes (a split zone at d -10.5 to -6). In the last 150 m before it, the bot "followed" any car in the zone's line, a car coming the other way included, so it braked to a stop across the centre line at full lock toward the zone. Seed 23 with the bot alone sat 460 ticks at Broadway s 112 with the live check's exact inputs. Now a car coming the other way in the zone's line keeps the bot on its own side, riding, and it goes for the zone once the line is clear. A car going its way in the line is still followed, as on road-2's ramp.
- **Boxed in, the bot braked whatever the car in its line did** (`src/dev/bot`). In dense traffic, stopped in the oncoming lane with both lanes of its own way flowing at 9 m/s, it stood still for 941 ticks. Now it follows a car going its way at that car's pace, easing to a stop 4 m behind it, and still stops for a car coming the other way.
- **Hairpin yield counted riders standing still** (`hairpinMouth` in `src/sim/traffic/index.ts`). A deputy waiting on the shoulder inside the reach (or anyone stopped there) held oncoming cars at their wait line for good. Now a rider under 2 m/s does not hold the wait (`HAIRPIN_COMING_MPS`). The spawn rule still counts every rider, since a spawn that cannot stop in time is never a car stuck at a wait line. Car-following still stops a vehicle behind a rider standing in its lane. `docs/architecture.md` (Traffic, hairpin yield) says so.

**Measured** (the full world, Bridge City's quick race, seeds 1 to 24 each way). The longest standstill on the bike in a travel lane, before and after:
- The bot alone: player 460 ticks, then none over 180. Rivals 238, then none.
- With the thumb: player 487 ticks, then none over 180. Rivals 5,801, then 622. The 622 is Kevin pinned on the shoulder (d 8.6), the same in both builds, and it frees itself.

The 180 downs in the bot-alone runs fit the respawn rules: a tumble of at most 3.5 s, or a fall off a bridge plus the 4 s splash penalty (Dial-Up on seed 4: crash at tick 1830, splash at 1980, respawn at 2220), then a rival's 1.5 s get-up and the run-back at 7 m/s, or the player's 3 s skip. One rival's down was 5 ticks past that bound, which measures the run-back as a straight line. The longest down is 726 ticks, a rival's long run-back. Cops standing in a lane are roadblocks (at most 45 s) or the cops with the man they busted, as designed.

**Tests.**
- `src/dev/bot/bot.test.ts`: two new tests that fail on main's bot. One existing assertion now reads "follows at the blocker's pace" as riding up to the car's pace, not braking.
- `src/sim/traffic/hairpin-yield.test.ts`: a standing rider does not hold the car. It fails on main, where the car sits at u 861.5. Its riders now ride at 12 m/s, held in place.
- `tests/sim/never-stuck.test.ts`: Bridge City with dense traffic (the ISOLATED profile, traffic at 3x), seeds 1 and 2. No rider of the field stands still on the bike over 3 s, and the bot keeps 3 m/s or more through cars in the cut's line. Main's bot fails it: 308 ticks still on seed 1, 0 m/s on seed 2.

Done, not phone-verified; the bot and traffic only.
