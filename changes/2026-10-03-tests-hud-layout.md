---
kind: dev
audience: dev
---
The browser tier now checks the whole race HUD's layout, not only the style pop-ups. On a phone held sideways (the default look), a phone held upright and a laptop, during a real career race, it measures the painted box of every HUD widget and overlay: the speed, position, health and pause pieces, the touch buttons, the objective line, the career prompt, the heat badge, the pop-ups, the bark bubble, the slow-frames toast, and the landing one-liner (read from the sprite three.js draws). No two may overlap, and none may sit in the road ahead. It measures three moments: the race's start, once the heat badge is up, and while a landing line shows. Overlaps that main already has are named in a known list that can only shrink. The existing pop-up spec was extended rather than copied, and its negative control now also plants overlapped widgets. Playtest 3 found the race objective sitting over the heat meter; this check would have caught that.
