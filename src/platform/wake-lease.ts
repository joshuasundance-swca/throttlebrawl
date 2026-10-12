import type { PauseReason, WakeLockHandle } from './index';

export type WakeLeaseLoss = {
  readonly reason: 'native-release' | 'observation-failed' | PauseReason;
};
export interface WakeLease {
  readonly state: 'held' | 'lost' | 'released';
  release(): void;
}
export type WakeLeaseResult =
  | { kind: 'acquired'; lease: WakeLease }
  | {
      kind: 'refused';
      reason:
        | 'unsupported'
        | 'unavailable'
        | 'request-failed'
        | 'already-released'
        | 'unobservable'
        | 'observation-failed'
        | 'cancelled';
    };
export interface WakeLeaseOptions {
  signal: AbortSignal;
  onLost: (loss: Readonly<WakeLeaseLoss>) => void;
}
type Refusal = Extract<WakeLeaseResult, { kind: 'refused' }>['reason'];
type LostCallback = WakeLeaseOptions['onLost'];
interface Owner {
  state: 'pending' | WakeLease['state'];
  signal: AbortSignal | null;
  abort: (() => void) | null;
  onLost: LostCallback | null;
  resolve: ((result: WakeLeaseResult) => void) | null;
  native: NativeRecord | null;
}
interface NativeRecord {
  handle: WakeLockHandle;
  owner: Owner | null;
  confirmed: boolean;
  attempted: boolean;
}

