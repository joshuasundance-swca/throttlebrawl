---
kind: fixed
audience: player
---
Two road fixes. Steering early and hard for the shortcut no longer slams you into an invisible wall: the road's edge now guides you along it from 90 m before the split, not 15 m, in the Keys, the Pacific Northwest and San Francisco. And the ramp truck is solid past its ramp: ride up it slowly and you bump the car parked on top and get thrown off, instead of rolling along inside that car; fast enough off the lip and you fly over the whole truck as before.

For developers: `SPLIT_GUIDE_LEAD_M` goes from 15 to 90 (the integration skeptic's F1); `tests/sim/road-split-early.test.ts` sweeps 40 early commits per live shortcut (45 to 80 m out, steer 0.35 to full lock, assist off and light: 8, 11 and 0 met a wall before, 0 now), and the split-guide unit test's "well before the zone" spot moved with the lead. The truck past a 0.45 m lip platform is its body (the skeptic's F2), with its top at the model's car roof: a grounded rider coming off the deck into it crashes; an airborne one too slow to clear the truck (`truckClearMps`, about 10 m/s) crashes into it; a faster one never lands on it; and a rider put down inside a truck (tumble's remount) steps out beside it. `src/sim/riders/truck-body.test.ts` covers each, plus a whole-sim crawl, bump, remount and ride on. The features test's deck profile moved with it.
