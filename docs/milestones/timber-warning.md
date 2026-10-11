# Readable Timber warning

[default] The served Old Growth check on 2026-10-11 showed a player-targeted tell about 28 metres behind the player. The encounter card and rendered phases work, but a rearward windup is easy to miss. Use the existing target-health HUD area to identify a nearby Timber rival and its state with sound muted. Continued development is authorized; no new gameplay or public contract is required.

## Behavior

Show the nearby living Timber rider targeting the player during tell, charge and winded recovery in the existing target-health widget. Include its content-derived name and a short plain phase label. An incoming Timber warning takes precedence over the ordinary auto-target; when the warning ends, restore the current ordinary target without retained state. Scope it to Road riders on the same edge, within 35 metres of progress, with at most 2 metres of road-relative height separation and no finished rider. World elevation changes along a hill do not exclude riders sharing that road surface. Do not advertise an NPC-targeted or distant signature. Respect a removed target-health widget and existing HUD layout, text size and reduced-motion preferences. No flash, sound, new HUD box, camera change, AI retune, asset, save format or network dependency.

## Automated acceptance

1. Derive focused unit tests from this contract and prove them red against existing behavior before implementation. A nearby Timber signature targeting the player is identified despite idle combat and no ordinary target; tell, act and open carry distinct plain labels and the correct name/health.
2. Preserve ordinary auto-target behavior and controls for another signature, NPC targeting, far/split-edge/high targets, dead or finished riders, a down player and missing/idle signature. Leaving eligibility restores the current ordinary target. Multiple eligible riders resolve deterministically.
3. Add focused DOM coverage through the real UI update, including warning priority, phase/name/health changes and reset; respect target-health removal. No test waits for time or frames.
4. A browser CI regression drives an actual authored boss race through the test handle and asserts the rendered warning, bounds and readable name/phase at small landscape/all text sizes. Find its seed by bounded search or reuse a documented content-derived fixture; no writes to sim state. Keep the existing gameplay tests and negative controls.
5. The full existing CI gate and budgets remain required. The coordinator inspects the served warning with sound muted and records that desktop browser evidence is not phone verification.

## Ownership

A UI worker owns the UI helper/integration, focused unit/DOM test, focused browser regression and change note. The coordinator owns this contract, integration, types, CI and the single served browser slot. No worker network, browser, build or typecheck; local tests are only named touched unit files with two workers. Read the whole file before edits and preserve unrelated work.
