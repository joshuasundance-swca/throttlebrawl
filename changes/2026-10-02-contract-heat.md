---
kind: changed
audience: dev
---
Contract for the cops' heat meter (playtest 2): the sim snapshot gains `law` (the player's heat, 0 to 1, its tier, 0 to 3, and whether a chase was shaken off), the event list gains `heat` (the tier changed), and an event's `cops` block gains `heat` (the meter on or off). Nothing fills them yet: the heat stays at zero until the meter lands.
