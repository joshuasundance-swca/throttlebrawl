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
import { clamp, nextFloat, type EntityId, type TuningParamDecl } from '../../core';
import type { RoadNetwork } from '../../road';
import { riderState } from '../riders';
import type { AttackPhase, SimConfig, SimWeaponDef } from '../types';
import { addMover, systemState, type Mover, type SimSystem, type World } from '../world';
import { lateSteps } from '../late';

/** The tuning key of the height a hit reaches up or down (supports). */
export const REACH_HEIGHT_KEY = 'combat.reachHeightM';

export const COMBAT_TUNING: readonly TuningParamDecl[] = [
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
/** Tolerance for comparing scaled-time sums against whole-tick durations. */
export const EPS = 1e-9;
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
export type WeaponBehaviour = (typeof WEAPON_BEHAVIOURS)[number];

/** A weapon's behaviour: its `behaviour` id when registered, else the M1 swing. */
export function behaviourOf(w: SimWeaponDef): WeaponBehaviour {
  const id = w.behaviour ?? 'melee.swing';
  return (WEAPON_BEHAVIOURS as readonly string[]).includes(id) ? (id as WeaponBehaviour) : 'melee.swing';
}

export type ActivePhase = Exclude<AttackPhase, 'cooldown'>;

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

export function weaponById(config: SimConfig, id: string): SimWeaponDef | undefined {
  return config.weapons.find((w) => w.contentId === id);
}

export function isRiding(m: Mover): boolean {
  return m.kind === 'rider' && (m.mode === 'Road' || m.mode === 'Airborne');
}

/**
 * Whether b is within a hit's reach of a in height (`combat.reachHeightM`: a rider on a truck's roof is
 * out of reach of one on the road below; two on the same roof fight). Any height with the key left out.
 */
export function inReachHeight(world: World, a: Mover, b: Mover): boolean {
  return Math.abs(b.h - a.h) <= (world.params[REACH_HEIGHT_KEY] ?? Infinity);
}

export function isLaw(config: SimConfig, m: Mover): boolean {
  return config.riders[m.riderIndex]?.faction === 'law';
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
export function candidates(
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

/**
 * Picks the auto-target and side for an attacker; `override` is a side flag (0 = none). The
 * straight kick aims at the nearest rider ahead inside the narrow straight box, and its side (the
 * way the shove goes) is the side he is on. With no override and nobody to aim at, the side is 0:
 * not chosen yet (the wind-up re-aims; the active moment swings at either side).
 */
export function aim(
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

/** A takedown count, for the results screen and M4's takedown hunts. */
export function takedownCount(world: World, id: EntityId): number {
  return combatState(world).takedowns[id] ?? 0;
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
export function takePickup(st: CombatState, rider: Mover, pickup: Mover): void {
  st.held[rider.id] = st.pickupWeapon[pickup.id] ?? '';
  st.heldPickup[rider.id] = pickup.id;
  st.pickupHolder[pickup.id] = rider.id;
  pickup.h = STOWED_H;
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
  // The step is in ./step.ts, a lazy chunk the race waits for (src/sim/late.ts).
  step: (world, config) => lateSteps().combatStep(world, config),
};
