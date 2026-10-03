---
kind: fixed
audience: player
---
A grudge match's career card now says what its rule actually judges, so the line under the rule card never contradicts it (the live check after #394):
- **The Collab** (San Francisco) read "Beat Chad Speedwell to the line." right under "Most style at the line wins". It now reads "Have more style cash than Chad Speedwell when you cross the line."
- **Timber** (the Pacific Northwest finale) said "knock Old Growth down three times", but fists don't count. It now says "knock Old Growth into traffic or scenery three times".
- **The Audit** (Keys) now adds "plus one per hit you take (up to two more)", so the count on the card matches the HUD's line items.
- Dial-Up's Bad Connection was already right and is unchanged.

A unit test checks every grudge-rule event on the career maps for the same kind of contradiction.
