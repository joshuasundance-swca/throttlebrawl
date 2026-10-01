---
kind: dev
audience: dev
---
The contract for road set pieces (W-P events: roadwork, crash scenes, parades, a hay truck, speed traps). `SimConfig.modifiers` now carries resolved `event-modifier` entries (`SimModifierDef`: chance, progress window, duration, weight and effects) instead of an always-empty list, `SimEventDef.modifiersPerRace` caps how many fire in one race, and `SimSnapshot.props` lists the set pieces' props in play (cones, flares, signs, hay bales, the people who work them) for render to draw. The content schema adds one effect kind, `set-piece`, whose `piece` is a closed list in sim/modifiers. Nothing fills these yet: the sim still carries an empty list and an empty props array.
