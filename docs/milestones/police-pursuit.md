# Police pursuit and Escape scoring

[default] Repair the live-check finding that Escape scoring reads a combat target as a police pursuit target. Keep those meanings separate. The contract lands before its career consumer.

## Automated acceptance

1. An additive optional `EntitySnapshot.pursuitTargetId` reports the police system's current target while the cop is actively chasing; otherwise it is `-1`. Combat `targetId` keeps its existing meaning. Snapshot reads do not mutate state or consume randomness.
2. A real-sim test observes an idle, unarmed cop pursuing the player before the finish. Its combat target stays `-1`, while its pursuit target is the player. Parked siren lead, non-law riders, inactive pursuit and NPC pursuit are negative controls. Same seed/input remains deterministic.
3. The subsequent career consumer starts survival/distance tracking from pursuit, including when the cop is not attacking. A combat-only target, a parked cop and an NPC pursuit do not start the clock. A continuous chase cannot become lost heat merely because attacks stop. Genuine pursuit cessation, jurisdiction and bust controls retain their behavior.
4. A focused real-sim Escape regression wins through pursuit survival or distance before finishing, with a cop's attacks disabled. The test advances simulation ticks, uses the isolated profile where appropriate, and preserves the finish fallback independently.
5. Existing CI gates, budgets and leak scan remain green. The coordinated served check observes the Escape objective and completion, rather than inferring pursuit from an attack or a siren alone. Phone verification remains with the maintainer.
6. Career objective text describes the actual escape conditions, including reaching the finish. A fall alone is not described as a loss condition; a bust still fails the event.

## Sequence

The sim snapshot contract and its tests land first. The career scoring change and its regressions follow on that contract. No save format, pack schema, dependency or global police behavior changes.
