---
kind: dev
audience: dev
---
Road and pack checks now discover shipped content rather than requiring a fixed number of regions,
networks or routes. Existing licensing, geometry, replay and pedestrian checks remain; authored
traffic mixes may reuse base vehicles, and patrol-lot checks use the course's authored bounds.

The default route description now works for map-derived event routes too. A rider can explicitly
reuse an existing body model while keeping their own identity, role and motorcycle.

Ground closure is checked from actual geometry, not inferred from total elevation change; the
floating-ground negative control remains. Model replacement checks apply to asset-backed scenery,
while procedural trees keep their own mesh checks. The browser picker inventory comes from live
region files, and Clinton joins the rendered race and replay regression cases.

Explicit rider body names accept both a short model name and a full rider asset id, preserving
model retry and presentation retirement behavior. The light-eligibility fixture opts its probe
into road events explicitly, so a region can intentionally ship without random road events.
Board-copy checks read every region without fixing the region inventory size.
