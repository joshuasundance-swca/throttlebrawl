# Career event focus

`[default]` Make the next career action concrete using the existing suggested event and Ride button. On the first map presentation, open the suggested event's detail without starting a race. After results, the next map presentation opens the current suggestion instead of retaining the completed event. Keep ordinary redraws, Garage visits, manual event selection and Close under the player's control. Do not change progression, rewards, saves or event selection rules.

## Automated acceptance

- First map presentation shows the actual suggested event's complete detail and enabled Ride action; no ride callback or race starts automatically.
- After results and updated career progress, Map opens the new suggested event's detail. The completed event remains won. When no suggestion exists, no stale event detail appears.
- Selecting another event survives ordinary redraw and Garage/Map navigation. Explicit Close survives redraw. Results resets this presentation choice once; later redraws preserve a new manual choice.
- Extend the real first-event browser journey to check the Results-to-Map detail against the map's current suggestion, deriving content from the packs. Preserve the existing settlement, claimed roads and layout assertions.
- Exercise the Results Next action and confirm it launches the displayed next event. Pause/quit and return through Garage and Menu to Career with the prior result settled once and the same cash and ridden bike.

## Limits

This is a focused continuation and discoverability change. It does not establish human onboarding success, phone thumb reach or useful timing of every combat prompt. The Next action is an integration coverage gap, not a known production defect. Use existing UI and dev seams; add no general focus manager or telemetry.
