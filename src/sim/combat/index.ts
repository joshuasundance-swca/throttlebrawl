// sim/combat: attacks with real timing windows, auto-target, hits and the crude hit-stop
// (docs/milestones/M1.md, combat-1). Punch and kick are weapon entries like any other
// (packs/base/weapons/punch.json and kick.json); every duration arrives in ticks on SimWeaponDef.
//
// Rules, in brief:
// - An attack starts on the tick its `attack` flag rises (docs/architecture.md, "Movers"): a
//   wind-up, a short active moment, a recovery, and for a rival's weapon with a cooldown (the kick)
//   a cooldown after that. A rival's kick asked for during its cooldown becomes a punch. A player's
//   kick has no cooldown: it waits only for the leg's return (playtest 4, [decided] "No wait": about
//   0.8 s between kicks), so a player's kick is never swapped for a punch. Rivals keep the data's
//   wait, so they kick as often as before (their AI paces by the whole cycle). [default]
// - The press buffer (playtest 4, P4-6: "reduce delay between tap and attack"; the feel audit's F1).
//   A player's press made anywhere in a recovery is kept (run A's live check, punch item 3: the
//   last 10 ticks dropped a mashing thumb's presses), and the attack starts on the first legal tick:
//   the tick the recovery ends, or the stagger after it. Presses in the wind-up and the active moment
//   are the same swing and are ignored, as in M1. A player's press made while staggered is kept the
//   same way (M2 combat-3). The latest press wins; it keeps its flags while it waits: a kick asked
//   for at the press or by a swipe recognised later stays a kick, and the latest side wins. Rivals'
//   presses are never kept: the AI presses again when it wants to. [default]
// - Phase timers count scaled time (world.timeScale per tick); only the hit-stop countdown runs
//   on raw ticks, because a countdown scaled by a zero timeScale would never end.
// - Auto-target picks the nearest valid rider in the acquisition box, preferring a non-cop. The
//   side is the sign of the target's lateral offset; the side flags override it during the
//   wind-up (and re-pick the target on that side), never once the active moment has started.
//   An attack with no target yet re-aims every tick of its wind-up (playtest 4, the feel audit's
//   F2): a press made before the rider is inside the box picks him, and his side, once he is. One
//   still without a target by its active moment swings at either side (side 0), never only the
//   right. [default]
// - A bump never cancels an attack (playtest 4, P4-6: "bumping into a rival while attacking doesn't
//   negate the attack"). The riding phase's contact (sim/riders/contact) holds two bikes 2 m apart
//   nose to tail, merges their speeds and glances them apart, so a rider you ride into is pushed
//   out of a punch's or kick's reach before it lands. When a player's bike touches the rider his
//   attack is aimed at (or, with none, a rider on its side) during its wind-up or active moment, or
//   in the BUMP_AFTER_TICKS (0.5 s) before its press (run B's B15: a press just after a rear bump
//   found the rider 2 m ahead, past every reach), the attack lands on that rider in its active
//   moment while he is within BUMP_REACH_M along and across. Without a bump the reach boxes are
//   unchanged, and rivals' attacks keep the reach box. A clear side swipe (one side flag) lets go of
//   a touched rider on the other side, so it never lands there (run A's check, punch item 5: a
//   punch's bump on the right carried into the left kick it became). [default]
// - The kick conversion (M2 combat-3, playtest 1 item 3): a `kick` flag converts any attack but a
//   kick into a kick while it is still in its wind-up (M1's rule), or while it is no older than
//   combat.kickConvertMs (default 250 ms, 15 ticks) in any phase. A natural swipe-down takes longer
//   than the punch's 7-tick wind-up to recognise, so the window reaches past it. Inside the window
//   the kick keeps the attack's age (capped one tick short of the kick's wind-up), so a swipe lands
//   on the kick's own schedule from the press, never later; outside it (a late change of mind
//   during a long pipe wind-up) the kick's wind-up starts from zero, as in M1. A punch that has
//   already landed stands: the jab, then the kick. The input lane's gesture-timing invariant checks
//   its swipe window against this window.
// - The directional kick (playtest 2, 2026-10-02: "Kick timing requires the ability to choose kick
//   direction as you ride up behind someone (directional swipe)"). A kick with ONE side flag kicks
//   to that side whatever side the rider ahead is on at the press, so a player riding up behind
//   someone commits to the side they will pass on (the side flags already worked this way for
//   every attack). A kick with BOTH side flags is the straight kick: it aims at the rider directly
//   ahead (|Δd| ≤ STRAIGHT_KICK_D_M) and reaches combat.straightKickReachM (2 m) forward, past the
//   side kick's 1 m, and shoves him away from the kicker's line like any kick. Both flags without
//   the kick stay an auto-sided attack, as before. The straight choice is made at the press, or by
//   the flags during the wind-up (and so by a kick conversion), like the side; `attackStart` and
//   `hit` carry `straight: true`. [default]
// - The hit test runs only while active, against that weapon's reach box on the chosen side. One
//   hit per attack; no hit by the end of the active moment is an `attackMiss`.
// - A landed hit: damage to health, a stagger (the target cannot start an attack, its own wind-up
//   is interrupted, and the riders phase's wobble halves its steering and shakes the bike for the
//   stagger's length; a non-player's hit on a player scales both by combat.onPlayerScale, so his
//   attacks come back the tick his wobble ends: run A's check, punch item 4), a sideways shove away from the attacker, and at zero health a `crash` event
//   (tumble-1 turns it into the tumble). A hit involving a player sets timeScale to 0 for
//   hitStopMs × combat.hitStopScale (rival-against-rival hits get none).
// - The shove (M2 combat-3, playtest 1 item 4) is a short curve: the lateral speed peaks on the
//   hit and falls linearly to zero over combat.knockbackDecayS of world time, so it moves the
//   target peak × decay / 2 metres, integrated exactly per tick. The peak is the weapon's
//   knockbackMps × combat.knockbackScale (× combat.kickShoveScale for a kick) × the total-mass
//   ratio attacker/target (rider plus bike, clamped 0.5–2) × the attacker's bike hitPowerScale ×
//   (1 − the target's bike knockbackResistance). At the defaults a kick (18 m/s over 0.4 s) moves
//   the target 3.6 m, about a lane, like a forced swerve, possibly into traffic. A punch
//   (3.3 m/s) and the pipe (7.5 m/s) keep M1's nudges, 0.66 m and 1.5 m: the stagger is what is
//   new for them. (A 0.3 m punch kept the bot's fights alongside a rival going, which slowed it
//   and raised the cop's bust rate from 9 to 13 in 40 bot races; M1's nudge ends a fight as before.)
//   The shove stops at the drivable edge (riders' riderLimits: the verge's edge with off-road on). A non-player's kick on a player
//   shoves by combat.onPlayerScale, and any non-player's hit on a player wobbles by it (default
//   0.4, so a rival's kick moves you about 1.4 m, near M1's 1.7 m, and a rival's punch keeps M1's
//   0.66 m): the big shove is the player's new tool, and playtest 1 asked that rivals stay as hard
//   as they were. At 1.0 an 8-race bot batch saw hits on the player rise from 27 to 51 and
//   knock-offs from 0 to 7. Each `hit` event
//   carries `hitImpulse`, a 0..1 strength for the camera jolt and haptics: (the weapon's data
//   damage + peak shove m/s) / 40, capped at 1.
// - Knockdowns (playtest 2, 2026-10-02: "surprising how long it takes to knock people down"): a
//   hit's damage is the weapon's data damage × combat.unarmedDamageScale (2) for the punch and the
//   kick, or × combat.weaponDamageScale (2.5) for a held weapon, so a fresh 100-point rival goes
//   down in 3 kicks (36), 5 punches (20) or 2 pipe swings (55), never one. The scales apply to a
//   PLAYER's hits; a non-player's hit on a player takes combat.onPlayerDamageScale (1), and rivals'
//   and cops' hits on each other keep the data damage, as before. [default]
//   (Scaling every hit cut a San Francisco player's cop-weapon steals from 8 races in 10 to 4 in
//   tests/sim/cops-steal-chance; scaling the player's alone keeps it at 6.) The dev bot fights
//   little, so the 12-race seeded batch moves only a little: the bot's knock-offs 3 -> 4, its hits
//   per knock-off 3 -> 2, busts 2 -> 2.
// - Fight stats (playtest 2, interview round 3: "Visible personalities", moderate differences shown
//   through how rivals ride and fight), in the player's own fights, like the knockdown scales: a
//   rider's stats.toughness divides the damage and the stagger the player's hits do to it, and a
//   rival's stats.power multiplies its hits on the player by combat.powerOnPlayer (default 0, so
//   rivals hit you as hard as before: playtest 1 item 7). Both are 1 when absent, 0.5-2; each
//   rival's numbers are in its pack file. Fights among rivals and cops keep their data numbers until
//   the AI-personality run. [default] The 50-race batch's bot busts (cap 15) swing with any sim
//   change: on one main, the knockdown retune alone gave 6, stats in every fight 15, stats in the
//   player's fights 11; after main moved, the last gave 1. So this rule rests on playtest 1 item 7
//   and on matching the knockdown scales, not on the batch.
// - The career's gentle climb (playtest 3, round 3 "Fights: gentle climb", accepted): the field
//   level's power scale (SimRiderDef.levelPower, from FieldLevel.powerScale: 0.9 at a region's
//   first tier up to 1.12 at its last in season 1) is kept apart from a rival's own stats.power,
//   and reaches the player's fights on its own: a rival's hit on the player is times
//   1 + (levelPower - 1) × combat.levelPowerOnPlayer (1), at most combat.levelPowerMax (1.15, so
//   season 2's higher levels stay inside "about 10-15% harder"). A region's first tier hits about
//   10% softer, never harder than before; no level, a level of 1, the player's hits and the cops'
//   and fights among rivals are untouched. Damage only: the shove and the stagger keep their
//   numbers. [default] The rival's health scale (FieldLevel.healthScale) makes the "easier or
//   harder to knock down" half.
// - Health recovers out of combat (M2 combat-3): after combat.regenDelayS of world time with no
//   attack started, landed or received, a riding player regains combat.regenPerS points a second,
//   in whole points, up to the maximum. Rivals and the cop do not recover.
// - The momentum kick (playtest 1 item 9): a kick's shove adds the kicker's own sideways speed
//   toward the target (speed × sin(yaw) along d), × combat.momentumKickGain (1), capped at
//   combat.momentumKickMaxMps (8 m/s, 1.6 m more). Steering away adds nothing.
// - One cause id per attack: attackStart, hit, kick, attackMiss and the resulting crash share it.
//
// Takedowns and the slow motion (docs/milestones/M2.md, combat-4):
// - A rider who goes down within combat.takedownWindowS (2 s, raw ticks from the hit to the crash)
//   of a landed hit is a `takedown` for its lastAttackerId: `data.kind` `health` (the finishing
//   hit), `traffic` (a car, a big pedestrian or animal, a flying body) or `scenery` (anything
//   else). Crashes come from world.lastEvents, since traffic, peds and tumble run after combat,
//   so the takedown comes one tick after the crash and carries its causeId. A crash with
//   data.contact `tumble` (a body already down touching a car) never counts; one fall is one
//   takedown at most.
// - Domino credit (W-Q, the pitch deck's item 4: "A rider you launch who knocks another off counts
//   as your takedown ('DOUBLE', then 'STRIKE')"). A fall with no hit credit of its own whose crash
//   says a flying body knocked it off (sim/tumble: data.cause `tumble`, target = the body's rider)
//   is a takedown for whoever was credited with that body's fall, kind `traffic`, with
//   data.domino = the chain's length: 2 for the first rider the body takes out (a DOUBLE), 3 and up
//   for the next one down the line (a STRIKE). A rider's own fall carries no credit to itself.
//   [default]
// - A traffic or scenery takedown with a player on either side, with SimConfig.slowMo on, starts
//   the slow motion on the takedown's tick: timeScale combat.slowmoScale (0.3) for
//   combat.slowmoS (0.8 s, 48 raw ticks), `slowmoStart` then `slowmoEnd`, none within
//   combat.slowmoCooldownS (8 s) of the last start. A hit-stop inside it pauses its count and
//   restores the slow scale; world.facts.slowmo shows the ticks left.
//
// Pickup weapons and the steal (docs/milestones/M1.md, combat-2):
// - Each non-unarmed weapon in the config (the lead pipe in M1) lies on the road as a `pickup`
//   entity at fixed spots along the route. A riding rider (not a cop) who holds nothing and passes
//   over one picks it up (a `weaponGrab` event with `data.source` 'road').
// - A held weapon replaces the punch: an attack press swings it (its own wind-up, active moment
//   and recovery from data). The kick stays a kick, and a kick flag during any wind-up but the
//   kick's own still turns the attack into a kick.
// - The steal: an attack press by a rider (not a cop), while an opponent's held weapon is in
//   its wind-up at an age inside the weapon's steal window (ticks 7–20 of the pipe's 20, both ends
//   included, counted in scaled time) and the thief is inside that weapon's reach box, takes the
//   weapon instead of starting an attack. The swing is cancelled, and one `weaponGrab` event
//   (`data.source` 'steal', target = the robbed rider, the swing's causeId) records the move. The
//   steal pass runs before any attack advances, so the outcome does not depend on entity order.
//   A thief with full hands drops his own weapon where he is (it lies on the road as a pickup
//   again; `data.dropped` names it) and takes the swung one: the W-O polish run, after the skeptic
//   saw 4 of 11 cop steal windows come while the player held a road weapon, so the steal cue asked
//   for a press that only swung the pipe. [default]
// - The telegraph: when a held weapon's wind-up reaches its steal window, a `stealWindow` event
//   (render's glint, audio's cue).
// - A rider who wrecks (leaves Road/Airborne, or reaches zero health) drops the weapon where it
//   is; it lies on the road as a pickup again. A held pickup entity is stowed below the road
//   (h = STOWED_H) so presentation shows it only through the holder's `heldWeapon`.
//
// Every v1 weapon (docs/milestones/M4.md, weapons-2; a head start, crude first):
// - Each weapon names a registered behaviour (WEAPON_BEHAVIOURS, a closed list; absent or unknown
//   is `melee.swing`), so a new weapon that reuses one is data only. Every behaviour is the M1
//   swing (timing, reach, damage, shove, stagger from data); `melee.wrap` (the chain) also drags
//   the target's speed by combat.wrapDragMps, and `taser.stun` also stuns: the target cannot
//   attack and wobbles for the weapon's stunTicks × combat.stunScale, and loses
//   combat.stunSpeedLoss of its speed. The `hit` event carries `dragMps` or `stunTicks`.
// - Weapons with verbs (run W-T, the pitch deck's #4). [default]
//   - `throw.burst` (Kevin's briefcase): the swing's wind-up as usual (snatchable in it, from arm's
//     length only, THROW_SNATCH_M), then at its end the weapon leaves the hand (a `throw` event)
//     as its own pickup entity flying up the road at the thrower's speed + combat.throwSpeedMps,
//     aimed at the nearest rider up to reach.sM ahead and reach.dM to either side. The first rider
//     but the thrower inside the THROW_HIT box takes a normal hit (damage, shove, stagger), and the
//     weapon bursts: `hit` with `thrown`, `burst`, `spent` and the burst point in world metres
//     (`burstX/Y/Z`, render's paperwork). One that flies its length bursts where it lands
//     (`attackMiss`, the same data). One throw, and it is gone for the race.
//   - `melee.yank` (the chain): the wrap's drag, and the shove turns round: it pulls the target
//     across the attacker's line to combat.yankPastM beyond it (`hit` carries `yank`, `yankM`). A
//     rider yanked from his oncoming side comes out in the oncoming lane.
//   - `melee.sweep` (the campaign sign, the canoe paddle): one swing lands once on a rider on each
//     side through its active moment, right side first, never twice on one rider; each is shoved
//     away (`hit` carries `sweep`), and only the first landing spends a use.
// - A cop's landed hit on a player is softened by combat.copOnPlayerScale (damage, shove and
//   stun): an armed cop swings so you can snatch his weapon, not to raise the bust rate.
// - Uses live on the pickup entity, so a stolen weapon keeps what it has left. `charges` (the
//   taser) are spent one per swing that reaches its active moment; the swing that spends the last
//   one finishes, then the weapon is gone. `durabilityHits` (junk, the club) are spent one per
//   landed hit; the last one breaks it on the blow. A spent weapon's pickup stays stowed for good
//   (pickupHolder SPENT) and its holder is bare-handed again. The `hit` (or `attackMiss`) of the
//   swing that uses the last of a weapon carries `spent: true`.
// - Roadside spawns: each spot draws its weapon from the `combat` stream, weighted by
//   roadsideWeight (absent: 1; 0, the cops' baton and taser, never lies on the road). The spots
//   (W-Q, playtest 2's "Weapons should do more"; the pitch deck's "pickups turn up about every
//   500 m instead of three fixed spots"): one per `combat.pickupSpacingM` of route (at least one),
//   each somewhere in the middle half of its own stretch, drawn from the `combat` stream first, so
//   every seed lays them differently and a replay lays them the same. [default]
// - A weapon by the bike (W-Q, the pitch deck's item 11, "fill the dead air after a crash"): when
//   a player who holds no weapon gets up after a crash (tumble's `getUp`), with chance
//   `combat.crashWeaponChance` (0.3) a roadside weapon, drawn by roadsideWeight from the `combat`
//   stream, lies CRASH_WEAPON_AHEAD_M up the road from the parked bike, on its line, so riding off
//   picks it up. The roll is drawn for every player get-up, so the stream stays aligned. [default]
// - A rider's startingWeapon (a cop's baton or taser) is in hand at the start, as a stowed
//   pickup, so the M1 steal takes it off him like any held weapon. Cops still never pick up, and
//   a cop keeps his weapon through a wreck (holstered; the cops polish round, 2026-10-01): before,
//   his first crash dropped it for good, so in San Francisco, where he crashed about three times a
//   race, he hardly ever swung and you hardly ever had a steal chance. [default]
import { clamp, nextFloat, sin, type EntityId, type TuningParamDecl } from '../../core';
import type { RoadNetwork } from '../../road';
import { riderLimits, riderState } from '../riders';
import { parkedBike } from '../tumble';
import { InputFlag, type AttackPhase, type SimConfig, type SimWeaponDef, type TakedownKind } from '../types';
import { addMover, emit, setSlowmo, systemState, type Mover, type SimSystem, type World } from '../world';

