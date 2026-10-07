---
kind: changed
audience: dev
---
CI uses fresh timings from two successful full suites. The unit workload needs three slices to fit its existing planning limit; no timeout or planning share increased. Browser jobs keep eight slices by splitting the transient-card checks into coverage and loading specs with the same setup and paint helper. All ten tests keep their names, callback bodies and assertions.

The refreshed predictions include job setup and the last browser slice's perf run. The new partition check includes every current test file, including files without a measured time. Split timing entries identify the original measured tests and the separately measured resize regression; the next full-suite refresh can replace those derived entries with direct file measurements. Browser execution remains for CI; not phone-verified for this change.

The coordinator also owns integration and CI failures. Builders work in parallel when their files are independent; shared code and contracts have one owner. Ready dependent branches can be handed back without keeping a worker waiting. Ordinary PRs use the train; a full-gate exception needs a concrete reason. The keeper classifies a failed step before retrying and remains responsible until each PR merges or has a recorded blocker. Project instructions and the engineering guide describe this allocation without requiring a large pool or a separate keeper agent.

The optional workflow template now builds branches and returns reports to the coordinator. It launches no keeper or live-check agents, defaults to two builders, requires an explicit execution model, and marks every result as still requiring integration and a live check. Mocked execution checks that unpublished prerequisites can feed dependent builders, missing evidence prevents a dependent launch, and invalid dependency cycles are rejected.
