---
kind: fixed
audience: player
---
An installed game now opens its cached copy when the host answers with an error page, including a temporary 503 outage. A healthy network response still brings you the latest game.

Page loads give the network half a second before opening the installed copy, leaving more time to load and draw on a weak connection. A timely new page still wins; without a cached page the game continues waiting for the network. Manifest and changelog requests keep their existing network window.

Developer checks cover error responses with and without cached content, healthy-update priority and cached startup when the network hangs. Startup timing uses the production boot path and the first visible-screen event recorded in the page, with hidden-menu and usable-menu controls. Race restoration after a page reload remains separate work.

Road scenery construction now reuses an exact nearest-sample index instead of repeatedly scanning entire road edges. Road clipping, endpoint handling and equal-distance choices stay the same; checks compare the resulting projections against the original linear lookup and include index construction in the coordinate-work control.
