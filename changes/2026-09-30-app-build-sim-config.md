---
kind: dev
audience: dev
---
`buildSimConfig` now resolves every M2 race setting in one place: Easy, Normal or Hard (from nine tuning values `difficulty.<preset>.<scale>` with the plan's starting numbers, so the panel can adjust them), steering assist and auto-throttle per player slot, the lower-overall-speed multiplier, the slow-motion toggle (on by default) and the race length (short, standard or long; an event that lacks the chosen length races its first one, and the config records which length and route it used). All of it lands in the replay header. The difficulty values are read only at race start, never mid-race, so a change "applies next race". Nothing in the menus sets these yet; ui-2 and save-2 add the settings.
