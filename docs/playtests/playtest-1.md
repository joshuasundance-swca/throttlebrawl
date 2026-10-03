# Playtest 1, 1b and 1c (2026-09-30)

> **In plain words.** The maintainer's first three phone sessions, all on 2026-09-30: the M1 build in the morning, then two later builds of main. The notes shaped most of the M2 feel pass. The task-level detail is in [M2.md](../milestones/M2.md); this page keeps the words and the decisions in one place.

Cite these as "playtest 1, 2026-09-30", "playtest 1b, 2026-09-30" or "playtest 1c, 2026-09-30". Every decision below is `[decided]` unless it says `[default]`.

## Playtest 1 (the M1 build), the maintainer's words

- "Camera too low to see oncoming traffic"
- "Road too narrow to easily weave around traffic"
- "Can't kick but kicking should have the effect of moving the kicked over a bit like swerving"
- "Physics of hitting cars not quite right, seems bouncy"
- "Seems like riders can clip through each other"
- "I enjoyed playing intermediate versions too."

Later the same day: "the road doesn't feel too wide on my laptop btw"; "oh and the pedestrians are standing in the water lol"; "it's fun but still a little bit boring, maybe just a bit monotonous and a bit uninteresting. I look forward to some of the details and features that will bring it to life."; "also the shortcut doesn't blend right with the road and it has weird visual artifacts". On the phone camera: "on laptop camera height isn't as big a deal as the phone. I think phone may just be 'harder'." On speed, M1 "felt pretty slow", and the maintainer chose "faster + stronger cues". On the kick: "in road rash there was a kind of momentum or inertia where you could steer into someone and kick and send them further off to the side than a 'normal' kick."

The phone held a steady 60 fps (p95 16.8 ms) on the M1 build. Nothing felt unfair, so rivals, the cop and traffic difficulty stayed as they were.

### Decisions

- **Camera:** higher and further back, so oncoming traffic shows at the reaction range; the sliders stay. It adapts to the screen shape: higher and further back on a wide, short phone view, unchanged on a laptop. (camera-2 in M2.)
- **Road:** travel lanes slightly wider `[default]` for how much; shoulders stay rideable but slower than the road.
- **Kick:** a swipe of natural length (about 150 to 200 ms `[default]`) kicks; a kick that arrives during an early punch wind-up turns it into a kick; a visible kick hint on the attack button. A landed kick shoves the target about a lane width sideways; punches stagger instead. A kick while steering into the target adds the attacker's own sideways speed, clamped (the momentum kick, with a slider).
- **Cars:** a solid head-on or rear hit throws the rider off; a side brush wobbles and slows; no rubbery rebound.
- **Riders:** solid bumps instead of overlap; side contact pushes both apart and wobbles them.
- **Speed:** the starter bike's top speed goes to about 100 mph, with a top-speed scale slider; speed cues: a speed-scaled field of view, road streaks, wind sound rising with speed and denser roadside objects, each a slider.
- **The pause screen** shows the keyboard controls; the in-race HUD never does ("don't clutter the in-game HUD with those controls").
- **Quick wins:** speed-boost pads, and a jumpable car-carrier ramp ("jump over a tow truck, the kind that tows multiple cars and looks like a ramp from behind").
- **Looks are settings:** selectable looks built on shared models; the default is picked by playing.

## Playtest 1b (main, later that day)

- "kick still doesn't seem to work on the phone (maybe the changes aren't implemented?) I managed to do it once but only once. maybe it needs adjusted."
- "it's strangely difficult to get on the shortcut. like you've got to get way over to the right or you can't pass through onto it. you get forced away like it's a barrier."

Decisions: land the kick's input half; fix the shortcut's invisible barrier (no steering pushback in split zones, a clean handover between the branch edges, the split zone drawn); keep pedestrians on land; boost pads and the car-carrier ramp with placeholder geometry; the favourite look, "Ink + 1960s film grade", built as a playable look beside Classic.

## Playtest 1c (main, that evening)

- "The little pop-ups about near miss etc get in the way of seeing what's ahead. Maybe they could be less intrusive and/or less centered"
- "The trees don't look great and it can still get visually monotonous. Maybe that's partly just because we don't have a lot of models and textures yet. It also feels like the bikes accelerate slowly. And I want randomness so you don't see the same cars in the same order, ramp truck in the same place, etc"
- "they are also mostly inappropriately placed, in concrete floating in the river lol"
- "Cool I'd like to also watch oncoming go up and up as you ride"
- "Not big on the cracked, rust, grime"
- "I do think we should start adding other regions races etc to avoid over optimizing, keep things fun, ensure everything works", then "Pnw and sf first then others" and, for new race types, "These can wait until later".

### Decisions

- **Acceleration:** retune the launch.
- **Randomness:** each race gets a fresh seed, saved in the replay so determinism holds; traffic, set pieces and scenery scatter follow it. Self-tests and fixed-seed tests stay fixed.
- **Scenery** goes on land or verge only: never on bridges, the road or water.
- **The model pipeline starts** ("We can start"): Blender scripts, a first Keys scenery pack, flat colours so every look applies, every AI-made asset logged in `THIRD_PARTY_ASSETS.md`.
- **Looks:** "sun-bleached wasteland ink" and "Kodachrome brush ink" join the switch. No crack, rust or grime textures.
- **Regions now:** the Pacific Northwest and San Francisco first, crude, as content packs; new race types wait. See [the roadmap](../roadmap.md#regions-alongside-the-milestones).
- **A live oncoming counter** ticks up while you ride the oncoming lane.
- **The phone pause screen:** the keyboard legend must not hide the "cut this" list.
