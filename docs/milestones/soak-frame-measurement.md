# M5 soak: frame measurement prerequisite

Implementation contract for the measurement prerequisite. `[default]`

The phone soak needs a record of the whole run, rather than the existing last-600-frame buffers.
This first slice adds only a pure collector in `src/dev/perf/soak-frames.ts` and its unit tests.
It does not start a race, own a driver, acquire wake locks, change settings, add a menu action,
or declare a phone performance pass. Those integrations need their own reviewed app/platform
contracts. The existing rolling overlay and its percentile convention remain unchanged.

## Input and ownership

The collector accepts an ordered stream of `{ timestampMs, epoch, eligible }` samples. A sample
represents a frame actually drawn by the game loop, after its frame-rate gate; timestamps are raw
monotonic frame timestamps in milliseconds. `timestampMs` and `epoch` are TypeScript numbers;
`eligible` is a boolean. Epochs must be nonnegative safe integers (`Number.isSafeInteger`).
The integration must increment the epoch whenever eligibility is interrupted, including a pause,
loading hold, hidden page, context
loss or race replacement that occurs between two drawn frames. No independent RAF loop supplies
these samples. Both endpoints must be eligible and have the same epoch for an interval to count.

Stage one has no loop subscription or app contract. Its caller is responsible for truthful samples.
Unit tests supply explicit timestamps and epochs. A later integration must verify the actual loop
and transition wiring before describing the data as real rendered-frame measurements.

Non-finite/negative timestamps, unsafe/non-integer/negative epochs, non-boolean eligibility,
backwards timestamps or backwards epochs throw a RangeError and leave the collector unchanged.
Equal timestamps replace the validated endpoint's epoch and eligibility, but add no interval/time.
An ineligible endpoint or changed epoch excludes the whole interval; never split or clamp a slow
frame to the simulation's elapsed-time cap. The first frame establishes an endpoint only.

## Retention and duration

Retain every eligible raw interval until collection stops after at least 900000 ms of accumulated
eligible interval time. Include the complete final interval and report its overrun; never trim a
slow final frame to hit the target exactly. Further samples after this terminal measurement state
are ignored. This state means only that the measurement target was reached, not that the soak
qualified: the session owner must separately prove scene, continuity, wake and lifecycle rules.

Report eligible duration, retained sample count, first-to-last accepted frame span and excluded
observed interval duration. These durations describe the supplied frame stream, not time before
the first frame or after the final one. A session report must measure its own total wall duration.
Loading/menu gaps are excluded and visible in the accounting; they cannot certify continuous load.

A fixed safety cap of 1000000 retained intervals ends collection explicitly as incomplete if the
next eligible interval would exceed it. Reject that triggering sample transactionally: keep the
previous endpoint, durations, windows and samples unchanged, then set the retention-overflow reason.
The cap takes precedence even when the refused interval would also reach the duration target.
Never discard old samples silently. Cancellation freezes the partial data with an explicit reason.
Terminal state is checked before input validation: after target, cancellation or overflow, all later
samples and cancellation calls are no-ops, including malformed inputs. No persistence or clocks
live in the collector.

## Numerical oracle

For sorted ascending values `x` of length `N`, an empty summary has sample count 0 and null metrics.
Distribution metric units are milliseconds. The median is the middle value for odd `N`, or the arithmetic
mean of the two middle values for even `N`. The report labels it `medianMs`, not a nearest-rank p50.
For p95 and p99, use index `ceil(p * N) - 1`, with p equal to 0.95 and 0.99 respectively. Maximum is
the final value. The slowest-one-percent tail contains the largest `ceil(N * 0.01)` samples; report
that count and their arithmetic mean. Tail mean, p99 and maximum are distinct diagnostics.
This slice assigns no launch threshold to them. The later session/launch contract must settle the
exact operation for the 30-fps tail bar; tail mean, p99 and maximum imply different rules.
No report field or collector state provides a 30-fps or phone launch verdict.

Minute windows use accumulated eligible interval time. Assign each complete interval to the minute
containing its ending time; an exact boundary belongs to the preceding minute. For the final
overrun, use 900000 ms only to assign the minute while retaining the full raw interval value.
Minute 1 contains endpoints in `(0,60000]`; minute 15 contains endpoints in `(840000,900000]`.
Report both `medianMs` and `medianFps` for these two windows. FPS is `1000 / intervalMs` for each
sample, then the true median of those per-sample rates; it is not the reciprocal of the even-sized
interval median. This preserves the product spec's frame-rate unit alongside M5's interval metric.
An incomplete window's medians are null. A completed window with no samples also has null medians
and sample count 0; a very long interval can skip a window and must not invent data for it.
Report minute sample counts and completeness separately from medians. A missing median cannot
support a thermal comparison.

GC observations, device, renderer, scene, refresh rate, wake continuity and qualification are outside
this collector. Their absence cannot become zero GC pauses or a successful phone run.

## Automated acceptance

1. Hand-calculated odd/even/empty and 100-value distributions distinguish the specified median,
   p95, p99, maximum and slowest-one-percent mean from the old rolling percentile convention.
2. More than 600 eligible intervals retain an early planted slow frame in the full-run statistics;
   a large raw interval remains unclamped. Mutating an input sample after recording it or mutating
   a returned report cannot alter retained data or a subsequent report.
3. Both-endpoint eligibility and changed-epoch controls exclude transition gaps, including a hold
   that starts and ends between sampled frames. Duration accounting reconciles the observed span.
4. Injected timestamps exercise exact minute boundaries, long intervals that skip windows, partial
   window nulls, final overrun and the complete 900000-ms target without wall-clock waits. An even
   minute window distinguishes median per-frame FPS from the reciprocal of median interval.
5. Invalid ordering/data fail without changing the collector; cancellation and retention overflow
   freeze honest partial reports. Assert unchanged overflow endpoint/accounting and cap-before-target
   precedence. Equal-timestamp epoch/eligibility transitions affect the next interval. Unsafe epochs
   fail transactionally. Every terminal reason ignores subsequent malformed inputs and cancellations.
6. Tests and production constants share the 15-minute target; no shortened test-only duration.
7. The report contains diagnostics and collection state, with no GC count, launch-pass boolean or
   30-fps threshold verdict. Target reached cannot imply wake/scene/phone qualification.

## Follow-on sequence

After this contract and collector land, define an additive actual-frame subscription and an
app-owned ephemeral Quick Play session. Review wake acquisition/loss ownership, fixed scene/seed,
largest resolved field, traffic/law/default full rate, interruptions, repeated-race accounting,
save/replay/settings protection and cleanup before wiring the pause-menu tool. Then add the optional
debug-report section and rendered lifecycle tests. Measure on the phone before tuning quality.
