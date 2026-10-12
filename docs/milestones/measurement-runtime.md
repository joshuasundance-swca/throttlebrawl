# M5 isolated repeated-race runtime contract

`[default]` This APP slice supplies an isolated repeated-race runtime for the later DEV frame
collector. It starts only from the ordinary menu, repeats one qualified classic race, and releases
ownership through one terminal path. It does not establish the M5 phone launch bar, a qualifying
phone run, GPU completion, screen presentation, or continuous-scene thermal equivalence. It never
parks or resumes an existing race.

The diagnostic scene helper, owned screen-wake lease, actual-frame observation and canonical collector progress access are prerequisites. This contract defines their runtime consumer and the additive AUDIO and RENDER seams needed before it can be connected.

## Ownership and module boundary

APP owns preparation, its independent seed, the scene's private config and stream, simulation,
repeat lifecycle, driver invocation, wake lease, renderer/audio borrowing, frame eligibility,
normal-operation exclusion, restoration, and terminal publication. DEV owns the bot factory,
canonical collector, 900000 ms eligible-duration target, 1200000 ms post-commit wall deadline,
stop decision, and report. The composition root may connect a later UI entry to DEV. DEV imports
APP; APP never imports DEV.

The runtime is a parallel APP branch. It does not call ordinary `newSim`, `launchRace`,
`showPicked`, `pickRoute`, result, career, Quick Play, replay, seen/veto, or seed helpers.
It needs no generic session manager, second app/canvas, active-race snapshot, new RAF observer,
save-format change, or production synthetic clock.

## Frozen public APP surface

The types below are added beside the existing public `TickDriver` and `AppHandle` definitions in
`src/app/index.ts`. The exact imported public types are:

```ts
import type { AudioSuspendLeaseResult } from '../audio';
import type { WakeLease, WakeLeaseResult } from '../platform';
import type { QualitySetting, QualityTierId } from '../render';
import type { MeasurementSceneResult } from './measurement-scene';
```

The scene prerequisite must export `MeasurementSceneResult` (and its public description types)
from `src/app/measurement-scene.ts`; the wake prerequisite must export
`WakeLease` and `WakeLeaseResult` from `src/platform/index.ts`; render already exports
`QualitySetting` and `QualityTierId`. `TickDriver` remains the existing
`(snapshot: SimSnapshot, actions: ActionState) => void`.

```ts
type AppDeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T :
  T extends readonly (infer U)[] ? readonly AppDeepReadonly<U>[] :
  T extends object ? { readonly [K in keyof T]: AppDeepReadonly<T[K]> } :
  T;

export type AppMeasurementScene =
  Extract<MeasurementSceneResult, { kind: 'ready' }>['scene'];

export interface AppMeasurementRepeatRequest {
  readonly index: number;
}

export interface AppMeasurementRequest {
  readonly signal: AbortSignal;
  readonly driverForRepeat:
    (repeat: Readonly<AppMeasurementRepeatRequest>) => TickDriver;
}

export type AppMeasurementRefusalReason =
  | 'aborted'
  | 'owner-busy'
  | 'not-menu'
  | 'wrong-ui-screen'
  | 'ui-paused'
  | 'normal-load-pending'
  | 'normal-launch-pending'
  | 'lifecycle-held'
  | 'renderer-context-lost'
  | 'lockstep-active'
  | 'superseded-before-start'
  | 'scene-refused'
  | 'wake-refused'
  | 'wake-lost-before-start'
  | 'audio-suspend-refused';

export interface AppMeasurementRefusal {
  readonly kind: 'refused';
  readonly reason: AppMeasurementRefusalReason;
  readonly sceneRefusal:
    AppDeepReadonly<Extract<MeasurementSceneResult, { kind: 'refused' }>> | null;
  readonly wakeRefusal:
    AppDeepReadonly<Extract<WakeLeaseResult, { kind: 'refused' }>> | null;
  readonly audioRefusal:
    AppDeepReadonly<Extract<AudioSuspendLeaseResult, { kind: 'refused' }>> | null;
}

export type AppMeasurementStopReason =
  | 'collector-target'
  | 'collector-deadline'
  | 'collector-bad-timestamp'
  | 'collector-overflow'
  | 'collector-feed-failed'
  | 'caller-cancelled';

export interface AppMeasurementRepeat {
  readonly index: number;
  readonly finalTick: number;
  readonly reason: 'finished' | 'busted' | 'session-ended';
}

export interface AppMeasurementRestoration {
  /** The ordinary state immediately before a superseding action is delivered. */
  readonly logical: 'menu';
  /**
   * 'restored' means reset + receipt application + one CPU renderer call completed.
   * It makes no GPU-completion or screen-presentation claim.
   */
  readonly visible: 'restored' | 'blocked-context' | 'draw-failed';
}

export interface AppMeasurementWorkload {
  readonly simulation: 'qualified-default-isolated-repeat';
  readonly replay: {
    readonly policy: 'omitted';
    readonly normalRecorder: 'untouched';
  };
  readonly audio: {
    readonly policy: 'omitted';
    readonly normalAudioPolicy: 'suspend-if-running';
    readonly commitEvidence: 'no-context-or-suspended-or-closed';
  };
  readonly graphics: {
    readonly policy: 'retain-current-setting';
    readonly governor: 'separate-fresh-windows';
    readonly frameDivisor: 1;
  };
}

export interface AppMeasurementRuntime {
  readonly phase: 'running' | 'ending' | 'ended';
  readonly repeatIndex: number;
  readonly tick: number;
  readonly countdown: boolean;
  readonly divisor: 1;
  readonly quality: {
    readonly setting: QualitySetting;
    readonly tier: QualityTierId;
    readonly scale: number;
    readonly pixelRatio: number;
  };
  readonly wake: WakeLease['state'];
}

export type AppMeasurementEnd =
  | {
      readonly kind: 'stopped';
      readonly reason: AppMeasurementStopReason;
      readonly repeats: readonly AppDeepReadonly<AppMeasurementRepeat>[];
      readonly restored: AppDeepReadonly<AppMeasurementRestoration>;
    }
  | {
      readonly kind: 'cancelled';
      readonly reason:
        | 'signal'
        | 'manual-pause'
        | 'back'
        | 'quit'
        | 'superseded';
      readonly repeats: readonly AppDeepReadonly<AppMeasurementRepeat>[];
      readonly restored: AppDeepReadonly<AppMeasurementRestoration>;
    }
  | {
      readonly kind: 'failed';
      readonly reason:
        | 'hidden'
        | 'pagehide'
        | 'fullscreen'
        | 'rotate'
        | 'context-lost'
        | 'wake-lost'
        | 'wake-observation-failed'
        | 'synthetic-clock'
        | 'scene-drift'
        | 'driver-conflict'
        | 'action-gate-failed'
        | 'driver-factory-failed'
        | 'driver-failed'
        | 'draw-failed';
      readonly repeats: readonly AppDeepReadonly<AppMeasurementRepeat>[];
      readonly restored: AppDeepReadonly<AppMeasurementRestoration>;
    };

export type AppMeasurementEvent =
  | { readonly kind: 'repeat-start'; readonly index: number }
  | {
      readonly kind: 'repeat-end';
      readonly repeat: AppDeepReadonly<AppMeasurementRepeat>;
    }
  | {
      readonly kind: 'ended';
      readonly end: AppDeepReadonly<AppMeasurementEnd>;
    };

export interface AppMeasurementSession {
  readonly scene: AppMeasurementScene;
  readonly workload: AppDeepReadonly<AppMeasurementWorkload>;
  readonly ended: Promise<AppDeepReadonly<AppMeasurementEnd>>;
  inspect(): AppDeepReadonly<AppMeasurementRuntime>;
  subscribe(
    listener: (event: AppDeepReadonly<AppMeasurementEvent>) => void,
    onError: (error: unknown) => void,
  ): () => void;
  stop(reason: AppMeasurementStopReason): void;
}

export type AppMeasurementStart =
  | AppMeasurementRefusal
  | { readonly kind: 'started'; readonly session: AppMeasurementSession };
```

