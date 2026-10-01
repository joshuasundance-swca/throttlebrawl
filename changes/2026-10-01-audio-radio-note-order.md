---
kind: dev
audience: dev
---
Corrected the radio note's station order. The R key goes score, rockabilly, surf, off, because the stations switch in id order (`keys-rockabilly` before `keys-surf`); the first note said surf came first. The in-game browser test (`tests/e2e/audio-radio.spec.ts`) checks the real order.
