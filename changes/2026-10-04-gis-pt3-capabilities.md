---
kind: dev
audience: dev
---
The real-road bake (`tools/gis`) can now write everything playtest 3's real places need. Nothing in the game changes yet: the Seven Mile Bridge, Duval Street, the Golden Gate, Lombard and Bridge City bakes (tasks T9.2 to T9.4) use these next.

- **Ramp lips.** A `ramp` with `params.heightM` is built into the road's elevation with the same formula the hand-made compiler uses, its lip moved onto a sample.
- **Gaps over a missing span.** A stitch joins two map ways across a span the map does not draw (the Old Seven Mile Bridge's missing span) with a straight deck. A gap stitch also writes a `gap` there, optionally with a kicker ramp whose lip is the gap's edge, and with the gap's respawn params (`respawn: "main"` for the Moser Channel).
- **Landmarks from lat/lon.** The bake places each one against the real map line, then maps it into the baked road, so a landmark stays where it really stands beside the road. The network report says how far each lands from its real point.
- **Per-road sample spacing.** A long straight bridge can be sampled every 6 m, about a third of the road data of 2 m. Base's real-road data loads before every race, so this keeps the Seven Mile cheap.
- **Synthetic branch ends.** A branch can leave or join where the map has no junction: a turn, a straight carrying a ramp truck and a gap, and a turn back (the Seven Mile's staging platforms). A junction's road ends must lie within 60 m of it, so each such end is a short connector plus an ordinary staging road.
- **A way filter per line**, so the old bridge's oddly tagged ways can carry a path.
- **Barriers per road and per bridge**, including `jumpable` walls and the `railing` look (the Golden Gate).
- **`aiTake` on a branch**, so the old road can say no rival takes it.
- **The feature-kind list** now includes `landmark`. A test reads the game's own lists out of `src/road/validate.ts`, `src/core/surfaces.ts` and `src/road/types.ts`, so the bake cannot drift from them.

The bake's own lint now also runs these rules:

- the jump lint;
- gap and landmark params;
- no gap on a route's main path;
- jumpable walls and barrier looks;
- playtest 3's new scenery tags.

**Unchanged output.** Every new switch is off by default. On the same cached map and elevation data, the old code and the new baked the Russian Hill network (16 files and its report) and the Twin Peaks stretch (5 files) to byte-identical files. The existing test fixtures' bakes are identical too.

**Tests.** `tools/gis/tests/test_capabilities.py` has 29 tests: a Seven-Mile-like network with a stitched gap, a kicker, two staging ends and two landmarks; ramps, spacing and barriers on a stretch; the lints; a left-side branch; and every committed config still loading. The whole suite has 85 tests, and ruff and strict mypy are clean. CI does not run this Python tool, so its gate is local, as `tools/gis/README.md` says. The README's new section, "Playtest 3: jumps, gaps, landmarks and staging", documents every switch.
