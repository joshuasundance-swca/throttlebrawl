---
kind: dev
audience: dev
---
The sim snapshot now fills each rider's `attackPhase` (idle, windup, active, recovery, or cooldown after a kick), `targetId` (the current auto-target while an attack runs, else -1) and `lastAttackerId` from combat's state (`combatView` in `src/sim/combat/`), instead of the skeleton's constants. Render, camera, audio and the HUD can now show the wind-up telegraph, frame the target and know who hit whom. `heldWeapon` stays null until combat-2's pickup.
