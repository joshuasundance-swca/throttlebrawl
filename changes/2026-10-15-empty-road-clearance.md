---
kind: changed
audience: dev
---
Road scenery skips repeated ground-clearance probes when the whole strip has no neighboring-road
candidates. Any neighboring candidate retains the existing clipping search, including height and
filter checks. This reduces empty-space work during scene construction without changing the sampled
Keys and Samish geometry. Curved joins, both strip directions, cold and warm queries, and actual
lower-road clipping are checked against the previous search.

The production cached-startup check keeps its exact five-second target. This work does not claim
that the CI timing failure or the Lake Samish countdown hitch is resolved.
