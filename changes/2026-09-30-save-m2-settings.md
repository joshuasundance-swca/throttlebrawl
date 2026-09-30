---
kind: new
audience: dev
---
The settings record can now hold every M2 setting: difficulty, steering assist, the lower-speed multiplier, race length, steering method and tilt sensitivity, throttle mode, pull-back brake, haptics, slow motion, reduce shake, the frame-rate cap, the tuning-panel entry, gamepad remaps, the last build whose what's-new card this device saw, and the "cut this" list. Each is a new field with a default, so the record stays at version 1: an M1 record loads with the M2 defaults filled in, and an M1-era build still loads an M2 record. Fields this build doesn't know, written by a later build, now survive its load and save, so rolling a deploy back loses nothing. Two helpers come with it: `withVeto` adds a "cut this" flag once per item, and `settingsAssists` gives the sim's per-slot assists shape (auto-throttle is the "auto" throttle mode). Nothing reads the new fields yet; the settings screen (ui-2) and the race start (app-4) wire them up.