`AppHandle` gains:

```ts
beginMeasurement(request: AppMeasurementRequest): Promise<AppMeasurementStart>;
```

`AppOptions` gains an optional construction-time `measurementSeedSource?: SeedSource` for
focused tests. Production defaults to `cryptoSeed`. This source is independent from the ordinary
`RaceSeeds` object. There is no public seed override, shorter-success duration, timestamp, config,
stream, renderer, storage, or settings parameter.

Every returned data object and array is a fresh, deeply frozen plain value. Session methods are the
only capabilities. The ready scene type is exactly the ready result's already-deep-readonly
`scene`; config and stream never escape. `sceneRefusal` is non-null only for `scene-refused`
and is exactly the refused extract. `wakeRefusal` is non-null only for `wake-refused` and is
exactly the refused extract. `wake-lost-before-start` carries neither object because an acquired
lease, rather than a refused result, lost qualification before publication. `audioRefusal` is
non-null only for `audio-suspend-refused` and is exactly the audio refused extract. Abort,
supersession, and wake loss carry no audio refusal even when they win while audio acquisition is
pending.

Unexpected programmer exceptions from scene resolution or wake prerequisite acquisition are not
content refusals. APP retires the pending owner and any acquired resources, then rejects
`beginMeasurement` with the original exception. AUDIO's explicitly contained suspension and
observation failures use its frozen refused result instead. Once a session object exists, all
runtime terminal paths are represented by `ended`; none escapes through RAF, input, listener, or
cleanup.

## Strict preflight and preparation

Preflight order is fixed:

1. an already-aborted request refuses `aborted`;
2. another pending, ending, or active owner refuses `owner-busy`;
3. require public state `menu`, UI's exact current screen `menu`, and `ui.paused === false`,
   mapping those failures to `not-menu`, `wrong-ui-screen`, and `ui-paused`;
4. require no lifecycle/context hold, lost renderer context, normal content load, normal launch
   continuation, or non-null lockstep mode, mapping those failures respectively to
   `lifecycle-held`, `renderer-context-lost`, `normal-load-pending`,
   `normal-launch-pending`, and `lockstep-active`;
5. reserve a unique measurement owner generation before the first await.

UI adds an APP-readable `screen(): Screen` getter. The runtime requires both
`state() === 'menu'` and `ui.screen() === 'menu'`; public `AppState` remains `menu` while
measurement owns the parallel runtime. APP and UI also add one pre-mutation action gate. Every UI
handler packages its entire local mutation and APP callback as one once-only delivery closure and
consults the gate before changing region, route, screen, pause, settings, radio, tuning, garage,
imports, busy state, or persistent data. The APP gate contains its own exception boundary. During
pending preparation, an internal gate exception retires the owner and rejects `beginMeasurement`
with that exception; during an active session it terminates as `action-gate-failed`. The original
delivery closure is not invoked, the original exception propagates to that action's caller after
cleanup, and no closure can run twice.

The radio shortcut uses the same gate from owner reservation through cleanup. AUDIO publicly
re-exports its existing pure `radioKeyAction(event): 'next' | 'skip' | null`; AUDIO removes both
its stand-in and engine-owned window key listeners, and UI removes its after-the-fact keydown
microtask. APP installs the one capture-phase listener. For an accepted key it creates one complete
delivery closure that calls `audio.nextRadio()` or `audio.skipTrack()` and then calls the existing
`ui.syncLive()` synchronously to update tuning, settings, and persistence. The gate owns that whole
closure: pending preparation cancels then delivers it once, active measurement consumes it without
either audio or UI mutation, and ordinary operation delivers it once. No independent listener or
queued microtask can retune or persist outside the gate.

APP tracks:

