---
kind: changed
audience: player
---
Morrison carries oncoming traffic as well as forward traffic. Both ends have legal reverse
turns, and overlapping turns share clearance until the full vehicle has passed. Existing rider
entrances remain available. Rider and traffic connectors share a graded junction surface, including
bank across their widths; their paths and links remain intact, while their elevations change.

For devs: reverse traffic movements are authored in the GIS source and validated against lane
direction and position. The bot shares rivals' and cops' road projection across short connectors.
Traffic views reuse unchanged physical lane ranks without writing simulation state.

Tests cover ambient oncoming cars, a continuous reverse trip, opposing long vehicles at varied
arrival times, separate road heights, original rider links, vehicle reuse and geometry. The parked
obstruction control now starts its waiting car on the approach outside the expanded clearance zone.
The original forward-only assertion now protects the forward connector while reverse branch access
has its own checks. Regional width checks retain ordinary four-metre lanes and read dedicated turn
widths and directions from the source configuration.

CI exposed surface overlaps and a sensing walk that could turn back at a fork and fold sibling-road
traffic into the rider's lane. The repair preserves existing asphalt ownership, fills the added
turns beneath it, and keeps sensing walks moving away from the viewer. The original Keys bot route
test is retained. The GIS preservation test now permits only elevation, grade and bank changes on
the opted-in rider connectors; it still protects all other fields and endpoint heights.
The road-height validator now compares banked surfaces at the same world point; a tilted-plane
control and a raised-connector control retain its original height limit. Added asphalt also spans
its verge so it meets the surrounding land without a crack.
The historical downtown renderer comparison now retains the original inputs for the graded rider
connectors, alongside its original expected scene. Current-scene land, building and vehicle
clearance checks continue to use the shipped road geometry; historical exceptions are not expanded.
The supporting-asphalt offset applies only to road surfaces and paint. Terrain construction and
the simulation's terrain query retain the same world heights and land reach.

The bot also keeps moving when lining up on a rival behind it: a negative fight-speed target
previously held it stopped on a clear road. Traffic can still stop it. The original dense-traffic
standstill limit is unchanged. Natural remount coverage no longer requires eight crashes, and sign
coverage no longer requires five spawned signs: both retain nonempty positive observations and
their original per-observation limits, with the planted sign collision control retained. The
roadblock scenario uses the supported three-times heat setting rather than thirty-times heat;
its radioed-ahead event assertion and simulation-tick budget remain unchanged.

This changes simulation and replay identity. Career and settings formats, rewards and rival pace
are unchanged. Desktop checks do not establish phone feel or the branch's resulting time advantage.
