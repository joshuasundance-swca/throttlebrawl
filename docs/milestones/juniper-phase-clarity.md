# Juniper's cut-in body language

`[default]` Make the existing Northwest rival's three cut-in phases distinguishable in her
riding pose. Current rendering uses the same crouch for act and open. This is a source-level
presentation gap, not evidence of human confusion or a need to change difficulty.

## Scope

Keep the shoulder check toward the intended rider during tell. Crouch into the cut during act,
then sit out of that crouch as the move opens and she pulls away. Open is not an exhausted or
slowed phase: the existing simulation uses a 1.05 pace multiplier and suppresses new swings.
Do not change that behavior, timing, targeting, navigation, input, combat, snapshots or content.

Use the existing cut-in snapshot and production rider rig. Act/open must not invent a committed
side from a live target. Supported punch/kick windup, active and recovery take precedence across
the whole rig; cut-in poses resume afterward. Neutral and other signatures remain unchanged.
No new assets, effects, overlays, diagnostic API, generation, dependency or environment.

## Automated acceptance

1. A failing geometry test distinguishes act from open on the actual Rig update path. After the
   change, tell checks toward either actual target side, act crouches further than tell, and open
   sits out of act. Exercise multiple phase times and retain a same-phase equality control.
2. Without a supported combat overlay, act/open signature geometry does not vary with the live
   side of `signature.targetId`; hands and feet remain on their riding contacts. Removing the
   signature restores every neutral bone. Criterion 3 owns attack-side-dependent combat.
3. With a supported prior punch/kick attackStart on either side, all three visible combat phases
   match ordinary whole-rig combat across every cut-in phase; afterward cut-in resumes. Preserve
   existing non-cut-in controls and tests. Fixture parts prove geometry, not shipped-model pixels.
4. Full CI, leak scan and budgets hold. One coordinated served-game check examines the loaded
   Juniper model and actual cut-in phases using existing hooks and muted normal chase. A bounded
   encounter (seeds 1–4, at most 3600 sim ticks each) that cannot expose the phases is recorded
   as incomplete visual evidence, rather than fixed through teleportation, forced acquisition
   or a new seam. Phone readability and
   human recognition remain unverified.

## Ownership

The coordinator owns the small render change, test, note, integration and browser slot, reusing
an installed feature checkout. Local tests select touched unit files only with two workers.
