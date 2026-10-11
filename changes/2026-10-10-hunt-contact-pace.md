---
kind: fixed
audience: player
---

Hunts now start with rival pace at least 90% of the bike you chose. A fast bike can still catch the
field, but a competent forward ride gets more time to fight after the opening pass. Faster authored
opposition stays fast. Ordinary races, Grudge, Escape, police, rewards and rubber-band settings keep
their existing rules.

This is a Hunt-only exception to career tier pace. Rival acceleration, steering, personality and
navigation still decide what happens on the road; this does not keep every rival alongside you or
erase a lead after a crash. The 90% floor was the smallest tested candidate, not a universal optimum.

The regression checks the real opening grid with the Superbike on Sunburn Hunt, in authored, career
and generic Quick Play setups. It replays identical forward inputs and measures living targets inside
the punch's reach for its windup plus active phase after accelerating beyond the old field bike cap.
Traffic and unrelated optional systems are isolated, and rival attacks are suppressed for this pace
probe. This does not verify every bike, region, traffic interaction or a phone playtest.

The career configuration tests now assert Hunt's exact bike-derived floor. Their former guarantee
that every event family has the same tier pace is replaced by exact per-event pace, unchanged tier
pace progression and monotonic pace within each event family. Field identity, fighting stats,
ordinary-event pace, police and rewards keep their negative controls.

The all-region career ladder test also replaces its universal exact tier-pace expectation with
Hunt's exact selected-bike floor, derived from the input profile and pack data. Ordinary events keep
exact tier pace, and Hunt rival caps are checked exactly. The garage, field identities, fight and
police controls, shared-road speed bands, seeds and tick budgets stay in place.
