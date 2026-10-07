---
kind: fixed
audience: player
---
Road events are solid where they are drawn. You no longer ride through a parade's marchers, the flagger, the cop waving traffic by, a warning sign or the speed trap's radar as if they were not there. A sign or the radar is a wobble (the radar goes flying; a sign stays put). A person who has not stepped aside in time is a soft wobble, never a crash, and they stumble out of the way. A lane vote gantry's post is solid like a lamp post: slow, a wobble; fast and square on, a crash. Its far post, which stood in the oncoming lanes, is gone: the gantry now reaches over the road from one side. Signs now stand beside the road, not in the outer lane. A parade float's skirt is now exactly the float's size; it used to hang half a metre past the float, so you could ride through the overhang. The work truck's arrow board now fits the truck. The flagger's and marchers' waving arm now waves overhead, instead of swinging out at you.

The two ramp-truck shortcuts, the Plaza Cut and the Mill Yard Cut, are proven makeable on the starter bike. From 200 m back you reach the truck's lip at about 34 m/s, and the jump needs 20 m/s. Nothing about them changed.

For devs: `PROP_CONTACT` and `propBoxes` in `src/sim/modifiers/setpieces.ts` give every `PropKind` its rule and its boxes. The rules are `light`, `standing`, `dodges`, `solid`, `hop`, `vehicle` and `overhead`. `meetLight` and `bumpPerson` handle the sign, the radar and people. `publishSolids` publishes the gantry's post and the floats' centrepieces each tick into `PIECE_SOLIDS_KEY` (`src/sim/riders/features.ts`). `solidHazardsNear` takes the world and meets them as solid road hazards; it is a small edit in `src/sim/riders/index.ts`, the riders' own folder in the sim lane. `ON_VEHICLE` holds where each prop rides on its vehicle, and `standSignsOff` moves a sign past the outermost lane at its spot. PR #641 does the same, more thoroughly, across every road. The new tuning switch `modifiers.propContact` is on by default; a race whose tuning leaves it out rides as before.

On the render side (`src/render/event-props.ts`), the gantry frame is a cantilever (`GANTRY_POST_OUT_M`). The float skirt is the float's size, by theme, and the SF float's ring is narrower. The arrow board is 2.25 m wide. The radar's placard sits under its head. The paddles and placard are held closer to the body. `signPanel` is exported for the tests.

Tests:
- `tests/sim/set-piece-ride-column.test.ts` is the ride-column check's twin. It rides Key West, the San Francisco hills and Bridge City with every set piece forced in. It draws each prop alone with `EventProps`, and fails on a drawn part in the lanes with no sim shape, and on a sign in the lanes. On main it named 62 props (30 on Key West, 13 in San Francisco, 19 in Bridge City). Its negative controls are hay drawn without its truck, and a skirt 1.5 m wider than its float; both are found. The same skirt at the float's own width is not.
- `scripts/set-piece-shapes.test.ts` holds every kind's drawing inside its boxes, or its vehicle's box, for every pair the packs ship. It holds each box within 0.15 m of what is drawn in it. Its negative controls are the old skirt, a box twice a person's width, the old radar placard and the old far post.
- `src/sim/modifiers/prop-contact.test.ts` rides into each new kind by sim ticks. With the switch off, each ride meets nothing.
- `tests/sim/ramp-truck-cuts.test.ts` finds every ramp-truck shortcut on every network and rides each from its approach. Its control at an 18 m/s lip hits the wall.

Not phone-verified.

The keeper, after train 426: `tests/sim/batch.ts`'s `ISOLATED` profile turns the new switch off (`'modifiers.propContact': 0`), as `tests/sim/isolation-profile.test.ts` asks of every `system: true` switch. Its seeded tests already ran without road events (`modifiers.setPieceChance` 0), so none of them moves.