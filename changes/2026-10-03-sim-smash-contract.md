---
kind: changed
audience: dev
---
Contract for roadside smashables (the pitch deck's "the road fights back"): a closed list of smashable kinds in `core` (lobster traps, mailboxes, parking meters, a startup's pop-up desk, cafe tables, a firewood stand), an optional `smashables` list in a region file (each with its takedown name, such as CATCH OF THE DAY, and vetoable like signs), `SimConfig.smashables`, `SimSnapshot.smashables` (where each one stands and whether it is smashed) and a `smash` event that names the takedown when a rider is knocked into one. Nothing fills them yet: no region lists any, and the sim places none until the smashables land.
