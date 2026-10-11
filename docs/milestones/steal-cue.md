# A weapon glint that follows the steal rule

[default] Repair the existing weapon glint before changing steal timing or controls. The early
combat milestone promises that the glint tells the player when to steal; a whole wind-up is
wider than the actual weapon window. A rider holding a weapon while kicking also cannot have
that weapon stolen. Preserve the small existing cue and the skill required to press it.

## Contract first

Publish optional `EntitySnapshot.stealId` for player riders: the holder selected by the existing
steal rule for a fresh attack on the next combat tick, using current positions and the current
scaled tick length. Publish -1 for no candidate and for non-player entities. The query must be
pure and share the selection code with actual resolution. It is a preview, not a promise about
positions after riders move, a later input, or competing thieves. A still-held attack requires
release before another fresh press; show no candidate while that attack remains held.

Do not change window endpoints, recovery/press buffering, attack direction, kick intent,
ownership, audio events, AI or sim hashes. The contract lands separately before its renderer
consumer. No save or content-format changes.

## Automated acceptance

1. For stationary positive fixtures, preview selects the same holder as a fresh press actually
   steals. Exercise the resolved weapon windows, including both inclusive endpoints, both
   sides, throwing weapon range limits and scaled time. Verify ownership and the transfer event.
2. Show the positive control before changing one precondition to make it fail: early/late age,
   each range dimension and height, player attack/recovery/stagger, sustained attack, held-weapon
   kick, interruption/conversion, law thief and a holder no longer riding. A recovery that ends
   this tick still cannot steal before advancement; stagger uses the actual pre-pass decrement.
3. Preserve preference for holders targeting the thief, then nearest, including the existing
   exact-tie iteration order; retain multiple-thief exactly-once and full-hand swap controls.
4. Repeated snapshots neither mutate combat state nor change replay hashes or later events.
   Non-player/non-rider fields are neutral. Hand-built old snapshots remain valid.
5. In the consumer change, show the existing glint only on the player's selected holder.
   Suppress early and held-kick glints and glints while the player is not ready. Verify fallback
   and rigged rider visibility, with positive and negative controls. Disclose replacement of
   the old test that expected a glint throughout every held-weapon wind-up.
6. Add short control help explaining a fresh press alongside the glint, waiting until a swing
   finishes, and replacing a carried weapon. Existing kick presses may also steal; do not
   describe an invented punch-only action. No new box, road overlay or automatic assist.

## Live check

Drive one real served-game check through existing tick hooks and real input, capture the
rendered cue and resulting transfer if a bounded encounter can be obtained. Record any unmet
part plainly. Human legibility and phone timing remain phone-unverified.