/** Independent native requests, with owner-free retirement after logical withdrawal. */
export function createWakeLeases(
  request: () => (() => Promise<WakeLockHandle>) | null,
  unavailable: () => boolean,
) {
  const owners = new Set<Owner>();
  const natives = new Set<NativeRecord>();
  const observed = (record: NativeRecord): boolean | undefined => {
    if (record.confirmed) return true;
    try {
      const value = record.handle.released;
      return typeof value === 'boolean' ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const confirm = (record: NativeRecord) => {
    record.confirmed = true;
    natives.delete(record);
  };
  const cleanup = (record: NativeRecord) => {
    if (observed(record) === true) confirm(record);
    if (record.confirmed || record.attempted) return;
    record.attempted = true;
    try {
      // Success is not release confirmation; only a truthful property or event retires it.
      void record.handle.release().then(
        () => {
          if (observed(record) === true) confirm(record);
        },
        () => {},
      );
    } catch {
      // Logical withdrawal still settles if the native call throws, rejects or never settles.
    }
  };
  const detach = (owner: Owner) => {
    owners.delete(owner);
    if (owner.signal && owner.abort) owner.signal.removeEventListener('abort', owner.abort);
    owner.signal = null;
    owner.abort = null;
    owner.onLost = null;
    owner.resolve = null;
    const record = owner.native;
    owner.native = null;
    if (record) record.owner = null;
    return record;
  };
  const notify = (callback: LostCallback, reason: WakeLeaseLoss['reason']) => {
    try {
      callback({ reason });
    } catch (error) {
      console.error('Wake lease loss callback failed', error);
    }
  };
  const refuse = (owner: Owner, reason: Refusal) => {
    if (owner.state !== 'pending') return;
    const resolve = owner.resolve;
    owner.state = 'released';
    const record = detach(owner);
    resolve?.({ kind: 'refused', reason });
    if (record) cleanup(record);
  };
  const withdraw = (owner: Owner) => {
    if (owner.state === 'pending') {
      refuse(owner, 'cancelled');
      return;
    }
    if (owner.state !== 'held') return;
    owner.state = 'released';
    const record = detach(owner);
    if (record) cleanup(record);
  };
  const end = (affected: Iterable<Owner>, reason: WakeLeaseLoss['reason']) => {
    const callbacks: LostCallback[] = [];
    const records: NativeRecord[] = [];
    // Invalidate and detach the entire batch before native cleanup or owner reentry.
    for (const owner of affected) {
      if (owner.state !== 'held' && owner.state !== 'pending') continue;
      const pending = owner.state === 'pending';
      const callback = owner.onLost;
      const resolve = owner.resolve;
      owner.state = pending ? 'released' : 'lost';
      const record = detach(owner);
      if (record) records.push(record);
      if (pending) resolve?.({ kind: 'refused', reason: 'unavailable' });
      else if (callback) callbacks.push(callback);
    }
    for (const record of records) cleanup(record);
    for (const callback of callbacks) notify(callback, reason);
  };
  const inspect = (owner: Owner) => {
    if (owner.state !== 'held' || !owner.native) return;
    const record = owner.native;
    const value = observed(record);
    if (value === true) {
      confirm(record);
      end([owner], 'native-release');
    } else if (value === undefined) end([owner], 'observation-failed');
  };
  const observeRelease = (record: NativeRecord) => {
    record.handle.onRelease(() => {
      confirm(record);
      const current = record.owner;
      if (current?.state === 'pending') refuse(current, 'already-released');
      else if (current?.state === 'held') end([current], 'native-release');
    });
  };
  const fulfill = (owner: Owner, handle: WakeLockHandle) => {
    const record: NativeRecord = { handle, owner: null, confirmed: false, attempted: false };
    natives.add(record);
    if (owner.state === 'pending') {
      record.owner = owner;
      owner.native = record;
    }
    // This callback captures only native bookkeeping, never a terminated owner's signal/callback.
    try {
      observeRelease(record);
    } catch {
      refuse(owner, 'observation-failed');
      cleanup(record);
      return;
    }
    if (owner.state !== 'pending') {
      cleanup(record);
      return;
    }
    // Preserve the distinction between an absent boolean and a getter that throws.
    const qualify = (): Refusal | null => {
      if (record.confirmed) return 'already-released';
      try {
        const value = handle.released;
        if (value === true) {
          confirm(record);
          return 'already-released';
        }
        return value === false ? null : 'unobservable';
      } catch {
        return 'observation-failed';
      }
    };
    const first = qualify();
    if (first) {
      refuse(owner, first);
      return;
    }
    if (unavailable()) {
      refuse(owner, 'unavailable');
      return;
    }
    const last = qualify();
    if (last) {
      refuse(owner, last);
      return;
    }
    if (owner.state !== 'pending') {
      cleanup(record);
      return;
    }
    const resolve = owner.resolve;
    owner.resolve = null;
    owner.state = 'held';
    const lease: WakeLease = {
      get state() {
        inspect(owner);
        return owner.state as WakeLease['state'];
      },
      release: () => withdraw(owner),
    };
    resolve?.({ kind: 'acquired', lease });
  };
  return {
    acquire(options: WakeLeaseOptions): Promise<WakeLeaseResult> {
      if (options.signal.aborted) return Promise.resolve({ kind: 'refused', reason: 'cancelled' });
      const requester = request();
      if (!requester) return Promise.resolve({ kind: 'refused', reason: 'unsupported' });
      if (unavailable()) return Promise.resolve({ kind: 'refused', reason: 'unavailable' });
      return new Promise((resolve) => {
        const owner: Owner = {
          state: 'pending',
          signal: options.signal,
          abort: null,
          onLost: options.onLost,
          resolve,
          native: null,
        };
        owner.abort = () => withdraw(owner);
        owners.add(owner);
        options.signal.addEventListener('abort', owner.abort, { once: true });
        try {
          void requester().then(
            (handle) => fulfill(owner, handle),
            () => refuse(owner, 'request-failed'),
          );
        } catch {
          refuse(owner, 'request-failed');
        }
      });
    },
    lose: (reason: PauseReason) => end(owners, reason),
    held() {
      let held = false;
      for (const record of natives) {
        const owner = record.owner;
        const value = observed(record);
        if (value === true) {
          confirm(record);
          if (owner?.state === 'held') end([owner], 'native-release');
        } else if (value === undefined && owner?.state === 'held') end([owner], 'observation-failed');
        else if (value === false) held = true;
      }
      return held;
    },
  };
}
