---
kind: changed
audience: dev
---
The rivals are ready for the career's gentle fight climb, and for roads they should not take. A race can now carry a field level: every rival's aggression is scaled by it (about 10% off at a region's first tier up to about 20% on by its last, the career picks the numbers), and each signature move's gap is scaled too, so lower means Chad films himself more often. A race without one rides exactly as before.

A route can also say how many rivals take a branch (`aiTake`, 0 to 1). A branch with a gap in it and no `aiTake` is shut to every rival who is not bold (a risk of 0.8 or more), and to the law. The cops do not take a branch the rule shuts: they stay on the highway and meet you where it rejoins.

For devs: `sim/ai/level.ts` (the scales, held to a sane range), `sim/ai/branches.ts` (the one rule), `signature.ts` (the gap scale, stored only when it is not 1 so no hash moves), and one line in `sim/cops/index.ts`'s `drive` that keeps a barred cop's line out of the split zone. Cops do not share the rivals' shortcut roll, so that edit was needed. A real route that must keep everyone on the highway, such as the Old Seven Mile Bridge, still has to name `aiTake: 0` in its route file, since the bold would otherwise try it. Content docs: `content-packs.md` (`aiTake`) and `architecture.md` (controllers).
