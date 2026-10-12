# M5 diagnostic repeated-race consumer

`[default]` This DEV slice connects the reviewed APP runtime to the canonical collector and
an explicit menu tool. It is not a phone launch test. It measures completed CPU renderer-call
intervals while an isolated repeated race is eligible; audio and recording are omitted.
This contract defines implementation acceptance; its source review is not evidence of a working tool.

## Prerequisites and ownership

Implement only after the runtime API, complete renderer receipts and audio lease are accepted.
DEV owns one consumer per AppHandle, its bot factory, collector, independent wall deadline,
small diagnostic overlay and latest report. APP owns simulation, action exclusion, wake/audio,
repeats and restoration; DEV uses only public APP methods. No second RAF, lockstep driver,
direct sim stepping, replay mutation, quality setting, storage or remote send is added.

One coherent consumer owner may edit src/dev/measurement.ts and focused tests, src/dev/index.ts,
src/dev/report/index.ts and summary.ts/tests, src/main.ts, plus the optional UI callback plumbing
in src/app/index.ts and src/ui/index.ts and focused menu layout tests. A separate interface
amendment described below lands first. Do not invent a generic session manager.

## APP timing evidence

The current session API resolves beginMeasurement after commit, first driver creation and first
repeat-start publication. DEV cannot infer exact commit time from that later promise settlement.
Add readonly committedAtMs:number to AppMeasurementSession. It is the finite nonnegative raw
performance.now() value captured once at runtime commit, immediately before the first factory or
external publication. It uses the same performance time origin as real RAF timestamps. It is
unchanged across repeats and deeply frozen with the session. It is evidence, never a public clock
override. Acquisition/preparation time is excluded from post-commit wall accounting.
Add readonly endedAtMs:number to every AppMeasurementEnd variant, captured from the same clock
once when APP latches its terminal cause, before restoration/external terminal callbacks. A later
subscription to an already-ended session therefore reports the real runtime terminal instant.

## Entry, cancellation and visible state

Add an optional onMeasureFrames callback through main -> APP -> UI, with its button in the
ordinary menu's existing More tools alongside the debug-report action. Label it 'Measure frames'.
The callback is absent/hidden until wired. It never appears as a race/pause/settings action.
Opening it does not switch the underlying UI screen: APP's strict menu preflight remains true.
The diagnostic overlay has a compact explanation, Start, Cancel/Stop and Close, and scrolls on a
small landscape phone. Explanation: 'Runs an automated repeated race. Keeps 15 minutes of eligible
frame intervals, with a 20-minute wall limit. Sound and recording are omitted. This is a diagnostic,
not a phone performance pass.' No auto-start. Start is explicit and disabled while preparing/running.
Provide explicit 'Copy debug report' and 'Save debug file' buttons in the diagnostic overlay using
the existing DEV export helpers, so a completed result can be saved directly from the menu.
Exports while running are labelled partial and leave the session running. Do not require starting
a normal race merely to reach the existing pause-menu file export.

Opening the overlay creates no APP owner or wake lease. Start synchronously reserves the DEV
attempt and AbortController before calling beginMeasurement. Cancel while preparing aborts once;
Stop while running calls session.stop('caller-cancelled') once. Closing or disposal cancels owned
work and removes owned listeners/timers/DOM. Normal menu actions remain available to APP's accepted
supersession gate. A late response cannot mount, clear a new attempt or replace its result.
APP refusals show their exact reason and nested evidence without a completed-run claim. Unexpected
preparation exceptions show a contained generic failure and are captured by the existing error log.
No refusal constructs a fake session, zero-duration successful result or short-target workaround.

## Collection and timer ordering