/** The tuning key of the height a hit reaches up or down (supports). */
export const REACH_HEIGHT_KEY = 'combat.reachHeightM';

export const COMBAT_TUNING: readonly TuningParamDecl[] = [
  {
    // Supports (the maintainer, 2026-10-06: riders land on vehicles and ride them): a punch, a kick, a
    // swung weapon or a snatch reaches a rider only this far above or below the attacker, m, so a
    // rider on a truck's roof and one on the road below cannot fight, and two on the same roof can.
    // About a leg's reach from the saddle. [default] A race whose tuning leaves it out (every
    // recording made before) reaches any height, as before.
    id: REACH_HEIGHT_KEY,
    group: 'combat',
    label: 'Hits reach up or down',
    default: 1,
    min: 0.25,
    max: 5,
    step: 0.25,
    unit: 'm',
    affectsSim: true,
  },
  {
    id: 'combat.hitStopScale',
    group: 'combat',
    label: 'Hit-stop',
    default: 1,
    min: 0,
    max: 3,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.knockbackScale',
    group: 'combat',
    label: 'Knockback',
    default: 1,
    min: 0,
    max: 3,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.kickShoveScale',
    group: 'combat',
    label: 'Kick shove',
    default: 1,
    min: 0,
    max: 2,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.knockbackDecayS',
    group: 'combat',
    label: 'Shove length',
    default: 0.4,
    min: 0.1,
    max: 1,
    step: 0.05,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'combat.staggerScale',
    group: 'combat',
    label: 'Stagger',
    default: 1,
    min: 0,
    max: 3,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  // Knockdowns (playtest 2, 2026-10-02: "surprising how long it takes to knock people down"; the
  // maintainer: "it should take a few hits even if they are kicks. Weapons should do more").
  {
    id: 'combat.unarmedDamageScale',
    group: 'combat',
    label: 'Punch and kick damage',
    default: 2,
    min: 0.5,
    max: 4,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.weaponDamageScale',
    group: 'combat',
    label: 'Weapon damage',
    default: 2.5,
    min: 0.5,
    max: 4,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.onPlayerDamageScale',
    group: 'combat',
    label: 'Rival damage on you',
    default: 1,
    min: 0,
    max: 4,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.powerOnPlayer',
    group: 'combat',
    label: 'Rival power on you',
    default: 0,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.levelPowerOnPlayer',
    group: 'combat',
    label: 'Field level power on you',
    default: 1,
    min: 0,
    max: 2,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.levelPowerMax',
    group: 'combat',
    label: 'Field level power, top',
    default: 1.15,
    min: 1,
    max: 1.5,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.kickConvertMs',
    group: 'combat',
    label: 'Kick swipe grace',
    default: 250,
    min: 0,
    max: 400,
    step: 10,
    unit: 'ms',
    affectsSim: true,
  },
  {
    id: 'combat.onPlayerScale',
    group: 'combat',
    label: 'Rival hits on you',
    default: 0.4,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.regenDelayS',
    group: 'combat',
    label: 'Recover after',
    default: 5,
    min: 0,
    max: 20,
    step: 0.5,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'combat.regenClearM',
    group: 'combat',
    label: 'Recover when clear by',
    default: 15,
    min: 0,
    max: 60,
    step: 1,
    unit: 'm',
    affectsSim: true,
  },
  {
    id: 'combat.regenPerS',
    group: 'combat',
    label: 'Recovery rate',
    default: 3,
    min: 0,
    max: 20,
    step: 0.5,
    unit: 'hp/s',
    affectsSim: true,
  },
  {
    id: 'combat.straightKickReachM',
    group: 'combat',
    label: 'Straight kick reach',
    default: 2,
    min: 0.5,
    max: 4,
    step: 0.1,
    unit: 'm',
    affectsSim: true,
  },
  {
    id: 'combat.momentumKickGain',
    group: 'combat',
    label: 'Momentum kick',
    default: 1,
    min: 0,
    max: 3,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.momentumKickMaxMps',
    group: 'combat',
    label: 'Momentum kick cap',
    default: 8,
    min: 0,
    max: 20,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    // W-Q: about one roadside weapon every 500 m of route (it was three fixed spots). [default]
    id: 'combat.pickupSpacingM',
    group: 'combat',
    label: 'A roadside weapon every',
    default: 500,
    min: 100,
    max: 3000,
    step: 50,
    unit: 'm',
    affectsSim: true,
    system: true,
  },
  {
    // W-Q: how often a weapon lies by your bike when you get up from a crash. [default]
    id: 'combat.crashWeaponChance',
    group: 'combat',
    label: 'Weapon by the bike after a crash',
    default: 0.3,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '',
    affectsSim: true,
    system: true,
  },
  {
    id: 'combat.wrapDragMps',
    group: 'combat',
    label: 'Chain drag',
    default: 4,
    min: 0,
    max: 15,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  // W-T, weapons with verbs (the pitch deck's #4): how fast a thrown weapon (Kevin's briefcase)
  // leaves the hand, on top of the thrower's own speed, and how far past your own line the chain's
  // yank swings a rival. [default]
  {
    id: 'combat.throwSpeedMps',
    group: 'combat',
    label: 'Throw speed',
    default: 16,
    min: 4,
    max: 40,
    step: 1,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    id: 'combat.yankPastM',
    group: 'combat',
    label: 'Chain yank past you',
    default: 1.2,
    min: 0,
    max: 3,
    step: 0.1,
    unit: 'm',
    affectsSim: true,
  },
  {
    id: 'combat.stunScale',
    group: 'combat',
    label: 'Taser stun',
    default: 1,
    min: 0,
    max: 3,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.stunSpeedLoss',
    group: 'combat',
    label: 'Taser speed loss',
    default: 0.2,
    min: 0,
    max: 0.8,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.copOnPlayerScale',
    group: 'combat',
    label: 'Cop hits on you',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.takedownWindowS',
    group: 'combat',
    label: 'Takedown credit window',
    default: 2,
    min: 0.5,
    max: 5,
    step: 0.1,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'combat.slowmoScale',
    group: 'combat',
    label: 'Slow motion speed',
    default: 0.3,
    min: 0.1,
    max: 1,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.slowmoS',
    group: 'combat',
    label: 'Slow motion length',
    default: 0.8,
    min: 0.2,
    max: 3,
    step: 0.05,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'combat.slowmoCooldownS',
    group: 'combat',
    label: 'Slow motion cooldown',
    default: 8,
    min: 0,
    max: 30,
    step: 0.5,
    unit: 's',
    affectsSim: true,
  },
];

/** The unarmed weapon entries, by content id. */
export const PUNCH_ID = 'base:punch';
export const KICK_ID = 'base:kick';

/** Auto-target acquisition box (M1 starting numbers): |Δs| ≤ 4 m, |Δd| ≤ 3 m. */
export const ACQUIRE_S_M = 4;
export const ACQUIRE_D_M = 3;
/** The straight kick's lateral half-width: it boots the rider directly ahead. [default] */
export const STRAIGHT_KICK_D_M = 1;
/**
 * How far (along and across, m) a rider a player's attack touched stays in its reach. Contact holds
 * two bikes 2 m apart nose to tail and glances them about 1 m further apart across within a punch's
 * or kick's wind-up and active moment; 3 m covers both. [default]
 */
export const BUMP_REACH_M = 3;
/**
 * A player's attack started this many ticks (0.5 s) after his bike last touched a rider counts that
 * bump as its own: a felt bump, the reaction to it and the thumb's way to the button. [default]
 */
export const BUMP_AFTER_TICKS = 30;
const SIDE_BITS = InputFlag.attackSideLeft | InputFlag.attackSideRight;
/** The attacker/target total-mass ratio is clamped to this range before it scales a shove. */
const MASS_RATIO_MIN = 0.5;
const MASS_RATIO_MAX = 2;
/** hitImpulse = (data damage + peak shove m/s) / this, capped at 1. */
const HIT_IMPULSE_FULL = 40;
/** Tolerance for comparing scaled-time sums against whole-tick durations. */
const EPS = 1e-9;

/** A rider picks up a weapon within this box: |Δs| ≤ 1 m (a tick at top speed is 0.63 m), |Δd| ≤ 1.5 m. */
export const PICKUP_S_M = 1;
export const PICKUP_D_M = 1.5;
/** Squared ground distance past which a rider is surely outside a pickup's box (6 m, m²). */
const PICKUP_NEAR_M2 = 36;
/** Riders higher than this above the road (mid-jump) fly over a pickup. */
const PICKUP_MAX_H = 1.5;
/** Height of a held pickup entity: below the road, out of sight (the holder shows it). */
export const STOWED_H = -20;
/** pickupHolder of a weapon that is used up (charges spent, or broken): gone for the race. */
export const SPENT = -2;

/** The registered weapon behaviours (weapons-2): a closed list; the file header says what each adds. */
export const WEAPON_BEHAVIOURS = [
  'melee.swing',
  'melee.wrap',
  'taser.stun',
  'throw.burst',
  'melee.yank',
  'melee.sweep',
] as const;

/** pickupHolder of a thrown weapon in the air (W-T): nobody holds it and nobody can pick it up. */
export const THROWN = -3;
/** A thrown weapon hits a rider within this box around it: |Δs| ≤ 1.2 m, |Δd| ≤ 0.9 m. [default] */
export const THROW_HIT_S_M = 1.2;
export const THROW_HIT_D_M = 0.9;
/** A thrown weapon can be snatched in its wind-up only from this close, m (its reach is its range). */
export const THROW_SNATCH_M = 1.6;
/** A thrown weapon leaves the hand this high, comes down to THROW_END_H and arcs THROW_ARC_M over. */
const THROW_START_H = 1.2;
const THROW_END_H = 0.2;
const THROW_ARC_M = 0.6;
export type WeaponBehaviour = (typeof WEAPON_BEHAVIOURS)[number];

/** A weapon's behaviour: its `behaviour` id when registered, else the M1 swing. */
export function behaviourOf(w: SimWeaponDef): WeaponBehaviour {
  const id = w.behaviour ?? 'melee.swing';
  return (WEAPON_BEHAVIOURS as readonly string[]).includes(id) ? (id as WeaponBehaviour) : 'melee.swing';
}

type ActivePhase = Exclude<AttackPhase, 'cooldown'>;

/** Per-rider plain state, by entity id. */
export interface CombatState {
  phase: ActivePhase[];
  /** Weapon content id of the current attack ('' when idle). */
  weapon: string[];
  /** Scaled ticks spent in the current phase. */
  elapsed: number[];
  /** Scaled ticks since the current attack started (its age across phases). */
  age: number[];
  /** Attack side in the attacker's frame: +1 right, -1 left. */
  side: number[];
  /** Whether the current attack is the straight kick (both side flags with the kick). */
  straight: boolean[];
  targetId: EntityId[];
  landed: boolean[];
  /** Cause id shared by every event of the current attack. */
  cause: number[];
  /** Scaled ticks left before the weapon in `cooldownWeapon` may start again. */
  cooldown: number[];
  cooldownWeapon: string[];
  /** Scaled ticks of stagger left. */
  stagger: number[];
  /** The current shove's peak speed along +d, m/s (0 = none). */
  knockPeak: number[];
  /** Scaled ticks into the current shove, and its whole length in ticks. */
  knockT: number[];
  knockTicks: number[];
  /** Scaled ticks since this rider last started, landed or took an attack. */
  calm: number[];
  /** Recovery owed, in 1/60 points (whole points are paid into health). */
  regenAcc: number[];
  lastAttackerId: EntityId[];
  /** Raw tick of the last hit this rider took (-1: none), for takedown credit. */
  hitTick: number[];
  /** Whether this rider's current fall has been looked at for a takedown (reset while riding). */
  downSeen: boolean[];
  /** Who was credited with this rider's current fall (-1: nobody), and the chain length (1: direct). */
  fallBy: EntityId[];
  fallChain: number[];
  /** Takedowns credited to each rider this race. */
  takedowns: number[];
  /** The takedown slow motion in progress (its raw ticks left are world.facts.slowmo). */
  slowmo: {
    actor: EntityId;
    target: EntityId;
    cause: number;
    /** The time scale to go back to when it ends. */
    resume: number;
    /** Raw tick it started (-1: never), for the length and the cooldown. */
    startTick: number;
  };
  /** Last tick's flags, for press edges. */
  prevFlags: number[];
  /** A player's kept attack press (made while staggered, or at the end of a recovery). */
  pending: boolean[];
  /** The kept press's kick and side flags (InputFlag bits), updated while it waits. */
  pendingFlags: number[];
  /** The rider a player's current attack touched (-1: none), for the bump rule. */
  touched: EntityId[];
  /** Raw ticks of hit-stop left, and the timeScale to restore afterwards. */
  hitStopTicks: number;
  resumeTimeScale: number;
  /** Held weapon content id per rider ('' = none), and the pickup entity it came from. */
  held: string[];
  heldPickup: EntityId[];
  /** Whether the current attack's steal cue has been emitted. */
  stealCued: boolean[];
  /** Pickup entity ids, in spawn order. */
  pickups: EntityId[];
  /** Per pickup entity: its weapon content id, and who holds it (-1 = lying on the road). */
  pickupWeapon: string[];
  pickupHolder: EntityId[];
  /** Per pickup entity: charges and durability hits left (absent until first spent: the weapon's own). */
  pickupCharges: number[];
  pickupHits: number[];
  /** The sweep (W-T): the sides the current swing has landed on (1 right, 2 left), and its first victim. */
  sweptSides: number[];
  sweepFirst: EntityId[];
  /** Thrown weapons in the air (W-T), in launch order. */
  flights: Flight[];
}

/** A thrown weapon in the air (W-T, `throw.burst`): plain data, so the state hash covers it. */
export interface Flight {
  pickup: EntityId;
  /** The thrower, and the throw's cause id (its attackStart's). */
  by: EntityId;
  cause: number;
  weapon: string;
  /** Speed along the road in the thrower's direction, m/s. */
  speed: number;
  /** The d it is aimed at, and how far it moves toward it per tick, m. */
  dTo: number;
  dStep: number;
  /** Scaled ticks in the air, and the flight's whole length. */
  age: number;
  ticks: number;
}

export function combatState(world: World): CombatState {
  return systemState<CombatState>(world, 'combat', () => ({
    phase: [],
    weapon: [],
    elapsed: [],
    age: [],
    side: [],
    straight: [],
    targetId: [],
    landed: [],
    cause: [],
    cooldown: [],
    cooldownWeapon: [],
    stagger: [],
    knockPeak: [],
    knockT: [],
    knockTicks: [],
    calm: [],
    regenAcc: [],
    lastAttackerId: [],
    hitTick: [],
    downSeen: [],
    fallBy: [],
    fallChain: [],
    takedowns: [],
    slowmo: { actor: -1, target: -1, cause: 0, resume: 1, startTick: -1 },
    prevFlags: [],
    pending: [],
    pendingFlags: [],
    touched: [],
    hitStopTicks: 0,
    resumeTimeScale: 1,
    held: [],
    heldPickup: [],
    stealCued: [],
    pickups: [],
    pickupWeapon: [],
    pickupHolder: [],
    pickupCharges: [],
    pickupHits: [],
    sweptSides: [],
    sweepFirst: [],
    flights: [],
  }));
}

/** What presentation needs about one rider's combat (fed into the snapshot). */
export interface CombatView {
  attackPhase: AttackPhase;
  targetId: EntityId;
  lastAttackerId: EntityId;
  heldWeapon: string | null;
}

export function combatView(world: World, id: EntityId): CombatView {
  const st = combatState(world);
  const phase = st.phase[id] ?? 'idle';
  return {
    attackPhase: phase === 'idle' && (st.cooldown[id] ?? 0) > EPS ? 'cooldown' : phase,
    targetId: phase === 'idle' ? -1 : (st.targetId[id] ?? -1),
    lastAttackerId: st.lastAttackerId[id] ?? -1,
    heldWeapon: st.held[id] || null,
  };
}

/** A pickup entity's weapon content id ('' for any other entity). */
export function pickupWeapon(world: World, id: EntityId): string {
  return combatState(world).pickupWeapon[id] ?? '';
}

/** Where `b` is relative to `a`: metres ahead along a's travel, and metres to a's right. */
export function relative(
  road: RoadNetwork,
  a: Mover,
  b: Mover,
  range: number,
): { ds: number; dd: number } | null {
  let bs: number | null = null;
  if (b.pos.edge === a.pos.edge) bs = b.pos.s;
  else {
    for (const n of road.neighbours(a.pos.edge, a.pos.s, range)) {
      if (n.edge === b.pos.edge) {
        bs = b.pos.s + n.sOffset;
        break;
      }
    }
  }
  if (bs === null) return null;
  return { ds: (bs - a.pos.s) * a.pos.dir, dd: (b.pos.d - a.pos.d) * a.pos.dir };
}

function weaponById(config: SimConfig, id: string): SimWeaponDef | undefined {
  return config.weapons.find((w) => w.contentId === id);
}

function isRiding(m: Mover): boolean {
  return m.kind === 'rider' && (m.mode === 'Road' || m.mode === 'Airborne');
}

/**
 * Whether b is within a hit's reach of a in height (`combat.reachHeightM`: a rider on a truck's roof is
 * out of reach of one on the road below; two on the same roof fight). Any height with the key left out.
 */
export function inReachHeight(world: World, a: Mover, b: Mover): boolean {
  return Math.abs(b.h - a.h) <= (world.params[REACH_HEIGHT_KEY] ?? Infinity);
}

function isLaw(config: SimConfig, m: Mover): boolean {
  return config.riders[m.riderIndex]?.faction === 'law';
}

function isPlayer(config: SimConfig, m: Mover): boolean {
  return config.riders[m.riderIndex]?.controller.kind === 'player';
}

interface Candidate {
  id: EntityId;
  dd: number;
  dist2: number;
  law: boolean;
}

/**
 * Valid riders inside a box (-sM ≤ Δs ≤ aheadM, |Δd| ≤ dM; aheadM defaults to sM) around `a`, on
 * `side` if it is nonzero. Sorted by preference: non-cops first, then nearest, then lowest id.
 */
function candidates(
  world: World,
  config: SimConfig,
  a: Mover,
  sM: number,
  dM: number,
  side: number,
  aheadM = sM,
): Candidate[] {
  const health = riderState(world).health;
  const out: Candidate[] = [];
  for (const b of world.movers) {
    if (b.id === a.id || !isRiding(b) || (health[b.id] ?? 0) <= 0 || !inReachHeight(world, a, b)) continue;
    const rel = relative(config.road, a, b, Math.max(sM, aheadM) + 2);
    if (!rel || rel.ds < -sM || rel.ds > aheadM || Math.abs(rel.dd) > dM) continue;
    if (side !== 0 && side * rel.dd < 0) continue;
    out.push({ id: b.id, dd: rel.dd, dist2: rel.ds * rel.ds + rel.dd * rel.dd, law: isLaw(config, b) });
  }
  return out.sort((x, y) => Number(x.law) - Number(y.law) || x.dist2 - y.dist2 || x.id - y.id);
}

function sideFlag(flags: number): number {
  const left = (flags & InputFlag.attackSideLeft) !== 0;
  const right = (flags & InputFlag.attackSideRight) !== 0;
  return left === right ? 0 : left ? -1 : 1;
}

/** Both side flags with the kick: the straight kick (playtest 2's directional kick). */
function straightFlag(flags: number): boolean {
  const both = InputFlag.attackSideLeft | InputFlag.attackSideRight;
  return (flags & InputFlag.kick) !== 0 && (flags & both) === both;
}

/**
 * Picks the auto-target and side for an attacker; `override` is a side flag (0 = none). The
 * straight kick aims at the nearest rider ahead inside the narrow straight box, and its side (the
 * way the shove goes) is the side he is on. With no override and nobody to aim at, the side is 0:
 * not chosen yet (the wind-up re-aims; the active moment swings at either side).
 */
function aim(
  world: World,
  config: SimConfig,
  a: Mover,
  override: number,
  straight = false,
): { target: EntityId; side: number } {
  const best = straight
    ? candidates(world, config, a, 0, STRAIGHT_KICK_D_M, 0, ACQUIRE_S_M)[0]
    : candidates(world, config, a, ACQUIRE_S_M, ACQUIRE_D_M, override)[0];
  if (override !== 0) return { target: best?.id ?? -1, side: override };
  if (!best) return { target: -1, side: 0 };
  return { target: best.id, side: best.dd < 0 ? -1 : 1 };
}

/**
 * The rider an attack by `id` would hit right now, or -1 (playtest 4, P4-6, "Auto-aim + swipe": the
 * player sees who a tap will hit). During an attack it is the attack's own target; otherwise it is
 * what an auto-sided press would aim at, by the same `aim()` the press uses, so the marker follows
 * the sim and never a copy of its rule. Only a rider that is riding and alive has one.
 */
export function aimPreview(world: World, config: SimConfig, id: EntityId): EntityId {
  const a = world.movers.find((m) => m.id === id);
  if (!a || !isRiding(a) || (riderState(world).health[id] ?? 0) <= 0) return -1;
  const st = combatState(world);
  if ((st.phase[id] ?? 'idle') !== 'idle') return st.targetId[id] ?? -1;
  return aim(world, config, a, 0).target;
}

/**
 * An attack with no target yet aims again (playtest 4, the audit's F2): an auto-sided one picks the
 * nearest rider and his side once he is in the box, a forced side keeps its side and picks a target
 * on it, and the straight kick looks ahead again.
 */
function reAim(world: World, config: SimConfig, st: CombatState, a: Mover): void {
  if ((st.targetId[a.id] ?? -1) >= 0) return;
  const straight = st.straight[a.id] === true;
  const aimed = aim(world, config, a, straight ? 0 : (st.side[a.id] ?? 0), straight);
  st.targetId[a.id] = aimed.target;
  st.side[a.id] = aimed.side;
}

/** A kept press's flags, updated by this tick's: the kick sticks once asked for, the latest side wins. */
function keepFlags(kept: number, now: number): number {
  const sides = (now & SIDE_BITS) !== 0 ? now & SIDE_BITS : kept & SIDE_BITS;
  return ((kept | now) & InputFlag.kick) | sides;
}

/**
 * Keeps a player's press (the stagger queue, the press buffer). A new press replaces the one kept
 * before it (the latest press wins); its kick and side flags then keep updating while it waits.
 */
function keep(st: CombatState, id: EntityId, flags: number): void {
  st.pendingFlags[id] = keepFlags(0, flags);
  st.pending[id] = true;
}

/**
 * Aims an attack from this tick's flags: the straight kick, a forced side, or the auto side. A forced
 * side (a clear side swipe) also lets go of a rider the attack touched on the other side, so the bump
 * rule never lands it there (run A's check, punch item 5: a punch's bump carried into the kick).
 */
function setAim(world: World, config: SimConfig, st: CombatState, a: Mover, flags: number): void {
  const straight = straightFlag(flags);
  const forced = straight ? 0 : sideFlag(flags);
  const aimed = aim(world, config, a, forced, straight);
  st.straight[a.id] = straight;
  st.targetId[a.id] = aimed.target;
  st.side[a.id] = aimed.side;
  const bumped = world.movers[st.touched[a.id] ?? -1];
  if (forced !== 0 && bumped) {
    const rel = relative(config.road, a, bumped, BUMP_REACH_M + 2);
    if (!rel || forced * rel.dd < 0) st.touched[a.id] = -1;
  }
}

function durationOf(w: SimWeaponDef, phase: ActivePhase): number {
  if (phase === 'windup') return w.windupTicks;
  if (phase === 'active') return w.activeTicks;
  return w.recoveryTicks;
}

/** Starts a wind-up; `age` is where it starts (non-zero only for a kick conversion). */
function startAttack(
  world: World,
  st: CombatState,
  a: Mover,
  w: SimWeaponDef,
  cause: number | undefined,
  age = 0,
): void {
  const id = a.id;
  st.phase[id] = 'windup';
  st.weapon[id] = w.contentId;
  st.elapsed[id] = age;
  st.age[id] = age;
  st.calm[id] = 0;
  st.landed[id] = false;
  st.stealCued[id] = false;
  st.sweptSides[id] = 0;
  st.sweepFirst[id] = -1;
  const target = st.targetId[id] ?? -1;
  const extra: { target?: EntityId; causeId?: number } = {};
  if (target >= 0) extra.target = target;
  if (cause !== undefined) extra.causeId = cause;
  const straight = w.contentId === KICK_ID && st.straight[id] === true;
  st.cause[id] = emit(
    world,
    'attackStart',
    id,
    { weapon: w.contentId, side: st.side[id] ?? 1, ...(straight ? { straight } : {}) },
    extra,
  );
}

function endAttack(st: CombatState, id: EntityId): void {
  st.phase[id] = 'idle';
  st.straight[id] = false;
  st.weapon[id] = '';
  st.elapsed[id] = 0;
  st.targetId[id] = -1;
  st.touched[id] = -1;
}

/** Advances an attack by `ts` scaled ticks through as many phase ends as that covers. */
function advance(world: World, config: SimConfig, st: CombatState, a: Mover, ts: number): void {
  const id = a.id;
  const w = weaponById(config, st.weapon[id] ?? '');
  if (st.phase[id] === 'idle' || !w) return;
  st.elapsed[id] = (st.elapsed[id] ?? 0) + ts;
  st.age[id] = (st.age[id] ?? 0) + ts;
  for (;;) {
    const phase: ActivePhase = st.phase[id] ?? 'idle';
    if (phase === 'idle') return;
    const dur = durationOf(w, phase);
    const elapsed: number = st.elapsed[id] ?? 0;
    if (elapsed + EPS < dur) return;
    st.elapsed[id] = elapsed - dur;
    if (phase === 'windup') {
      st.phase[id] = 'active';
      // A charged weapon (the taser) spends a charge as the swing goes off.
      if (st.held[id] === w.contentId && w.charges != null) {
        spendUse(st.pickupCharges, st.heldPickup[id] ?? -1, w.charges);
      }
      // A thrown weapon (W-T) leaves the hand now; its flight decides the hit or the miss.
      if (st.held[id] === w.contentId && behaviourOf(w) === 'throw.burst') {
        launch(world, config, st, a, w);
        st.landed[id] = true;
      }
    } else if (phase === 'active') {
      // A bump in the riding phase of the tick the active moment ends still lands (the bump rule).
      if (!st.landed[id] && !landBump(world, config, st, a, w)) {
        const target = st.targetId[id] ?? -1;
        const extra: { target?: EntityId; causeId?: number } = { causeId: st.cause[id] ?? 0 };
        if (target >= 0) extra.target = target;
        // A taser's last charge, fired into thin air: it goes at the end of this swing.
        const left = st.pickupCharges[st.heldPickup[id] ?? -1];
        const spent = st.held[id] === w.contentId && w.charges != null && (left ?? w.charges) <= 0;
        emit(
          world,
          'attackMiss',
          id,
          { weapon: w.contentId, side: st.side[id] ?? 1, ...(spent ? { spent } : {}) },
          extra,
        );
      }
      st.phase[id] = 'recovery';
    } else {
      // A player's attack waits for nothing but its own recovery ([decided] "No wait").
      if (w.cooldownTicks > 0 && !isPlayer(config, a)) {
        st.cooldown[id] = w.cooldownTicks;
        st.cooldownWeapon[id] = w.contentId;
      }
      endAttack(st, id);
      // The swing that spent the last charge is over: the weapon is gone.
      const pid = st.heldPickup[id] ?? -1;
      if (st.held[id] === w.contentId && w.charges != null && (st.pickupCharges[pid] ?? w.charges) <= 0) {
        retire(world, st, a);
      }
      return;
    }
  }
}

/**
 * The weapon a request resolves to: the held weapon (or the punch, bare-handed), or the kick when
 * asked for. A kick still cooling down falls back to the held weapon or the punch.
 */
function resolveWeapon(
  config: SimConfig,
  st: CombatState,
  id: EntityId,
  wantKick: boolean,
): SimWeaponDef | undefined {
  const main = (st.held[id] ? weaponById(config, st.held[id]) : undefined) ?? weaponById(config, PUNCH_ID);
  if (!wantKick) return main;
  const cooling = (st.cooldown[id] ?? 0) > EPS && st.cooldownWeapon[id] === KICK_ID;
  return cooling ? main : (weaponById(config, KICK_ID) ?? main);
}

/** How a hit lands beyond the swing's defaults (W-T: a thrown weapon's hit, a sweep's second side). */
interface LandOptions {
  /** The cause id to carry (a thrown weapon's throw); absent: the attacker's current attack. */
  cause?: number;
  /** Extra `hit` event data. */
  extra?: Record<string, number | string | boolean>;
  /** Whether this hit spends a use of a held breakable (false: a sweep's second side, a throw). */
  spend?: boolean;
}

function land(
  world: World,
  config: SimConfig,
  st: CombatState,
  a: Mover,
  victim: Mover,
  w: SimWeaponDef,
  dd: number,
  opts: LandOptions = {},
): void {
  const riders = riderState(world);
  const id = a.id;
  const vid = victim.id;
  const thrown = opts.cause !== undefined;
  const cause = opts.cause ?? st.cause[id] ?? 0;
  // A thrown weapon's hit belongs to a throw already over, not to whatever its thrower does now.
  if (!thrown) st.landed[id] = true;
  st.calm[id] = 0;
  st.calm[vid] = 0;
  const kick = w.contentId === KICK_ID;
  // A cop's hit on a player lands soft (combat.copOnPlayerScale on its damage, shove and stun):
  // his swing is there to be snatched, and playtest 1 asked that the cop stay as hard as he was.
  const copSoft =
    isLaw(config, a) && isPlayer(config, victim)
      ? clamp(world.params['combat.copOnPlayerScale'] ?? 0.5, 0, 1)
      : 1;
  // Fight stats (playtest 2, "Visible personalities"): the attacker's power, the target's toughness.
  // Only in the player's fights; a rival's power reaches the player by combat.powerOnPlayer.
  const byPlayer = isPlayer(config, a);
  const hitOnPlayer = isPlayer(config, victim) && !byPlayer;
  const power = byPlayer
    ? statOf(config, a, 'power')
    : hitOnPlayer
      ? 1 + (statOf(config, a, 'power') - 1) * clamp(world.params['combat.powerOnPlayer'] ?? 0, 0, 1)
      : 1;
  const toughness = byPlayer || hitOnPlayer ? statOf(config, victim, 'toughness') : 1;
  const climb = hitOnPlayer ? levelClimb(world, config, a) : 1;
  const damage = Math.round(
    (w.damage * damageScale(world, config, a, victim, w) * copSoft * power * climb) / toughness,
  );
  const health = Math.max(0, (riders.health[vid] ?? 0) - damage);
  riders.health[vid] = health;
  // The shove along d, away from the attacker (the attack side when they are level).
  const away = (dd === 0 ? (st.side[id] ?? 1) || 1 : dd < 0 ? -1 : 1) * a.pos.dir;
  // The momentum kick (playtest 1 item 9): a player kicking while steering into the target adds
  // their own sideways speed toward it to the shove, × combat.momentumKickGain, capped. Players
  // only: rivals steer constantly, and with it their pack fights changed enough to halve the
  // grudge holders' swings at the player (playtest 1 item 7: rivals stay as they are).
  const surge = kick && isPlayer(config, a) ? momentum(world, a, away) : 0;
  const fullPeak = shovePeak(world, config, a, victim, w) + surge;
  // A rider's kick on a player shoves less, and any rider's hit on a player wobbles less
  // (combat.onPlayerScale): the kick's lane-wide shove and the wobble are new, and the playtest
  // asked that rivals stay as hard as they were. A punch or the pipe keeps M1's nudge.
  const onPlayer =
    isPlayer(config, victim) && !isPlayer(config, a) ? (world.params['combat.onPlayerScale'] ?? 1) : 1;
  const peak = fullPeak * (kick ? onPlayer : 1) * copSoft;
  // The jolt reads the weapon's data damage, not the knockdown-scaled one, so the feel of each blow
  // stays as it was while rivals go down sooner.
  const hitImpulse = Math.min(1, (w.damage * copSoft + fullPeak * copSoft) / HIT_IMPULSE_FULL);
  const effect = behaviourEffect(world, st, victim, w, copSoft);
  // A breakable held weapon spends one hit (the last one breaks it on this blow); a taser on its
  // last charge goes at the end of this swing. Either way the hit says `spent`.
  const heldSwing = !thrown && opts.spend !== false && st.held[id] === w.contentId;
  const pid = st.heldPickup[id] ?? -1;
  const breaks = heldSwing && w.durabilityHits != null && spendUse(st.pickupHits, pid, w.durabilityHits) <= 0;
  const spent =
    thrown || breaks || (heldSwing && w.charges != null && (st.pickupCharges[pid] ?? w.charges) <= 0);
  const knockTicks = Math.max(1, Math.round((world.params['combat.knockbackDecayS'] ?? 0.4) * 60));
  // The yank (W-T, the chain): the shove turns round and pulls the target toward the attacker, across
  // his line, to combat.yankPastM beyond it. A rival on your right comes out on your left: into the
  // oncoming lane when you ride on that side of him. The shove curve moves peak × ticks / 120 m.
  const yank = behaviourOf(w) === 'melee.yank';
  const yankM = yank ? Math.abs(dd) + Math.max(0, world.params['combat.yankPastM'] ?? 1.2) : 0;
  const resist = clamp(config.riders[victim.riderIndex]?.bike.knockbackResistance ?? 0, 0, 1);
  const yankPeak = ((yankM * 120) / knockTicks) * (1 - resist) * onPlayer * copSoft;
  emit(
    world,
    'hit',
    id,
    {
      weapon: w.contentId,
      damage,
      kick,
      ...(kick && st.straight[id] ? { straight: true } : {}),
      health,
      hitImpulse,
      ...effect,
      ...(yank ? { yank: true, yankM: Math.round((yankPeak * knockTicks * 1000) / 120) / 1000 } : {}),
      ...(spent ? { spent } : {}),
      ...opts.extra,
    },
    { target: vid, causeId: cause },
  );
  if (kick) emit(world, 'kick', id, { weapon: w.contentId }, { target: vid, causeId: cause });

  st.knockPeak[vid] = yank ? -away * yankPeak : away * peak;
  st.knockT[vid] = 0;
  st.knockTicks[vid] = knockTicks;
  // The stagger: no attacks, and the riders phase's wobble (less steering, a shaking bike). A
  // non-player's hit on a player locks his attacks for the wobble he feels (onPlayer), not the data
  // stagger behind it (run A's check, punch item 4), so the attack and the wobble end on one tick.
  const stagger = Math.round((w.staggerTicks * (world.params['combat.staggerScale'] ?? 1)) / toughness);
  const wobble = Math.round(stagger * onPlayer);
  st.stagger[vid] = Math.max(st.stagger[vid] ?? 0, wobble);
  if (wobble > 0) riders.wobble[vid] = Math.max(riders.wobble[vid] ?? 0, wobble);
  st.lastAttackerId[vid] = id;
  st.hitTick[vid] = world.tick;
  if (st.phase[vid] === 'windup') endAttack(st, vid);

  if (health <= 0) {
    endAttack(st, vid);
    emit(world, 'crash', vid, { reason: 'knockedOff', by: id }, { target: id, causeId: cause });
  }
  if (breaks) retire(world, st, a);

  if (isPlayer(config, a) || isPlayer(config, victim)) {
    const ticks = Math.round((w.hitStopMs * (world.params['combat.hitStopScale'] ?? 1) * 60) / 1000);
    if (ticks > 0) {
      if (st.hitStopTicks <= 0) st.resumeTimeScale = world.timeScale;
      st.hitStopTicks = Math.max(st.hitStopTicks, ticks);
      world.timeScale = 0;
    }
  }
}

/** A rider's fight stat (stats.toughness or stats.power), 1 when absent, kept to the schema's 0.5–2. */
function statOf(config: SimConfig, m: Mover, stat: 'toughness' | 'power'): number {
  return clamp(config.riders[m.riderIndex]?.[stat] ?? 1, 0.5, 2);
}

/**
 * The career's gentle climb (playtest 3, round 3 "Fights"): a rival's hit on the player times
 * 1 + (its field level's power scale - 1) × combat.levelPowerOnPlayer, kept at or under
 * combat.levelPowerMax. A rider with no level (free play, a cop, the player) or a level of 1 is 1,
 * so those fights and their hash are as they were. Below 1 (a region's first tier) the hit is softer.
 */
function levelClimb(world: World, config: SimConfig, a: Mover): number {
  const level = clamp(config.riders[a.riderIndex]?.levelPower ?? 1, 0.5, 2);
  if (level === 1) return 1;
  const gain = clamp(world.params['combat.levelPowerOnPlayer'] ?? 1, 0, 2);
  const max = clamp(world.params['combat.levelPowerMax'] ?? 1.15, 1, 1.5);
  return Math.min(1 + (level - 1) * gain, max);
}

/**
 * The knockdown scale on a hit's data damage (playtest 2): on a hit a PLAYER lands,
 * combat.unarmedDamageScale for the punch and the kick, combat.weaponDamageScale for a held weapon.
 * A non-player's hit on a player takes combat.onPlayerDamageScale (default 1, the data damage as
 * before: playtest 1 item 7 asked that rivals stay as hard as they were, and the complaint was
 * about knocking THEM down). Rivals' and cops' hits on each other keep their data damage: scaled,
 * the quicker rival-on-rival knock-offs cut a San Francisco player's cop-weapon steals from 8 races
 * in 10 to 4 (tests/sim/cops-steal-chance, minimum 5), and the maintainer's ask was the player's.
 */
function damageScale(world: World, config: SimConfig, a: Mover, victim: Mover, w: SimWeaponDef): number {
  const p = world.params;
  if (!isPlayer(config, a))
    return isPlayer(config, victim) ? Math.max(0, p['combat.onPlayerDamageScale'] ?? 1) : 1;
  return Math.max(
    0,
    w.unarmed ? (p['combat.unarmedDamageScale'] ?? 2) : (p['combat.weaponDamageScale'] ?? 2.5),
  );
}

/**
 * What a weapon's behaviour adds to a landed hit (after the shared swing's damage, before its shove
 * and stagger), returned as extra `hit` event data. The file header lists the behaviours.
 */
function behaviourEffect(
  world: World,
  st: CombatState,
  victim: Mover,
  w: SimWeaponDef,
  scale = 1,
): Record<string, number> {
  const p = world.params;
  const behaviour = behaviourOf(w);
  if (behaviour === 'melee.wrap' || behaviour === 'melee.yank') {
    const before = victim.speed;
    victim.speed = Math.max(0, before - Math.max(0, p['combat.wrapDragMps'] ?? 4));
    return { dragMps: Math.round((before - victim.speed) * 1000) / 1000 };
  }
  if (behaviour === 'taser.stun') {
    const ticks = Math.round((w.stunTicks ?? 0) * Math.max(0, p['combat.stunScale'] ?? 1) * scale);
    if (ticks <= 0) return {};
    const riders = riderState(world);
    st.stagger[victim.id] = Math.max(st.stagger[victim.id] ?? 0, ticks);
    riders.wobble[victim.id] = Math.max(riders.wobble[victim.id] ?? 0, ticks);
    victim.speed *= 1 - clamp(p['combat.stunSpeedLoss'] ?? 0.2, 0, 1) * scale;
    return { stunTicks: ticks };
  }
  return {};
}

/** Spends one use (a charge or a durability hit) of a pickup; returns what is left. */
function spendUse(left: number[], pid: EntityId, full: number): number {
  if (pid < 0) return full;
  const now = Math.max(0, (left[pid] ?? full) - 1);
  left[pid] = now;
  return now;
}

/** A used-up weapon leaves its holder's hand for good; its pickup stays stowed (SPENT). */
function retire(world: World, st: CombatState, holder: Mover): void {
  const pid = st.heldPickup[holder.id] ?? -1;
  st.held[holder.id] = '';
  st.heldPickup[holder.id] = -1;
  const pickup = world.movers[pid];
  if (!pickup) return;
  st.pickupHolder[pid] = SPENT;
  pickup.h = STOWED_H;
}

/**
 * The sweep (W-T, the campaign sign): one swing looks for a rider on each side through its whole
 * active moment, right side first, and lands once on each it finds (never twice on one rider). Each
 * is shoved away from the attacker; only the first landing spends a use of a breakable.
 */
function sweepTest(world: World, config: SimConfig, st: CombatState, a: Mover, w: SimWeaponDef): void {
  const id = a.id;
  for (const [side, bit] of [
    [1, 1],
    [-1, 2],
  ] as const) {
    const swept = st.sweptSides[id] ?? 0;
    if ((swept & bit) !== 0 || st.weapon[id] !== w.contentId || st.phase[id] !== 'active') continue;
    const first = st.sweepFirst[id] ?? -1;
    const inReach = candidates(world, config, a, w.reachSM, w.reachDM, side).filter((c) => c.id !== first);
    const pick = inReach.find((c) => c.id === st.targetId[id]) ?? inReach[0];
    const victim = pick ? world.movers[pick.id] : undefined;
    if (!pick || !victim) continue;
    st.sweptSides[id] = swept | bit;
    if (first < 0) st.sweepFirst[id] = pick.id;
    land(world, config, st, a, victim, w, pick.dd, { extra: { sweep: true }, spend: first < 0 });
  }
}

function hitTest(world: World, config: SimConfig, st: CombatState, a: Mover): void {
  const id = a.id;
  const w = weaponById(config, st.weapon[id] ?? '');
  if (w && st.phase[id] === 'active' && behaviourOf(w) === 'melee.sweep' && !w.unarmed) {
    sweepTest(world, config, st, a, w);
    return;
  }
  if (!w || st.phase[id] !== 'active' || st.landed[id]) return;
  // The straight kick reaches forward (combat.straightKickReachM) in its narrow box, either side.
  const inReach =
    w.contentId === KICK_ID && st.straight[id]
      ? candidates(
          world,
          config,
          a,
          w.reachSM,
          STRAIGHT_KICK_D_M,
          0,
          world.params['combat.straightKickReachM'] ?? 2,
        )
      : candidates(world, config, a, w.reachSM, w.reachDM, st.side[id] ?? 1);
  const pick = inReach.find((c) => c.id === st.targetId[id]) ?? inReach[0];
  const victim = pick ? world.movers[pick.id] : undefined;
  if (pick && victim) land(world, config, st, a, victim, w, pick.dd);
  else landBump(world, config, st, a, w);
}

/**
 * The bump rule: a rider this attack touched stays in its reach while he is within BUMP_REACH_M
 * along and across; lands on him and returns true, or returns false.
 */
function landBump(world: World, config: SimConfig, st: CombatState, a: Mover, w: SimWeaponDef): boolean {
  const bumped = world.movers[st.touched[a.id] ?? -1];
  if (!bumped || !isRiding(bumped) || (riderState(world).health[bumped.id] ?? 0) <= 0) return false;
  if (!inReachHeight(world, a, bumped)) return false;
  const rel = relative(config.road, a, bumped, BUMP_REACH_M + 2);
  if (!rel || Math.abs(rel.ds) > BUMP_REACH_M || Math.abs(rel.dd) > BUMP_REACH_M) return false;
  land(world, config, st, a, bumped, w, rel.dd);
  return true;
}

/**
 * The rider a player's attack touched from tick `since` to this one (the riding phase's contact,
 * which ran before this phase), or -1: the attack's target first, else a rider on its side (any
 * side when it has none; the rider ahead for the straight kick).
 */
function touchedSince(world: World, config: SimConfig, st: CombatState, a: Mover, since: number): EntityId {
  const contact = riderState(world).contactTick ?? {};
  const target = st.targetId[a.id] ?? -1;
  const side = st.side[a.id] ?? 0;
  let found = -1;
  for (const o of world.movers) {
    if (o.id === a.id || !isRiding(o)) continue;
    const key = a.id < o.id ? `${a.id}-${o.id}` : `${o.id}-${a.id}`;
    const at = contact[key];
    if (at === undefined || at < since || at > world.tick) continue;
    if (o.id === target) return o.id;
    if (found >= 0 || target >= 0) continue;
    const rel = relative(config.road, a, o, BUMP_REACH_M + 2);
    if (!rel) continue;
    const onSide = st.straight[a.id] ? rel.ds > 0 : side === 0 || side * rel.dd >= 0;
    if (onSide) found = o.id;
  }
  return found;
}

function totalMass(config: SimConfig, m: Mover): number {
  const def = config.riders[m.riderIndex];
  return def ? def.massKg + def.bike.massKg : 1;
}

/** A landed hit's peak shove speed, m/s (unsigned): the file header gives the formula. */
function shovePeak(world: World, config: SimConfig, a: Mover, victim: Mover, w: SimWeaponDef): number {
  const p = world.params;
  const kickScale = w.contentId === KICK_ID ? (p['combat.kickShoveScale'] ?? 1) : 1;
  const ratio = clamp(totalMass(config, a) / totalMass(config, victim), MASS_RATIO_MIN, MASS_RATIO_MAX);
  const power = config.riders[a.riderIndex]?.bike.hitPowerScale ?? 1;
  const resist = clamp(config.riders[victim.riderIndex]?.bike.knockbackResistance ?? 0, 0, 1);
  const peak = w.knockbackMps * (p['combat.knockbackScale'] ?? 1) * kickScale * ratio * power * (1 - resist);
  return Math.max(0, peak);
}

function endShove(st: CombatState, id: EntityId): void {
  st.knockPeak[id] = 0;
  st.knockT[id] = 0;
}

/**
 * Moves shoved riders sideways by `ts` scaled ticks of their shove curve (speed peak·(1 − t/N)
 * over N ticks, integrated exactly, so the distance does not depend on the time scale) and keeps
 * them inside the drivable limits; reaching a limit ends the shove.
 */
function slide(world: World, config: SimConfig, st: CombatState, ts: number): void {
  for (const m of world.movers) {
    const peak = st.knockPeak[m.id] ?? 0;
    if (peak === 0) continue;
    if (!isRiding(m)) {
      endShove(st, m.id);
      continue;
    }
    if (ts <= 0) continue;
    const n = st.knockTicks[m.id] ?? 1;
    const t0 = st.knockT[m.id] ?? 0;
    const t1 = Math.min(n, t0 + ts);
    const d = m.pos.d + (peak / 60) * (t1 - t0 - (t1 * t1 - t0 * t0) / (2 * n));
    // The riders' limits: the lanes' edges, or the verge's with off-road on (run W-R), so a kick
    // can send a rider onto the verge and never snaps one riding there back onto the road.
    const { lo, hi } = riderLimits(world, config, m.pos.edge, m.pos.s, m.pos.d);
    m.pos.d = clamp(d, lo, hi);
    st.knockT[m.id] = t1;
    if (m.pos.d !== d || t1 >= n - EPS) endShove(st, m.id);
  }
}

/** Whether another riding rider is within `rangeM` of `m` along the road (either way). */
function riderNear(world: World, config: SimConfig, m: Mover, rangeM: number): boolean {
  for (const o of world.movers) {
    if (o.id === m.id || !isRiding(o)) continue;
    const rel = relative(config.road, m, o, rangeM + 2);
    if (rel && Math.abs(rel.ds) <= rangeM) return true;
  }
  return false;
}

/**
 * Out-of-combat recovery: whole points into a player's health once they have been calm long
 * enough, clear of other riders. Players only: the product spec's "back off until your energy is
 * restored" is the player's, and rivals and the cop keep M1's durability. Both limits came from
 * the fighting dev bot's cop busts on the 50-seed batch: 9 with no recovery, 14 when everyone
 * healed, 15 when the player healed while still riding in the pack.
 */
function recover(world: World, config: SimConfig, st: CombatState, ts: number): void {
  const health = riderState(world).health;
  const delay = Math.round((world.params['combat.regenDelayS'] ?? 5) * 60);
  const rate = world.params['combat.regenPerS'] ?? 3;
  const clearM = world.params['combat.regenClearM'] ?? 15;
  for (const m of world.movers) {
    if (m.kind !== 'rider' || !isPlayer(config, m)) continue;
    // Backing off counts only once no other riding rider is within clearM along the road.
    if (clearM > 0 && isRiding(m) && riderNear(world, config, m, clearM)) st.calm[m.id] = 0;
    const calm = (st.calm[m.id] ?? 0) + ts;
    st.calm[m.id] = calm;
    const max = config.riders[m.riderIndex]?.healthMax ?? 0;
    const hp = health[m.id] ?? 0;
    if (!isRiding(m) || hp <= 0 || hp >= max || calm + EPS < delay) {
      st.regenAcc[m.id] = 0;
      continue;
    }
    let acc = (st.regenAcc[m.id] ?? 0) + rate * ts;
    const whole = Math.floor((acc + EPS) / 60);
    acc -= whole * 60;
    st.regenAcc[m.id] = acc;
    if (whole > 0) health[m.id] = Math.min(max, hp + whole);
  }
}

/**
 * The momentum kick's extra shove speed, m/s: the kicker's sideways speed along d toward the
 * target (`away` is the shove's d sign), × combat.momentumKickGain, capped at
 * combat.momentumKickMaxMps. Steering away adds nothing.
 */
function momentum(world: World, a: Mover, away: number): number {
  const toward = a.pos.dir * a.speed * sin(a.yaw) * away;
  const gain = world.params['combat.momentumKickGain'] ?? 1;
  const max = world.params['combat.momentumKickMaxMps'] ?? 8;
  return clamp(gain * Math.max(0, toward), 0, Math.max(0, max));
}

// ---- Takedowns and the slow motion (M2 combat-4) ---------------------------------------------

/** How a fall counts: the finishing hit, a moving hazard, or anything else in the way. */
function takedownKind(data: Readonly<Record<string, unknown>>): TakedownKind {
  if (data['reason'] === 'knockedOff') return 'health';
  const cause = data['cause'];
  return cause === 'traffic' || cause === 'ped' || cause === 'tumble' ? 'traffic' : 'scenery';
}

/** A takedown count, for the results screen and M4's takedown hunts. */
export function takedownCount(world: World, id: EntityId): number {
  return combatState(world).takedowns[id] ?? 0;
}

/**
 * Credits last tick's falls (world.lastEvents: every phase's crashes, traffic's and tumble's
 * included, which run after this one). A rider's first crash of a fall is a takedown for its
 * lastAttackerId when that rider's hit landed within combat.takedownWindowS (raw ticks, from the
 * hit to the crash). A crash whose data.contact is `tumble` (a body already down touching a car)
 * never counts. The takedown carries the crash's causeId, one tick after the crash.
 */
function creditTakedowns(world: World, config: SimConfig, st: CombatState): void {
  for (const m of world.movers) {
    if (m.kind !== 'rider' || !isRiding(m)) continue;
    st.downSeen[m.id] = false;
    st.fallBy[m.id] = -1;
    st.fallChain[m.id] = 0;
  }
  const window = Math.round((world.params['combat.takedownWindowS'] ?? 2) * 60);
  for (const e of world.lastEvents) {
    if (e.type !== 'crash' || e.data['contact'] === 'tumble') continue;
    const victim = world.movers[e.actor];
    if (!victim || victim.kind !== 'rider' || isRiding(victim) || st.downSeen[victim.id]) continue;
    st.downSeen[victim.id] = true;
    let by = st.lastAttackerId[victim.id] ?? -1;
    const hitAt = st.hitTick[victim.id] ?? -1;
    let chain = 1;
    // A knock-off another system made and named its rider for (the riders' landing hit, the pitch
    // deck's #13): that rider is credited, as for combat's own finishing hit.
    const knocker = e.data['reason'] === 'knockedOff' ? (e.target ?? -1) : -1;
    if (knocker >= 0 && knocker !== victim.id && world.movers[knocker]?.kind === 'rider') by = knocker;
    else if (by < 0 || by === victim.id || hitAt < 0 || e.tick - hitAt > window) {
      // Domino credit: knocked off by a flying body whose own fall someone was credited with.
      const body = e.data['cause'] === 'tumble' ? (e.target ?? -1) : -1;
      by = body >= 0 ? (st.fallBy[body] ?? -1) : -1;
      if (by < 0 || by === victim.id) continue;
      chain = (st.fallChain[body] ?? 1) + 1;
    }
    st.fallBy[victim.id] = by;
    st.fallChain[victim.id] = chain;
    const kind = chain > 1 ? 'traffic' : takedownKind(e.data);
    st.takedowns[by] = (st.takedowns[by] ?? 0) + 1;
    const extra: { target: EntityId; causeId?: number } = { target: victim.id };
    if (e.causeId !== undefined) extra.causeId = e.causeId;
    const cause = emit(world, 'takedown', by, chain > 1 ? { kind, domino: chain } : { kind }, extra);
    const attacker = world.movers[by];
    const playerInvolved = isPlayer(config, victim) || (attacker !== undefined && isPlayer(config, attacker));
    if (kind !== 'health' && playerInvolved && config.slowMo) startSlowmo(world, st, by, victim.id, cause);
  }
}

/**
 * The in-flow slow motion on a big, player-involved takedown: combat.slowmoScale for
 * combat.slowmoS of raw ticks, unless one started within combat.slowmoCooldownS. It starts on the
 * takedown's tick, after this phase's own step time was taken, so every phase sees the same count
 * of slow ticks. During a hit-stop it takes over the scale the hit-stop restores.
 */
function startSlowmo(world: World, st: CombatState, actor: EntityId, target: EntityId, cause: number): void {
  const sm = st.slowmo;
  const cooldown = Math.round((world.params['combat.slowmoCooldownS'] ?? 8) * 60);
  if (world.facts.slowmo.remainingTicks > 0) return;
  if (sm.startTick >= 0 && world.tick - sm.startTick < cooldown) return;
  const ticks = Math.max(1, Math.round((world.params['combat.slowmoS'] ?? 0.8) * 60));
  const scale = world.params['combat.slowmoScale'] ?? 0.3;
  st.slowmo = { actor, target, cause, resume: 1, startTick: world.tick };
  if (st.hitStopTicks > 0) {
    st.slowmo.resume = st.resumeTimeScale;
    st.resumeTimeScale = scale;
  } else {
    st.slowmo.resume = world.timeScale;
    world.timeScale = scale;
  }
  setSlowmo(world, ticks);
  emit(world, 'slowmoStart', actor, { ticks, timeScale: scale }, { target, causeId: cause });
}

/** Counts the slow motion down on ticks the world moved, and ends it (restoring the scale). */
function stepSlowmo(world: World, st: CombatState, frozenAtStart: boolean): void {
  const left = world.facts.slowmo.remainingTicks;
  const sm = st.slowmo;
  if (left <= 0 || frozenAtStart || sm.startTick === world.tick) return;
  setSlowmo(world, left - 1);
  if (left - 1 > 0) return;
  // A hit-stop that began this tick restores the scale the slow motion leaves behind.
  if (st.hitStopTicks > 0) st.resumeTimeScale = sm.resume;
  else world.timeScale = sm.resume;
  emit(world, 'slowmoEnd', sm.actor, {}, { target: sm.target, causeId: sm.cause });
}

// ---- Pickup weapons and the steal (combat-2) ------------------------------------------------

type Spot = { edge: number; s: number; d: number; dir: 1 | -1 };

/** How many roadside weapons a route of this length gets: one per spacing, at least one. */
export function pickupCount(routeLengthM: number, spacingM: number): number {
  return Math.max(1, Math.round(routeLengthM / Math.max(1, spacingM)));
}

/**
 * Road positions for the roadside weapons, in the middle of the travel lane: the route cut into
 * pickupCount equal stretches, one spot in each, at `jitter()` (0..1) across the middle half of its
 * stretch (0.5 is the stretch's centre). A point the main path cannot place is skipped.
 */
export function roadsideSpots(config: SimConfig, spacingM = 500, jitter: () => number = () => 0.5): Spot[] {
  const { route, road } = config;
  const out: Spot[] = [];
  const count = pickupCount(route.length, spacingM);
  for (let k = 0; k < count; k++) {
    const x = ((k + 0.25 + 0.5 * clamp(jitter(), 0, 1)) / count) * route.length;
    for (const e of route.mainEdges) {
      const len = road.edges[e]?.length ?? 0;
      const p0 = route.progressAt(e, 0);
      const p1 = route.progressAt(e, len);
      if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 === p1) continue;
      if (x < Math.min(p0, p1) || x > Math.max(p0, p1)) continue;
      const s = ((x - p0) / (p1 - p0)) * len;
      const dir: 1 | -1 = p1 > p0 ? 1 : -1;
      const lanes = road.lanesAt(e, s);
      const lane = lanes.find((l) => l.kind === 'drive' && l.direction === dir) ?? lanes[0];
      out.push({ edge: e, s, d: lane?.dCenterM ?? 0, dir });
      break;
    }
  }
  return out;
}

/** How far up the road from the parked bike the crash weapon lies, m: met just after the remount. */
export const CRASH_WEAPON_AHEAD_M = 6;

/** A roadside weapon by roadsideWeight from the `combat` stream (one draw), or null when none. */
function drawRoadside(world: World, config: SimConfig): SimWeaponDef | null {
  const pool = config.weapons.filter((w) => !w.unarmed && Math.max(0, w.roadsideWeight ?? 1) > 0);
  const total = pool.reduce((sum, w) => sum + Math.max(0, w.roadsideWeight ?? 1), 0);
  let r = nextFloat(world.rng.combat) * total;
  if (total <= 0) return null;
  return pool.find((w) => (r -= Math.max(0, w.roadsideWeight ?? 1)) < 0) ?? pool[pool.length - 1] ?? null;
}

/**
 * Last tick's player get-ups (tumble runs after this phase): with combat.crashWeaponChance, and only
 * for a player with empty hands, a roadside weapon by the parked bike. Two draws per player get-up,
 * always (the chance, then the weapon), so the stream stays aligned whatever the outcome.
 */
function crashWeapons(world: World, config: SimConfig, st: CombatState): void {
  const chance = clamp(world.params['combat.crashWeaponChance'] ?? 0.3, 0, 1);
  for (const e of world.lastEvents) {
    if (e.type !== 'getUp') continue;
    const m = world.movers[e.actor];
    if (!m || m.kind !== 'rider' || !isPlayer(config, m)) continue;
    const roll = nextFloat(world.rng.combat);
    const w = drawRoadside(world, config);
    const bike = parkedBike(world, m.id);
    if (!w || !bike || roll >= chance || st.held[m.id]) continue;
    const spot = { ...bike };
    config.road.advance(Object.assign(spot, { s: spot.s + CRASH_WEAPON_AHEAD_M * spot.dir }));
    spawnPickup(world, w.contentId, spot);
  }
}

// ---- Thrown weapons (W-T, `throw.burst`: Kevin's briefcase) ---------------------------------

/**
 * The throw: the held weapon leaves the hand as its own pickup entity, at THROW_START_H, moving
 * along the road at the thrower's speed plus combat.throwSpeedMps. It is aimed at the nearest
 * rider ahead within the weapon's reach box (reach.sM ahead, reach.dM either side; the current
 * target first), drifting across to his d by the time it would close the gap; with nobody there
 * it flies straight. It flies for reach.sM / throw speed and comes down at THROW_END_H.
 */
function launch(world: World, config: SimConfig, st: CombatState, a: Mover, w: SimWeaponDef): void {
  const id = a.id;
  const pid = st.heldPickup[id] ?? -1;
  const pickup = world.movers[pid];
  st.held[id] = '';
  st.heldPickup[id] = -1;
  if (!pickup) return;
  const throwMps = Math.max(1, world.params['combat.throwSpeedMps'] ?? 16);
  const ahead = candidates(world, config, a, 0, w.reachDM, 0, w.reachSM);
  const aim = ahead.find((c) => c.id === st.targetId[id]) ?? ahead[0];
  const victim = aim ? world.movers[aim.id] : undefined;
  const rel = victim ? relative(config.road, a, victim, w.reachSM + 2) : null;
  const dTo = rel ? a.pos.d + rel.dd * a.pos.dir : a.pos.d;
  const reachTicks = rel ? Math.max(1, (Math.max(0, rel.ds) / throwMps) * 60) : 1;
  pickup.pos.edge = a.pos.edge;
  pickup.pos.s = a.pos.s;
  pickup.pos.d = a.pos.d;
  pickup.pos.dir = a.pos.dir;
  pickup.h = THROW_START_H;
  pickup.speed = a.speed + throwMps;
  st.pickupHolder[pid] = THROWN;
  st.flights.push({
    pickup: pid,
    by: id,
    cause: st.cause[id] ?? 0,
    weapon: w.contentId,
    speed: pickup.speed,
    dTo,
    dStep: Math.abs(dTo - a.pos.d) / reachTicks,
    age: 0,
    ticks: Math.max(6, Math.round((w.reachSM / throwMps) * 60)),
  });
  // The release (the `throw` event): the thrower's hands are empty from this tick.
  const extra: { target?: EntityId; causeId: number } = { causeId: st.cause[id] ?? 0 };
  if (victim) extra.target = victim.id;
  emit(world, 'throw', id, { weapon: w.contentId, pickup: pid }, extra);
}

/** Where a thrown weapon bursts, in world metres (render's paperwork), rounded to centimetres. */
function burstAt(config: SimConfig, m: Mover): { burstX: number; burstY: number; burstZ: number } {
  const p = config.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, Math.max(0, m.h));
  const cm = (v: number) => Math.round(v * 100) / 100;
  return { burstX: cm(p.x), burstY: cm(p.y), burstZ: cm(p.z) };
}

