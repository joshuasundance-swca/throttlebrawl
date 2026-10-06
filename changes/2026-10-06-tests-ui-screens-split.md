---
kind: dev
audience: dev
---
The browser test of the start, menu and settings screens no longer runs into its 30-second limit. It also raced twice to check that the mirror setting moves the touch buttons, and the whole test took 25.4 s on main (run 37427759843). It ran out of time twice on a PR run (37430031610), both times in its last screenshot, taken mid-race in the software renderer. It is now two tests. The first checks the screens (about 12 s on that main run's timestamps) under the usual limit. The second does the two races (about 13 s), with a 90-second hang guard like every other race test. Each test asserts what the old one did; the first also checks that Back returns to the menu. Not phone-verified (no game change).
