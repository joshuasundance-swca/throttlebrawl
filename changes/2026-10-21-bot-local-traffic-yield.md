---
kind: dev
audience: dev
---

The robot test rider can yield a short distance toward a clear edge of its own lane when stopped
opposing traffic is waiting for it. Previously, both could remain stopped in a wide alley. The
robot keeps its normal passing checks, waits for moving oncoming traffic, and limits the yield
to a slow local movement before waiting for the queue to clear.

Snapshots expose derived physical footprint lengths and widths for riders and registered traffic.
The local yield checks those bodies at their actual headings, including long and sideways vehicles
whose centres stand outside the nearby gap. Missing or invalid geometry leaves this recovery waiting.
When already touching a body, the robot only yields away along the shallowest overlap axis, so a
clear destination does not allow it to push deeper through the body on the way there.
