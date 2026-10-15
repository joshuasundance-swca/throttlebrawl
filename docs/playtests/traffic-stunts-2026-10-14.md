# Traffic and stunt feedback, 2026-10-14

The build and device were not identified in this feedback. These are the maintainer's observations
and requests, not a reproduced diagnosis or phone verification of subsequent changes.

> btw I feel like there should be oncoming traffic on Morrison in Bridge City. it feels like maybe it's hiding a potentially important constraint that will limit us later. and it's not a one-way street so it doesn't feel right. then again I don't understand why it's currently one-way and I don't fully understand the constraints you're managing.

> oh one other thing doing a wheelie into a ramp should result in backflips similar to launching off of a car

> i5 by lake samish the centermost lanes are wider than any other lane and make it really easy to just cruise between traffic. and the shortcut/alternate route should have a few cars here and there. in general there shouldn't really be roads with no other traffic. the type and density of traffic could vary but no traffic can get boring, generally speaking. plus a few cars on that route would give an opportunity for jumping between the main road and the alternate route, which is a fun possibility.
> oh also I noticed if you ever do 5+ flips you crash. I don't know if it's physics or just because we don't have a handler for that situation lol.
> also I think it would be cool if you could spin during jumps. not sure how viable that is.
> oh and 1st person (helmet view) doesn't move with wheelies, flips, etc.
> also it seems like i5 lake samish race pretty consistently stutters at loading (3, stutter, pause, 3 2 1)
> just feedback I'm giving, you don't need to immediately prioritize or change anything purely because of this feedback, but feel free to work it in appropriately

The maintainer authorized proceeding with the recommendations. `[decided]` Morrison should support
oncoming traffic, and wheelie ramp takeoffs should produce backflips. The other observations remain
inputs to prioritization; they do not authorize declaring a cause or require immediate delivery.

`[default]` Finish and validate the current traffic and ramp work first. Then use Lake Samish to
check sparse alternate-road population, lane dimensions and cross-road vehicle interactions.
Investigate the reported five-flip crash and repeated countdown separately. Consider mid-air spins
and helmet-camera stunt response with camera comfort and readable landings in mind. No cause for
the reported failures, or feasibility verdict on spins, has been established here.
