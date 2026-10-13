---
kind: fixed
audience: player
---
An installed game now opens its cached copy when the host answers with an error page, including a temporary 503 outage. A healthy network response still brings you the latest game. Existing network wait windows remain unchanged.

Developer checks cover error responses with and without cached content, healthy-update priority and usable cached startup when the network hangs. The browser uses the production boot path, checks the actual service-worker request, and retains hidden-menu and usable-menu controls.

The broader startup candidate, including a shorter page wait, a renderer optimization and the newly introduced five-second first-visible assertion, moved to the separate cached-startup task after timing failures. Its exact test and code are preserved; M5's five-second target remains unchanged and unmet. This repair does not complete offline startup acceptance. Race restoration after a page reload remains separate work.
