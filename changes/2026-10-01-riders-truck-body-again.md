---
kind: fixed
audience: player
---
The ramp truck is solid again past its ramp, matching the truck you see: the car parked on its top deck is really there, so riding up slowly you bump it and fall off rather than passing through it.

For developers: this reverts #214. The render and road lanes each fixed the skeptic's F2 twice, in opposite directions, minutes apart: #211 (sim: a solid body past the lip) and #209 (render: no car, a flat deck); then #212 (render: the car back, matching #211) and #214 (sim: the flat deck back, matching #209). After #214, main drew the car while the sim rode a flat deck through it, the original F2. This restores #211's sim body, which #212's render gates check against (the platform at the lip height, the car roof at the body's top on all 7 live truck spots). Final state: sim and render both have the top-deck car, solid.
