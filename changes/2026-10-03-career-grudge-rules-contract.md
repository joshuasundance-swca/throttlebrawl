---
kind: changed
audience: dev
---
Contract for grudges with rules and a world that keeps receipts (the pitch deck's #14): a closed list of rival rules in `core` (`audit`, `bad-connection`, `collab`, `timber`), an optional `rules.rule` on a grudge-match event (only a grudge match may carry one), `SimEventDef.grudgeRule` (the rule and its rival; only Dial-Up's `bad-connection` changes the sim), a `badConnection` sim event (the modem screech, the drop, the reconnect) and an additive `receipts` list in the career profile (a rival put into traffic, or a bust, and where; no version bump). Nothing uses them yet: no event names a rule, the sim ignores the field, and no receipt is written until the grudge-rules lane lands. No replay hash moves.
