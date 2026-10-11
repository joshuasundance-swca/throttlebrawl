# M5 frame observation contract

`[default]` This supplies the actual app-frame input for the [pure collector](./soak-frame-measurement.md).
It adds an observation surface, not a soak session, bot, wake lease, menu action or phone verdict.

## Public app surface

```ts
export interface AppDrawnFrame {
  readonly timestampMs: number;
  readonly epoch: number;
  readonly eligible: boolean;
}

// AppHandle
subscribeFrames(
  onFrame: (frame: Readonly<AppDrawnFrame>) => void,
  onError: (error: unknown) => void,
): () => void;
```

App owns subscriptions and eligibility epochs. The existing game loop supplies its raw RAF
timestamp to the app render hook as a third argument, after the frame gate accepts that callback.
A fourth `synthetic` boolean records whether this frame entered the lockstep stepping branch,
captured before stepping and retained even if a step hands the mode back to real time. Current
mode at emission alone cannot identify that final fast-forward frame.
The existing clamped render delta, fixed-step planning, interpolation and lockstep behavior remain
unchanged. Rejected frame-gate callbacks emit nothing. No independent RAF or clock supplies data.

A sample means the app's scene-render invocation returned normally while context was not known
lost before or after the call. Emit immediately after that invocation; post-processing's scene and
final-quad calls together form one logical frame. No pose, known context loss or a thrown render
invocation emits no sample and invalidates continuity. Preserve the existing render exception
behavior by rethrowing after invalidation. This is CPU-side call completion, not proof of GPU
completion, compositing, screen presentation or display refresh. No render interface change is
needed for the currently known void-render paths; a later new no-op path must preserve this rule.

## Eligibility and epochs

Persistent `liveEligible` requires all of: race state, current race and snapshot, unpaused UI and loop, no
hidden/context hold, no foreground `loadingRoads`, document visible, renderer context not known
lost, countdown no longer holding, snapshot tick greater than zero, and real-time loop mode
(`lockstep === null`). Emitted `eligible` is `liveEligible && !synthetic`; the historical flag
belongs only to that frame and never enters remembered eligibility or the epoch signature.
It means measurable real-time gameplay, not a qualifying largest-field,
default-full-rate phone scene.

Menu/results/paused backdrops can emit completed-render samples with `eligible: false`. Real-time
zero-step frames, crashes, tumble, on-foot recovery, airborne riding, takedowns, slow motion and
finish-shot frames remain eligible while the predicate holds. Preserve their raw wall intervals;
do not substitute slowed sim time or remove warmup frames. Background asset/road/model arrivals
do not make racing ineligible merely because a download exists. Capped racing remains diagnostic
data; the next accepted timestamp includes the skipped callbacks' elapsed time.

Use a nonnegative safe-integer epoch, owned by the App instance and never reset on subscription.
Refresh a live eligibility-context signature at each transition and before emission. Its fields
are app state, race and snapshot presence, snapshot tick-zero status, UI and loop pause, hidden
and context hold membership, foreground loading, document visibility, renderer context-loss
status, countdown holding, and normalized lockstep mode/count. Advance epoch on an actual
signature change, including false-to-false changes while already ineligible. Positive tick
values and the historical `synthetic` flag are excluded. Also invalidate at every race
replacement and missing/failed draw attempt, even if the signature is identical. Refresh after
replacement before its explicit invalidation; multiple genuine changes may advance more than
once, but exact increments are not a consumer contract. Stable frames,
no-op sync calls, duplicate holds and unchanged lockstep requests must not advance it. An epoch
must never wrap or become unsafe; exhaustion fails explicitly rather than emitting a false identity.

A final fast-forward step that sets lockstep to null changes the live signature at that point.
Its drawn frame remains ineligible because it entered synthetically. A subsequent no-op sync
does not change epoch, and the next real-time frame may be eligible at that same epoch. The
collector's both-endpoint eligibility rule excludes their crossing interval.