/**
 * Moves thrown weapons by `ts` scaled ticks (none during a hit-stop). The first riding rider other
 * than the thrower inside the THROW_HIT box takes the hit (the nearest, then the lowest id), and the
 * weapon bursts (`hit` with `thrown`, `burst` and the burst point); one that flies its length, or
 * off the end of the road, bursts where it lands (`attackMiss`, the same data). Either way it is
 * gone for the race (SPENT), and both events carry the throw's cause id.
 */
function flyPass(world: World, config: SimConfig, st: CombatState, ts: number): void {
  if (ts <= 0 || st.flights.length === 0) return;
  const health = riderState(world).health;
  const left: Flight[] = [];
  for (const f of st.flights) {
    const pickup = world.movers[f.pickup];
    const thrower = world.movers[f.by];
    const w = weaponById(config, f.weapon);
    if (!pickup || !thrower || !w) continue;
    f.age += ts;
    pickup.pos.s += pickup.pos.dir * f.speed * (ts / 60);
    const end = config.road.advance(pickup.pos);
    const step = f.dStep * ts;
    pickup.pos.d += clamp(f.dTo - pickup.pos.d, -step, step);
    const u = clamp(f.age / f.ticks, 0, 1);
    pickup.h = THROW_START_H + (THROW_END_H - THROW_START_H) * u + 4 * THROW_ARC_M * u * (1 - u);
    let best: { m: Mover; dd: number; dist2: number } | null = null;
    for (const m of world.movers) {
      if (m.id === f.by || !isRiding(m) || (health[m.id] ?? 0) <= 0) continue;
      const rel = relative(config.road, pickup, m, THROW_HIT_S_M + 2);
      if (!rel || Math.abs(rel.ds) > THROW_HIT_S_M || Math.abs(rel.dd) > THROW_HIT_D_M) continue;
      const dist2 = rel.ds * rel.ds + rel.dd * rel.dd;
      if (!best || dist2 < best.dist2) best = { m, dd: rel.dd, dist2 };
    }
    if (best) {
      // The shove goes away from the thrower's side of the target.
      const side = relative(config.road, thrower, best.m, w.reachSM + 4);
      const dd = side && side.dd !== 0 ? side.dd : best.dd;
      const extra = { thrown: true, burst: true, ...burstAt(config, pickup) };
      land(world, config, st, thrower, best.m, w, dd, { cause: f.cause, extra });
      bury(st, pickup);
      continue;
    }
    if (u >= 1 - EPS || end === 'deadEnd') {
      const data = {
        weapon: f.weapon,
        side: 1,
        thrown: true,
        burst: true,
        spent: true,
        ...burstAt(config, pickup),
      };
      emit(world, 'attackMiss', f.by, data, { causeId: f.cause });
      bury(st, pickup);
      continue;
    }
    left.push(f);
  }
  st.flights = left;
}

