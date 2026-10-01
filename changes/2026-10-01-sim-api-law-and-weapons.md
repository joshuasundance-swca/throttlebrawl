---
kind: dev
audience: dev
---
Sim contract for M4 cops-3 and weapons-2 (a head start): a race's config can now carry a weapon's behaviour id, its charges, durability, stun and roadside weight, a rider's starting weapon, and the event's tier and `cops` block (mode, base count, tier scale, chaos summon, randomness). Every new field is optional, and absent means today's behaviour, so nothing changes until the sim reads them (next PR) and buildSimConfig fills them in (a follow-up for the app lane).
