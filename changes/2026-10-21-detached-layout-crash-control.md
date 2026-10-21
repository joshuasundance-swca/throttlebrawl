---
kind: fixed
audience: dev
---
The detached-body layout check now deliberately holds a wheelie until the player crashes, then
observes the real tumble and get-up transitions. It still checks the followed-player identity and
mask, measures the actual bike and rider geometry, and detects a planted HUD cover over each body
in both modes. This replaces the assumption that the bot must suffer an incidental crash within
1,200 ticks after a paid landing; it no longer claims that natural crash frequency.
