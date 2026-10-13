# U-turn shortcut after braking

`[default]` Holding the U-turn shortcut and steering must turn a slow, grounded player even when a normal brake press immediately preceded it. A previous brake gesture must not silently consume the shortcut's first tap.

The shortcut first holds the brake with straight bars for 0.4 seconds, then releases it before sending its ordinary short tap, gap and held brake. This briefly brakes while clearing either a prior first tap or an armed second press. It adds about half a second before the pivot, avoids a new replay command, and does not change the manual touch gesture or its speed limit.

## Automated acceptance

- Feed actual keyboard samples through the rider simulation. Holding Q with steering completes the turn from an idle brake state, after a long brake released between samples, and after a recent short brake tap.
- Use the simulation's existing first-tap duration to define long braking. The idle case proves the sampled keyboard-to-simulation path works before the repair.
- Complete the slow, stopped turn within three seconds of simulation time. Preserve existing tests for both directions, held/stuttering full-lock braking, cancelled gestures, AI exclusion and replay determinism.
- Keep the same recorded SimInput shape and manual brake gesture. The shared keyboard/gamepad shortcut still supplies the gesture through brake and steering inputs.
- Run the normal gate and a served native-key check with a sampled brake press before Q, alongside the deployed pause help.

Desktop verification does not establish real-phone or physical-gamepad behavior.
