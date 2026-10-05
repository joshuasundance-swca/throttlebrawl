---
kind: changed
audience: player
---
The amber target box is gone. It was drawn over the rider a tap would hit, and the maintainer found it disruptive and ugly. Taps still hit the closest rival on either side, and the swipe sides work exactly as before; there is simply nothing drawn on the rival. For devs: `src/render/aim-marker.ts` and its test are deleted and render no longer draws a marker; the sim still publishes `EntitySnapshot.aimId` (tested in `src/sim/combat/aim-preview.test.ts`), so a later faint cue can read it. Not browser-run; not phone-verified.
