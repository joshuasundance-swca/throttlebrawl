---
kind: new
audience: dev
---
A race can now run on a real road instead of its event's own road (the maintainer, 2026-10-01: "Yes, add as routes"). `RaceSetup.route` names a route; `realRoutes` lists the routes it may name for an event: the routes on networks baked from map data (`tools/gis`) whose `region` is the event's region, in the race's packs. Anything else falls back to the chosen race length's route. The chosen route lands in the recording's header (`event.routeId`) beside the seed, so replays and resumes rebuild the same road. `routeChoices` gives the menu's coming route picker its list: the region's hand-made road first (the default), then each real road by name, with the real road or streets it follows and its length. Today the Keys offer one, the Bahia Honda stretch of the Overseas Highway; the Pacific Northwest and San Francisco roads land next.