/** A burst thrown weapon is gone for the race: stowed out of sight, never picked up again. */
function bury(st: CombatState, pickup: Mover): void {
  st.pickupHolder[pickup.id] = SPENT;
  pickup.h = STOWED_H;
  pickup.speed = 0;
}

/** Puts a weapon on the road as a new pickup entity (the race start and tests use it). */
export function spawnPickup(world: World, weapon: string, spot: Spot): EntityId {
  const st = combatState(world);
  const m = addMover(world, 'pickup', { edge: spot.edge, s: spot.s, d: spot.d, dir: spot.dir });
  st.pickups.push(m.id);
  st.pickupWeapon[m.id] = weapon;
  st.pickupHolder[m.id] = -1;
  return m.id;
}

/** Gives a rider a pickup's weapon; the pickup entity is stowed out of sight. */
function takePickup(st: CombatState, rider: Mover, pickup: Mover): void {
  st.held[rider.id] = st.pickupWeapon[pickup.id] ?? '';
  st.heldPickup[rider.id] = pickup.id;
  st.pickupHolder[pickup.id] = rider.id;
  pickup.h = STOWED_H;
}

/** Puts a held weapon back on the road where its holder is. */
function dropWeapon(world: World, config: SimConfig, st: CombatState, holder: Mover): void {
  const pid = st.heldPickup[holder.id] ?? -1;
  // A taser whose last charge went off in the swing the wreck cut short is spent, not dropped.
  const w = weaponById(config, st.held[holder.id] ?? '');
  if (w?.charges != null && (st.pickupCharges[pid] ?? w.charges) <= 0) {
    retire(world, st, holder);
    return;
  }
  const pickup = world.movers[pid];
  st.held[holder.id] = '';
  st.heldPickup[holder.id] = -1;
  if (!pickup) return;
  st.pickupHolder[pid] = -1;
  const edge = config.road.edges[holder.pos.edge];
  pickup.pos.edge = holder.pos.edge;
  pickup.pos.s = edge ? clamp(holder.pos.s, 0, edge.length) : holder.pos.s;
  pickup.pos.d = edge ? clamp(holder.pos.d, edge.dMin + 0.5, edge.dMax - 0.5) : holder.pos.d;
  pickup.pos.dir = holder.pos.dir;
  pickup.h = 0;
}

