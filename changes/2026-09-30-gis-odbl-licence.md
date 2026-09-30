---
kind: dev
audience: dev
---
Groundwork for the real-road side quest (gis-1): the base pack's `licenseRules` now put every `osm-` prefixed network, road and route file under the Open Database License with the OpenStreetMap attribution, the licence text lives in `packs/base/LICENSES/ODbL-1.0.txt`, and THIRD_PARTY_ASSETS.md lists the OpenStreetMap road data and the USGS elevation. The rule's paths go beyond the doc's example (roads only) because a baked stretch also needs its own network and route files, which carry OSM-derived data too. The content test that listed every road now lists only the hand-made ones, so the OSM roads can sit beside them.