Create one fresh canonical createSoakFrameCollector per attempt. After a started result, record
only that session's actual drawn frames through subscribeFrames. Feed only while the exact current
attempt's session.inspect().phase is running; preparation has no feed, and ending/ended inspections
exclude normal/restoration frames before APP's terminal publication. A session that is already terminal when returned produces a partial
result without installing a driver, active overlay timer or a frame feed. Subscribe to terminal
events with the accepted priming semantics, handling synchronous priming before unsubscribe handles
have been assigned. Match callbacks to the exact attempt/session identity after every callback.

driverForRepeat constructs a fresh createBot for every index. Capture current app.playerId() and
app.roadQueries() at factory invocation, fail through the runtime factory path if absent, and
return the bot.drive closure using those same handles. Never call setTickDriver or onStep.
The bot itself remains unchanged. Keep real repeat indices and runtime ended.repeats, not an
independent duplicate repeat ledger.

Use SOAK_TARGET_ELIGIBLE_MS (900000) and the collector's readonly state/eligibleMs. Per frame,
record the exact raw timestamp/epoch/eligible sample once, then inspect direct collector state;
do not sort/report or retain a second interval history per draw. If it becomes target-reached,
stop as collector-target. Retention overflow stops as collector-overflow. RangeError input
validation stops as collector-bad-timestamp; any other feed failure stops as collector-feed-failed.
The frame observer's paired onError stops as collector-feed-failed. Stop is once-only, and the
outer callback returns immediately after stop. Normal-state cleanup remains APP's responsibility.

Set one independent timer for committedAtMs + 1200000 relative to current performance.now(),
clamped at zero only for scheduling, never for report accounting. Its callback rechecks current
clock and attempt ownership; an early callback rearms the remaining duration. It stops as
collector-deadline at/after the absolute deadline even if no drawn frame arrives. Frame-feed
entry checks that deadline before recording, so a late target frame cannot defeat an already
expired wall limit. A target frame observed before the deadline may stop first; later timer
callbacks are inert. No deadline begins before commit and no test-only duration exists.

Use APP's frozen end.endedAtMs. Ended promise reconciliation must reuse that evidence, not
recalculate elapsed time from delayed callback delivery. Cancel a still-collecting collector using
the exact terminal kind/reason; preserve target-reached and retention-overflow states unchanged.
Detach feed and deadline before collecting the final report so restoration frames cannot enter it.
Keep every terminal result, including context-blocked or draw-failed restoration. No throwing
report callback or DOM teardown may strand APP ownership.

## Report and progress

Latest result is per AppHandle, session-local and never persisted. Running progress reads only
canonical eligibleMs/state plus immutable scene/workload/runtime inspection, throttled for DOM
updates without a second RAF. A UI progress timer is owned and cleared; it never supplies samples.
Report() is computed on explicit user export or terminal freeze, not every frame. A report during
collection is labelled partial/running and cannot accidentally cancel the collector.

The report outcome is a plain-data union: refused (exact APP refusal and no collection/timing),
failed-before-start (generic failure with no fabricated runtime result), running (partial collector,
sampledAtMs and wallMs from sample time, endedAtMs:null and end:null), or ended (exact frozen APP
terminal evidence and its endedAtMs). It has no session/controller/DOM/timer or mutable handle.
Every snapshot is a fresh deeply frozen value; running export does not replace a terminal result.
The running/ended variants contain schemaVersion:1, build/device observations and their capture phase,
scene and workload, committedAtMs/endedAtMs/wallMs, runtime final quality/wake state,
exact terminal evidence/repeats/restoration and the full canonical SoakFrameReport. Refusal evidence
is a separate latest-attempt outcome with no invented timestamps or collection metrics. Device
is navigator.userAgent, not a hardware model inferred from it.