/** Whether a rider may take a weapon now: riding, conscious, empty-handed, and not a cop. */
function canTake(world: World, config: SimConfig, st: CombatState, m: Mover): boolean {
  return isRiding(m) && (riderState(world).health[m.id] ?? 0) > 0 && !st.held[m.id] && !isLaw(config, m);
}

/**
 * Whether a rider may steal now: riding, conscious and not a cop. Full hands are fine: the thief
 * drops what he holds and takes the swung weapon (the W-O polish run, [default]).
 */
function canSteal(world: World, config: SimConfig, m: Mover): boolean {
  return isRiding(m) && (riderState(world).health[m.id] ?? 0) > 0 && !isLaw(config, m);
}

/** Whether `holder` is winding up its held weapon (not a kick it switched to). */
function swingingHeld(st: CombatState, holder: Mover): boolean {
  const id = holder.id;
  return st.phase[id] === 'windup' && !!st.held[id] && st.weapon[id] === st.held[id];
}

/**
 * The steal pass, before any attack advances this tick. `pressed` marks the riders whose attack
 * press rose this tick; a steal consumes the thief's press. The wind-up's age this tick is its
 * elapsed scaled time plus this tick's timeScale: on tick T + k of a wind-up started on tick T,
 * it is k at timeScale 1.
 */
