---
kind: dev
audience: dev
---
A new sim test rides every region's routes and, 0.1 s after each take-off, holds the brake to the ground or the kick for 0.35 s, the way the verifier crashed jumps on San Francisco seed 1. No held jump may go down (seed 1 on main: 0 of 10 for each). On the code from before the fix (#284's first air control) the same test fails: 4 of 10 brake-held jumps and 1 of 12 kick-held jumps went down. The fixture ramp and crest already hold the same bar (src/sim/riders/air-safety.test.ts); this one holds it on real crests and bends.
