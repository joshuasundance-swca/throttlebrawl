// The saved recording (docs/milestones/M2.md, replay-2; docs/architecture.md, "Resume after a
// reload"). The in-progress race's recording (header, inputs so far, tuning changes, hashes) is
// written synchronously to Web Storage every SAVE_EVERY_TICKS ticks and whenever app/ reports a
// pause or a hide. A hidden tab may never finish an asynchronous IndexedDB write, so this is a
// plain setItem inside try/catch; the most recent write wins, so a killed tab loses at most the
// last 5 s. On boot, `offer(replayKey)` hands app/ the saved recording when its replay key matches
// the running build; app/ re-runs it headlessly to the saved tick (`resumeFromRecording`). A
// recording from another replay key cannot resume exactly: it is moved aside with a one-line
// notice and kept for the debug file.
//
// replay/ imports only the sim's types. The storage is injected (app/ passes localStorage, tests a
// map), and building or stepping a sim is app/'s job.
import { decodeReplay, encodeReplay, type Recording } from './index';

/** Save the recording every this many ticks (5 s at 60 Hz). [default] */
export const SAVE_EVERY_TICKS = 300;

/** The one-line notice when a saved race cannot resume (it was saved by another sim build). */
export const NOTICE_STALE =
  "Your unfinished race can't be resumed: the game was updated since. It's kept in the debug file.";
/** The one-line notice when the saved race could not be read at all. */
export const NOTICE_UNREADABLE = "Your unfinished race couldn't be read, so it can't be resumed.";

/** The subset of the Web Storage API the store uses. */
export interface RecordingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Storage keys: name-neutral, derived from platform's app id (the settings record's prefix). */
export function recordingKey(keyPrefix: string): string {
  return `${keyPrefix}:race`;
}
export function staleRecordingKey(keyPrefix: string): string {
  return `${keyPrefix}:race-stale`;
}

/** What boot finds. */
export type ResumeOffer =
  | { kind: 'none' }
  /** A recording of this build's replay key: resume it by re-running it to `tick`. */
  | { kind: 'resume'; recording: Recording; tick: number }
  /** A recording that cannot resume; it is kept (when readable) for the debug file. */
  | { kind: 'stale'; recording: Recording | null; replayKey: string | null; notice: string };

export interface SaveResult {
  /** The recording's tick count when it was written (the tick a resume lands on). */
  tick: number;
  /** Characters written (the encoded JSON). */
  chars: number;
  /** False when storage refused it (quota, blocked storage): the race goes on regardless. */
  ok: boolean;
}

export interface RecordingStore {
  /** Writes the recording now, synchronously. Never throws. */
  save(rec: Recording): SaveResult;
  /** On boot: the saved recording, checked against the running build's replay key. Never throws. */
  offer(replayKey: string): ResumeOffer;
  /** Forgets the saved recording (the race finished, or the player quit it). Never throws. */
  clear(): void;
  /** The last recording that could not resume (this session's, or a stored one), for the debug file. */
  stale(): Recording | null;
  /** The last write this session, or null. */
  lastSave(): SaveResult | null;
  /** The replay key of the recording in storage now, or null (the debug report). Never throws. */
  savedReplayKey(): string | null;
}

export interface RecordingStoreOptions {
  /** Name-neutral key prefix: platform's app id. */
  keyPrefix: string;
  /** null when storage is unavailable: saves then report ok false, and nothing is offered. */
  storage: RecordingStorage | null;
}

function read(storage: RecordingStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: RecordingStorage | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(storage: RecordingStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Blocked storage: nothing was saved there either.
  }
}

function decode(text: string): Recording | null {
  try {
    return decodeReplay(JSON.parse(text));
  } catch {
    return null;
  }
}

export function createRecordingStore(opts: RecordingStoreOptions): RecordingStore {
  const { storage } = opts;
  const key = recordingKey(opts.keyPrefix);
  const staleKey = staleRecordingKey(opts.keyPrefix);
  let last: SaveResult | null = null;
  let staleRec: Recording | null = null;

  const store: RecordingStore = {
    save(rec) {
      const text = JSON.stringify(encodeReplay(rec));
      last = { tick: rec.inputs.length, chars: text.length, ok: write(storage, key, text) };
      return last;
    },
    offer(replayKey) {
      const text = read(storage, key);
      if (text === null) return { kind: 'none' };
      const rec = decode(text);
      if (!rec) {
        // Unreadable (corrupt, or a newer replay format): move it aside untouched.
        write(storage, staleKey, text);
        remove(storage, key);
        return { kind: 'stale', recording: null, replayKey: null, notice: NOTICE_UNREADABLE };
      }
      // A finished race, or one that never stepped, is nothing to resume.
      if (rec.end || rec.inputs.length === 0) {
        remove(storage, key);
        return { kind: 'none' };
      }
      if (rec.header.replayKey !== replayKey) {
        staleRec = rec;
        write(storage, staleKey, text);
        remove(storage, key);
        return { kind: 'stale', recording: rec, replayKey: rec.header.replayKey, notice: NOTICE_STALE };
      }
      return { kind: 'resume', recording: rec, tick: rec.inputs.length };
    },
    clear() {
      remove(storage, key);
    },
    stale() {
      if (staleRec) return staleRec;
      const text = read(storage, staleKey);
      return text === null ? null : decode(text);
    },
    lastSave: () => last,
    savedReplayKey() {
      const text = read(storage, key);
      if (text === null) return null;
      try {
        const parsed = JSON.parse(text) as { header?: { replayKey?: unknown } } | null;
        const k = parsed?.header?.replayKey;
        return typeof k === 'string' ? k : null;
      } catch {
        return null;
      }
    },
  };
  return store;
}

/** Saves every SAVE_EVERY_TICKS ticks, plus on demand (a pause or a hide). */
export interface Autosave {
  /** Call after each recorded tick; saves when the interval has passed. True when it saved. */
  afterTick(tick: number, rec: Recording | null): boolean;
  /** Saves now (app/ reports a pause, a hide or a lost fullscreen). */
  flush(rec: Recording | null): SaveResult | null;
  /** A new race (or a resumed one) starts the interval again from `tick`. */
  reset(tick?: number): void;
}

export function createAutosave(store: RecordingStore, everyTicks = SAVE_EVERY_TICKS): Autosave {
  let lastTick = 0;
  return {
    afterTick(tick, rec) {
      if (!rec || rec.end || tick - lastTick < everyTicks) return false;
      lastTick = tick;
      store.save(rec);
      return true;
    },
    flush(rec) {
      if (!rec || rec.end) return null;
      lastTick = rec.inputs.length;
      return store.save(rec);
    },
    reset(tick = 0) {
      lastTick = tick;
    },
  };
}
