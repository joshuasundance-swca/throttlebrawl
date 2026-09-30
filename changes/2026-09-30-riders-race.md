---
kind: new
audience: player
---
Races have a proper start and end. Riders line up on a starting grid, positions update live as people pass each other, and everyone gets a place at the finish: anyone still on the road 30 seconds after you finish is placed where they are, and anyone lying in the road is out. Getting busted ends your race and puts you last. Rivals who fall far behind get a slight push and rivals far ahead ease off a little, so the pack stays close; the tuning panel can change how strong that pull is.

For developers: the doc's riders-3 section records the built rules as `[default]` (classification at the timeout, `down` at race end, the law never places, the rubber-band formula and its two tuning keys). The route handle does not expose the route file's `startGrid` yet, so the grid is read from it when present and otherwise uses two per row, 8 m apart.
