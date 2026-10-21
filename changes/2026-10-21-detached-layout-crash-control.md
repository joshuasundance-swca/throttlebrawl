---
kind: fixed
audience: dev
---
The detached-body layout check now brakes away the landing surge and coasts into a deliberately
overheld wheelie until the player crashes, then observes the real tumble and get-up transitions.
It still checks the followed-player identity and
mask, measures the actual bike and rider geometry, and detects a planted HUD cover over each body
in both modes. This replaces the assumption that the bot must suffer an incidental crash within
1,200 ticks after a paid landing; it no longer claims that natural crash frequency.
The check captures each mode immediately after its real draw and before the next simulation tick,
so a brief get-up phase is measured even when the parked bike is close enough to remount at once.
