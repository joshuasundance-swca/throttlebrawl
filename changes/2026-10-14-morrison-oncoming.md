---
kind: changed
audience: player
---
Morrison carries oncoming traffic as well as forward traffic. Both ends have legal reverse
turns, and overlapping turns share clearance until the full vehicle has passed. Existing rider
entrances remain available. Traffic asphalt follows the existing shortcut surface where they overlap.

For devs: reverse traffic movements are authored in the GIS source and validated against lane
direction and position. The bot shares rivals' and cops' road projection across short connectors.
Traffic views reuse unchanged physical lane ranks without writing simulation state.

Tests cover ambient oncoming cars, a continuous reverse trip, opposing long vehicles at varied
arrival times, separate road heights, original rider links, vehicle reuse and geometry. The parked
obstruction control now starts its waiting car on the approach outside the expanded clearance zone.
The original forward-only assertion now protects the forward connector while reverse branch access
has its own checks. Regional width checks retain ordinary four-metre lanes and read dedicated turn
widths and directions from the source configuration.

This changes simulation and replay identity. Career and settings formats, rewards and rival pace
are unchanged. Desktop checks do not establish phone feel or the branch's resulting time advantage.
