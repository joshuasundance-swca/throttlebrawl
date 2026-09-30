---
kind: dev
audience: dev
---
Sim contract for M2 traffic-3: each traffic type in a race's config now carries its `weight` from the event's region file (the `traffic.mix` list for cars and trucks, `pedestrians` and `animals` for the roadside). A type the region lists nowhere gets 0. The field is optional, so hand-built test configs keep the sim's own category defaults. Nothing reads it yet; the traffic lane's next change does. Today's Keys weights equal the old defaults, so races come out the same.
