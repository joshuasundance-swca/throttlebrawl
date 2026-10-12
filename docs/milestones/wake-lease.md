# M5 owned screen-wake lease contract

`[default]` Prerequisite for a later ephemeral diagnostic session. PLATFORM owns this additive
API; it adds no app session, button, collector, timer or performance verdict.

## Surface

```ts
export type WakeLeaseLoss = {
  readonly reason: 'native-release' | 'observation-failed' | PauseReason;
};
export interface WakeLease {
  readonly state: 'held' | 'lost' | 'released';
  release(): void;
}
export type WakeLeaseResult =
  | { kind: 'acquired'; lease: WakeLease }
  | { kind: 'refused'; reason: 'unsupported' | 'unavailable' | 'request-failed'
      | 'already-released' | 'unobservable' | 'observation-failed' | 'cancelled' };
// Platform and shared-page export
acquireWakeLease(options: {
  signal: AbortSignal;
  onLost: (loss: Readonly<WakeLeaseLoss>) => void;
}): Promise<WakeLeaseResult>;
```

Each call requests its own native screen sentinel through the existing injected env. The ordinary
`keepAwake(boolean)` sentinel and other leases are independent. Do not replace or aggregate the
ordinary intent/request state. Withdrawing one lease never calls another sentinel's release or
changes ordinary intent. This deliberate smaller design relies on native per-sentinel ownership:
the [2026-09-29 W3C working draft](https://www.w3.org/TR/2026/WD-screen-wake-lock-20260929/)
removes a released sentinel from the document's active list and asks for OS release only when
that list empties. Acquisition remains advisory; browsers may end it, including on hidden pages.
These are specification semantics, not proof of phone behavior.

## Acquisition, loss and cancellation

Preflight order: aborted signal -> cancelled; absent requester -> unsupported; hidden document,
pagehide-until-pageshow flag or an existing platform pause reason -> unavailable. Refusal installs
no owner/request. Windowed use is allowed when no actual fullscreen pause reason exists.

Register the signal and owner token before the native call, and settle cancellation/unavailability
promptly without waiting for a hanging native promise. Catch synchronous requester throws and
rejections as request-failed. No automatic retry or acquisition timeout is added by PLATFORM.
The later app owner supplies a preparation deadline and aborts it.

On fulfillment, install native release observation before checking its live released property.
The reduced WakeLockHandle gains a truthful read-only `released: boolean | undefined`, backed by
the native property; absence is unobservable and cannot qualify. Check again before publishing
acquired. Already-released handles refuse; synchronous release during registration cannot publish
held. Registration throws and live-property read throws before publication refuse as
observation-failed; they never escape the result promise. A cancelled/unavailable old token can
never revive after a hide/show pair. Every fulfilled handle not published to an owner, including
unobservable, observation-failed, cancelled and unavailable results, receives exactly one
contained native release attempt unless positively observed already released. Unknown state is
not proof of release. Identity prevents its event from touching other leases or the ordinary
sentinel. Keep native-only retirement bookkeeping until release is positively observed; when
observation remains unavailable or broken, retain the unresolved bookkeeping for platform lifetime.

Publication means the acquired promise was resolved, not that its consumer has resumed. Native or
lifecycle loss after publication may run before that continuation; invalidate state before the
mandatory onLost callback. The caller must check lease.state at its own commit boundary. Pending
tokens settle refused without onLost; published held tokens become lost and notify once. Terminal
tokens never reacquire. Explicit release/abort means released, withdraws only this owner and does
not notify onLost. Release after loss is a harmless no-op and keeps state lost.

The live state getter detects an observed native released property even if its release event has
not delivered yet, using the same once-only loss path. Observation failure after publication,
including a throwing state-property read or loss of its truthful boolean value, ends a held token
as lost with observation-failed, withdraws the native handle through contained cleanup and notifies
once. This reason means qualification was lost, not that native release was proved. The public
state getter is total; terminal state reads do not attempt renewed qualification. Every state
becomes terminal before its
callback can reenter. Callback exceptions are contained, reported once via console.error and cannot
stop sibling losses, lifecycle watchers or native cleanup. Duplicate events do nothing.

## Lifecycle and cleanup

Install minimal lease-only visibility/pagehide/pageshow availability listeners once when the
platform instance is created, before returning it; these observe events since instance creation,
not events before it existed. Track pagehide until pageshow even before the first acquisition.
Do not install a dummy watchLifecycle subscriber or new guards/gesture policies. Hidden and pagehide
terminate pending and held owners even with no lifecycle subscriber. Record pagehide unavailability
until pageshow. Visibility return never revives a lease. Existing pause(reason) boundaries also
terminate owners, including false-to-false overlap changes; duplicate pause reasons do nothing.
Invalidate all affected token states and detach their signal/callback references before delivering
any captured callbacks, then preserve existing watcher notifications and ordinary sync behavior.
Each listener reads actual env.isHidden independently of watcher ordering. Initial hidden refuses.
Construction without any acquisition requests no wake lock and installs no guards or styles.

Lease-only lifecycle state must not widen ordinary boolean-only behavior. Fullscreen/rotate use
existing pause boundaries; app manual pause/WebGL loss remain future app-session responsibilities.
Loss describes the browser signal's observed boundary, not an exact physical screen-off timestamp.
No clock or polling loop is introduced.

Logical withdrawal is synchronous; it does not prove native/physical release. Contain release
throws/rejections; do not await a hanging release for cancel/refusal/loss settlement and do not spin
retry loops. Retain management of unresolved native handles until their released state/event can
confirm cleanup, without retaining terminated owner callbacks/signals. Never give a retiring handle
to a fresh owner. Its only permitted retained closure is native cleanup bookkeeping. Platform
instances/page lifetime own that bookkeeping; this stage provides no global dispose API.

Keep wakeLockHeld's signature and legacy diagnostic/intent behavior. Its result is the existing
ordinary diagnostic OR any additional managed lease/retiring handle whose native released property
is false. This is best-effort aggregate state, not physical-lock or lease-qualification confirmation;
the ordinary path's legacy pointer semantics are not repaired in this slice. Unknown native state
cannot qualify a lease or contribute verified additional held state. Diagnostic property reads
are contained and total. A failed or unknown read contributes no additional held result and never
discards unresolved retiring bookkeeping. If it detects failed observation of a published held
token, use the same observation-failed terminal path. Existing legacy mocks lacking
the property still exercise legacy behavior; lease qualification mocks supply truthful state.

## Automated acceptance

1. Held positive control and unsupported/hidden/pagehide/pause/aborted/requester-throw/rejection/
   unobservable/already-released/registration-throw/getter-throw negatives. No refusal creates a
   held token or retry loop. Every unused fulfillment has one release attempt unless observed
   already released; unobservable/observation-failed retirement retains no owner callback/signal.
2. Native mock tracks independent active sentinels. A/B and ordinary intent coexist in both orders;
   releasing/aborting A or keepAwake(false) preserves B. Last withdrawal, duplicates and diagnostic
   held state are observed. Mock independence is a test of application calls, not browser proof.
3. Deferred and never-settling acquisition cancellation resolves promptly via controlled promises;
   late unused fulfillment releases once, sibling/ordinary handles remain intact, and hide/show
   during pending acquisition cannot turn the old request into success.
4. Property released before subscription, synchronous registration loss, recheck loss, loss after
   publication before await continuation, property-before-event and stale events all use terminal
   once paths. Adapter forwards a live getter and native once listener. Throwing property reads
   before publication refuse observation-failed; throwing or unknown reads after publication lose
   qualification once with observation-failed. State and diagnostic reads never throw.
5. Native/lifecycle loss with and without existing watchers, initial hidden, overlapping reasons and
   pagehide-until-pageshow permanently end leases. Pagehide with visible document before first
   acquisition refuses until pageshow, without a lifecycle watcher; no construction-time request,
   guards or styles. Ordinary visible-return retry still works.
6. Reentrant/throwing loss callbacks see terminal state and cannot prevent sibling invalidation,
   ordinary notifications or cleanup. Abort/release removes only its own token/listener, no onLost.
7. Native release throw/reject/hang is contained without false cleanup confirmation or auto retries;
   held diagnostics expose positively observed unreleased retiring handles; throwing/unknown
   reads neither report additional held state nor discard retirement. No owner callback/signal
   survives terminal.
8. Existing boolean integration browser specs and scoped platform tests retain their coverage.
   New lease ownership/native-adapter behavior is tested through the actual injected PLATFORM
   implementation with truthful mocks; its built-app browser integration follows the session
   consumer, without inventing a global test bridge now. Tests use controlled events/promises/dev
   predicates, no wall waits or successful phone claim.

Ownership: one PLATFORM owner handles index.ts, a small lease helper and affected scoped tests,
including native mocks and existing browser coverage only if an adapter fixture needs repair.
No APP session integration or changes to
ordinary race wake calls, save/replay/sim/render, shared CI or budgets. Root owns integration and
the coordinated ordinary-race served check after the platform implementation ships; new lease
consumer/browser acceptance remains explicitly deferred to session integration.
