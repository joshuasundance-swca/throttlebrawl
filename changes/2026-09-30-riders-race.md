---
kind: new
audience: player
---
Races have a proper start and end. Riders line up on the route's starting grid, positions update live as people pass each other, and everyone gets a place at the finish: anyone still on the road 30 seconds after you finish is placed where they are, and anyone lying in the road is out. Getting busted ends your race and puts you last. Rivals who fall far behind get a slight push and rivals far ahead ease off a little, so the pack stays close; the tuning panel can change how strong that pull is.

For developers: the doc's riders-3 section records the built rules as `[default]` (classification at the timeout, `down` at race end, the law never places, `lapOrCheckpoint` at the route's checkpoints, the rubber-band formula and its two tuning keys). The default rubber-band strength is 0.06 to match ai-1's interim factor, so switching the AI to `rubberBandFactor` changes nothing for a single player.
