# Cached startup: remaining M5 acceptance

`[default]` M5 offline-1 still requires a browser test showing that the installed game boots from its cache in under five seconds when navigation network requests hang. This target remains unmet; the [HTTP fallback repair](./offline-http-fallback.md) establishes response correctness and functional return only.

## Preserved candidate and evidence

The local candidate branch `lane/render/cached-startup-target` retains commit `d09fabcad258cb3dfb8c6d61e163384797bfaf43`: the 500 ms page window, exact nearest-sample renderer index, their unit controls, and the browser's exact `expect(timing.firstVisible).toBeLessThan(5000)` assertion. They are unaccepted candidates, not proven remedies. The focused HTTP branch restores the original three-second window and renderer implementation. Before resuming this candidate, reconcile its changes against the accepted HTTP branch; do not assume merging the scope split preserves candidate-owned changes.

Observed CI browser results, in milliseconds:

| Candidate | Train first visible | Independent PR-head control first visible |
|---|---:|---:|
| Three-second window, `f30e06e` | 7845.2 | 7662.2 |
| 500 ms window and indexed lookup, `06cee55` | 4398.2 | 6843.3 |

Primary browser-job logs: `f30e06e` [train](https://github.com/joshuasundance-swca/throttlebrawl/actions/runs/38317235803/job/115036715511) and [PR-head control](https://github.com/joshuasundance-swca/throttlebrawl/actions/runs/38317235803/job/115041156228); `06cee55` [train](https://github.com/joshuasundance-swca/throttlebrawl/actions/runs/38321601430/job/115050775242) and [PR-head control](https://github.com/joshuasundance-swca/throttlebrawl/actions/runs/38321601430/job/115054242412). The coordinator re-derived these values from the primary logs; the independent source review did not verify historical timings.

The diagnostic dry run at `d09fabc` observed first visible at 5760.9 ms, response start at 503.4 ms, response end at 509.3 ms, DOM interactive at 3964.6 ms and DOM content loaded at 4040.1 ms. It observed one actual held service-worker request, production mode and no cleanup errors. The response returned near the candidate's timeout, but the remaining startup delay has not been attributed to a specific cause. These runs are not controlled main-versus-candidate performance comparisons and do not establish optimization payoff or phone timing.

The diagnostic [train log](https://github.com/joshuasundance-swca/throttlebrawl/actions/runs/38324401723/job/115059673835) supplies those navigation fields. Its [PR-head control](https://github.com/joshuasundance-swca/throttlebrawl/actions/runs/38324401723/job/115063428534) also missed the unchanged bound, with first visible at 7892.3 ms. Both are failed timing acceptance, not successful performance validation.

## Automated acceptance

- Preserve the exact end-to-end first-visible `<5000` assertion in production mode under an actual held service-worker navigation request. A response-time proxy does not satisfy it.
- Retain visible start-screen and usable-menu assertions, hidden-menu observer control, actual request proof, installed-cache integrity, HTTP error/update controls and cleanup/error checks.
- Any resumed timeout or renderer candidate retains its manual timer, uncached-response, exact linear-reference, tie, geometry and cold-construction controls.
- Diagnose the remaining delay before adding further production optimizations. Run normal gates and a coordinated served-build check; name the device, renderer and scene. Desktop software-rendered browser evidence is not phone verification.

Completing the HTTP repair does not close this task or M5 offline-1. The five-second target is not relaxed or relabelled as phone-only acceptance.
