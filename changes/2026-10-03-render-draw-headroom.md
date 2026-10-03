---
kind: dev
audience: dev
---
Busy road scenes draw the same things in fewer draw calls. The live check found the busiest scene (a Keys roadwork beside a speed trap: 23 event props and three signs) at 109 of the 120 draw calls the perf check allows.

- Road event props are batched. The props standing still go in one mesh, the moving ones (a waving arm, a rolling log, a float's dressing) in a second, and every warning sign's panel in one mesh over a shared texture of up to eight signs. That roadwork scene's props were 11 draw calls; now they are 3. A parade is 4 however many props it has. The still mesh is rewritten only when something changes, so props standing still cost nothing per frame.
- The roadside smashables share that still mesh, so they add no draw call of their own (they were one per kind standing).
- The road leaves its lane markings, dashes and thin posts out of any 512 m chunk wholly farther than 300 m from the camera. At that distance a 0.15 m line is about a fifth of a pixel and only showed as broken dots. Measured from a chase camera every 25 m on four routes (Keys standard and skeleton sprint, the PNW sawmill haul, SF standard), this saves a median of 3 to 5 draw calls per view, and up to 12.
- Traffic shapes, smashed-prop debris and event flares are not drawn while all of their instances are out of view (behind the camera, say). This is unmeasured locally.

The look is unchanged: the same shapes, colours and materials, and the signs keep their unlit panels. Not phone-verified.
