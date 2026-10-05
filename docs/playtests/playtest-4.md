# Playtest 4 and its answers (2026-10-04)

> **In plain words.** The maintainer played for a couple of hours on the phone and other devices, and sent notes from memory. A read-only feel audit then measured the controls he called clunky. Five short rounds of questions followed. They settled a menu-first first run, a wheelie button, auto-aim with a swipe to choose the side, a kick with no wait, a drift anywhere, a U-turn of its own, a steering choice (Arcade by default, plus a true Free mode), smoking bikes that slow a little, carts that swerve, kept bike prices, an easy way onto the old Seven Mile Bridge, and richer music for every region. New race and challenge types stay open.

Cite this as "playtest 4, 2026-10-04". Every answer is `[decided]` on that date; the bracketed readings after an answer are what the maintainer was shown and chose. The coordinator's own calls are `[default]` and listed separately. He added: "You don't need to act on all of these things now but maybe record them in scratch or something."

The build played was the live build after playtest 3's waves A and B (commit 98e72b2). Wave C was running at the time, and some notes were already covered by it.

## The maintainer's words

His own list, "just what I recall right now", as he wrote it. "One other person who played it" is shown here as "a second player".

> Getting onto the old bridge is hard because you have to go far to the right and you tend to miss the ramp truck
> The real roads do not have the characteristics of the roads in question in terms of scenery and feel etc
> The world still feels empty in places- like Bridge City should look like downtown Portland even in the distance etc and be as content-rich as the others
> Combat feels clunkier than it used to-- timing is difficult, mainly. A second player said they didn't like the kick cooldown or something like that. The timing is hard to control and I wish I could choose an attack direction.
> Lombard's hairpins feel impossible to control smoothly
> Even with steering assist off, it feels kinda like you're on a track at times-- I'm not sure if this is good or bad but it does make it hard to take certain shortcuts and it seems to control when drifting is possible.
> Wheelie control conflicts with accelerating. I only tried it on phone.
> Races should have a 3 2 1 go type countdown
> On mobile if I clear site data and refresh then hit play it jumps right into the first career event instead of main menu?
> Maybe Races from main menu should have options?
> To change bike for main menu races you have to go into career garage
> Tuning on mobile blocks pause button and it seems you can't get it to minimize once it's up so you have to refresh the whole page/game
> Maybe bikes should slow down when they start smoking?
> Wheelie into the back of a car should also allow backflips
> Shortcut entries and exits tend maybe junctions in general to be rough in terms of access, visible artifacts, etc
> Old seven mile bridge should have Fred the Tree https://en.wikipedia.org/wiki/Fred_the_Tree
> Duval St should be a party street
> golf carts and similar things should swerve out of the way
> The more complex SF music is impressive probably my favorite I like Keys music too but PNW seems very simple and slow. It's not as good as the others even if I get the motivation and vibe.
> Effects are too loud by default compared to the other audio
> I really look forward to more polish, correction, more complete worlds, etc etc. Keep up the good work! :)

## Round 1: the first run, steering and combat

