---
kind: changed
audience: dev
---
cops-1 follow-up: Sgt. Pruitt now comes alongside, so you can knock him down. Before this he only ever hung back at the follow gap, out of reach of any punch or kick. Now, after 8 s on station behind his target he moves in and rides 1.2 m beside him for 6 s (inside punch and kick reach, holding his line firmly against knockback), then drops back to the gap. If you go down while he is alongside, he is right there: that is the risk. His health is now 100, like the rivals, instead of 120.

Tested end to end with the merged combat and tumble systems: punches and kicks land on him, knock him off, he tumbles, runs back and rides again; and a swerve into the barrier with him alongside ends in a bust within 8 s. 22 cop unit tests in all; the 50-race bust-rate batch still reads 0% (the stub bot never crashes and he never catches it).