- a measurement owner generation;
- a normal-operation generation covering ordinary loads, selection, backdrop work, and launches;
- the opaque renderer presentation token returned for the current complete receipt;
- explicit pending normal load and launch ownership.

Every ordinary continuation that can launch, redraw, select, notify, clear busy state, or consume a
seed captures and rechecks the normal-operation generation before mutation. Measurement
continuations capture and recheck the owner generation, normal-operation generation, exact selected
intent, UI screen, lifecycle/context state, and wake state after every await and immediately before
commit. Stale continuations may populate immutable caches; they cannot write selection, backdrop,
notices, busy state, seed state, or launch anything.

Preparation draws one uint32 seed from the separate measurement seed source. It loads only the
selected scene's declared dependencies and existing sim steps/planners, then calls the reviewed
pure `resolveMeasurementScene`. It never temporarily selects the scene. A scene refusal maps to
`scene-refused` with its exact frozen refusal. APP then requests its own wake lease with an
owner-controlled signal. A refused lease maps to `wake-refused`. After fulfillment APP checks
`lease.state` immediately before commit. Lost maps to `wake-lost-before-start`; released uses
the already-latched `aborted` or `superseded-before-start` cause. A released lease without such
a cause is a programmer error: retire ownership and reject rather than invent a refusal. Every
unpublished acquired lease is released exactly once. APP next calls
`audio.acquireSuspendLease({signal: ownerSignal})` and races it through the same owner settlement.
An audio refused `aborted` result maps to the already-latched `aborted` or
`superseded-before-start` cause. Any non-abort audio refusal maps to `audio-suspend-refused` with
that exact frozen refusal. An audio `aborted` result without a latched owner cause is a programmer
error and rejects after cleanup. Every unpublished acquired audio lease is released exactly once.
With no intervening await or external callback, the final commit rechecks owner generation, menu
intent, lifecycle/context, wake `held`, and audio lease `held`, then synchronously rereads
`audio.state()`. A read throw or non-quiet state releases the unpublished lease and refuses
`audio-suspend-refused` with respectively `observation-failed`/null or
`not-suspended`/the observed state. Only a current `none`, `suspended`, or `closed` observation may
be followed immediately by session construction and publication.

Caller abort and superseding ordinary actions settle preparation promptly without awaiting a
hung content, wake, or audio-suspend promise. The owner-controlled signal retires late wake
fulfillment through PLATFORM and late audio fulfillment through AUDIO. A stale content
continuation remains generation-inert.

## Action policy

The gate and every public APP mutator use this table. “Deliver” means invoke the original complete
mutation/callback exactly once. A thrown delivered action propagates to its original caller after
measurement cleanup; it does not reopen or alter the terminal result.

| Phase and action | Frozen behavior |
| --- | --- |
| Any duplicate `beginMeasurement` | Refuse `owner-busy`; do not disturb the first owner. |
| Already-aborted request | Refuse `aborted`; acquire nothing. |
| Pending: any ordinary public mutator or UI action | Invalidate and settle preparation as `superseded-before-start`, then deliver once. |
| Active: `session.stop(reason)` | Stop with that exact reason; consume the call. |
| Active: request abort | Cancel as `signal`; consume. |
| Active: manual pause, Back/Escape, Quit | Cancel as `manual-pause`, `back`, or `quit`; consume. Do not open ordinary pause/results UI. |
| Active: explicit normal UI action or public mutator | Cancel as `superseded`, finish synchronous logical cleanup, then deliver once. |
| Active: gameplay, camera-cycle, R-radio, Backquote/tuning shortcuts | Drain and consume; measurement continues. They do not change camera, radio, tuning, settings, or storage. Raw pause uses the terminal row above. |
| Active: read getters, `checkReplay`, frame subscribe/unsubscribe, measurement subscribe/unsubscribe, `inspect` | Allow without changing ownership. |

Pending/active ordinary delivery includes navigation, region/route selection, Race/restart,
career/map, setup, garage, import, settings/radio/tuning, install/reload, debug export, `setSeed`,
`setTickDriver`, `onStep`, and `setLockstep`. A foreign driver/listener/lockstep setter is
delivered only after cleanup and is never overwritten by restoration.

The measurement overlay owns pointer input. APP's capture-phase keyboard guard applies from owner
reservation through terminal cleanup. The centralized R handler above and every Backquote, camera,
pause, and ordinary UI handler reach the action gate before mutation. Device latches are still
sampled and drained. During active measurement only manual pause terminates; camera and other raw
controls are discarded.

## Protected normal state and runtime branch

The following is the exact minimal protection list:

1. Keep untouched the ordinary `race`, `prev`, `curr`, `recent`, `playerId`, outcome,
   countdown/finish-shot, career race, Quick Play log/settings/done/retry, selected
   event/route/stream/event/hashes/replay key, settings/profile/tuning objects, normal recorder,
   normal quality governor, and normal `RaceSeeds`.
2. APP tracks the exact ordinary `TickDriver | null` and ordinary step listener. A
   measurement-owned driver occupies a separate branch. Measurement steps never invoke the
   ordinary step listener. Cleanup restores the normal driver slot only while its owner token still
   owns that slot; a delivered foreign setter wins.
3. Retain an APP-owned menu presentation receipt when normal menu code applies it. It contains one
   complete `RendererPresentationRecipe` with the exact road, environment, dressing, board catalog,
   traffic types, rider looks, player paint, scene seed, renderer look, and normal quality
   tier/scale, plus the menu `prev`/`curr`/player/recent/attract pose required to reconstruct the
   same selected menu scene. The renderer token itself is never reused after measurement takes a
   newer presentation.
4. The measurement branch owns its private sim, stream/config, snapshots, player, countdown,
   event list, driver, repeat index, measurement camera, separate quality governor, and divisor-one
   frame gate. Ordinary runtime references and private governor windows remain parked.
5. The underlying UI screen remains menu behind the overlay. Measurement never calls ordinary
   race, pause, results, career, busy, narrative, ticker, or veto paths.
