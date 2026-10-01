---
kind: dev
audience: dev
---
A browser test for the menu's region picker: it picks each region the menu offers, starts a race, and checks from the race's own recording that the race is in that region; the Keys must be picked by default. It reports "skipped" until app/ hands the region list to the menu, and arms itself as soon as app/ does.
