---
kind: fixed
audience: player
---
The ramp truck behaves the way it now looks. The truck you see has a flat top deck with nothing parked on it, so riding up it slowly you roll along that deck and drop off the end, instead of crashing into a car that is no longer drawn there.

For developers: a fix-forward of #211's F2 half. #211 made the sim's truck body solid past the lip (the model's top-deck car), while render's #209, merged minutes later, removed that car and drew a flat deck at the lip height to the truck's front, matching the sim as it was. Both answered the skeptic's F2, in opposite directions, so main had an invisible solid car on a visibly flat deck. This puts the sim back on the flat deck that render draws (`deckOf` level to `s1`; no body, clear speed or forced crash), keeps #211's remount step-out, and rewrites `src/sim/riders/truck-body.test.ts`: at 3, 5 and 8 m/s a rider rolls up, along the deck at 2.8 m and off the end with no crash or truck contact, and never stops on it; the remount steps out; and a whole-sim crawl over the truck rides on with no crash. The features test's deck profile is back to "level to the front". The split guide (#211's F1 half) is unchanged.
