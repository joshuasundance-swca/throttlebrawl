---
kind: fixed
audience: dev
---

The cop difficulty check now recognizes an explicit under-limit radar reading as a patrol encounter.
It previously required every patrol to sound a siren and pull out, contradicting the radar trooper's
rule that a lawful rider may pass while he stays parked. The exception requires a real radar cop's
reading for the player, with a finite measured speed at or below its stated limit. Difficulty spawn
comparisons, actual siren leads, the arrival sample floor, and the radar's positive and negative
behavior checks remain. Cop behavior and seeds are unchanged.
