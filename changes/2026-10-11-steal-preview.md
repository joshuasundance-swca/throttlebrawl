---
kind: changed
audience: dev
---

The simulation now names the weapon holder a fresh attack would try to steal from on the next
combat tick. This presentation-only preview uses the same selection as the steal itself, including
weapon timing, reach, player readiness and release before a new press. It prepares the existing
weapon glint to show a useful opportunity without changing attacks, steals or ownership.

Movement or another thief can still change what happens before the press resolves. Focused tests
cover inclusive window edges, scaled time, hit-stop exit, stagger and recovery, competing holders,
full hands and unchanged replay state when snapshots are read repeatedly.
