---
kind: new
audience: player
---

Longview gets a separate city-street race. Washington Way offers the direct diagonal;
Hudson Street and 20th Avenue offer a longer grid detour, with a boost pad after its
corner. Both meet again before the bridge and the northbound 30th Avenue finish.
The detour has ordinary traffic in both directions, and rivals can choose it too.

The streets use OpenStreetMap alignment and new USGS terrain samples. Corner easing,
lane widths, generous soft margins and the bridge guardrails are game adaptations.
The roadside town scenery is generic, rather than a claim about mapped properties.
Port Shift stays available as a separate course.

Traffic occupying a receiving lane keeps priority. A car holding a junction can then
clear it before an upstream merge claim, preventing a queue from locking the exit
while waiting for that same junction. Whole-body receiving-space checks still apply.
The regression follows one actual vehicle generation across the complete detour in
each direction. Its three-minute simulation watchdog allows dense queues to clear;
the old arbitration still fails at that same bound.
