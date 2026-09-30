---
kind: new
audience: dev
---
The real-road side quest (gis-1) has its first stretch: about 6.8 km of the real Overseas Highway (US 1) from Bahia Honda Key over the 2 km Bahia Honda Bridge, across the Spanish Harbor Keys and the 1 km Spanish Harbor Channel Bridge, to the bend onto Big Pine Key. It is baked from OpenStreetMap plus USGS land elevation into the same road format as the hand-made track, as the network `osm-keys-bahia-honda` and the route `osm-bahia-honda-run`. It is an alternative route only: no event uses it yet, and the hand-made road stays the default. The bot finishes a race on it in about 3 minutes.

The Keys data probe came first (`tools/gis/probe/keys-us1.md`): US 1 is continuous and well tagged in OpenStreetMap, but mostly straight and flat, and long bridges are drawn as a few straight segments. So the bake smooths the line, shortens long straights on land, and synthesizes the bridge decks and humps (the elevation data is bare earth, which has no bridges). The humps are exaggerated for fun and are not measured heights.

The pipeline is its own small Python project in `tools/gis/` (fetch once, bake offline, never at runtime). Every baked file names its sources, query, retrieval time and hash in `provenance`, and OSM-derived files carry the `osm-` prefix for the ODbL licence rule.
