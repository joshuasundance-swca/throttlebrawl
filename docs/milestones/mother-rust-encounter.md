# Mother Rust / Drawbridge encounter

`[default]` A focused gameplay slice for the existing first-region boss: readable preparation,
a committed ram that a late lateral dodge can defeat, and a finite recovery opening. Reuse the
existing ram, rider rig, authored finale and scoring. This follows the Old Growth and Pivot
prototypes; it does not establish a current human difficulty or phone-readability defect.

## Behavior and limits

Select private timing only for event `base:keys-boss-mother-rust`, kind `grudge-match`, rider
`base:mother-rust` and signature `ram`. A canonical recreation can use the tactic; career rewards
remain in the separate settlement path. Ordinary Mother Rust simulation behavior stays unchanged.
No new objective, global difficulty retune, health or speed increase, forced proximity,
teleportation, lead erasure, asset, paid generation, tool, dependency, snapshot or pack contract.

Candidate timing: first readiness 240, tell 48, act 36, open 90, gap 480 and spread 180 sim ticks.
First grace and phase durations are unscaled; the existing career scale applies to gap/spread.
These are implementation defaults awaiting runtime checks, not measured phone tuning.

During tell, retain the physical swing wide. At tell-to-act, the selected encounter captures the
target's cross-road line in private state and commits to it. Ordinary ram retains live tracking.
Traffic and shortcut navigation retain the last word on line and speed; an obstacle can override
a move without preventing its acquisition. Never demand a complete ram through an obstruction.

Both timer expiry and early contact enter the selected recovery on the transition tick. Early
contact must use the selected open duration and immediately return the recovery helper. Capture
the private ceiling once from actual mover speed and ordinary target speed on that transition:
candidate 0.85 times their minimum. Ordinary ram's 0.95 pace remains unchanged. Ordinary
throttle/brake produces slowing; no instantaneous speed write. Clear the ceiling on phase exit
and interruption. No swings during recovery; normal throttle resumes after it.

Pre-open target loss finishes with selected scaled gap/spread and a rider-owned RNG draw.
Target disappearance after open starts does not shorten recovery: the selected remaining opening
completes and schedules normally. Down/unsticking interruption retains
`max(existing readiness, tick + scaled gap)` without another RNG draw.

Preparation, ram and recovery get distinct poses using the existing signature snapshot.
It has no committed direction: act/open must not borrow the live target's side to imply one.
Tell may look toward the target as attention. Supported punch/kick windup, active and recovery
poses take precedence across the whole rig; the signature pose returns afterward. Visual phase
polish may apply to ordinary ram appearances; non-ram and neutral geometry stay unchanged.

The authored victory remains finish-ahead OR three player-attributed Mother Rust takedowns,
including health-only falls. Preserve PNW progression, deduplicated golf-cart ownership,
per-season teaser cadence and the existing replay purse. No tactic hint, new rule card, career
code/content change or redundant settlement matrix belongs in this slice.

## Automated acceptance

1. Write the failing test first from content-derived canonical scope. Different event, kind,
   rider, move, ordinary Mother Rust and disabled signatures/style quirks are controls. Retain
   existing signature tests.
2. A tick-driven isolated scene covers tell -> committed act -> finite open, fixed act line after
   a late dodge, no swings, contact and timer entry caps, actual braking where appropriate,
   mover-speed decline, passing opportunity and later throttle resumption. Out-of-range/lateral
   offsets prevent acquisition. A separate matched obstruction proves navigation priority while
   lifecycle remains finite. Check pre-open target-loss RNG scheduling, post-open disappearance
   retaining recovery, and no-draw down/unsticking scheduling. Same seed/input reproduces hashes.
3. Resolve the actual boss through the existing canonical `careerRace` harness. A bounded
   `firstSeed` search uses seeds 1-16 and at most 4800 sim ticks per seed. Qualification requires
   the ram's `targetId` to equal the player ID before calling a dodge player counterplay.
   Observe commitment and physical recovery without teleportation or forced acquisition.
   Preserve failed probes. A null result stops this probe: no wider search, global retune or
   weakened oracle. Success within this bound and human challenge remain unverified until checked.
4. Focused production-rig geometry checks distinguish phases, keep act/open independent of live
   target-side changes and compare supported prior `attackStart` punches/kicks in every attack
   phase against whole-rig ordinary baselines. Verify the signature resumes afterward; retain
   neutral/non-ram controls. Existing fixtures are allowed but do not prove shipped GLB pixels.
   The served check examines the actual model and muted phases.
5. Retain generic attributed-fall/OR scoring, every-career settlement, named-finale loss/replay/
   teaser coverage and Quick Play profile isolation. Do not turn preserved composition into a
   claim that every reward is paid only once; ownership, seasonal teasers and replay purses differ.
6. The existing full gate, leak scan and budgets pass. One coordinated served check examines the
   existing boss card and actual tactic/counterplay after deployment. Done remains not
   phone-verified; fixture checks and bots do not establish human readability or difficulty.

## Ownership

One builder owns the coherent sim/render change and named tests on an existing installed feature
checkout. The coordinator owns the reviewed acceptance, integration and served check. Local runs
are only owned unit files with `VITEST_MAX_WORKERS=2 --project unit`, and the authored sim file
alone by filename with `--project sim`. No local browser/server/build or whole tier. No new
environment or asset generation is required.