The following source seams are mandatory, including transitions entirely between sampled frames:

- `go`/finish/menu/quit/retry state changes;
- `launchRace` replacement and countdown begin, after its new snapshot and UI are ready;
- UI pause/resume through `syncRunning`, after the paused value changes;
- hidden/context hold membership changes, including UI auto-pause;
- both true/false assignments of foreground loading in region and career starts, including failure;
- countdown release and the first actual sim step, so the last held tick-zero frame stays ineligible;
- AppHandle `setLockstep`, including actual fast-forward entry/exit through that method;
- no-pose/context/failed-render attempts.

Read document visibility as well as holds: the platform watcher's initial hidden reason does not
necessarily invoke the app callback. Returning visible or restoring context cannot override an
existing pause. Between-frame interruptions must change epoch even if both observed endpoints
are subsequently eligible. The later session owner still records interruptions and total wall time.

## Subscription ownership and failure

Each registration owns a distinct token and idempotent unsubscribe closure, including duplicate
functions. Removing one token removes only that registration. Never replace tick drivers, step
listeners or existing renderer/platform lifecycle callbacks to install a subscriber.

Capture and freeze one three-field sample before dispatch. All listeners for that draw see its
original values even if an earlier listener changes app state. Snapshot the registration entries:
new entries wait for the next draw; an entry removed before its turn is skipped. No synthetic
initial frame is delivered. With no subscribers, allocate no sample or dispatch array.

A throwing subscriber is detached before its required error callback runs; notify it once and
continue the other listeners and normal loop. An error callback that throws is isolated and
reported once through `console.error`; it cannot suppress other deliveries or stop the loop.
A measurement owner must freeze incomplete data on its error callback. Feed loss cannot silently
become a successful session. Render failures retain their separate existing exception behavior.

## Automated acceptance

1. Injected RAF queue tests prove raw accepted timestamps, including an interval above the sim
   clamp, and no event for frame-gate skips. Existing step/interpolation/lockstep controls still pass.
2. App wiring tests observe the actual renderer call: one sample after successful direct or logical
   post-pass rendering; none on missing pose, context no-op or throw. Preserve render errors.
3. Real-time race positive controls versus menu, paused, results, initial-hidden, countdown-last-held,
   tick-zero and lockstep negatives. Real gameplay modes/slow motion/zero-step frames remain eligible.
4. Exercise every seam above. Between-frame pause/resume, hidden/shown, context loss/restore,
   loading start/end and identical-scene race replacement change epoch. Unchanged calls and stable
   frames retain it. Feed actual emitted samples into the pure collector and reject crossing gaps.
5. Actual fast-forward entry/exit and direct normalized lockstep changes break continuity; unchanged
   normalized requests do not. A fast-forward hand-back to null during a step leaves that frame's
   historical synthetic flag true and its observation ineligible. Preserve existing tick driver,
   step listener and simulation behavior.
6. Duplicate/additive subscriptions, owner-only cleanup, mutation attempt, subscription changes
   during dispatch, failing listeners/error callbacks and surviving loop/deliveries are observed.
7. A focused CI browser test subscribes through the built app's `window.__app` AppHandle, checks race,
   pause/menu and cleanup, and uses tick/dev predicates rather than wall-clock waits. It does not
   shorten or pretend to complete the production 15-minute test.

Use the small internal helper to inject missing-pose/context-no-op/thrown render attempts in
unit tests; app wiring and the browser's real context-loss seam cover the actual surface.

Ownership: one app implementation owner handles `src/app/index.ts`, `loop.ts`, a small internal
frame-observation helper, affected unit tests and the focused browser regression. Root handles
integration. The dev collector's API, existing rolling perf/report, simulation, saves, replay,
quality behavior, platform and UI interfaces remain outside this slice. Only after this surface is
implemented and verified does the app-owned session contract connect a collector to it.