6. Existing additive frame subscribers stay installed and receive drawn measurement frames through
   the extended frame context. The ordinary single step listener remains installed but is not
   invoked for measurement steps.
7. Existing lifecycle/context holds remain exactly as normal code set them. Measurement cleanup
   never clears a normal hold and releases only its own wake lease.

Measurement replay is omitted. APP never calls `beginRace`, `recordInput`, `recordParams`,
`checkpoint`, `finish`, `resume`, or any other normal-recorder mutation. Normal replay getters
continue to expose the exact same recorder and completed end marker.

Measurement audio is omitted. AUDIO keeps one logical running-intent boolean as the source of
truth for ordinary `resume`, ordinary `suspend`, delayed engine installation, lease acquisition,
and lease release. It replaces the stand-in's current `resumed` flag; a native context's observed
state is evidence of silence, not running intent. AUDIO adds only this specific seam:

```ts
export type AudioObservedState = AudioContextState | 'none';

export type AudioSuspendLeaseResult =
  | {
      readonly kind: 'acquired';
      readonly lease: AudioSuspendLease;
    }
  | {
      readonly kind: 'refused';
      readonly reason:
        | 'aborted'
        | 'suspend-failed'
        | 'observation-failed'
        | 'not-suspended';
      readonly observedState: AudioObservedState | null;
    };

export interface AudioSuspendLease {
  readonly state: 'held' | 'released';
  readonly wasRunningIntent: boolean;
  readonly observedState: 'none' | 'suspended' | 'closed';
  release(): void;
}

export interface AudioSystem {
  // Existing methods, including the existing synchronous-intent `suspend(): void`, are omitted.
  // This measurement-specific primitive settles only after the native suspend request settles.
  suspendForLease(): Promise<void>;
}

export interface AudioFace extends AudioSystem {
  acquireSuspendLease(options: {
    readonly signal: AbortSignal;
  }): Promise<AudioSuspendLeaseResult>;
}
```

`acquireSuspendLease` first captures `wasRunningIntent`, advances the audio generation, and
synchronously changes logical intent to stopped. It installs the abort listener before invoking a
native primitive. It then calls and awaits the relevant `AudioSystem.suspendForLease()` and reads the
current `state()` after fulfillment. With no graph/context or in offline mode, `state() === 'none'`
is immediately quiet. Only a freshly observed `none`, `suspended`, or `closed` state may return an
acquired lease. A synchronous throw or promise rejection returns `suspend-failed`; a state-read
throw returns `observation-failed`; a fulfilled suspension whose observed state is still `running`
returns `not-suspended`. All four are frozen refused results; none leaks the
exception object.

Abort races the native operation and settles the acquisition promptly as refused `aborted`. Any
abort, refusal, or stale fulfillment synchronously retires the acquisition generation and restores
the captured logical intent only if that generation still owns it. It contains the corresponding
async resume. A native suspend that fulfills after cancellation performs one final generation
check: it may issue a contained resume only when the current logical intent is running, and it may
never grant or publish a lease.

AUDIO uses two independent counters. The **intent generation** advances when lease acquisition
takes stopped-intent ownership and on every actual ordinary running-intent mutation (`resume` or
`suspend`). Radio track/station changes and engine loading are not running-intent mutations. The
**engine-load generation** advances once per lazy-engine load/retry attempt and only prevents an
older candidate engine from installing over a newer attempt. Engine construction or installation
never advances, replaces, or transfers the intent generation held by a pending or acquired suspend
lease. Each active load attempt owns an internal identity, its public-facing shared `loading`
promise, and an invalidation wakeup. Advancing either generation resolves the applicable wakeup;
only the attempt whose identity is still stored as `loading` may settle or clear that shared slot.

While no engine is published, AUDIO retains one canonical ordered journal of configuration calls:
`setVolumes`, `setParam`, `setEngineSounds`, `setStations`, `setRegion`, `setRoad`, and
`setRadioCut`. This journal contains configuration only; frame, update, event, countdown, bark,
duck, and radio-control calls are never journaled. Each private candidate has its own replay cursor
and applies every journal entry at most once, in insertion order. Candidate retirement, a failed
suspend or observation, and load retry do not splice, clear, or otherwise consume the canonical
journal. Entries arriving while candidate reconciliation awaits append to the same journal and are
applied from that candidate's cursor before publication. Successful publication synchronously
applies through the then-current journal tail, assigns `engine`, and only then removes exactly the
published candidate's applied prefix. Thereafter a configuration setter calls the published engine
directly. Thus the engine that is actually published receives every pre-publication configuration
call, including late calls, exactly once and in order even when an earlier private candidate fails
or is retired.

Lazy fulfillment constructs an engine as a private candidate and leaves the currently published
engine/context in place. Before the candidate may become `engine`, it captures the current intent
and load generations and reconciles the candidate to the current logical intent. When intent is
stopped, including both a pending acquisition and a held lease, AUDIO invokes
`candidate.suspendForLease()` once and races that promise against the attempt's invalidation
wakeup. A suspend throw/rejection fails the matching attempt. Fulfillment first freshly requires
the candidate's `state()` to be `none`, `suspended`, or `closed`, then rechecks both captured
generations immediately before assignment. An observation throw or non-quiet observation fails the
matching attempt. Failure leaves the prior quiet engine/context published, contains/logs the error,
and clears only the still-matching shared `loading` slot so a later ordinary resume can retry.

If intent or load generation changes before candidate suspension settles, the invalidation side of
the race wins immediately: it retires the private candidate, settles and clears only its matching
shared `loading` slot, and starts or follows the current load attempt when the current running
intent requires an engine. An ordinary `resume()` that caused or observed the invalidation follows
that current attempt through publication and contained native resume; it never remains chained to
the retired suspension promise. The abandoned native promise has fulfillment and rejection
handlers attached. Its later rejection is contained. Its later fulfillment cannot publish the
retired candidate or mutate ownership; after rechecking the current generations it reconciles the
currently published engine/context to the current logical intent, issuing a contained resume only
when intent is currently running. A later ordinary `suspend` leaves it stopped. A replacement
candidate uses the same rules, so an obsolete never-settling suspension cannot hold `loading`,
ordinary resume, ordinary suspend, or a retry open.

