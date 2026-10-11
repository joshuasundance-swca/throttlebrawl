---
kind: fixed
audience: player
---

Escape objectives now follow whom the police are chasing, including between attacks and when a cop
is unarmed. A pause in fighting no longer counts as losing a cop who is still on you. Career cards
also name reaching the finish as a way out and stop describing an ordinary fall as an automatic loss.

The regression tests separate pursuit from combat, keep the finish, jurisdiction and bust controls,
and complete an authored survival objective with unarmed cops before the finish. The existing card
text check now protects the corrected rules, including the distance objective.