Retain only one fixed-size lastMeasurementRender observation. Inside the delivered frame callback,
after confirming this exact session is running and BEFORE checking the deadline or requesting any
stop, capture app.rendererStats(): actual width/height/pixelRatio/drawCalls/triangles/renderer string,
with phase:'measurement-frame' and that delivered raw timestampMs. No report/sort or observation
history is created. Only a finite nonnegative timestamp can identify this observation; otherwise
retain the previous observation or null and let canonical collector validation stop bad input.
Freeze a copy into running/ended report snapshots; if no measurement observation was successfully
captured by this consumer, lastMeasurementRender is null. Never replace it with current renderer
stats during ended publication, export, menu restoration or later normal play. A getter failure
terminates through collector-feed-failed and retains the last successfully captured value or null.
Final quality/wake comes from the session's frozen runtime inspection, never restored-menu stats.
Quality capture reports when observed;
do not imply one unchanged tier over the run. Refresh rate and GC counts are unknown/omitted.
No pass boolean, 30-fps threshold verdict, GPU/screen-presentation or continuous thermal claim.
Terminal wallMs is endedAtMs - committedAtMs. Running wallMs is sampledAtMs - committedAtMs.
Collector observedSpanMs/excludedObservedMs/eligibleMs describe
only its sampled span; wall time outside sampled endpoints is not fabricated into excluded frames.

DEV gatherReport attaches its own optional measurement data from the per-AppHandle consumer;
APP does not import the report type or store DEV data. buildSummary adds one compact labelled
diagnostic line with outcome, eligible/wall durations and primary reason, while remaining within
2048 UTF-8 bytes and preserving normal error visibility. Full debug file adds a labelled one-line
measurement JSON section before the unchanged replay marker. ReportData with no measurement must
retain existing output. parseDebugFile remains summary+replay compatible. Copy/save requires the
existing explicit user action; nothing sends or exports automatically. Closing the diagnostic
does not erase its latest result; the next explicit attempt replaces it only when an outcome exists.

## Automated acceptance

1. Menu tool is optional, inside More, not offered during race/pause/settings. Open alone changes
   no state; explicit Start creates exactly one attempt. Portrait and landscape rendered checks
   show Start/Stop/Close and summary in bounds with scroll available and unchanged normal menu.
2. Fresh bots receive indices0/1/2, current player/road before first input; no ordinary driver,
   listener, lockstep, replay or persistence mutation occurs. Normal race is a positive control.
3. Exact frame samples reach the collector once. Transition epochs/ineligible endpoints exclude
   gaps; ordinary, preparation and restoration frames do not enter it. A planted early slow frame
   survives over600 intervals. No report/sort is called from progress sampling.
4. Controlled monotonic timestamps exercise the full canonical900000ms target and overrun,
   retention overflow, malformed timestamps and independent1200000ms wall deadline with zero
   frames. Deadline/target ties obey the explicit precedence. Delayed first-factory/subscription
   controls prove commit/end timing is captured by APP rather than promise settlement or callback
   delivery. No real-time waits or short constants.
5. Pending/active cancellation, already-ended started result, synchronous priming/terminal callback,
   listener error, aborted late promise, duplicate clicks/stops, supersession and disposal leave
   no owned feed/timer/DOM callback and cannot change a replacement attempt. Positive current
   attempt controls prove stale callbacks were capable of updating state.
6. Interrupted results retain exact reasons/restoration, full partial statistics and separate wall
   versus sampled accounting. No inherited rolling-buffer metrics, invented refresh/GC/phone pass.
   Distinct measurement and restored-menu drawCalls/triangles/pixelRatio prove ended export keeps
   the last measurement-frame observation and timestamp; an already-ended zero-frame control is
   null. A deadline-triggering delivered frame is captured before stop/restoration. Stats getter
   failure stops once without substituting restored-menu evidence.
7. Full export preserves all measurement fields and normal replay marker/parser round trip; absent
   measurement preserves existing output. Long multibyte values/errors stay within2048UTF8bytes
   without losing the newest ordinary error. No automatic clipboard/share/network/storage calls.
8. One served-build check drives real menu Start then Stop and export with a controlled APP runtime
   path plus ordinary menu action afterward. It verifies rendered/restored behavior; injected
   timestamps test numerical duration separately and never claim a phone/15-minute live run.