When current intent is running and both captured generations remain stable, a current replacement
candidate may be published without waiting for the retired candidate's stopped-intent operation;
after the journal commit, the existing contained generation-checked resume path runs on the
published engine. An uninstalled candidate may receive replayed configuration setters but receives
no `resume`, `frame`, `update`, or `onEvents` call and is never exposed through `state()` or
`inspect()`. Candidate construction, an abandoned candidate suspension, and their shared native
context may not advance logical intent or supersede its current owner.

If load fulfillment occurs while acquisition is pending, it does not stale or refuse the
acquisition. The acquisition may settle against the still-published quiet context; if candidate
installation wins first, its final current-context observation sees the quiet candidate. If
fulfillment occurs while the lease is held, the candidate must be quiet before publication and the
same lease generation remains owner. If abort/refusal or an ordinary intent mutation retires the
pending owner during candidate reconciliation, its next generation check follows the current
intent and can never grant the retired lease. Thus module load may remain unresolved without
blocking acquisition, while every load that eventually settles is either safely installed or
retired.

An acquired lease is total and idempotent. `release()` synchronously changes its state to
`released` and restores the captured logical intent only while the lease generation still owns it;
if restoration requires native resume, that promise is contained and generation checked. Runtime
commit is forbidden until the acquired result and its quiet observed state exist. APP then calls
no measurement `update`, `frame`, `onEvents`, engine-sound, road, radio, countdown, or bark method.
Workload metadata reports `audio.policy === 'omitted'`,
`normalAudioPolicy === 'suspend-if-running'`, and
`commitEvidence === 'no-context-or-suspended-or-closed'`. This is observed CPU-side audio state;
it makes no speaker-output or hardware-latency claim.

Because installation preserves a pending/held lease's intent generation, a held lease still owns
release after any successful delayed installation. Its release restores `wasRunningIntent` through
the currently published engine. An actual later ordinary `resume` or `suspend` advances intent
generation and wins; subsequent lease release and late candidate/suspend/resume continuations are
inert with respect to that newer intent.

The separate quality governor starts from the current `QualitySetting` and current actual tier
with fresh private windows. It persists across natural repeats, advances only from measurement
draw intervals, may adapt resolution normally, and never calls `saveAutoTier`. The normal
governor sees no measurement frames. The measurement divisor is literal one regardless of
settings/tuning. Workload and runtime metadata disclose the policy, actual tier, scale, and pixel
ratio.

## Repeat, driver, frame, and event semantics

The same ready config, stream identity, and uint32 seed are used for every repeat. Assets and the
measurement governor remain warm. Natural `finished` or `busted`:

1. freezes and publishes that repeat's `repeat-end`;
2. invalidates the frame epoch;
3. creates a fresh sim from the same private scene without ordinary settlement;
4. makes the new measurement route/player visible through existing `roadQueries()` and
   `playerId()` getters;
5. invokes `driverForRepeat({index})` synchronously and installs the returned exact function;
6. publishes `repeat-start`;
7. only then permits countdown/input sampling or a tick-zero step.

Index starts at zero and increments exactly once per committed replacement. DEV therefore creates a
fresh bot for every repeat. The factory receives no sim/config/stream handle. A factory throw or
non-function result terminates as `driver-factory-failed` before the repeat can step. A driver
throw is caught around invocation, no sim step follows its partially written actions, and the
session terminates as `driver-failed`; neither exception escapes RAF. A terminal session appends
one `session-ended` repeat only if that repeat had published `repeat-start`, using its actual
last completed tick, and publishes its `repeat-end` before `ended`.

Every call into code outside the owning runtime is a callback boundary, even when it returns on the
same JavaScript stack. APP rechecks the exact owner object and generation immediately after
`driverForRepeat`, after the returned driver, after each session listener and its paired `onError`,
after each `repeat-start`/`repeat-end` publication, after `frames.draw` returns from frame-subscriber
publication, and after any gated ordinary delivery closure. If the check fails, the current stack
returns immediately. In particular: a factory-triggered stop cannot install a driver or publish a
start; a driver-triggered stop cannot call `sim.step`; a repeat-event stop cannot create the next
sim or sample input; and a frame-subscriber stop cannot perform any post-draw audio, HUD/ticker,
seen/veto, look fallback, quality-governor, `saveAutoTier`, renderer-quality, or storage write.
Exception handlers apply the same recheck after calling any external error callback. The once latch
does not substitute for this return barrier.

After scene/wake/audio commit APP constructs the session object before invoking the first factory.
If that first factory fails, `beginMeasurement` still resolves `started` with that session and
its already-resolved failed `ended` evidence; it does not reject or relabel a runtime failure as a
refusal. On success it publishes repeat zero, then resolves `started`. A later subscriber receives
the current-repeat priming event, so it cannot miss repeat zero.

Loop stepping and rendering branch on explicit measurement ownership while public state remains
menu. Frame eligibility is ordinary-race-live **or** measurement-live, with the accepted tick-zero,
countdown, loading, pause, hidden, context, visibility, and null-lockstep checks at both endpoints.
Commit, every repeat replacement, and cleanup invalidate the epoch. Measurement calls the existing
`frames.draw(rawTimestamp, historicalSynthetic, hasPose, render)`; its sample still means only
that the CPU render callback completed. A historical synthetic frame is ineligible and immediately
terminates as `synthetic-clock`. APP performs the owner/generation callback barrier immediately
after `frames.draw` and before the existing render stack's audio/UI/look/governor/persistence tail.
APP adds no second observer and never polls retained history.

Session subscription follows frame observation's proven additive semantics:

