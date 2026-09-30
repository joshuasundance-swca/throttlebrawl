---
kind: dev
audience: dev
---
Contract change for combat-3: `SimBikeDef` gains `knockbackResistance` (0..1, the share of a hit's shove the bike shrugs off) and `hitPowerScale` (scales the shove this rider's hits give), read from the bike file's `combat` block that the content-pack doc and the bike schema already define. `buildSimConfig` always writes them (0 and 1 when the bike has no combat block), so the M2 knockback can scale by the target's resistance as the M2 plan asks. Both fields are optional in the type, so hand-built test configs still compile. The one M1 bike has no combat block, so nothing plays differently yet.
