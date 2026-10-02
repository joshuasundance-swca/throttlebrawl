---
kind: dev
audience: dev
---
A region file can give an area of its roads its own traffic: `traffic.areas` lists a road tag (such as a Keys district, `key-fishing`) and the mix that replaces the region's mix where that tag covers the road. The weights reach the sim on each traffic type as `areaWeights`, by tag. Nothing uses them yet; the next change gives each of the four keys its own traffic.