- each call creates an independent token, even for the same callbacks;
- duplicate unsubscribe is a no-op;
- publication snapshots entries and skips one removed reentrantly before its turn;
- a listener added during publication does not join that publication's snapshot; after the outer
  publication returns, it receives exactly one current-repeat prime, or the terminal `ended`
  event if reentrant cleanup ended the session first;
- a throwing listener is removed, its exact error is sent once to its paired `onError`, and a
  throwing `onError` is logged and contained;
- listener failure never ends the runtime or blocks siblings;
- subscribing while running and outside publication synchronously primes that subscriber with the
  current `repeat-start`; subscribing after terminal publication synchronously supplies the
  frozen `ended` event and returns a no-op unsubscribe;
- terminal publication order is an in-progress `session-ended` repeat-end, then `ended`, then
  resolution of the same frozen object through `session.ended`.

`inspect()` returns a new deeply frozen snapshot of canonical current state. After terminal it
returns the final `ended` phase values. `stop`, abort, wake loss, lifecycle loss, draw failure,
and action cancellation use a once latch; every call after the first terminal transition is a
no-op, including reentrant calls from listeners or loss callbacks.

## Semantic menu restoration and terminal ordering

“Restored” is deliberately semantic. It means APP reapplied the same selected menu recipe and exact
menu sim snapshot/pose, normal look and quality, reset measurement transients, and completed one
CPU renderer call. It does not preserve renderer-private temporal histories, audio phase, GPU
completion, or proof that pixels reached the screen.

RENDER adds one atomic, compile-shaped receipt boundary using the existing setter parameter types:

```ts
declare const rendererPresentationTokenBrand: unique symbol;

export type RendererPresentationToken = {
  readonly [rendererPresentationTokenBrand]: true;
};

export interface RendererPresentationRecipe {
  readonly road: RoadNetwork;
  readonly env: LookEnv;
  readonly dressing: RoadDressing | undefined;
  readonly boards: BoardCatalog | undefined;
  readonly trafficTypes: readonly SimTrafficTypeDef[];
  readonly riderLooks: readonly RiderLook[];
  readonly playerPaint: string | null;
  readonly sceneSeed: number;
  readonly look: string;
  readonly quality: {
    readonly tier: QualityTierId;
    readonly scale: number;
  };
}

export interface RendererPresentationOptions {
  readonly reset: 'preserve' | 'measurement-to-menu';
}

export interface GameRenderer {
  // Existing methods omitted.
  applyPresentation(
    recipe: RendererPresentationRecipe,
    options: RendererPresentationOptions,
  ): RendererPresentationToken;
  setPresentationQuality(
    token: RendererPresentationToken,
    tier: QualityTierId,
    scale: number,
  ): boolean;
}
```

`applyPresentation` increments the renderer's internal presentation generation exactly once and
returns an opaque token for that generation. It copies the two input arrays, installs all recipe
fields under that one token, and performs one coherent road/scene rebuild; it does not call the
public setters in a way that creates intermediate generations. Every APP path that applies a
complete menu, normal race, or measurement presentation uses this boundary. Existing individual
setters may remain for focused RENDER callers, but no APP production writer uses them. Measurement
and normal quality governors call `setPresentationQuality` with the token belonging to their
current complete receipt; it returns false without mutation for a stale token and otherwise changes
only tier, scale, and pixel ratio without incrementing the presentation generation.

Every renderer-owned asynchronous request captures the current token before its first async edge
and rechecks it after every `then`/`await` and immediately before any live assignment, attachment,
dispose/rebuild, or retry scheduling. This covers film post, race parts, rider-rig chunks plus their
part/model loads and manifest-retry callbacks, backdrop builder/water, road water, staged roadside
scenes, text surfaces, waterfront and its plan,
Chinatown/North Beach blocks, mural alleys, verge, landmark modules and kits, airboats, Pacific
Northwest places and plans, party lights, roadside, downtown, scenery modules/models, and
`EntityViews` traffic vehicle models. For that last chain, the presentation generation supplied by
`applyPresentation` is captured when `setTrafficTypes` calls `requestVehicleModels`; it is checked
after the `vehicles` chunk resolves, after `loadVehicleSets` resolves, and inside
`setVehicleModels` immediately before changing `vehicleSets`, `vehicleGeometries`, or an existing
instanced mesh's live `geometry`. Its existing `vehicleRequest` check remains an additional
same-presentation request guard; it does not replace the presentation check. A stale
completion may fill a token-neutral immutable module/asset cache, but it cannot assign a live
module/layer/model field, attach or dispose a scene node, rebuild the road, alter load flags or
reports, or schedule a retry for the retired presentation. The next current receipt may consume
that cache through its own token.

`reset: 'measurement-to-menu'` runs synchronously before installing the menu recipe. It clears the
pending visual-event queue, wobble/flash/kick state, and interpolation history in `EntityViews`.
Its exact `EntityViews` postconditions also require `dives.size === 0`,
`gestures.size === 0`, `getUps.size === 0`, and `fists.size === 0`; the first restored menu draw
must therefore show no measurement pedestrian dive or held-phone/fist gesture and no measurement
on-foot get-up or fist-shake pose even when menu entity ids equal measurement ids. It also clears
particles, rings, reactors, tint and their clocks in `FeelEffects`; speed-line level/clock; rain
streak visibility/clock; `AirPays` pending crashes, flying paper, mark, visibility and clock;
pending verge bursts; rider-rig ghost/event pose timers; renderer `lastFrameAt`, downtown and
mission tick/still clocks; last-frame scenery counts; and the measurement structure-plan pointer.
It preserves loaded immutable assets/modules, hidden/veto refs, render tuning, reduce-motion, and
normal settings. The freshly applied menu recipe and required actual menu draw then repopulate the
current scene. `reset: 'preserve'` changes none of those transient fields.

The once-only terminal path is:

