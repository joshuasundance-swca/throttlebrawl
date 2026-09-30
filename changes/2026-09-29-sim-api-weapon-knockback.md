---
kind: dev
audience: dev
---
Contract change for combat-1: `SimWeaponDef` gains `knockbackMps` and `staggerTicks`, read from the weapon file's `knockback.lateralMps` and `knockback.staggerS` (the block the content-pack doc's weapon example already shows). The weapon schema now names that block (optional; a weapon without it has no knockback and no stagger), and `buildSimConfig` converts the stagger to ticks like the other timing fields. The punch and kick can then carry their shove in data, and the tuning panel's knockback slider scales per-weapon values instead of a hard-coded number.
