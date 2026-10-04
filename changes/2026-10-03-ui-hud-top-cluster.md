---
kind: fixed
audience: player
---
The race objective no longer sits on top of the heat meter (playtest 3). On a phone held sideways, the top centre now belongs to the rival's speech bubble alone. The bubble sits at the very top, a little narrower, with tighter lines, and it ends above the road ahead. The objective moves under the pause button on the same side, and the heat badge goes under the objective. In the left-handed mirror, both follow the pause button to the other side. On a small phone the bubble's words drop from 20 px to 18 px. On a laptop the bubble moves down under the objective. On a narrow upright screen the heat badge and the objective move under the bubble, so the rival's bar no longer covers the heat badge. Nothing was redrawn, and every piece keeps its look.

For devs: this clears 7 entries from the HUD layout check's known list (`tests/e2e/ui-style-popups.spec.ts`), plus 3 slow-frames-toast entries the moves cleared on the way: the heat badge and the objective sideways, and the objective upright. The cap is now 10.