1. latch the terminal cause and invalidate the measurement generation and frame epoch;
2. set the session phase to ending and prevent further step/render/driver/factory callbacks;
3. detach request/lifecycle callbacks, UI/input guards, and runtime-only consumers; retain session
   subscribers through the terminal event;
4. release only the measurement wake lease and synchronously release the audio suspend lease's
   logical intent;
5. discard measurement sim/camera/countdown/driver/governor references;
6. restore the exact normal driver only if the measurement token still owns its slot;
7. call `applyPresentation(savedMenuRecipe, {reset: 'measurement-to-menu'})`, retain its one fresh
   token, restore the unchanged normal governor tier/scale through that token, and attempt one
   direct actual menu renderer call with the saved menu snapshots and pose;
8. freeze the repeat list, restoration result, runtime final state, and terminal evidence;
9. retire measurement interception while retaining the closing owner marker; for a superseding
   ordinary action, deliver its original complete closure exactly once now, bypassing the retired
   gate so its nested ordinary work runs normally;
10. clear the terminal owner, publish `ended`, clear session subscriber entries, and resolve
    `session.ended` with the same object.

Steps 1–8 are synchronous logical cleanup. The draw is a synchronous CPU call. A lost context
records `blocked-context`; a reset/apply/draw exception is contained, records `draw-failed`,
and cleanup continues. When draw failure itself initiated termination, end reason is
`draw-failed`; otherwise restoration status preserves the primary cause without falsely claiming
visible restoration.

The restoration draw does not call `frames.draw` and cannot recursively publish a measurement
sample. No normal action waits for native wake release, audio resume, asset loads, or GPU work.
Generation checks make every delayed renderer/audio/loader continuation from the retired owner
inert before the action is delivered. The delivered action obtains the next normal
operation/presentation/audio generation. It therefore cannot be overwritten by restoration that
completes later. If delivery throws, terminal publication runs in `finally`, then the original
exception propagates.

`logical: 'menu'` describes state immediately before delivered superseding work. A delivered
action may then open settings or start a normal race. Hidden/context cleanup retains the normal
hold. Stale-build reload treats any pending/active/ending measurement owner as unsaved work and
cannot reload until terminal evidence is frozen.

Lifecycle handlers consult measurement ownership before ordinary `ui.pause`. Before session
publication, any acquired wake loss follows the preparation rule `wake-lost-before-start`. After
commit, hidden, pagehide, fullscreen, rotate, context loss, wake native release/observation failure,
scene drift, driver conflict, and draw failure enter the same terminal path. The active-session
wake callback mapping is exact:
`visibility` becomes `hidden`, `pagehide` remains `pagehide`, `fullscreen` remains `fullscreen`,
`rotate` remains `rotate`, `native-release` becomes `wake-lost`, and `observation-failed` becomes
`wake-observation-failed`. This mapping happens inside the wake callback before it enters the once
latch. It therefore remains correct under PLATFORM's actual ordering, where `leases.lose(reason)`
runs before ordinary lifecycle watchers for the same pause. A later lifecycle callback is a no-op
and cannot replace the first evidence. No terminal condition auto-restarts.

## DEV duration responsibility

DEV subscribes to actual drawn frames, records them in the canonical collector, and uses the
accepted allocation-free collector `state` and `eligibleMs` reads to decide when to call
`session.stop`. APP owns no target timer. DEV starts its monotonic 1200000 ms wall deadline at
runtime commit, independently of frame delivery. The target remains 900000 ms eligible duration,
including the collector's accepted whole final interval and overrun. Target, deadline, bad
timestamp, retention overflow, feed callback failure, and caller cancellation map to the exact stop
reasons above and preserve DEV's partial report. APP terminal reasons are evidence; none proves a
collector or phone launch threshold.

## Automated acceptance

1. **Type/export contract:** a type-only consumer imports every frozen APP type, the scene extracts,
   `WakeLease['state']`, `AudioSuspendLeaseResult`, `RendererPresentationRecipe`,
   `RendererPresentationToken`, `QualitySetting`, and `QualityTierId` through public module exports.
   Refusals cannot carry ready config/stream handles; session metadata cannot expose mutable handles.
2. **Strict entry:** an ordinary menu positive control starts. Boot/start, settings, race options,
   career/map/results, UI-paused or active race, loading, pending launch, hidden/context, lost
   renderer, duplicate owner, foreign lockstep, and already-aborted controls refuse with exact
   reasons and no normal state/storage/seed/driver/audio mutation.
3. **Preparation races:** controlled never-settling load/wake/audio-suspend promises prove prompt abort and
   `superseded-before-start`; late content/wake fulfillment cannot publish, select, draw, notify,
   clear another busy state, launch, or resume audio. Acquired-then-lost wake cannot publish.
   Audio synchronous throw, suspension rejection, state-read throw, and still-running observation
   refuse as `audio-suspend-refused` with exact nested reasons. Commit occurs only after observing
   `none`, `suspended`, or `closed`. Every unpublished wake and audio lease is released once.
4. **Action matrix:** every table row has a positive spy proving the action could mutate normally.
   Pending cancellation settles before one delivery. Active explicit actions observe completed
   logical cleanup before one delivery. Raw controls are consumed. Delivered foreign driver,
   listener, and lockstep values survive and are never overwritten later. With preparation held on
   a never-settling dependency, R cancels first, then one closure performs both retune and synchronous
   `syncLive`; active R performs neither, and no later microtask changes radio settings.
5. **Fresh repeat drivers:** the first and subsequent factories see indices 0, 1, 2 and the
   corresponding measurement `roadQueries`/player before first input. A stateful bot is fresh per
   repeat. Factory throw/non-function and driver throw terminate with exact reasons, perform no
   following sim step, and never escape RAF. Reentrant factory stop installs/publishes nothing;
   reentrant driver stop performs no sim step; reentrant repeat-start/end stop performs no next-sim,
   input, or countdown work.