function stealPass(world: World, config: SimConfig, st: CombatState, pressed: boolean[], ts: number): void {
  for (const thief of world.movers) {
    if (thief.kind !== 'rider' || !pressed[thief.id]) continue;
    if (st.phase[thief.id] !== 'idle' || (st.stagger[thief.id] ?? 0) > EPS) continue;
    if (!canSteal(world, config, thief)) continue;
    let best: { holder: Mover; mine: boolean; dist2: number } | null = null;
    for (const holder of world.movers) {
      if (holder.id === thief.id || holder.kind !== 'rider' || !isRiding(holder)) continue;
      if (!swingingHeld(st, holder) || !inReachHeight(world, holder, thief)) continue;
      const w = weaponById(config, st.held[holder.id] ?? '');
      if (!w?.steal) continue;
      const age = (st.elapsed[holder.id] ?? 0) + ts;
      if (age + EPS < w.steal.startTick || age - EPS > w.steal.endTick) continue;
      // The thief must be where the weapon is going: inside the holder's reach box, either side. A
      // thrown weapon's reach is its throw range, so its snatch box stays at arm's length (W-T).
      const thrownW = behaviourOf(w) === 'throw.burst';
      const boxS = thrownW ? Math.min(w.reachSM, THROW_SNATCH_M) : w.reachSM;
      const boxD = thrownW ? Math.min(w.reachDM, THROW_SNATCH_M) : w.reachDM;
      const rel = relative(config.road, holder, thief, boxS + 2);
      if (!rel || Math.abs(rel.ds) > boxS || Math.abs(rel.dd) > boxD) continue;
      const mine = st.targetId[holder.id] === thief.id;
      const dist2 = rel.ds * rel.ds + rel.dd * rel.dd;
      if (!best || (mine && !best.mine) || (mine === best.mine && dist2 < best.dist2)) {
        best = { holder, mine, dist2 };
      }
    }
    if (!best) continue;
    const hid = best.holder.id;
    const weapon = st.held[hid] ?? '';
    const age = (st.elapsed[hid] ?? 0) + ts;
    const cause = st.cause[hid] ?? 0;
    const pickup = world.movers[st.heldPickup[hid] ?? -1];
    st.held[hid] = '';
    st.heldPickup[hid] = -1;
    endAttack(st, hid);
    // Full hands: the thief lets go of his own weapon where he is (it lies on the road again).
    const dropped = st.held[thief.id] ?? '';
    if (dropped) dropWeapon(world, config, st, thief);
    if (pickup) takePickup(st, thief, pickup);
    else st.held[thief.id] = weapon;
    pressed[thief.id] = false;
    const data: Record<string, string | number> = {
      weapon,
      source: 'steal',
      windupTick: Math.round(age * 1000) / 1000,
    };
    if (dropped) data['dropped'] = dropped;
    emit(world, 'weaponGrab', thief.id, data, { target: hid, causeId: cause });
  }
}

