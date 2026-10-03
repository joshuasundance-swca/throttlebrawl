# Playtest 3 and its interview (2026-10-03)

> **In plain words.** The maintainer played a lot, finished the whole career in one evening, and found it too easy: a few easy wins bought the fastest bike, with no struggle after that. Text pop-ups and HUD pieces covered the game. Three interview rounds that day decided a career with real progression and seasons, a single ticker for pop-ups, wheelies, a first-class drift, real places, six bikes, and the Keys' Seven Mile Bridge with jumps between the old and new spans.

Cite this as "playtest 3, 2026-10-03". Every answer is `[decided]`; the bracketed readings after an answer are what the maintainer was shown and chose. The coordinator's own calls are listed separately as `[default]`.

## The maintainer's words

"I've actually been playing a lot. I finished career last night and I've played more today. The progression doesn't feel right. I won a few easy races and then bought the fastest bike. No struggle, no increasing difficulty, etc. The race objective sits over the heat meter. The black and white text pop-ups block the actual game. Things like bike riders cause collisions when they should arguably get out of the way off the sidewalk etc. I'd love a way to do wheelies and if you wheelie into the hood of a car it should launch you up into a jump doing backflips. Braking into a hairpin at speeds makes a nice drift like mechanism and we should consider that a first class experience. The ramp trucks could be in motion and the static one could be used to get to shortcuts or something. In the keys I think the 7 mile bridge has an old road parallel to it. Jumps could let you get from one to the other. I have a lot of ideas and feedback I'm not thinking of. Feel free to ask questions, make suggestions, etc.

I'd like more variety and real world content in the races. Plus everything just needs more polish and variety. Maybe codex could create and optimize textures and models etc."

## What it settled at once

- **The HUD rule:** nothing covers the road ahead or overlaps another HUD piece, and pop-ups do not get bigger. The race objective must stop sitting over the heat meter.
- **Traffic manners:** cyclists and pedestrians get out of the way, off onto the sidewalk, instead of causing collisions.
- **Wanted, then designed in the rounds below:** wheelies with a hood launch into backflips; the hairpin drift as "a first class experience"; ramp trucks in motion, with the static ones leading to shortcuts; the old Seven Mile Bridge beside the new one, with jumps between them; "more variety and real world content in the races"; Codex may make and optimize textures and models.

## Interview answers

- **Round 1.** Progression: "All three" [tiers gate the garage: each tier unlocks the next bike class, and its boss must be beaten first; the field levels up every tier, so tier 3 rivals ride bikes as good as your best; money is gentle but tighter: each new bike takes about 3-4 races of winnings, with smaller purses, pricier bikes and repairs after crashes]. Pop-ups: "Top ticker strip" [one line at a time along the top edge, fading fast; the road stays clear; takedown names flash briefly, small]. Wheelie: "I think maybe 2 is right because we already swipe up to accelerate. I like the idea of skill though lol. What do you think" [answered and taken: double-tap the throttle to pop it, then balance it by thumb height on the throttle; too high loops out, too low drops the front; a wheelie into a car's hood launches a backflip jump]. Real world: all three [real landmarks, real road layouts and real local life], with "Duval St, downtown Portland, Golden Gate" first; brands and businesses stay invented.
- **Round 2.** Drift: all four [a drift meter with style cash that chained corners multiply; an exit boost; smoke, skid marks, knee down and a camera lean; drift career events such as hairpin races and mountain switchbacks]. Look: "Mix: models + small atlases" [stylized models with richer shapes, plus small baked texture sheets for facades, signs and murals; Codex builds and optimizes both]. After the career: "Longer + seasons" [more tiers per region with real struggle, then Season 2 and later with a harder field and remixed events, the garage carried over]. Feel: "Smooth; fights feel right" [no slowdowns noticed on the phone off-road, downtown in San Francisco or in crashes, and knockdowns about right]. This phone-verifies main as of run W-T.
- **Round 3.** Bikes: "Six bikes" [add a Sport 600, a Grand Tourer 1100 and a Supersport 900; a new bike every second tier, about 3-4 races each]. Regions: "In order" [the Keys first, the Pacific Northwest after the Keys boss, San Francisco after the Pacific Northwest boss; places already raced stay open]. Save: "Both" [Season 2 on the finished save, plus a "New career" button that keeps the old save as a backup code]. Fights: "Gentle climb" [about 10% easier to knock down at a region's first tier, about 20% harder by its last; tunable]. A Portland sign: "Salmon: STILL RAINING" [an invented neon leaping salmon in the stag sign's spot, marked new and vetoable]. Seven Mile: "Ramp hops + real gap" [real geometry and length, about 11 km; ramp trucks on repair platforms hop about 30 m between the bridges; the real 80 m missing span is the big jump, and a miss is a splash and a respawn on the highway; rivals and cops stay on the highway].

## The coordinator's calls `[default]`

- The Golden Gate is named "the Golden Gate", with no fall or rail jokes, and is kept out of the logo.
- Lombard Street becomes a slow "crooked mile" race if drift can't hold there; the drift races are on Crown Point and Twin Peaks.
- A hood launch works off the trunk of the car ahead too.
- A clipped cyclist topples onto the sidewalk, and you only wobble.
- The pedestrian's step-out gag is a fake-out at the kerb.
- Cash pop-ups merge into the ticker.
- No Painted Ladies (they are private homes, and no route passes them).
- Popping a wheelie needs at least 0.3 throttle.

## Process decisions the same day

The maintainer also answered a retrospective on how the agents work. These are carried in [AGENTS.md](../../AGENTS.md) and [the engineering doc](../engineering.md#parallel-agent-lanes):

- Delivery: "Keep as is": big parallel runs continue, and the maintainer explores each build on their own.
- Verification: "Tests in CI + one live check": escaped bug classes become per-PR CI tests, one live check per run, independent reviewers only for high-stakes changes.
- Rules: "Consolidate into repo but be careful about oversharing etc": AGENTS.md and the docs are the single source.

## Where the decisions live

[The product spec](../product-spec.md): controls (wheelie, drift), combat (the fight climb), traffic (manners), career (progression, seasons, region order), bikes (six), world frame (real places, the Seven Mile Bridge), look, and UX (the ticker and the HUD rule).
