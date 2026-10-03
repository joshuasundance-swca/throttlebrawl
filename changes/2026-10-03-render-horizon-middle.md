---
kind: new
audience: player
---
The horizon moves now (pitch 6, "the horizon comes alive"):
- In the Keys, shrimp boats trawl up and down with their outriggers down, and a red-and-white seaplane comes in low over the water and lands, then does it again.
- In the Columbia River Gorge, a long freight train rolls along the far bank, and on the Pacific Northwest's own road one runs along the far shore of the sound. The ferries still cross.
- In San Francisco, fog pours over the Marin Headlands toward the Golden Gate and over Twin Peaks into the city, in slow tongues that slide down the slope and thin out. Headlights and tail lights crawl across the Golden Gate and both halves of the Bay Bridge.

Each of them runs end to end and fades into the haze near the end of its run before it comes round again, so nothing pops in or out. All of it is part of the backdrop's single mesh: it adds no draw calls and nothing per frame. It adds triangles to that mesh: about 200 in the Keys, 1,000 to 1,400 in the Pacific Northwest, and 1,900 to 2,400 in San Francisco (counted by building every network's backdrop with and without the new pieces).

For pack authors: the backdrop data gains a `train` kind, an `aircraft` kind (a seaplane), a `shrimper` vessel style, a `pour` cloud style and a bridge's `traffic`. A moving piece is left out when any part of its run comes within its keep-out distance of a road. Checks: each region's networks build their movers, every moving vertex keeps 150 m from every road at both ends of its run, the seaplane's floats end the run at the water, the train rides level, and nothing glides faster than 60 m/s.
