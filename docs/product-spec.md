# throttlebrawl: product spec

> **In plain words.** throttlebrawl (a working codename) is a browser game you can open on a phone or a computer. You ride a motorcycle in illegal road races, and you punch, kick and swing stolen weapons at rival riders at speed, while dodging traffic and cops. The best moment in the game is landing a hit at speed, such as kicking a rival into an oncoming truck. The races belong to a traveling outlaw circuit that tours US regions, starting with the Florida Keys. A career that climbs through each region's road map earns you cash for better bikes. The humor is deadpan and a little strange, never corny. The game has to feel good, look distinctive, run smoothly on a budget Android phone, and have real personality before it launches publicly. This document says what the game is. Other docs in this folder say how it is built and in what order.
>
> It is inspired by Road Rash (EA, 1991–2000), and it puts its own spin on things.

## How to read this spec

Every design item carries one tag:

- **[decided]**: traces to a maintainer answer. Don't change it without asking.
- **[default]**: a proposal by the planning agents. Agents may build it as written, and the maintainer may change it at any time.
- **[open]**: needs the maintainer. Each one is also listed in [Open decisions](#open-decisions).

Numbers marked [default] are starting values for the in-game tuning panel, not promises. Research facts that could not be checked are marked *(unverified)*. The humor, rival writing and taste rules live in [the tone guide](./tone-guide.md). Simulation, data formats and saves live in [the architecture doc](./architecture.md).

## Contents

- [Pitch](#pitch)
- [Pillars](#pillars)
- [Player fantasy](#player-fantasy)
- [Controls](#controls)
- [Combat](#combat)
- [Rivals](#rivals)
- [Cops](#cops)
- [Traffic and pedestrians](#traffic-and-pedestrians)
- [Weird events](#weird-events)
- [Crash and run-back](#crash-and-run-back)
- [Career](#career)
- [Failure states](#failure-states)
- [World frame](#world-frame)
- [Look](#look)
- [Audio](#audio)
- [UX and menus](#ux-and-menus)
- [Content and extensibility](#content-and-extensibility)
- [v1 scope and launch bar](#v1-scope-and-launch-bar)
- [Non-goals for v1](#non-goals-for-v1)
- [Idea shelf](#idea-shelf)
- [Open decisions](#open-decisions)
- [Provenance](#provenance)

## Pitch

- A motorcycle brawler-racer in the browser, with Road Rash's soul and its own spin. [decided]
- The core moment is **landing a hit at speed**. [decided]
- In the maintainer's words, the tone is "Probably obviously road rash homage but definitely room for flavor and humor. Maybe some fallout borderlands wild wasteland type stuff lmao who knows but nothing corny cheesy cringe etc if we can help it". [decided]
- On how far to follow the originals: "don't feel too limited by ps1 and n64 … put our own spin on things in whatever ways are the most fun." [decided]
- v1's signature spin is **Burnout-style takedowns**: knock a rival into traffic for a short, in-flow slow-motion beat and bonus cash. [decided] Knocking a rival into scenery counts too. [default] The slow motion is on by default and can be turned off. [decided]
- The v1 bar is **one great track with the full game loop**, good enough to share proudly. [decided]
- No ads or in-app purchases for now. No accounts for now. Offline play is preferred. [decided]

## Pillars

These four pillars settle design arguments. When two ideas conflict, the one that serves more pillars wins. [default]

| Pillar | What it means | How we check it | Tag |
|---|---|---|---|
| **Landing hits at speed** | The fight happens *while racing*, at full speed, never in a separate brawl mode. A clean hit gets hit-stop, a sound, knockback and a visible consequence. | The maintainer plays a build and reports that hits feel good. The tuning panel preset is saved. | [decided for the pillar; default for the detail and the check] |
| **Readable brawling** | At speed you can always tell who is next to you, who is winding up, what they hold, and why you crashed. Every hazard telegraphs. Nothing kills you from off-screen. | Playtest question: "did anything feel like a cheat?" The answer should be no. | [default] |
| **Personality** | Named rivals with grudges, deadpan signs, satirical billboards, trash talk, and a world that is ours but a little off. | The maintainer laughs, and the launch bar's personality check passes. | [decided for the pillar; default for the check] |
| **Runs well on a budget phone** | The benchmark is the maintainer's Galaxy A16 5G in landscape. If it runs well there, it runs well almost anywhere. | Measured on the real phone, never on desktop emulation. See [the launch bar](#v1-scope-and-launch-bar). | [decided] |

- Phone and desktop keyboard are **both first-class**. The maintainer plays mostly on the phone. [decided]
- The second pillar's name ("readable brawling") is the planners' phrasing. The maintainer loved the brawling of the originals; readability is how we protect it at speed. [default]

## Player fantasy

- You join an illegal road-racing circuit touring US regions. A sleazy streaming outfit films the tour and sells the carnage as "reality content", and it pushes for more with each tier. [decided] You start as a nobody. [default]
- You earn your place by winning races, knocking rivals into traffic, outrunning the local cops, and settling grudges. [decided]
- The feeling to chase: sunset on a long bridge over turquoise water, the pack bunched up around you, and a rival winding up a pipe. You snatch it and use it on him before the next truck arrives. [default]
- The fantasy is slapstick, not grim. Pedestrians and animals dive clear cartoonishly, there is no gore, and the humor is deadpan. [decided]

## Controls

### Touch (landscape, two thumbs)

| Control | Behavior | Tag |
|---|---|---|
| Left thumb, ride | Drag **up** for scaled throttle (further means faster). Drag **sideways** to steer. **Lift** the thumb to coast. | [decided] |
| Stick style | A floating stick that appears where the left thumb lands, anywhere in the left ~40% of the screen. The zone starts ~24 px in from the edge and touches inside that strip are ignored, because the phone's back gesture takes them before the page sees them. The stick base spawns at least one stick radius from the edge. The milestone 1 phone test checks for accidental back gestures in fullscreen *(unverified whether Chrome fullscreen needs a double swipe)*. | [default] |
| Brake | A separate brake button. | [decided] |
| Pull-back brake | Optionally, pulling the stick down also brakes. Playtests decide whether this is on by default. | [default] |
| Cruise-control toggle | **Not built.** A button that holds the current throttle so the left thumb can rest. The maintainer said "maybe… if realistic" about a cruise-control button, and later put "cruise mode" on the shelf. Asked what they meant, they answered "Both": the cruise-control button and a race-free cruise mode stay together on the shelf, and neither is built before a playtest asks for it (cockpit answer, 2026-09-29). The `cruise` action stays reserved. | [decided] |
| Right thumb, fight | One large **attack** button. It auto-targets the nearest rival in reach. | [decided] |
| Side choice | **Auto-aim plus swipe** (playtest 4, 2026-10-04, "Auto-aim + swipe"): a **tap** hits the closest rival on either side, right away. A **swipe** left, right or up on the attack button picks the side, or the straight kick. Phone first; the keyboard and gamepad keep their explicit side keys at parity. How, to stop accidental side picks: while the attack has no target the aim is re-checked every tick until it lands, a swipe must be clearly sideways to pick a side, and the rival it would hit is shown. As built (playtest 4, P4-6): the sim names the rider a tap would hit now (by the rule the press uses; on the keyboard and gamepad too), but no marker is drawn: the maintainer vetoed the amber target box on 2026-10-05 (taste log), and any future cue must be barely there and off by default. A kick swipe picks a side only when it leans more than 35 degrees from straight down (20 before; up to the 60-degree kick cone), and a flat flick still picks a punch's side. | [decided] for auto-aim plus swipe and the three swipes; [default] for the three mitigations and their numbers |
| Kick | Swipe **down** on the attack button. There is **no wait** between kicks (playtest 4, "No wait"): kick again as soon as the leg is back, about 0.8 s. A press made just before an attack ends is kept and fires as soon as it does (presses are buffered, not dropped), the delay between a tap and the hit is cut, and bumping into the rival you are attacking never cancels the attack (playtest 4: "reduce delay between tap and attack and make it so that bumping into a rival while attacking doesn't negate the attack"). | [decided] |
| Kick direction | Playtest 2 (2026-10-02): "Kick timing requires the ability to choose kick direction as you ride up behind someone (directional swipe)". A kick swipe leaning down-left or down-right kicked to that side; a swipe **up** is the straight kick at the rider directly ahead, with a longer forward reach. Playtest 4 supersedes the 20-degree lean rule: a slanted swipe down stays auto-aimed up to 35 degrees from straight down (the audit found a lean of 21 to 59 degrees picked a side by accident), and a side is picked by a clearly sideways swipe, as in the Side choice row. Keyboard: hold U or O with K for a side kick, I for the straight kick. Gamepad: Triangle with Square or Circle, L1 for the straight kick. | [default] |
| Wheelie | A small **wheelie button** by the right thumb (playtest 4, 2026-10-04, "Wheelie button"): **hold** it to lift the front and keep it up, **release** to drop it. The throttle stays the throttle, so you can wheelie at full gas. The skill is how long you hold: held too long, the front goes over the top and loops out (playtest 3's "too high loops out"); the wheelie gauge shows the angle and the risk, and letting go and pressing again keeps it up. A wheelie into a car's hood launches you into a backflip jump (playtest 3, 2026-10-03: "if you wheelie into the hood of a car it should launch you up into a jump doing backflips"), and the trunk of the car ahead launches too, from a closing speed of about 3 m/s (a small hop and one backflip at the least; playtest 4, 2026-10-04: "Wheelie into the back of a car should also allow backflips"; it was 8 m/s, and a contact at 6 to 8 m/s was a solid crash), so a wheelie into a car is never a solid crash. The ticker names the launch, HOOD ORNAMENT or TRUNK SPACE, and gives a wheelie crash a one-word reason (LOW, BIG, SMALL, SIDEWAYS, BEHIND or WOBBLY). The button sits left of the attack button, over the brake, and the layout's settle rule keeps it clear of both in either hand and off the road ahead at every phone size (it is smaller on a 16:9 phone). The keyboard holds H and the gamepad holds R3. Playtest 3's double-tap of the stick is gone: it fought with accelerating, and popped wheelies on quick flicks of the stick. | [decided] for the button, hold and release, the throttle staying the throttle and the hood launch; [decided] for the trunk launch (playtest 4); [default] for the place, its 3 m/s speed, the launch names and reasons, the keyboard and gamepad forms and the hold's numbers (on the tuning panel) |
| Drift | Braking hard into a hairpin at speed drifts, as "a first class experience" (playtest 3, 2026-10-03): a drift meter with style cash that chained corners multiply, an exit boost, smoke, skid marks, knee down and a camera lean, plus drift career events. How, as built (`src/sim/riders/drift.ts`): hold the brake (0.7 or more) and the bars (half lock or more) for 0.15 s above 18 m/s, about 40 mph (`riders.driftMinMps`), on any road, bend or straight (playtest 4, 2026-10-04, P4-8, "Anywhere" `[decided]`: it first needed the road to bend ahead, which kept it off the Seven Mile and San Francisco's downtown); then the slide holds without the brake, reaches up to 1.8× farther and costs a little speed, and ends when you let the bars go, turn them the other way or drop under 10 m/s (`riders.driftExitMps`). A clean exit (pointing down the road, 0.8 s or longer) boosts 2 to 6 m/s for 1.2 s, and a drift started within 4 s of it chains (×1.5, ×2, ×2.5, ×3). The chain's cash banks when the 4 s run out; a crash, a wobble, a hit or a flick of the bars at speed empties it. Drift room `[default]` (playtest 4, 2026-10-05, the maintainer: "more room for error in heavy traffic"): a slide against a barrier or rail crashes only from 1.6 times the barrier crash speed (`riders.driftEdgeForgive`), a wobble below; no vehicle spawns in or within 40 m of a bend of a 75 m radius or tighter (`traffic.driftBendClearM`); and a vehicle within 55 m of a drifting rider edges up to 1 m toward its kerb, inside its road (`traffic.driftRoomM`). The speed and the line stay the rider's. Only the player drifts. | [decided]; [default] for how |
| U-turn | A U-turn has **its own gesture** (playtest 4, 2026-10-04: "Its own gesture probably makes sense but I think it felt impossible partly because of the speed I was doing it at lol maybe I just need to slow waaaaaay down. It's also just very windy and tight"), for example a double-tap of the brake plus full lock. Braking into a hairpin, with the stick at full lock, never flips you: the audit found the old rule (12 m/s or less, brake 0.5 or more, steer 0.85 or more) turned a phone rider round on Lombard Street's first bend, and the same inputs finish clean without it. Lombard stays tight; its camera look-ahead may be shortened on tight bends if that helps. The keyboard and gamepad get a form of the gesture at parity. As built (playtest 4, P4-9): **tap the brake, then press it again and hold it with the bars at full lock**, at 12 m/s (about 27 mph) or slower; the bike then pivots round. The first tap is short (under 0.35 s) and made with the bars under half lock, and the second press comes within 0.45 s of the first lifting. Braking into a hairpin, held or stuttered, with any lock never turns you round. It is read from the brake and the bars alone, so the touch brake button, the brake key (S or the down arrow) and the pad's brake trigger (L2) all make it the same way, and a replay needs nothing new. The pause screen's keyboard legend names it on the brake row. The chase camera also shortens its look-ahead on tight bends (a bend's radius over 30 m, never under 0.3 of it) and slows its bearing spring by the same share, so Lombard Street's hairpins do not swing the view from one apex to the next. | [decided] for the own gesture and for hairpin braking never flipping; [default] for the gesture's exact form and numbers, and the camera's |
| Steering feel | Two feels (playtest 4, 2026-10-04: "maybe allow true assist off but rename today's default. arcade guided good. still want to fix where needed though."). **Arcade** is today's guided feel, kept as the default under an honest name: steering sets a heading relative to the road, and letting go lines the bike up with it. **Free** is a true off mode with no hidden pull toward the road: the bike goes where it points. Where the guidance gets in the way, specific shortcuts and spots are still fixed: turn-offs that start well inside the rider's reach, and connectors a bike can hold at its arrival speed. The choice is a sim setting, so it goes into the replay header; how it sits beside the steering-assist levels is [default]. As built (playtest 4, P4-8): **Settings, Race, Steering style: Arcade or Free**, just above Steering assist, applying at the next race. Arcade rides exactly as before. Free turns the bike at Arcade's first rate, so full lock holds the same bends, but nothing turns it back: held lock keeps turning past Arcade's cap (about 8° at 40 m/s), up to the 69° every rider is kept within, and hands off the bike keeps its heading. The steering assist is separate and works on top of either style. Rivals and cops always ride Arcade. Still guided in Free: barriers and edges square the bike up as before, and a jump's flight still follows the road (forgiving landings). | [decided] for Arcade as the default, Free, the name and the spot fixes; [default] for the rest |
| Held weapon | Swings with the same attack button; the button's icon changes. | [default] |
| Weapon steal | The same attack button, timed. See [Combat](#combat). | [decided] |
| Tilt steering | An option, with a sensitivity slider and recalibration at race start. | [decided for the option; default for the slider and recalibration] |
| Default steering | Thumb steering starts as the default. Playtests on the phone decide the final default. There is no data showing tilt is worse; complaints about it are reviewer opinion. | [default] |
| Button layout | Buttons are movable, resizable and configurable. | [decided] |
| Haptics | On, with a toggle. [decided] Where the browser has no vibration support (for example iOS Safari *(unverified)*), the toggle is hidden. [default] | [decided for the toggle; default for the hiding] |

- **How the attack gesture resolves.** Pressing attack starts the punch wind-up at once, on the auto-picked side, so there is no added latency on the core moment. During the wind-up, a drag more than about 24 px sideways flips the side, and a downward swipe of about 24 px (within 60 degrees of straight down, playtest 2) turns it into a kick wind-up, to the side it leans when it leans more than 35 degrees (playtest 4; it was 20), and a swipe up turns it into the straight kick. After the wind-up ends, the gesture is locked. A press during a rival's steal window is a grab. The thresholds are tuning values. [default]
- **Auto-target priority.** When a cop and a rival are both in reach, the auto-target prefers the non-cop, unless the side override points at the cop, so that chaos near a cop is never accidental. [default]
- **Extra touch bindings.** Skip the run-back with a tap on the attack button while on foot. Look-back is a small hold button near the top right. [default]
- Start sequence: one "tap to start" that enters fullscreen, locks landscape, unlocks audio and asks for tilt permission if the browser needs it. If the lock fails, a "rotate your phone" screen shows. [default]
- Guard against browser gestures: no pull-to-refresh, no browser long-press menu, no text selection, and safe-area insets respected. The game's own long-press (the in-game veto, see [UX and menus](#ux-and-menus)) still works. [default]

### Keyboard (equal priority)

| Key | Action | Tag |
|---|---|---|
| W / Up | Throttle (ramps up while held) | [default] |
| S / Down | Brake | [default] |
| A, D / Left, Right | Steer | [default] |
| H (hold) | Wheelie: hold to lift the front, release to drop it (playtest 4). Not Shift: five quick presses of Shift open the Sticky Keys prompt on Windows. | [default] |
| J | Attack (auto-target) | [default] |
| U / O | Attack, forced left / right | [default] |
| K | Kick | [default] |
| C | Change the camera view: low chase, far chase, helmet (camera-3; d-pad up on a gamepad). The cruise-control action stays reserved, on the shelf [decided], and gets a key of its own if a playtest asks for it. | [default] |
| Esc | Pause | [default] |
| Space | Skip the run-back while on foot | [default] |
| L (hold) | Look back | [default] |
| Backquote (`) | Open the tuning panel | [default] |

- Keyboard is as important as touch, and every key is remappable. [decided for equal priority; default for remapping]

### Gamepad

- All input goes through one mapping layer designed for gamepads from the start. A PS4-style controller, including one paired over Bluetooth to the phone, is added around milestone 2. [decided]

### Settings

| Setting | Tag |
|---|---|
| Four volume sliders (master, music, effects, voices), plus mute | [decided] |
| Default levels: master 80%, music 60%, effects 70%, voices 80%, so the effects sit between the music and the voices (effects were 90% until playtest 4, the maintainer: "Effects are too loud by default compared to the other audio"). A saved level is kept, except a saved Effects level of exactly 90% (the old default, which most devices that had played held, because the settings record is saved whole): that moves to 70% once, on its first load, and the record is then marked (`effectsDefault`), so a 90% chosen afterwards sticks | [default] |
| A Voices on/off switch beside mute (spoken barks; off keeps the Voices slider's level), on by default with the Voices slider at 80% (maintainer, 2026-10-01: "add a Voices volume and an off switch") | [decided]; the 80% default is [default] |
| Haptics on/off | [decided] |
| Takedown slow motion on/off | [decided] |
| Speed units (mph or km/h) | [decided] |
| Lower overall game speed (for readable fights and enjoying the scenery) | [decided] |
| Steering: thumb, tilt, or both | [decided for tilt as an option; default for "both"] |
| Steering style: Arcade (the default) or Free (playtest 4; see [Controls](#controls), "Steering feel") | [decided] |
| Throttle: scaled drag, or auto-throttle | [default] |
| HUD: show, hide or move each piece, with Full, Classic and Minimal presets | [decided] |
| Race length | [decided] |
| Frame rate: smooth first by default (the display's full rate, with the picture softening under load), plus a battery saver at about 30 fps (cockpit answer, 2026-09-29) | [decided] |
| Frame-rate cap options are divisors of the measured display refresh: full, half, a third | [default] |
| Look: Ink + 60s film for a new save, with Classic, Sun-bleached wasteland and Kodachrome brush in the switch (maintainer, 2026-10-01: "ink+60s but may change later"). When slow frames (under about 34 fps at the full frame rate) fill 60% of 6 s of a race on an ink look, a note offers a one-tap switch to Classic; "No thanks" is remembered | [decided] for the default; [default] for the offer and its numbers |
| Difficulty: Easy, Normal, Hard. The presets set rival aggression, cop frequency and rubber-banding; assists toggle separately | [decided] |
| Failure mode: Road Trip is the default, with Classic and Hardcore as later options (cockpit answer, 2026-09-29; see [Failure states](#failure-states)) | [decided] |

- A hidden **tuning panel** exists from milestone 1. It has sliders for hit-stop, knockback, steering and camera shake, used mid-race on the phone [decided], plus speed [default]. "Save preset" stores the values so agents can lock them in. [decided]
- On the phone, the tuning panel opens with a three-finger tap on the pause screen. On desktop the backquote key opens it. Three-finger gestures may clash with the phone maker's own gestures *(unverified)*, so a long-press on the build ID in the pause menu opens it too. [default]
- **Lower overall game speed** is a multiplier on every mover's speed and acceleration. It is not a time scale, so it does not collide with hit-stop or slow motion. It belongs to the simulation settings, is recorded in replays, and changes only between races. [default]

### Accessibility

The maintainer asked for accessibility basics "without being obtrusive or getting in the way". [decided]

- A left-handed mirror that swaps the two thumb zones. [decided]
- A reduce-screen-shake toggle. [decided]
- Subtitles for voices. Barks are text bubbles in milestone 1 anyway. [decided]
- Assist options. [decided] The set: steering assist (off, light, strong), auto-throttle, and the lower-overall-speed setting. [default]
- Rivals are told apart by shape (helmet, silhouette, jacket pattern) as well as by color, for color-blind players. [default]
- A text-size setting for menus and bubbles, and a reduce-motion toggle that softens the speed FOV kick and camera roll. [default]

## Combat

- Punch, kick and picked-up weapons. [decided]
- **Auto-target**: an attack hits the nearest rival in reach. The side comes from which side they're on; dragging off the button overrides it. With nobody in reach, you swing at air. [decided for auto-target and drag; default for the reach rule]
- **Kick** is a swipe down on the attack button. [decided] A kick needs a short wind-up and a reach window, so a kick that sends a rival flying is earned. The look-lab sample let you kick any time and have the rival fly, which the maintainer flagged as needing a timing gate. [default] Your next kick waits only for the leg to come back, about 0.8 s between kicks, with no extra cooldown (playtest 4, "No wait"). [decided] Rivals keep their pace between kicks. [default]
- **Timing** (playtest 4: "reduce delay between tap and attack and make it so that bumping into a rival while attacking doesn't negate the attack"). A kick lands as soon as a punch, about 0.12 s after the tap. A press made in the last moment of an attack (about 0.17 s) is kept and fires as soon as the attack ends. Bumping into the rider you are attacking never cancels the attack. [default]
- **Weapons in v1**: club or pipe, chain, wasteland junk, and the cops' baton or taser. [decided]
- Weapons are data. Adding one means adding a data entry and art, not code. [decided]
- **Weapon steal**: a timing snatch. Tap attack while a rival holds their weapon out or winds up to swing. [decided] The 3DO manual (1994) says: "To Grab Weapon: C (when opponent is holding it out)". The steal window gets a clear telegraph: a glint and a sound cue on the wind-up. [default]
- The maintainer also remembered a "dodge to the side and then come back and grab it" move. It isn't confirmed by the manuals, and it isn't in v1. It stays on the [idea shelf](#idea-shelf). [default]
- Rivals use weapons and steal them from you the same way. [decided]
- **Damage is health only.** When your health runs out, you are knocked off. The bike can't be destroyed. [decided]
- **Knockdowns take a few hits, and brawls are shorter and more frequent** (interview, 2026-10-02: "it should take a few hits even if they are kicks. Weapons should do more"). [decided] About 3 kicks, 5 punches or 2 weapon hits knock a rider down. [default] Playtest 3 (2026-10-03) found that "fights feel right". [decided] Within a region, fights climb gently: about 10% easier to knock down at its first tier and about 20% harder by its last ("Gentle climb", playtest 3). [decided] The numbers are sliders. [default]
- Health slowly recovers when you're out of combat, the way the originals let you "back off until your energy is restored". [default]
- **A smoking bike is a little slower** (playtest 4, 2026-10-04: "Maybe bikes should slow down when they start smoking?"; his answer "A little"). [decided] A bike smokes while its rider has a third of his health or less (the existing smoke); while it smokes it loses about 5 to 10 % of its top speed, and every race starts with every bike repaired, so in the career the repairs between races fix it, and the slowdown also lifts when your health comes back over the line. [decided] How [default]: 7.5 % (`riders.smokeSlowdown` on the tuning panel, 0 turns it off), on the bike's own top speed only (not the acceleration, a boost pad's boost or the ground), for every rider who smokes, rivals included (`src/sim/riders/smoke.ts`; the smoke line is `SMOKE_HEALTH`, 0.34, shared with the render).
- **Feel**: hit-stop of about 40–80 ms on clean hits, knockback, camera impulse and a meaty sound. All of these are on the tuning panel. [default] Hit-stop and takedown slow motion fire only on hits and takedowns that involve the player, dealt or received. Rival-vs-rival hits get sound and knockback only, and slow motion has a cooldown (about 8 s) so a pile-up doesn't chain it. [default]
- **Takedowns**: a rival counts as taken down when your hit causes them to go down within about 2 seconds, whether into traffic, into scenery, or by running out of health. [default] Takedowns pay bonus cash. [decided] Big takedowns (into traffic or scenery) trigger a short slow-motion beat of about 0.6–1.0 s that stays in the flow of play and is not a cutscene. It can be turned off. [decided for the in-flow slow motion and toggle; default for the duration]

## Rivals

- About eight named rivals, each with a look, a style and a line. [decided] Their writing lives in [the tone guide](./tone-guide.md#the-rivals).
- The roster shape is **4 circuit regulars who travel with the tour, plus 4 locals per region**, and always local cops. The maintainer said it "sounds right". [decided]
- The eight drafted rivals are all liked: Deacon Vane, Dial-Up, Chad Speedwell and Kevin from Accounting as regulars; Tammy Two-Stroke, The Mayor, Mother Rust and Sgt. Pruitt (a local cop) as Florida locals. [decided for the eight; default for who is a regular and who is local]
- Rivals are data plus content packs, so adding a rival needs no code change. [decided]
- **Visible personalities** (interview, 2026-10-02, after "Rivals feel samey"): moderate stat differences, shown through how each rival rides and fights, with signature riding and fighting moves. [decided]
- **Race field.** The player plus 7 named racers in tiers 1 and 2, and up to the player plus 9 in tier 3 and the boss race, crew included. Cops are extra, at most 2 on screen. Sgt. Pruitt is a cop and never races, which is why 7 named racers exist among the "about eight". The performance bar is measured at the largest field. [default]
- **Pace comes from the event, not the bike.** A rival's race pace comes from the event tier and the rival's style, not from the bike it rides. A rival's bike class is looks, sound and small handling quirks, so Kevin's scooter still keeps up with the pack. Novelty bikes are slow only for the player, in free riding and in events flagged as novelty. [default] In the career this becomes a **field level per tier** (playtest 3, 2026-10-03: "the field levels up every tier (tier 3 rivals ride bikes as good as your best)"). [decided] How [default]: the pace is a share of the best step-up bike open at that tier (about 0.74 at a region's first tier to 0.85 at its last, a little more for a boss, more each season), so not buying never makes the field easier; from a region's third tier, and in every tier from Season 2, rivals ride that bike, and the rank below it before; the cops ride the rivals' bike, capped just under the best open bike's top speed so a player on it can always outrun the law on a straight; and rival aggression, signature moves, health and power climb with the tier, the fights gently (about 10% easier to knock down at a region's first tier, about 20% harder by its last: "Gentle climb", [decided]). As built `[default]`: the rivals' health scale carries the knock-down half, and the power scale reaches the player's fights as the rivals' hits on the player: about 10% softer at a region's first tier, never harder than before there, about 12% harder at its last, never more than 15% (`combat.levelPowerOnPlayer` and `combat.levelPowerMax`; a rival's own `stats.power` still stays out of them: playtest 1 item 7). Each tier's numbers are in its career file's `field` block ([career format](./content-packs.md#career)).

### Rival AI in v1

| Behavior | Detail | Tag |
|---|---|---|
| Personality styles | Each rival has a style: heavy hitter, weaver, showboat, grudge-keeper, and so on. The style sets aggression, preferred weapon, lane habits and bark mix. | [decided for styles; default for the style list and what a style sets] |
| Grudge targeting | Rivals you have wronged hunt you. Grudges build from hits, takedowns and steals. | [decided for grudge targeting; default for what builds a grudge] |
| Rival-vs-rival fights | Rivals brawl with each other, including a few authored rivalries (see the tone guide). | [decided for rival-vs-rival fights; default for the authored rivalries] |
| Weapon use and steals | Rivals swing weapons, and steal them from you and from each other. | [decided] |
| Gang-ups | Simple gang-ups in v1. Two rivals may team up on you, or a rival may side with you against a shared grudge target. | [decided] |
| Crews | Proposal: a mix of dynamic gang-ups and fixed crews. The maintainer said "maybe a mix of all these", and only simple gang-ups are firm for v1. Mother Rust's gang, "the Swamp Kin" (a placeholder name), is the first proposed fixed crew. | [default] |
| Deeper crews and reputation | Later, not in v1. | [decided] |
| Rubber-banding | Arcade-fair and slight, so the pack stays close and there's always someone to fight. | [decided] |

- Rivals remember what you did to them, so barks can reference history ("last time at the bridge…"). [decided for memory barks] **Grudges are saved with the career**, so a rival still holds a grudge the next time you play, and memory lines actually come up in short sessions. [decided] (cockpit answer, 2026-09-29, which brings this small piece of "light persistence, later" forward) The career save arrives in milestone 4; until then a grudge lasts for the current race. [default]
- Cop heat carrying over between sessions, and grudges outside a career (in free roam), still come later. [decided] A world that keeps going when you're not playing, with rivals roaming on their own, is a proposal for later. [default]

## Cops

- Classic chase and bust. If a cop knocks you off, you're **busted** (interview, 2026-10-02; it was any fall near a cop before, and it is revisited after a playtest). The race ends for you, and you pay a fine. [decided]
- You can fight cops like any other rider. [decided]
- Cops carry batons and tasers, which you can steal. The Saturn manual tip says the easiest way to get a weapon is to take one from a cop. [default]
- Cops show up through a mix of three triggers, with some randomness: more cops at higher tiers, some cops in every race, and cops summoned by chaos. [decided]
- **A patrol in every race, plus a heat meter** (interview, 2026-10-02: "Mix of 2 and 1 (reliable but rich)", after playtest 2's "I think I've only ever encountered cops once"). One or two cops patrol every race. Chaos (takedowns, wrecks you cause, hits near a cop) raises heat, which brings more cops and then a roadblock; you lose them by riding clean or going off-road. [decided] The numbers are in [M4.md](./milestones/M4.md#cops-3--the-law). [default]
- Every region has its own local law. [decided] In the Keys that means county deputies, with state troopers on the highway, maybe marine patrol. [default for who patrols where]
- The law is a mix of real agency structure under parody names, plus fully parody forces; no real agency names, badges or logos. The maintainer said "maybe a mix of all". [default]
- Sgt. Pruitt is the named local cop in region 1. [decided]
- Fines grow with the tier. [default] When you can't pay, Road Trip, the default failure mode, caps the fine at the cash you have, so you are never knocked out of the career. [decided] See [Failure states](#failure-states).
- **Later, not v1**: a heat system that carries across sessions, cop radio chatter, and a playable cop mode (Road Rash: Jailbreak had one). [decided]

## Traffic and pedestrians

- v1 traffic: cars, trucks as big hazards, an oncoming lane, pedestrians and animals, and wasteland oddities. [decided]
- Pedestrians and animals dive out of the way cartoonishly. There's no gore, but hitting something big crashes you. [decided]
- Fairness rules [default]:
  - Every flat hazard has a visible, upright cause: cones mark the pothole, and a leaking truck drops the oil.
  - Hazards have audio telegraphs, such as horns from oncoming cars.
  - Dynamic hazards spawn only beyond reaction range, unless the player caused them.
  - Fog or draw distance never hides oncoming traffic inside reaction range.
  - A first small contact (a side brush or a graze) wobbles you; you crash only once you're already unstable. A solid head-on or rear hit throws you off, with no bounce. [decided for the solid hit: playtest 1, 2026-09-30]
  - **Reaction range** is closing speed times about 2 seconds (a tuning value). At the top bike's 160 mph against a 55 mph oncoming car, closing speed is about 96 m/s, so the range is about 190 m. Fog and draw distance for the oncoming lane are set from the fastest bike in the event.
- **Traffic manners** (playtest 3, 2026-10-03: cyclists "should arguably get out of the way off the sidewalk"): cyclists and pedestrians get out of the way instead of causing collisions. [decided] A clipped cyclist topples onto the sidewalk and you only wobble. [default] Golf carts and similar slow things swerve out of the way too (playtest 4, 2026-10-04: "golf carts and similar things should swerve out of the way"): they take the verge where there is room, and a solid rear-end into one is still a crash ("Keep it a crash"). [decided]
- Florida examples: rental scooters, RVs, boat trailers, golf carts and gators. Wasteland oddities include a boat abandoned in a lane and a mobile home rolling with no truck. More ideas are in [the tone guide](./tone-guide.md#region-flavor). [default]
- Near-misses pay cash. [decided]

## Weird events

- Weird events are rare, data-driven modifiers that make a race go strange. The maintainer wants all four kinds, with room to grow. [decided]
  - **Nature chaos:** a hurricane gust, a gator crossing, cold-night iguana rain.
  - **Human chaos:** a parade, a funeral procession, a spring-break convoy, an offshore rocket launch.
  - **Wasteland weird:** a cult roadblock, a runaway boat on a trailer, a UFO billboard that comes true.
  - **League stunts:** a bounty on the player, double-cash zones, a guest "celebrity" rider. The celebrity is always fictional; see [the hard lines](./tone-guide.md#hard-lines).
- Each weird event is an event-modifier entry in a content pack, so a new one needs no code when it reuses an existing behavior. [decided] The format is reserved in [the content-pack doc](./content-packs.md).
- Timing: milestone 4, or the idea shelf. [default]
- Mechanism: an event lists modifiers, each with a behavior, parameters and a chance. They are rolled from the race seed at race start and recorded in the simulation config and the replay header, so replays and the bot stay deterministic. Each behavior is registered code, like weapons. Nothing is built before milestone 4 except an optional `modifiers` field on events. [default]
- The writing rules are in [the tone guide](./tone-guide.md#other-writing-surfaces).

## Crash and run-back

- A big impact throws you and your bike. The rider tumbles, then **runs back to the bike**. You can skip the run. [decided] The skip input is in [Controls](#controls). [default]
- While running back, you can steer the runner to dodge traffic. Skipping puts you back on the bike after a short time penalty of about 3 seconds. [default]
- Trim only the waiting (interview, 2026-10-02) [decided]: the tumble hands back once nearly stopped, after at most about 3.5 seconds; Skip is never slower than running to the bike; you remount rolling (about 8 m/s). The run itself is unchanged. The numbers are sliders. [default]
- The simulation tracks riders by distance along the road and offset across it. [decided] Real physics is used only for crash tumbles. [default] Details are in [the architecture doc](./architecture.md#crash-tumble).
- Crashes are part of the comedy. The physics should be absurd and readable, never gory. [decided]
- Crashes are big and funny, and recovery is quick: ragdoll tumbles, the bike cartwheels, riders sometimes go over the rail, and the run-back starts fast. [decided]
- Going over a bridge rail ends in a funny splash (a gator or a fisherman reacts), a time penalty and a respawn on the bridge. There is no swimming. [decided]
- Knocked-off rivals tumble, get up and shake a fist, and a grudge is noted. It is never gory or lingering. [decided]
- A cop knocking you off means you're busted; crashing on your own near him does not (interview, 2026-10-02). [decided]
- Landings are forgiving (interview, 2026-10-02: "Forgiving landings", after playtest 2's "It's too easy to crash after a jump"). [decided]

## Career

- The first career was about **10 events across 3 tiers**, ending in a **boss grudge race**, roughly 1–2 hours of play. [decided] (2026-09-29) Playtest 3 found it too short and too easy, so it grows (below).
- **The map is the career** (interview, 2026-10-02: "Network map, tiered" and "The map"). Each region's road network is its career map, with events on its roads across all routes and all event types. Wins open nearby roads and the next tier, ending in the region's boss. You claim roads, find secrets and shortcuts, and each region has a set-piece finale. Later free roam uses the same map. [decided]
- **Progression with struggle** (playtest 3, 2026-10-03: "I won a few easy races and then bought the fastest bike. No struggle, no increasing difficulty"; the answer "All three"). [decided]
  - Tiers gate the garage: each tier unlocks the next bike class, and its boss must be beaten first.
  - The field levels up every tier: tier 3 rivals ride bikes as good as your best.
  - Money is gentle but tighter: each new bike takes about 3–4 races of winnings, with smaller purses, pricier bikes and repairs after crashes.
- **Longer, then seasons** (playtest 3: "Longer + seasons"): more tiers per region with real struggle; after the career, Season 2 and later bring a harder field and remixed events, with the garage carried over. Season 2 runs on the finished save, and a "New career" button starts over while keeping the old save as a backup code ("Both"). [decided]
- **Regions in order** (playtest 3: "In order"): the Keys first, the Pacific Northwest after the Keys boss, San Francisco after the Pacific Northwest boss. Places already raced stay open. [decided]
- **How the longer career is built** [default] (playtest 3's design, with its contract in [the career format](./content-packs.md#career) and [the save format](./architecture.md#save-format)): each region has 4 tiers of 3 events and a tier boss, a grudge match that opens after 2 of the tier's wins and opens the next tier when beaten; the last tier's boss is the region's. A tier once open stays open, so no old save loses one. Once every region boss of a season has fallen, a Start Season card offers the next season (a button, not an automatic start, since it resets the maps); a season keeps cash, the garage, paints, grudges, receipts, secrets and the history, and resets each region's map. Season 2 on remixes each node from a seed saved with the season (time of day, length, field, some event kinds, the tier bosses become the rivals you wronged most) with a harder field and bigger purses. "New career" keeps the finished career as a backup code in the save (the newest 3), and importing the code brings it back. The remix in detail [default] (`src/career/season.ts`): a time of day other than the node's Season 1 one; an event's long length half the time in a region's tiers 3 and 4; a regular event's field redrawn, the same size, from the region's rivals (its boss aside), with up to 2 guests from other regions from Season 3; one regular event in 3 swapped between a race, a takedown hunt and a cop escape, at the tier's purse (drift events and grudge matches never swap); each tier boss's match handed to the rival with the highest grudge toward you not yet a boss that season, keeping the route and the win rule but dropping a signature rule that is not the new rival's own; the region boss stays the rematch; weird events more likely each season (1.5 times in Season 2, twice in Season 3, at most 2.5 times) and one more a race (at most 3); a drift target 25% higher a season. Each boss's teaser plays again in the new season. "New career" starts the cash, garage, maps, grudges and history over, and keeps the failure mode and the control prompts already seen.
- **Between races** (interview, 2026-10-02: "all of the above in whatever mixes make sense and actually work well"): stream chat, rival texts and taunts, a local newspaper with the tabloid results, and side gigs. The streaming outfit is a quiet frame: between races, plus at most one producer ask during a race. [decided]
- The four event types are below; playtest 3 adds drift events (hairpin races and mountain switchbacks, see [Controls](#controls)). [decided] Their rules:

| Event type | Win condition | Tag |
|---|---|---|
| Classic race | Finish in the top 3 to advance | [decided for the type; default for top 3] |
| Takedown hunt | Reach a takedown count before the finish | [decided for the type; default for the rule] |
| Cop escape | Start with cops on you and either reach the finish or survive a set time without being busted (the content-pack rules allow both) | [decided for the type; default for the rule] |
| Grudge match | One-on-one with a named rival; beat them to the line or knock them down a set number of times | [decided for the type; default for the rule] |

- For race rules, the maintainer picked "Objectives mix" over a single top-3 rule. So each event states its own objective. [decided]
- The first proposed event list [default], from before the map career (each region's career file now places its events on the region's roads, see [the career format](./content-packs.md#career)):

| # | Tier | Event | Time of day |
|---|---|---|---|
| 1 | 1 | Classic race, the learn-by-riding event | noon |
| 2 | 1 | Takedown hunt | dawn |
| 3 | 1 | Grudge match vs Kevin from Accounting | golden-hour |
| 4 | 2 | Cop escape | dusk |
| 5 | 2 | Classic race, longer | night |
| 6 | 2 | Grudge match vs Chad Speedwell | noon |
| 7 | 3 | Takedown hunt | night |
| 8 | 3 | Cop escape, heavy | dawn |
| 9 | 3 | Classic race, full pack | golden-hour |
| 10 | Boss | Boss grudge race vs Mother Rust and her crew | dusk |

- The time-of-day values are the region's lighting presets from [the content-pack format](./content-packs.md#region). This table is the product proposal, and the sample career in the content-pack doc follows its boss; either can change. [default]

- Each event sets its own time of day. Weather comes later. [decided] A race from the main menu may pick its light and a dry or rainy race (see [the menu race's options](#ux-and-menus)); the rain is the drizzle the Pacific Northwest already has, drawn only, and it changes nothing about the riding. [default]
- Race length can be chosen per event: short, standard or long, roughly 2, 4 or 6 minutes. [decided for choice; default for lengths]
- You learn the controls by riding event 1, with prompts that appear only as they become relevant. The steal prompt, for example, appears the first time a rival winds up. [decided for learn-by-riding; default for the prompt timing]
- The first run is **menu first** `[decided]` (the maintainer, playtest 4, 2026-10-04: "Menu first"). A brand-new player (nothing stored, or site data cleared) sees the main menu after the start tap, with "Start career" as the obvious first tap, and never a race straight away; Start career opens the career map with the tutorial event suggested, and event 1's prompts teach the controls as you ride it. This replaces the earlier `[default]` race-first start (the maintainer had said "maybe race first" and "we may need to iterate on the intro"; a phone player who cleared site data was surprised to land in a race).
- Every race starts with a **3-2-1-GO countdown** `[decided]` (the maintainer, playtest 4: "Races should have a 3 2 1 go type countdown"). The cars and riders hold at the grid for three beats of a second, the number shows small and translucent in the strip beside the road ahead, never over it (the maintainer, 2026-10-05: "The 3 2 1 countdown blocks visibility of what's directly ahead so it's hard to plan your start. It should be less obstructive."), and each beat has a short beep on the effects bus (the quieter default mix); GO shows as the race starts. Input is ignored until GO. `[default]` for the timing: one second a beat, GO shown for about 0.8 s.
- Beating the boss plays a teaser for the next region, and free play continues afterwards. [decided] In v1, free play means replaying any event; riding freely on the network comes after v1 (see [World frame](#world-frame)). [default]
- You start events from menus or by riding up to race markers in the world. Milestone 1 uses menus only. [decided]
- You pick from a few preset riders, with room to add more. [decided]
- Short stylized stills with text play between events, like comic panels or grainy photos with rival trash talk. [decided] Tentatively (the maintainer said "idk"), the look is mixed by context: zine panels for rivals, a fake TV broadcast for the league, and comic panels. [default]

### Cash

- Cash comes from placing, takedowns and near-misses. There is no betting. [decided]
- Style cash comes from near-miss traffic, airtime, oncoming-lane riding, takedown combos and weapon steals, plus "maybe other stuff". [decided] It is scored in M2 and banked from M4. [default]
- Cash goes on bikes, paint and fines. There are no entry fees in v1. [default]
- **Tighter money** (playtest 3: "each new bike takes about 3-4 races of winnings; smaller purses, pricier bikes, repairs after crashes"). [decided] How [default]: purses grow about 22% a tier from about $900 at the first; each crash bills a repair of 1% of the bike's price (at least $50, at most 5 a race, never more than a quarter of what the race paid, and never below $0 in Road Trip); a won event replayed pays half its prize and required bonus (style pays in full); a wheelie and a drift pay style cash by the second; the producer's ask and the side gig pay 10% more for each tier up the whole career (a $250 ask pays $350 at the fifth tier, in steps of $50); later seasons pay more (Season 2 about 15% more purse, Season 3 on about 30%). The six bikes cost $11,250, $21,000, $31,750, $36,000 and $60,250 above the free Rustbucket (balance QA, T7.5; the Supersport rose from $34,000 to $36,000 when the Pacific Northwest's third tier gained a fourth race, T10.5): a typical player who rides the race the map suggests next buys each a median of 3 to 4 races after it goes on sale, one who rushes every boss 5 to 8, and a struggling player 8 to 13, still on the top bike by the end of Season 1 (`tests/sim/career-economy.test.ts` plays hundreds of seeded seasons through the career code on the real packs; only the race outcomes are modelled). The prices were kept after playtest 4 (2026-10-04): a player who follows the map's suggested races still buys each bike in about 3 to 4 races. [decided]

### Bikes

- Three bikes, each a clear step up [decided] (2026-09-29), grown to **six bikes for sale** (playtest 3, 2026-10-03: "Six bikes"): a Sport 600, a Grand Tourer 1100 and a Supersport 900 join them, a new bike every second tier, each about 3–4 races of winnings. [decided]
- Slow bikes too. The maintainer said "kinda all of these but also to enjoy the scenery". That covers a slow starter bike for readable fights; scooters, mopeds and dirt bikes; a lower-overall-speed option; and riding for the scenery. [decided]
- The proposed lineup [default]:

| Bike | Role class | Rough top speed | Role |
|---|---|---|---|
| Starter | slow | ~85 mph | Readable fights while you learn |
| Mid | standard | ~120 mph | Tier 2 |
| Top | fast | ~160 mph | Tier 3 and the boss |
| Scooter or moped, dirt bike | novelty | ~45–70 mph | Cheap, silly, scenic; some rivals ride these |
| Old chopper | novelty | ~100 mph | Big, loud and heavy; a novelty ride |
| Secret joke rides: a riding lawnmower, a mobility scooter, a golf cart | secret | ~12–25 mph | Hidden as easter eggs, unlocked after the boss in free play |

- The maintainer wants a moped or scooter, a dirt bike, an old chopper and the secret joke rides. [decided] The speeds, and the secret unlock rule, are [default]. The "role class" column is a role for balance; the bike file's own `class` field (scooter, moped, dirt, chopper and so on) is separate ([bike format](./content-packs.md#bike)).

- Any bike can enter any event. Higher tiers are tuned so the starter bike struggles, as in the originals. [default]
- Speed units are a setting. [decided]
- Handling is arcade but weighty. [decided]
- Paint colors are the only customization for now. [decided]
- Each bike has its own synthesized engine sound. [decided for synthesized; default for per-bike]

### Save

- Progress saves on the device, plus a copyable export code for backup and moving between devices. [decided]
- Save data carries a version number, so old saves and codes keep loading after updates. The maintainer left calls like this to the planners. [default]
- Cloud save may come later. [decided]

## Failure states

> **In plain words.** How much should losing hurt? The maintainer first said: "maybe these can all be options. let's think about how other decisions should influence this one". Below is that thinking and the options. Shown them, the maintainer chose the friendly one: **Road Trip is the default**, where a fine never takes you below $0, so you can never be knocked out, and **Classic and Hardcore come later as options** for anyone who wants harshness. [decided] (cockpit answer, 2026-09-29)

### What can go wrong in a race

| Setback | What happens | Tag |
|---|---|---|
| Place badly | You don't meet the event objective and don't advance. | [decided] |
| Wreck (health runs out, or you crash) | You're knocked off, then run back to the bike, which you can skip. You lose time, not the race. | [decided] |
| Busted | A cop knocks you off (interview, 2026-10-02; before, any fall near a cop). The race ends for you, and you pay a fine. | [decided] |
| Broke | You can't pay a fine. In Road Trip, the default, the fine is capped at the cash you have, so this never ends a career. | [decided] |

The bike can't be destroyed. Playtest 3 (2026-10-03) added repairs after crashes to tighten money [decided]; Road Trip's $0 floor covers them too, so they can't knock you out either [default]. In the 1994 original, running out of cash for a fine *or* a repair bill meant "you lose and have to start over". Here, only fines and repairs can drain you.

### How other decisions push on this

- **Bursty sessions.** The maintainer plays in short bursts, and hobby projects die when they start to feel like a chore. Losing 30 minutes of a 1–2 hour career is a quit moment. That pushes toward **friendly**.
- **Arcade-fair, slight rubber-banding.** The game already favors fairness over punishment. That pushes toward **friendly**.
- **Cash from placing, takedowns and near-misses.** Even a lost race pays something, so going broke is rare unless fines are large. That makes harsh modes **cheap to offer**.
- **Classic chase and bust.** A bust needs teeth, or cop escapes aren't tense. That pushes toward **fines that hurt**.
- **Road Rash soul.** The original ended the game when you went broke. That pulls toward a **classic option**.
- **Local save plus export code.** Any permadeath is on the honor system, since a player can re-import an old code. That's fine for a hobby game; don't build anti-cheat. It makes a hardcore mode **cheap but soft**.
- **No ads, no in-app purchases.** There's no business reason to sell continues. Harshness exists only for tension. That keeps it **opt-in**.
- **Assist options are already planned.** Strictness can be one more setting beside them.
- **Race length is selectable.** Short races make a retry cheap, which softens every mode.

### The default and the options

**Road Trip is the default, and it is built first, in milestone 4.** [decided] (cockpit answer, 2026-09-29) Classic and Hardcore are later options. [decided] The career profile carries a `failureMode` field, so they are a seam and not a rebuild. When they arrive, the mode is chosen when a career starts and can be made gentler at any time but never harsher mid-career. [default] Chill is a further proposal, as an accessibility option. [default] When Classic and Hardcore land is a proposal: after Road Trip, never ahead of the career loop, so they may slip past milestone 4 without holding anything up. [default]

| Mode | Place badly | Busted | Can't pay | Tag |
|---|---|---|---|---|
| **Road Trip** (the default) | Retry at once; keep the cash you earned | Race over, plus a fine | A fine is capped at the cash you have, so cash never goes below $0. You can never be knocked out of the career. | [decided for the mode and the $0 floor; default for the retry detail] |
| **Classic** (a later option) | Retry | Race over, plus a fine that scales by tier | You lose the current tier's progress and replay that tier's events, echoing how the originals revoked qualifications. | [decided for the option; default for the rules] |
| **Hardcore** (a later option) | Retry | Race over, plus a heavy fine | Career over. Start fresh. It's the original's rule, on the honor system. | [decided for the option; default for the rules] |
| **Chill** (a proposed accessibility option) | Retry | Cops still chase and can knock you down, but there are no busts or fines. In a cop-escape event, being caught ends the attempt and you retry, with no fine | Can't happen | [default] |

## World frame

- An illegal road-racing circuit tours US regions. Each region is a chapter and a content drop, with real roads, local rivals, gangs, law, weather and humor. [decided]
- A sleazy streaming outfit follows the tour and escalates with each tier. The frame blends an underground circuit with near-future satire: the world is ours, a little off, with the wasteland creeping in at the edges. [decided]
- Lore lives in road signs, rival barbs, billboards and short interludes, never in long cutscenes. [default]
- **Region 1, for v1: the Florida Keys and A1A.** Track 1 is a coastal highway. [decided]
- **More regions now, not after v1.** The maintainer: "I do think we should start adding other regions races etc to avoid over optimizing, keep things fun, ensure everything works". The Pacific Northwest and San Francisco come first ("Pnw and sf first then others"), crude first, as content packs that reuse everything, and the menu's region picker starts a race in either. New race types wait ("These can wait until later"; playtest 4, 2026-10-04, leaves them [open], see [Open decisions](#open-decisions)). [decided] (playtest 1c, 2026-09-30) When each lands is in [the roadmap](./roadmap.md#regions-alongside-the-milestones).
- Shelf regions: the Desert Southwest, San Antonio, Washington DC, Iowa and West Virginia, plus more to brainstorm. [decided] The Pacific Northwest and San Francisco left the shelf in playtest 1c. Flavor notes are in [the tone guide](./tone-guide.md#region-flavor).
- **Road network.** One connected network: roads join at junctions, you can free-roam on them among traffic, bikers and cops, and races are routes through that network. [decided]
- The network is designed to load in chunks, so a large real region can fit later. [decided]
- **Free roam.** The network supports riding freely from milestone 1. A playable free-roam mode and world race markers come after v1; milestone 1 starts events from menus only. [default]
- **Off-road** (interview, 2026-10-02: "Anywhere with ground", then "2 and 1"): a ridable ground band beside most roads (dirt, sand, grass and gravel, each with its own grip and speed; water, ferns and kerbs are the real edges; some fences smash), plus marked dirt shortcuts such as sandbars, fire roads and clear-cuts. Open hillsides, real terrain, open areas and free roam come later. [decided]
- **Barriers** (interview, 2026-10-02: "Both"): no invisible wall where ground is drawn; rails only on bridges and drops; posts only on highways. [decided]
- **Roads** (interview, 2026-10-02): branching roads, junction choices in races, map-based networks, U-turns, and 4–6 lane highways with lane splitting. [decided]
- **Real places** (playtest 3, 2026-10-03: "more variety and real world content in the races"): real landmarks, real road layouts and real local life, starting with Duval Street, downtown Portland and the Golden Gate. Brands and businesses stay invented. [decided] Playtest 4 (2026-10-04: "The real roads do not have the characteristics of the roads in question in terms of scenery and feel etc" and "Bridge City should look like downtown Portland even in the distance etc and be as content-rich as the others") asks every real place for an identity pass: its own scenery kit, signs, props, ambient life and distant skyline. He picked every group (Duval Street and the Seven Mile; the Golden Gate and Lombard; Bridge City; the older real roads) and added "any really lol". [decided] The order is the coordinator's call. [default] In Portland, the stag sign's spot gets an invented neon leaping salmon reading "STILL RAINING", marked new and vetoable (playtest 3). [decided] The Golden Gate is called the Golden Gate, with no fall or rail jokes, and stays out of the logo. [default]
- **Region firsts** (interview, 2026-10-02). San Francisco: downtown towers first (a four-lane avenue between invented AI-startup towers, cross traffic, cable cars only on the steep cable-line streets), then the waterfront, Chinatown and North Beach, and the Mission. The Keys: distinct keys first (a fishing village, a resort strip, a junkyard key, a party key), then sandbars, mangrove back roads and a secret island. [decided] Every region's scenery, traffic, people, signs and radio are its own, never a reskin (the maintainer, 2026-10-01b: "I want unique regional flavor everywhere"). [decided]
- **The Seven Mile Bridge** (playtest 3: "Ramp hops + real gap"): real geometry and length (about 11 km), with the old bridge running beside the new one; ramp trucks on repair platforms hop about 30 m between the bridges, and the real 80 m missing span is the big jump, where a miss is a splash and a respawn on the highway. Rivals and cops stay on the highway. [decided] Ramp trucks may also move, with the static ones leading to shortcuts (playtest 3: "The ramp trucks could be in motion and the static one could be used to get to shortcuts or something"). [default] **Playtest 4** (2026-10-04: "as long as it's reasonably and fairly truly accessible then the current respawn is fine. it's just too hard to get on."): the respawn on the highway stays, and getting onto the old road is easy to aim. [decided] As built, 2026-10-05 `[default]`: the turn-off's zone starts in the shoulder and runs 80 m; the run-up to the ramp truck is a gentle bend every bike holds at its top speed; both trucks are as wide as their decks; a fall at either truck hop wakes the rider on the highway, as the missing span does; and the zone's paint stays on the road, with chevrons along its 90 m lead-in. A rider who keeps holding right is carried along the staging platforms' edges without a scrape (`[default]`, run B), so the hop still has the speed it needs.
- **Cruise mode** is on the idea shelf. [decided] Asked whether that meant a relaxed, race-free ride or the cruise-control button, the maintainer answered "Both": the two stay together on the shelf, and neither is built before a playtest asks for it. [decided] (cockpit answer, 2026-09-29)
- The v1 track starts hand-authored and Keys-flavoured (bridges, causeways, invented curves and hills). Real Keys geometry may be mostly straight and flat *(unverified)*, so the fun comes from bridge humps, traffic, junction shortcuts and authored edits. [default]
- A GIS side-quest lane builds the real Overseas Highway (US 1) from public data in parallel from M1, in the same road format as the hand-built track. If the real road is fun, it replaces the hand-built track in M2. [decided] Whether it is fun is the maintainer's call: they ride both, their pick becomes the career's road, and the other stays in the game as an alternative route. [decided] (cockpit answer, 2026-09-29) How usable the Keys data is has not been probed yet *(unverified)*.
- Keys realism is evocative, not literal; real names are fine as flavor. [decided]
- Real roads come from GIS data. They're curated, proved step by step, and credited properly. Tracks should mix "recognisably real" with "tuned for fun"; the maintainer noted this "may take more thought". [decided]
- More real data later: elevation, land cover, traffic density and landmarks. [decided]
- Jumps and ramps are in v1, including one ramp shortcut on the track. [decided] Flips are in (interview, 2026-10-02: "I love the idea of doing flips"), and so is the wheelie's hood-launch backflip (playtest 3, see [Controls](#controls)). [decided] A Tony Hawk-style trick-combo meter stays on the shelf. [default]
- Every event sets a time of day. Weather comes later. [decided]
- The maintainer wants "a bit of all these" for story, endings, multiplayer and easter eggs: "creative endeavours are rarely a straight line". [decided] The v1 story runs up to the boss grudge race, then a next-region teaser and free play. [decided]

## Look

- Four sample looks were tried on the phone: PS1 authentic, chunky low-poly, comic/cel and hazy painterly. The maintainer found all four "rather pleasing", but none had a visual identity. All four rendered and ran fine on the A16; no frame-rate figure was recorded. [decided]
- Visual identity will come from a signature palette, character design, a zine or photocopy overlay, and exploration with AI concept art. [decided]
- A real look test on the phone after milestone 1 picks the style. [decided]
- Tentative, the maintainer said "idk" [default]: a milestone 3 look test compares exaggerated and realistic rider proportions, and palettes are compared and then set per time of day.
- The nostalgia anchor is the 1996 PS1 port of the 1994 3DO game, with its digitized riders and attitude. It's a reference for spirit, not a style to copy. [decided for the anchor; default for "not a copy"]
- Don't reproduce Road Rash's HUD, dashboard, characters or track names. Our bikes are fictional. [default]
- The camera is a low chase cam. [decided] Far chase, helmet cam, cinematic replay cameras and look-back all come too, staged by value and complexity. [decided]
- Assets start as code-made shapes, Blender scripts and synthesized sound. AI-generated art, voices and music are a labelled side quest. [decided] Running Blender tooling as its own side-quest lane is a proposal. [default]
- **Real models now** (interview, 2026-10-02, after playtest 2's "The riders and bikes are blocky and uninteresting"): real 3D riders with real proportions, loud costumes, limbs and flapping clothes, and real bike silhouettes per rival. [decided]
- **Stylized models plus small atlases** (playtest 3, 2026-10-03: "Mix: models + small atlases"): models with richer shapes, plus small baked texture sheets for facades, signs and murals. Codex builds and optimizes both. [decided]
- No crack, rust or grime textures (playtest 1c, 2026-09-30: "Not big on the cracked, rust, grime"). [decided]

## Audio

- Everything matters: engine roar and pitch, meaty hits with brief freeze frames, crash carnage, voices and shouting, traffic and the environment. [decided]
- The engine sound is synthesized in code first. [decided] It's built from rich harmonics, because phone speakers lose low frequencies; test it on the phone speaker itself. [default] It is "Richer and quieter" (interview, 2026-10-02, after "Engine monotonous and maybe too loud"). [decided]
- Music: a single original, gritty 90s-style score in milestones 1 and 2. [decided]
- Then **radio stations by genre, plus regional stations**; for the Keys, surf and rockabilly come first. [decided] Which milestone brings radio is a proposal. [default] A station is data: a genre, region tags and a playlist of manifest tracks. [default]
- **More code-made music only, for now** (interview, 2026-10-02: "More code-made music only"): more stations, each region with its own, plus a hidden pirate station per region; no DJ and no AI songs. [decided] This replaces, for now, the cockpit answer of 2026-09-29 that took AI-generated songs as a second source. The maintainer cuts tracks they don't like with "cut this", the same way as rival lines. [decided] "The music is impressive", so the composer's direction stays. [decided]
- **Richer music in every region** (playtest 4, 2026-10-04: "The more complex SF music is impressive probably my favorite I like Keys music too but PNW seems very simple and slow. It's not as good as the others even if I get the motivation and vibe."; then "I'm surprised how good the music is lol feel free to make more for all regions :P"). [decided] Every region's stations get as rich as San Francisco's, keeping each region's vibe. For the Pacific Northwest, all four of his directions: driving garage and grunge, indie and folk with drive, rainy-night synth, and the same vibe with more complexity. Still code-made only. [decided] A track he dislikes is cut with "cut this" as before.
- Radio DJ lines come later, together with the AI barks. Music that rises with the action comes later too. [decided]
- Genres that appeal, tentatively (the maintainer said "idk"): grunge, surf and rockabilly, stoner or desert rock, and swamp blues. [default]
- No licensed music. [default] Research says the 3DO and PS1 versions played their licensed grunge in menus and videos, with an original score during races *(unverified)*.
- Rival voices: text bubbles in milestone 1. Voice lines are generated offline later. Live, race-reactive lines are optional, later still. [decided]
- Cop radio chatter comes later. [decided]
- Four volume sliders, plus mute and a haptics toggle. [decided]
- Audio doesn't start until the first tap, because browsers require it. The "tap to start" handles this. [default]

## UX and menus

- Menus are in a 90s grunge zine style. [decided] The maintainer is fine with menus. [decided]
- **Options for a race from the main menu** (playtest 4, 2026-10-04: "Maybe Races from main menu should have options?" and "To change bike for main menu races you have to go into career garage"; asked which, he picked all four: bike choice; route, time and weather; rivals and cops; race length or laps, plus traffic density). [decided] New race and challenge types are [open] (see [Open decisions](#open-decisions)): he wants to compare them with the career and other games first, so the options carry a race-type seam with only today's race in it. How [default]:
  - One options screen, from the menu's **Options** button beside Race; Race on the screen or on the menu starts the race with the picks. The picks are remembered on the device between races and reloads, and apply to menu races only: a career race keeps its own event, field and bike.
  - Each option is one row with an arrow at each end and the value between (tapping the value steps forward too), big enough for a thumb; the rows flow into two or three columns on a phone held sideways. Keyboard: Tab to a row, the arrows step it, Escape goes back.
  - **Bike**: the garage's bike (the default), or any bike in the game, slowest first with its top speed, without going through the garage. The secret joke rides join the list once the garage owns one, so they stay easter eggs.
  - **Where**: the menu's region and road pickers, as before; the screen says where the race runs. **Time**: any (a different light each race, as before) or one of the region's lights. **Weather**: the region's own, dry or rain (render only).
  - **Rivals**: the usual field, or none up to seven, drawn from the region's riders. **Cops**: on or off; off means no law at all. **Difficulty**: Easy, Normal or Hard (the same setting as the settings screen's).
  - **Length**: the event's lengths (the settings screen's Race length); a picked real road sets its own length, so the row hides. Laps wait for a road that loops: every route today runs point to point.
  - **Traffic**: none, light, usual or heavy (0, 0.5, 1 and 1.75 times the traffic density slider).
  - Every pick that changes the race goes into the race's config, so the replay rebuilds it, and the replay header also carries the picks themselves.
- **What's new since you last played.** Each device remembers the last build it saw and shows only what changed since then, as a card. [decided]
- A full changelog page in the menu, with the same notes in the GitHub releases. [decided]
- The HUD shows speed, position, your health, the nearest rival's health and a minimap. Each piece can be shown, hidden or moved, with Full, Classic and Minimal presets. [decided for configurability; default for the list]
- **Nothing covers the road ahead or overlaps another HUD piece** (playtest 3, 2026-10-03: "The race objective sits over the heat meter. The black and white text pop-ups block the actual game."). Pop-ups never get bigger. [decided]
- **One top ticker** (playtest 3: "Top ticker strip"): pop-ups run one line at a time along the top edge and fade fast; takedown names flash briefly and small. [decided] Cash pop-ups merge into it. [default]
- **The moves' HUD** (playtest 3, T6.3): the drift chain is the ticker's meter line (`DRIFT ×2 +$140`), banks into a `DRIFT` chip and shows `DRIFT LOST` when a crash, wobble or hit empties it; a paid wheelie is a `WHEELIE` chip. The wheelie gauge, a thin bar beside the stick, is the only new widget and shows only while a wheelie is up. [default]
- **How the top of the HUD settles** (`src/ui/hud-layout.ts`): one rule set places the ticker, the objective, the heat badge and the slow-frames offer from the screen's size and where the layout record puts the position badge and the rival's bar. The top row holds the position badge, the pause button, the rival's bar and, where the widest gap between them is 260 px or more, the ticker. A narrower screen gives the ticker its own row under the top row, and a rival's bar that would sit on the position badge drops to the column under the top row. The objective (two lines at most; three in the narrow column) and the heat badge go under that, one above the other past the road ahead on a wide screen, side by side on a narrow one. Every slot is reserved while its widget is hidden, so nothing jumps when a rival or the heat comes up, and a text widget that overlaps a touch button moves up until it is 6 px clear. [default] (Not phone-verified.)
- **The network map is on the pause screen only**, with nothing permanent on the HUD (interview, 2026-10-02: "Maybe just map on pause"). The keyboard controls also show on the pause screen only, never the HUD (playtest 1, 2026-09-30: "don't clutter the in-game HUD with those controls"). [decided]
- Save on the device, plus an export code. There's an import screen for pasting a code. [decided]
- A **"copy debug report"** button gathers the build ID, the device and GPU description, the settings, recent errors, veto flags and the recent input recording. Nothing is sent anywhere automatically. [default]
  - The report has two parts: a short text summary (2 KB at most) copied to the clipboard, and the full report (recording, events, veto flags) saved as a `.txt` file through the phone's share sheet, with a plain download as the fallback. The file can then be attached in chat. Clipboard size limits on Android are *(unverified)*. [default]
- **In-game veto.** Long-press a bark subtitle, a billboard or a sign and choose "cut this". The flag goes into the debug report, and agents then remove the item from the game and record it in the [taste log](./tone-guide.md#taste-log). [decided]
  - Mechanics [default]: every displayed bark, sign and billboard carries its content ID. Both thumbs are busy mid-race, so the long-press is guaranteed on the pause screen's "recently seen" list (the last 20 items), in replays and interludes, and on world objects while paused. A mid-race long-press is welcome where it works but isn't required. Flags are stored on the device and included in the debug report. The agent's fix sets the item's `status` to `vetoed`, which keeps it in the file and makes the loader skip it.
  - Radio tracks can be cut the same way once radio exists [decided]: a long-press on the playing track in the pause menu's station panel. [default]
- Stats and analytics are parked until later. The maintainer said "figure out stats later". [decided]
- Every race quietly records its inputs, for bug replays now and ghost races later. [decided]
- The game auto-pauses on an app switch, a screen lock or a call, and resumes mid-race even after the tab reloads. [decided]
- The pause menu offers resume, restart, quit, the controls and HUD editor, the tuning panel (hidden unless enabled) and "copy debug report". [decided]
- A credits and data-licences page, including map-data attribution where real map data is used. [default]
- Offline play is preferred. [decided] The plan: the game works offline after the first load and can be installed as an app icon. [default]
- In-world billboards are satire, not ads. Real sponsor billboards are a "maybe", only if unobtrusive. [decided] They are not planned for v1. [default]
- The game is played through the direct game link, not an embedded page, so fullscreen and orientation lock work. [decided]

## Content and extensibility

- Tracks, rivals, bikes, weapons, barks, events, regions and HUD elements are data files and content packs. New content needs no code change wherever that's feasible. [decided]
- Full player modding is "maybe later". The pack format makes it cheap. [decided]
- Agents invent content freely within [the tone guide](./tone-guide.md). The maintainer vetoes, and vetoes go into the taste log. [decided]
- Nothing blocks multiplayer later: simulation, input and rendering stay separate. [decided]
- Format details are in [the content-pack doc](./content-packs.md) and [the architecture doc](./architecture.md#content-registry).

## v1 scope and launch bar

### What v1 is

- One great track, the Keys coastal highway, with the full loop: ride, fight, crash, get busted, earn, buy, advance, and beat the boss. [decided]
- More regions ride alongside it, crude first: the Pacific Northwest and San Francisco ("Pnw and sf first then others"; playtest 1c, 2026-09-30). [decided] They keep the game fun and prove the engine works beyond the Keys; the launch bar below is still measured on the Keys. [default]
- The eight rivals with personalities, grudges and barks; cops and busts; the career in 4 event types, on each region's map (see [Career](#career)); cash; six bikes for sale plus slow bikes; paint; interludes. [decided]
- Takedowns with toggleable slow motion; jumps and one ramp shortcut; traffic, pedestrians, animals and oddities. [decided]
- Touch and keyboard controls, with gamepad support around milestone 2. [decided]
- Settings, accessibility basics, the tuning panel, the what's-new card, the changelog, save and export. [decided]
- Weird events (milestone 4 or the shelf) and radio stations (after the milestone 1 and 2 score) are part of the plan, not of the first milestones. [default]
- Milestone 1 is everything, equally crude, cops included. [decided] The approved list, from the blueprint page: "a curvy road with hills, your bike, 4 box rivals, traffic cars, touch and keyboard controls, auto-target attacks, crash and run-back, a finish line with placing, engine and hit sounds, the chase cam, a cop, and the tuning panel". [decided]
- When things land is owned by [the roadmap](./roadmap.md#where-each-v1-item-lands); milestone 1's task plan is [M1.md](./milestones/M1.md). Everything in this spec beyond the approved list is v1 scope, not milestone 1 scope.
- The style-cash sources (near-miss traffic, airtime, oncoming-lane riding, takedown combos and weapon steals), difficulty presets, the pause menu with auto-pause and resume, and the vehicles above are v1 scope. [decided]

- Weird events and radio stations are reserved as data formats from the start; radio and DJ lines land after the milestone 1 and 2 single score. [default]
- The game gets a real name before milestone 5. [decided]

### The launch bar

A public v1 launch needs all four. [decided] How each is checked: [default]

| Bar | Passes when | Who judges |
|---|---|---|
| **Feel** | Steering, hits, kicks, steals, crashes and takedowns feel right on the phone, and a tuning preset is locked in. | The maintainer, by playing |
| **Look** | The post-milestone-1 look test has chosen a style, and the game has a recognizable visual identity. | The maintainer |
| **Runs well on the A16** | Over a 15-minute session at the largest race field, with traffic and cops, the 95th-percentile frame time stays within the target frame interval and the slowest 1% of frames stay at 30 fps or better, excluding loading holds. The median frame rate in minute 15 is within 10% of minute 1, as the proxy for thermal slowdown, because a web page can't read the phone's temperature. Measured on the phone itself, never on desktop emulation. The frame-rate priority is smooth first [decided] (cockpit answer, 2026-09-29), so the bar is measured at the default setting, not the battery saver, with a target interval of the display's refresh interval at the default full-rate setting (11.1 ms on a 90 Hz panel, 16.7 ms on a 60 Hz one) [default], and 16.7 ms (60 fps) as the floor the answer names ("60 frames per second or better") [decided]; see [the architecture doc](./architecture.md#performance-budgets). Frame-rate cap options should be divisors of the measured display rate (for example 90, 45 and 30 on a 90 Hz panel), because an uneven cap judders. | Measured, reported with device, renderer and scene named |
| **Personality** | Rivals, barks, signs, billboards and interludes make the maintainer laugh, with no open vetoes. | The maintainer |

- The spec-sheet figures for the A16 (a Mali-G57 MC2 GPU and a 90 Hz display) come from spec listings. Regional models may differ *(unverified)*. [default]

## Non-goals for v1

v1 will not have any of these. Several are on the [idea shelf](#idea-shelf), and nothing here is "never".

| Not in v1 | Tag |
|---|---|
| Multiplayer (the design leaves room for it) | [decided: later; default: not in v1] |
| Accounts; online leaderboards | [decided] |
| Cloud save | [decided: later; default: not in v1] |
| Ads and in-app purchases | [decided] |
| Live AI (a radio DJ, live commentary, live barks) | [default] |
| Stats and telemetry | [default] |
| Open areas, real terrain and free roam off the road network (the ground band and dirt shortcuts are in, interview, 2026-10-02) | [decided: later] |
| A trick-combo meter (flips, the wheelie launch and the drift meter are in, interview 2026-10-02 and playtest 3) | [decided] |
| Heat and grudges that carry across sessions in free roam (a career save does keep grudges, [decided] cockpit answer, 2026-09-29) | [decided: later; default: not in v1] |
| A playable cop mode | [decided: later; default: not in v1] |
| Deep crews, factions and reputation | [decided: later; default: not in v1] |
| Bike parts and customization beyond paint | [decided] |
| Weather | [decided: later; default: not in v1] |
| New race types, beyond the classic race, the career's event types and the drift events of playtest 3 ("These can wait until later", playtest 1c, 2026-09-30). Playtest 4 (2026-10-04) leaves it open: "idk I need to consider more options and compare to career, other games, etc" | [open] (`product-new-race-types`) |
| Dynamic music; radio DJ lines; AI-generated songs ("More code-made music only", interview, 2026-10-02) | [decided: later; default: not in v1] |
| The Rerun: your last attempt rides in the field as a rival you can punch (interview, 2026-10-02: "Later") | [decided: later] |
| Cruise mode; the cruise-control button (both on the shelf, cockpit answer, 2026-09-29) | [decided] |
| Player mods beyond the content-pack format | [decided] |
| Gore | [decided] |
| Guns and vehicle-mounted weapons | [default] |
| Licensed music | [default] |
| "Road Rash" in any name or branding | [decided] |

Stats and live AI are parked, not refused: the maintainer decides them once something fun exists. [decided] Radio stations by genre are planned; only their timing is a proposal.

## Idea shelf

Ideas wait here until a playtest earns them a place. Not now doesn't mean never. [default for the earn-its-way rule]

- **Game ideas** [decided]:
  - a Tony Hawk-style combo meter
  - Mad Max vehicle weapons
  - Hades-style rival memory and meta-progression
  - a gang or faction system
  - a playable cop mode
  - time trials with leaderboards
  - Crazy Taxi and GTA-style side jobs
  - photo mode
  - bike parts
  - (left the shelf: heat and pursuit, flips and riding off-road, interview, 2026-10-02; the wheelie and drift, playtest 3)
  - cruise mode, together with the cruise-control button (the maintainer's "Both", cockpit answer, 2026-09-29)
- **AI and online** [decided]:
  - an AI radio DJ that reacts to where you're riding
  - live race commentary
  - dynamic music
  - opt-in anonymous stats
  - cloud save
  - multiplayer
  - more regions
- **The empire and Scarface vibe** is flavor only. [decided]
- **Easter eggs**, all wanted [decided]: secret roads and shortcuts, a secret rider or bike, 90s-internet references and real-place gags. Timing is the shelf or milestones 4 and 5. [default]
- **Planners' additions** [default]:
  - a "dodge to the side and come back" weapon grab
  - a backhand attack
  - nitro or boost earned by aggression, the Burnout way
  - a daily seeded route
  - auto-clipped takedown replays
  - ghost races from the input recordings

## Open decisions

One is open: new race and challenge types (below). The three questions this spec raised were answered in the maintainer's cockpit on 2026-09-29:

| ID | Answer | Where it lands |
|---|---|---|
| `product-failure-states` [decided] | Road Trip is the default, with Classic and Hardcore as later options. | [Failure states](#failure-states) |
| `milestones-career-grudges-persist` [decided] | Yes: grudges are saved with the career. | [Rivals](#rivals), [the M4 plan](./milestones/M4.md#save-3--the-profile-and-the-export-code) |
| `product-cruise-meaning` [decided] | Both: the cruise mode and the cruise-control button stay together on the shelf. | [Controls](#controls), [Idea shelf](#idea-shelf) |
| `product-new-race-types` [open] | Playtest 4 (2026-10-04), asked about other race and challenge types for menu races: "idk I need to consider more options and compare to career, other games, etc". Nothing is built until he decides. If he wants it, an agent offers a comparison page (race types against the career and other games) to decide from. | [UX and menus](#ux-and-menus), [Non-goals](#non-goals-for-v1) |

The same round also settled items this spec carries: the frame-rate priority (smooth first, [Settings](#settings)), the radio's music source (code-made and AI tracks, vetoable, [Audio](#audio)) and the real-road choice (the maintainer rides both, [World frame](#world-frame)).

## Provenance

This section lists sources; it makes no design choices.

- Maintainer decisions come from the September 2026 interview and the blueprint playback page, which the maintainer said "mostly looks right", and from the phone playtests and their interviews, kept word for word in [docs/playtests/](./playtests/README.md).
- Weapon-steal wording: the Road Rash 3DO manual (1994), archived at `https://archive.org/details/Road_Rash_1994_Electronic_Arts_US`. The quote was checked against that manual's text.
- Busting, fines and "back off to recover": the 3DO, Sega CD and Saturn manuals, as summarized in the research notes.
- Touch-control precedents and web-platform facts: lane research. Where quotes weren't fetched first-hand, they are marked *(unverified)* above.