/** Emits the steal cue once per attack, on the tick a held weapon's wind-up reaches its window. */
function stealCue(world: World, config: SimConfig, st: CombatState, a: Mover): void {
  const id = a.id;
  if (st.stealCued[id] || !swingingHeld(st, a)) return;
  const w = weaponById(config, st.held[id] ?? '');
  if (!w?.steal || (st.elapsed[id] ?? 0) + EPS < w.steal.startTick) return;
  st.stealCued[id] = true;
  const extra: { target?: EntityId; causeId?: number } = { causeId: st.cause[id] ?? 0 };
  const target = st.targetId[id] ?? -1;
  if (target >= 0) extra.target = target;
  const ticks = w.steal.endTick - w.steal.startTick + 1;
  emit(world, 'stealWindow', id, { weapon: w.contentId, ticks }, extra);
}

/** Wrecked holders drop their weapon; then empty-handed riders pick up what lies on the road. */
function pickupPass(world: World, config: SimConfig, st: CombatState): void {
  const health = riderState(world).health;
  for (const m of world.movers) {
    // A cop keeps his weapon through a wreck (holstered): you get it only by snatching it mid-swing.
    if (m.kind === 'rider' && isLaw(config, m)) continue;
    if (m.kind === 'rider' && st.held[m.id] && (!isRiding(m) || (health[m.id] ?? 0) <= 0)) {
      dropWeapon(world, config, st, m);
    }
  }
  // Who could take one this tick, with their ground points: a cheap world-distance check skips the
  // road-frame test (relative(), which walks junction neighbours) for every pickup far away. W-Q laid
  // one every 500 m, and without this the batch's race step ran about 25 % slower.
  const takers: { m: Mover; x: number; z: number }[] = [];
  for (const m of world.movers) {
    if (m.kind !== 'rider' || m.h > PICKUP_MAX_H || !canTake(world, config, st, m)) continue;
    const w = config.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, 0);
    takers.push({ m, x: w.x, z: w.z });
  }
  if (takers.length === 0) return;
  for (const pid of st.pickups) {
    const pickup = world.movers[pid];
    if (!pickup || (st.pickupHolder[pid] ?? -1) !== -1) continue;
    const at = config.road.toWorld(pickup.pos.edge, pickup.pos.s, pickup.pos.d, 0);
    let best: { rider: Mover; dist2: number } | null = null;
    for (const { m, x, z } of takers) {
      // Took one earlier this tick: one weapon per hand, the other stays on the road.
      if (st.held[m.id]) continue;
      if ((x - at.x) * (x - at.x) + (z - at.z) * (z - at.z) > PICKUP_NEAR_M2) continue;
      const rel = relative(config.road, m, pickup, PICKUP_S_M + 2);
      if (!rel || Math.abs(rel.ds) > PICKUP_S_M || Math.abs(rel.dd) > PICKUP_D_M) continue;
      const dist2 = rel.ds * rel.ds + rel.dd * rel.dd;
      if (!best || dist2 < best.dist2) best = { rider: m, dist2 };
    }
    if (!best) continue;
    const weapon = st.pickupWeapon[pid] ?? '';
    takePickup(st, best.rider, pickup);
    emit(world, 'weaponGrab', best.rider.id, { weapon, source: 'road' }, { target: pid });
  }
}

