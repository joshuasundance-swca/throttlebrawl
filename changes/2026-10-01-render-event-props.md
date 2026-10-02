---
kind: dev
audience: dev
---
Render draws the road events' props from `SimSnapshot.props` (W-P): cones, road flares that glow, sawhorses, hay bales and a truck's stacked hay, an arrow board and a flashing light bar, a radar on a tripod, the people (a flagger with a SLOW paddle, a cop waving traffic by, marchers in each region's costume), each region's float dressing (a Keys flamingo or conch shell, a San Francisco launch stage with a loading ring, a Pacific Northwest log with a carved bear), San Francisco's giant inflatable, and the warning signs with their words. Code-made flat-coloured boxes on the `prop` material, one instanced mesh per shape, so a live piece costs a few draw calls and a race without one costs none. `RendererStats.eventProps` reports what the last frame drew.
