---
kind: new
audience: player
---
Wheelies, drifts and backflips now look the part (playtest 3: "a way to do wheelies", "braking into a hairpin... a nice drift like mechanism", "launch you up into a jump doing backflips").

- A wheelie lifts the front wheel exactly as high as the balance model says it is, so what you see is what you are balancing. The rider sits back with his arms straight and his head up, still holding on.
- In a drift the bike slides sideways through the corner with its nose pointing into the turn, and the rider hangs his inside knee out toward the road. The rear tyre leaves a dark skid mark on the tarmac and puffs of tyre smoke. A hard stoppie marks the front tyre. The marks last for the race (about 150 m of them), then the oldest are painted over.
- A backflip has its own posture: sat right back, head thrown back. A front flip is hunched over the bars, chin down.

For devs: `render/riders/index.ts` now reads `EntitySnapshot.wheelie` and `drift` (the rig's guess from acceleration stays for launches and stoppies, and for rivals), and `render/skids.ts` is new: one ring-buffer ribbon (512 quads, 0.18 m wide) and one instanced mesh of 48 smoke puffs, so at most 2 more draw calls, and both are hidden while nothing is sliding. It sits in the riders' lazy chunk, so the first-load JavaScript is unchanged (a built riders chunk, skids included, measured 12.7 KB gzip in all, and no other chunk holds the skid code). `Seating.stretchLean` in `pose.ts` is the new lean limit that keeps the hands on the bars when sitting back. Tests: `render/skids.test.ts`, `render/riders/moves.test.ts` (hand-built parts, no downloads), and `tools/blender/riders/riders.test.ts` runs a wheelie, a backflip and a drift knee on all 272 real rider-and-bike pairs (worst hand 0.064 m off its grip in a wheelie, 0.048 m in a backflip). Not phone-verified: how the slide reads at speed from the chase camera is for the maintainer's playtest.
