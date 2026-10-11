# Hunt riding pace

[default] Address the interview's complaint that competent riding leaves Hunt opponents behind and requires waiting. Existing Hunt grid and minimum-field rules establish initial availability; career field levels still override authored pace with the ordinary tier pace. Continued gameplay development was authorized on 2026-10-10. Exact pace tuning is an implementation choice to establish with observable probes.

## Scope

Resolve a Hunt-only static pace floor at race start from the selected player's real bike capability, after event patches and career field levels. Preserve faster authored opposition. Pass that pace through the existing rival bike construction so a lower bike speed cap does not silently defeat the policy. This is a narrow Hunt exception to career's normal tier-based field pace. Preserve personality, acceleration, ordinary steering/braking, navigation/traffic safety, target identity, reward scoring and global rubber-band settings. No live gap-based boost, teleportation, velocity mutation, new public contracts, new assets or budget increases.

Do not require every opponent to remain beside the player. Crashes, route choices and earned leads remain meaningful. A fast bike must still let the player catch opponents; a slow-bike Hunt must not lower faster authored opposition. If static pace cannot produce useful contact without replacing important handling or race rules, stop that implementation and report the evidence rather than widening the change silently.

## Automated acceptance

1. Actual generic and named Hunt configurations use the resolved selected bike and retain their proper field. Cover valid cross-pack selection, invalid/missing selection fallback, career field override and a season patch changing an event into a Hunt. Faster authored pace is not lowered. Pace is fixed at start, independent of current gaps.
2. Ordinary races, Grudge and Escape retain their existing field pace and bike behavior. Law riders, global rubber-band settings, target counting and rewards remain unchanged.
3. Write a failing contact-opportunity test before implementation. Use actual content-derived app/career setup and ordinary tick-driven rider inputs on a bounded route section, with unrelated optional systems isolated. A forward-riding player on a representative faster bike gets a usable combat-reach opportunity with a living target without braking, waiting or turning around. Measure gap, height, relative speed and duration; do not substitute config values or Hunt victory for this behavior. Compare the same initial setup and inputs before/after. Preserve ordinary physical movement and report the seed-search/tick budget.
4. Probe the real authored opening grid as well as any isolated chase fixture. A fixture beginning with a target behind the player may diagnose pursuit but cannot stand in for the authored opening. Preserve relevant acceleration/navigation safety controls; report limitations rather than claiming every bike/region is fixed.
5. The existing gate, leak scan and budgets hold. A coordinated served check observes the chosen Hunt setup and its actual contact opportunity after deployment. Done remains not phone-verified.

## Ownership

One worker owns app config and its focused tests, the authored Hunt sim probe and change note. The coordinator owns this acceptance contract, integration, central typecheck, CI and the served browser slot. No worker browser, build, network or full local tier. Wait for the worker's ready commit and read its evidence before integration. The boss batch has its own gate and live check; no shared source files are edited concurrently.