/**
 * The kick flag on an attack that is not a kick: converts it while it is in its wind-up, or while
 * it is inside the kick-conversion window (keeping its age); the file header has the rule.
 */
function convertToKick(world: World, config: SimConfig, st: CombatState, a: Mover, flags: number): boolean {
  const id = a.id;
  const age = st.age[id] ?? 0;
  const window = Math.round(((world.params['combat.kickConvertMs'] ?? 250) * 60) / 1000);
  const early = age <= window + EPS;
  if (!early && st.phase[id] !== 'windup') return false;
  const kick = resolveWeapon(config, st, id, true);
  if (!kick || kick.contentId !== KICK_ID) return false;
  const carried = early ? Math.min(age, Math.max(0, kick.windupTicks - 1)) : 0;
  // A swipe that asks for the straight kick re-aims the converted kick at the rider ahead.
  if (straightFlag(flags)) setAim(world, config, st, a, flags);
  startAttack(world, st, a, kick, st.cause[id], carried);
  return true;
}

export const combatSystem: SimSystem = {
  name: 'combat',
  init(world: World, config: SimConfig) {
    const st = combatState(world);
    const riders = riderState(world);
    for (const m of world.movers) {
      const def = config.riders[m.riderIndex];
      if (m.kind !== 'rider' || !def) continue;
      riders.health[m.id] ??= def.healthMax;
      st.phase[m.id] = 'idle';
      st.weapon[m.id] = '';
      st.elapsed[m.id] = 0;
      st.age[m.id] = 0;
      st.side[m.id] = 1;
      st.straight[m.id] = false;
      st.targetId[m.id] = -1;
      st.landed[m.id] = false;
      st.cause[m.id] = 0;
      st.cooldown[m.id] = 0;
      st.cooldownWeapon[m.id] = '';
      st.stagger[m.id] = 0;
      st.knockPeak[m.id] = 0;
      st.knockT[m.id] = 0;
      st.knockTicks[m.id] = 1;
      st.calm[m.id] = 0;
      st.regenAcc[m.id] = 0;
      st.lastAttackerId[m.id] = -1;
      st.hitTick[m.id] = -1;
      st.downSeen[m.id] = false;
      st.fallBy[m.id] = -1;
      st.fallChain[m.id] = 0;
      st.takedowns[m.id] = 0;
      st.prevFlags[m.id] = 0;
      st.pending[m.id] = false;
      st.pendingFlags[m.id] = 0;
      st.touched[m.id] = -1;
      st.held[m.id] = '';
      st.heldPickup[m.id] = -1;
      st.stealCued[m.id] = false;
      st.sweptSides[m.id] = 0;
      st.sweepFirst[m.id] = -1;
    }
    // Starting weapons (a cop's baton or taser): in hand from the start, as a stowed pickup.
    for (const m of world.movers.slice()) {
      const want = m.kind === 'rider' ? config.riders[m.riderIndex]?.startingWeapon : undefined;
      const w = want ? weaponById(config, want) : undefined;
      if (!w || w.unarmed) continue;
      const pickup = world.movers[spawnPickup(world, w.contentId, { ...m.pos })];
      if (pickup) takePickup(st, m, pickup);
    }
    // The roadside weapons: each spot draws one, weighted by roadsideWeight (absent: 1).
    const pool = config.weapons
      .filter((w) => !w.unarmed)
      .map((w) => ({ w, weight: Math.max(0, w.roadsideWeight ?? 1) }))
      .filter((p) => p.weight > 0);
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    const spacing = world.params['combat.pickupSpacingM'] ?? 500;
    const spots = roadsideSpots(config, spacing, () => nextFloat(world.rng.combat));
    for (const spot of spots) {
      if (total <= 0) break;
      let r = nextFloat(world.rng.combat) * total;
      const pick = pool.find((p) => (r -= p.weight) < 0) ?? pool[pool.length - 1];
      if (pick) spawnPickup(world, pick.w.contentId, spot);
    }
  },
  step(world: World, config: SimConfig) {
    const st = combatState(world);
    const frozenAtStart = st.hitStopTicks > 0;
    const ts = world.timeScale;
    // Last tick's falls first: a takedown (and its slow motion, from the phases after this one).
    creditTakedowns(world, config, st);
    crashWeapons(world, config, st);
    slide(world, config, st, ts);
    const health = riderState(world).health;

    // Press edges first, for everyone, so the steal pass sees every thief before any attack moves.
    const pressed: boolean[] = [];
    for (const a of world.movers) {
      if (a.kind !== 'rider') continue;
      const flags = world.inputs[a.id]?.flags ?? 0;
      pressed[a.id] = (flags & ~(st.prevFlags[a.id] ?? 0) & InputFlag.attack) !== 0;
      st.prevFlags[a.id] = flags;
      st.cooldown[a.id] = Math.max(0, (st.cooldown[a.id] ?? 0) - ts);
      st.stagger[a.id] = Math.max(0, (st.stagger[a.id] ?? 0) - ts);
    }
    stealPass(world, config, st, pressed, ts);

    for (const a of world.movers) {
      if (a.kind !== 'rider') continue;
      const id = a.id;
      const flags = world.inputs[id]?.flags ?? 0;

      if (!isRiding(a) || (health[id] ?? 0) <= 0) {
        if (st.phase[id] !== 'idle') endAttack(st, id);
        st.pending[id] = false;
        st.pendingFlags[id] = 0;
        continue;
      }
      const player = isPlayer(config, a);
      // The bump rule: remember the rider a player's attack touched in this tick's riding phase,
      // while it was winding up or out (his target, once touched, stays the one).
      if (player && (st.phase[id] === 'windup' || st.phase[id] === 'active') && !st.landed[id]) {
        const touched = touchedSince(world, config, st, a, world.tick);
        const was = st.touched[id] ?? -1;
        if (touched >= 0 && (was < 0 || was !== st.targetId[id])) st.touched[id] = touched;
      }
      advance(world, config, st, a, ts);
      stealCue(world, config, st, a);

      const wantKick = (flags & InputFlag.kick) !== 0;
      const override = sideFlag(flags);
      if (st.phase[id] === 'idle') {
        const staggered = (st.stagger[id] ?? 0) > EPS;
        // A player's press while staggered is kept and starts the attack as the stagger ends
        // (combat-3). AI controllers press again when they want to, so theirs is dropped as in M1.
        if (pressed[id] && staggered && player) keep(st, id, flags);
        if ((pressed[id] || st.pending[id]) && !staggered) {
          // A kept press starts with its own kick and side flags, updated by this tick's.
          const f = st.pending[id]
            ? (flags & ~(InputFlag.kick | SIDE_BITS)) | keepFlags(st.pendingFlags[id] ?? 0, flags)
            : flags;
          st.pending[id] = false;
          st.pendingFlags[id] = 0;
          const w = resolveWeapon(config, st, id, (f & InputFlag.kick) !== 0);
          if (w) {
            setAim(world, config, st, a, w.contentId === KICK_ID ? f : f & ~InputFlag.kick);
            // The bump rule reaches back: a bump just before a player's press is this attack's own.
            st.touched[id] = player ? touchedSince(world, config, st, a, world.tick - BUMP_AFTER_TICKS) : -1;
            startAttack(world, st, a, w, undefined);
          }
        }
      } else if (st.phase[id] === 'windup') {
        // The side and kick flags may still change the attack until the active moment starts: a
        // new forced side, or the straight kick asked for on a kick's wind-up.
        const straightNow = st.weapon[id] === KICK_ID && straightFlag(flags);
        if (straightNow && !st.straight[id]) setAim(world, config, st, a, flags);
        else if (override !== 0 && (override !== st.side[id] || st.straight[id])) {
          setAim(
            world,
            config,
            st,
            a,
            flags & ~(override < 0 ? InputFlag.attackSideRight : InputFlag.attackSideLeft),
          );
        } else reAim(world, config, st, a);
      }
      const converted =
        st.phase[id] !== 'idle' &&
        wantKick &&
        st.weapon[id] !== KICK_ID &&
        convertToKick(world, config, st, a, flags);
      // The press buffer: a player's press anywhere in a recovery (one the kick conversion did not
      // take) is kept; a kept press keeps reading the kick and side flags.
      if (pressed[id] && player && !converted && st.phase[id] === 'recovery') keep(st, id, flags);
      else if (st.pending[id]) st.pendingFlags[id] = keepFlags(st.pendingFlags[id] ?? 0, flags);
      hitTest(world, config, st, a);
    }
    flyPass(world, config, st, ts);
    pickupPass(world, config, st);
    recover(world, config, st, ts);

    // The hit-stop counts raw ticks, starting the tick after it began, so riders (which move
    // before combat) and combat's own knockback both hold still for exactly its length.
    if (frozenAtStart) {
      st.hitStopTicks--;
      if (st.hitStopTicks <= 0) {
        st.hitStopTicks = 0;
        world.timeScale = st.resumeTimeScale;
      }
    }
    // The slow motion's raw ticks run only on ticks the world moved (a hit-stop pauses them).
    stepSlowmo(world, st, frozenAtStart);
  },
};