- **First run.** "Menu first (Recommended)" [a new player sees the main menu, with "Start career" as the obvious first tap]. This turns the earlier race-first `[default]` into `[decided]` menu-first.
- **Track feel.** "maybe allow true assist off but rename today's default. arcade guided good. still want to fix where needed though." [today's guided feel stays the default under an honest name, "Arcade"; a true off mode, "Free", is added with no hidden pull toward the road; specific shortcuts and spots still get fixed where the guidance gets in the way].
- **Combat.** The clunkiness is on the phone and in early career races too: "I think it's mostly the timing and sequencing that makes it clunky. I can do it only somewhat consistently. It feels too mechanically constrained and timed." So it is the input timing and sequencing design, not the later tiers' rival tuning.
- **Menu race options.** All four [bike choice; route, time and weather; rivals and cops; race length or laps], "plus other race & challenge types, traffic density, maybe other things?". Bike choice for a menu race covers his note that you have to go into the career garage to change bike.

## Round 2: in chat

> For the fight I think maybe reduce delay between tap and attack and make it so that bumping into a rival while attacking doesn't negate the attack
> I did beat tier bosses
> Missing the gap in the first place is annoying lol it took me five restarts to get it the first time. The path into the shortcut is too narrow maybe.
> The phone wheelie experience is important. Phone play is my primary play.
> Top ticker is fine

- Combat: shorten the delay between a tap and the attack, and a bump into the rival never cancels an attack in progress. [decided]
- Tier bosses were beaten in real play, and the next tier opened.
- The Seven Mile: five restarts the first time; the path onto the old road is too narrow.
- The wheelie on the phone is high priority, because the phone is his primary platform. Every control change is designed for the touch screen first, with keyboard and gamepad kept at parity.
- The top ticker stays as it is.

## Round 3: the wheelie, attack direction, the Seven Mile and the music

- **Phone wheelie.** "Wheelie button (Recommended)" [a small button by the right thumb: hold to lift the front and keep it up, release to drop; the throttle stays separate; the skill is how long you hold before it loops out, and the gauge shows it].
- **Attack direction.** "Auto-aim + swipe (Recommended)" [a tap hits the closest rival on either side, right away; a swipe left, right or up on the attack button picks the side or a straight kick].
- **The Seven Mile.** "as long as it's reasonably and fairly truly accessible then the current respawn is fine. it's just too hard to get on." [keep the respawn on the highway after a miss, and make getting onto the old road genuinely accessible].
- **PNW music.** All four directions [driving garage and grunge; indie and folk with drive; rainy-night synth; the same vibe, more complex], and: "I'm surprised how good the music is lol feel free to make more for all regions :P".

## Round 4: places first, race types and smoking bikes

- **Places.** He picked every group [Duval Street and the Seven Mile; the Golden Gate and Lombard; Bridge City; the older real roads] and added "any really lol". Every real place gets the identity pass (its own scenery, signs, props, ambient life and distant skyline). The order is the coordinator's call `[default]`.
- **New race and challenge types.** "idk I need to consider more options and compare to career, other games, etc". `[open]`: nothing is built, and the question stays in [the product spec's open decisions](../product-spec.md#open-decisions). If he wants it, an agent offers a comparison page (race types against the career and other games) to decide from.
- **Smoking bikes.** "A little (Recommended)" [about 5 to 10 % less top speed while smoking; repairs between races fix it].

## The feel audit

A read-only audit measured the notes before anything was built. It found these, and where its recommendations differed from his words, his words won:

- **Combat.** No regression since playtest 3's build: the combat code and the weapon data are identical. The clunkiness is the standing design: a press made during an attack is dropped, not buffered; a kick locks out presses for 833 ms, then a kick swipe becomes a punch until 1,333 ms; an attack with no target defaults to the right and never re-aims; a slanted kick swipe (21 to 59 degrees) picks a side by accident; nothing shows when the kick is back.
- **Wheelie.** While the front is up, the thumb's height is both the throttle and the balance. The sweet band is 9.4 px in the middle of the stick, so a full swipe up loops out in about 0.6 s.
- **Trunk launch.** It works, but needs 8 m/s or more of closing speed; 6 to 8 m/s is a solid crash.
- **Old Seven Mile bridge.** The turn-off zone started 0.05 m inside the rider's reach (every other zone starts 2 to 3 m inside). The run-up's 60 m bend can't be held at arrival speed, the 3 m truck is narrower than the deck, and the chevrons were painted outside the rail.
- **Lombard.** The U-turn rule (12 m/s or less, brake 0.5 or more, steer 0.85 or more) fires on the first hairpin; without it the same inputs finish clean. The hairpins are about 21 m apart against an 18 m camera look-ahead.
- **"On a track".** It is the original steering model: steering sets a heading relative to the road, capped at about 8 degrees at 40 m/s, and letting go lines the bike up again. Assist off really is off. Drift started only where the road bends: 0 % of the Seven Mile and San Francisco's downtown. Shortcuts leave the road tangent, and some connectors bend tighter than full lock can hold.
- **Golf carts.** Only types 0.8 m wide or less could take the verge, so a 1.3 m cart moved 0.05 m. Letting carts take the verge cut cart hits from 9 to 2 in 15 seeded races.

## Round 5: the answers that closed the audit

- **Kick wait.** "No wait". Kick again as soon as the leg is back (about 0.8 s between kicks). With round 2: presses are buffered, the tap-to-hit delay is cut, and a bump never cancels an attack.
- **Drift.** "Anywhere (Recommended)": brake hard plus steer hard above about 40 mph is a drift on any road.
- **U-turn.** "Its own gesture probably makes sense but I think it felt impossible partly because of the speed I was doing it at lol maybe I just need to slow waaaaaay down. It's also just very windy and tight". So a U-turn needs its own gesture (for example a double-tap of the brake plus full lock), and normal hairpin braking never flips you. Lombard stays tight; its camera may soften if that helps.
- **Golf cart clip.** "Keep it a crash". Carts swerve onto the verge where there is room, and a solid rear-end is still a crash.
- **Bike prices.** Kept as they are: a player who follows the map's suggested races still buys each bike in about 3 to 4 races. (The coordinator's record of this answer has no quote, so none is given here.)

Already settled, so the audit's other options do not reopen them: the wheelie button; auto-aim plus swipe for attacks (the accidental side picks are mitigated by re-aiming every tick while there is no target, requiring a clearly sideways swipe for a side, and showing the target); easy-to-aim access to the old bridge ("reasonably and fairly truly accessible"); the trunk launch from about 3 m/s ("Wheelie into the back of a car should also allow backflips"); and steering as the renamed guided default plus Free, then the trap fixes.

## The coordinator's calls `[default]`

- The numbers: 7.5 % for the smoking slowdown, a countdown beat of one second, the button's place and size, and the hold's rise rate (all on the tuning panel where they are numbers).
- The swipe's details: a slanted swipe down stays auto-aimed (it no longer picks a side), and a swipe down is still the kick.
- The U-turn gesture's exact form and its keyboard and gamepad forms, and how Arcade and Free sit beside the steering-assist levels.
- Weather as a menu race option waits for a weather feature; the options are built in the order the code allows.
- The order of the places' identity passes.

## Where the decisions live

[The product spec](../product-spec.md): controls (attack aim and swipe, the kick, the wheelie, drift anywhere, the U-turn, the steering feel), combat (the smoking slowdown), traffic (carts), career (kept prices, menu first), world frame (the Seven Mile, the places' identity pass), audio (richer music in every region) and UX (menu race options, and the one open question, new race types). [The roadmap](../roadmap.md#playtest-4-alongside-the-milestones) says when. The tone guide's [taste log](../tone-guide.md#taste-log) carries the music call.

Built by 2026-10-05, per [the changelog notes](../../changes/): menu first and the countdown, the wheelie button, drift anywhere, the smoking slowdown, carts that swerve, the quieter default effects, the tuning panel's fit on a phone, a paid trick chip that shows at once, and the easy way onto the old Seven Mile Bridge. The rest waits for the next runs.