6. **Normal-state oracle:** identities and serialized values for every item in the protection list
   remain unchanged through preparation, at least two natural repeats, target stop, cancellation,
   and failure. A subsequent normal race supplies the positive mutation controls.
7. **Replay and seeds:** a completed normal replay including its end marker stays byte-for-byte
   identical and remains behind normal getters. Measurement invokes no recorder method. Normal
   seed draw/fix counters remain unchanged and the next normal race matches a no-measurement
   control; one measurement seed remains identical across repeats.
8. **Audio omission:** no measurement audio method is called. Running intent and actual context
   state are varied independently; a session publishes only after the actual context is quiet.
   Abort/supersession settles while suspension hangs; late suspend fulfillment reconciles only the
   current logical intent. Controlled engine loading resolves (a) while acquisition suspension is
   pending and (b) after a lease is held. Both cases preserve the lease intent generation, reconcile
   the candidate to a freshly observed quiet state before installation, settle eventually, and let
   held release restore captured running intent through the installed engine. Candidate suspension
   rejection, observation throw, non-quiet state, obsolete load attempt, and owner cancellation
   never publish the candidate or strand acquisition. A never-settling candidate suspension is
   invalidated by a later ordinary resume, ordinary suspend, and load retry; each later operation
   settles promptly without awaiting that suspension, the matching `loading` slot is the only one
   cleared, and late native fulfillment cannot publish the retired candidate or undo the then-current
   intent. A failed/retired candidate followed by a successful retry proves that queued
   `setEngineSounds`, `setRoad`, and `setRadioCut` calls, including calls appended during the first
   candidate's await, reach the published retry exactly once each and in insertion order. A later
   actual ordinary resume/suspend wins over candidate reconciliation and held release. Stop,
   superseding action, ordinary pause,
   rejected suspend/resume, duplicate release, and reentrant audio changes prove the lease restores
   only its owned intent and cannot later resume over normal work. Metadata exactly reports the
   omission and observed commit evidence without claiming speaker silence.
9. **Graphics:** normal settings/tuning/governor windows never change. Diagnostic governor starts
   from actual setting/tier with fresh windows, adapts across repeats, uses divisor one, makes no
   auto-tier write, reports actual tier/scale/pixel ratio, and restores normal tier/scale/look. Each
   complete receipt increments once; all its fields share one token; stale-token quality updates
   are inert. Delayed completion is forced for every named renderer request family, and each stale
   completion is proved unable to assign, attach, dispose/rebuild, change reports/flags, or retry.
   The traffic vehicle-model test separately delays the `vehicles` chunk and `loadVehicleSets`,
   advances presentation at each edge, and proves stale completion cannot change `vehicleSets`,
   `vehicleGeometries`, or live instanced-mesh geometry; a current-token positive control changes
   all three. Measurement-to-menu reset clears every named transient while preserving caches, veto
   refs, and normal tuning. Reused-id controls seed `dives`, `gestures`, `getUps`, and `fists`, then
   prove the restored menu draw has baseline pedestrian/on-foot poses and all four maps are empty.
10. **Frame truth:** only completed CPU render callbacks emit; measurement-live frames use the
    accepted both-endpoint gates. Tick zero, countdown, load, holds, non-null lockstep, context loss,
   and synthetic history are ineligible; synthetic terminates. Commit/repeat/cleanup change epoch.
   A subscriber that synchronously stops on a delivered frame proves the retired outer stack makes
   zero following audio, HUD/ticker, seen/veto, look, governor, renderer-quality, auto-tier, or
   storage writes.
11. **Repeat isolation:** natural finish and bust publish ordered end/start events, reuse identical
    scene/config/seed, keep warmed assets/governor, never show ordinary results, and never settle
    career/Quick Play/replay.
12. **Listener semantics:** duplicate callbacks have independent tokens; self/sibling unsubscribe,
    subscribe during publication, listener throw, `onError` throw, reentrant stop, current-repeat
    priming, and post-terminal subscription match the specified ordering without sibling loss or
    duplicate terminal publication.
13. **Restoration:** normal menu receipt reset/reapply and one actual renderer call are independently
    observed. Context-blocked and throwing draw paths report exact restoration status. Delayed
    measurement renderer/audio/content continuations are released after a superseding normal action
    and demonstrably cannot overwrite its scene, audio intent, selection, or UI.
14. **Terminal totality:** signal, stop reason, pause/back/quit, lifecycle/context, both wake-loss
    classes, drift, conflict, action-gate/factory/driver/draw failure, and collector stops share one
    once-only cleanup. Gate failures propagate only after cleanup. The in-progress repeat ends
   before the one ended event/promise. The real PLATFORM ordering is exercised for all six wake
   loss reasons and proves the first evidence is exactly `hidden`, `pagehide`, `fullscreen`,
   `rotate`, `wake-lost`, or `wake-observation-failed` as mapped. Hidden cleanup keeps the normal
   hold; stale reload cannot run before evidence freezes.
15. **Workload oracle:** ready scene metadata and private config match the independently tested scene
    contract; simulation is the qualified default isolated repeat, replay/audio are omitted, current
    graphics use a fresh governor, and divisor is one. No assertion turns this helper/runtime run
    into a qualifying phone or launch verdict.

## Implementation sequence

1. Add the AUDIO suspension and RENDER presentation APIs with their focused acceptance controls.
   These prerequisite changes preserve existing ordinary callers. Keep the existing radio listeners
   until the complete APP/UI replacement delivery is ready in the integration change.
2. Under one APP integration owner, add the parallel runtime and normal-operation generation guards,
   adopt complete renderer receipts, and replace the radio listeners and UI observer together with
   the gated delivery. This change completes the action and restoration policies above.
3. Add the DEV collector consumer, menu entry and report integration under a separate reviewed
   consumer contract. Preserve the canonical target and partial outcomes. No shortened success
   duration or phone launch verdict is introduced by this runtime.

The contract defines implementation acceptance; source review is not evidence that its runtime
behavior has already been implemented or verified.
