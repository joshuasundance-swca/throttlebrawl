---
kind: dev
audience: dev
---
Road and pack checks now discover shipped content rather than requiring a fixed number of regions,
networks or routes. Existing licensing, geometry, replay and pedestrian checks remain; authored
traffic mixes may reuse base vehicles, and patrol-lot checks use the course's authored bounds.

The default route description now works for map-derived event routes too. A rider can explicitly
reuse an existing body model while keeping their own identity, role and motorcycle.
