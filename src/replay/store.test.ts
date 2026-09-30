import { describe, expect, it } from 'vitest';
import type { SimInput } from '../sim/api';
import {
  createAutosave,
  createInputRecorder,
  createRecordingStore,
  NOTICE_STALE,
  NOTICE_UNREADABLE,
  recordingKey,
  REPLAY_FORMAT_VERSION,
  SAVE_EVERY_TICKS,
  staleRecordingKey,
  type Recording,
  type RecordingStorage,
  type ReplayHeader,
} from './index';

// replay-2 unit acceptance (docs/milestones/M2.md): the recording is saved synchronously every
// 5 s and on demand, offered on boot only to a build with the same replay key, refused with a
// one-line notice (and kept for the debug file) otherwise, and never throws on a broken storage.
// The whole reload cycle over a real headless race is in tests/sim/replay-resume.test.ts.

const PREFIX = 'test';
const KEY = 'code-a+content-a';

function memoryStorage(): RecordingStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function header(replayKey = KEY): ReplayHeader {
  return { formatVersion: REPLAY_FORMAT_VERSION, replayKey, seed: 7, eventId: 'e', tuning: {} };
}

const input = (t: number): SimInput => ({ steer: (t * 7) % 255, throttle: 255, brake: 0, flags: t % 3 });

function recording(ticks: number, replayKey = KEY): Recording {
  const r = createInputRecorder();
  r.begin(header(replayKey));
  for (let t = 0; t < ticks; t++) {
    r.record(t, [input(t)]);
    if (t % 60 === 0) r.checkpoint(t, t * 31);
  }
  r.recordParam(5, 'riders.steerScale', 1.2);
  const rec = r.current();
  if (!rec) throw new Error('no recording');
  return rec;
}

describe('replay/store: the saved recording', () => {
  it('saves synchronously and offers the recording back to a build with the same replay key', () => {
    const storage = memoryStorage();
    const store = createRecordingStore({ keyPrefix: PREFIX, storage });
    const rec = recording(1234);
    const saved = store.save(rec);
    expect(saved).toMatchObject({ tick: 1234, ok: true });
    expect(storage.map.has(recordingKey(PREFIX))).toBe(true);
    console.log(`[examined] 1234 ticks saved as ${saved.chars} characters`);

    // A reload: a new store over the same storage.
    const offer = createRecordingStore({ keyPrefix: PREFIX, storage }).offer(KEY);
    expect(offer.kind).toBe('resume');
    if (offer.kind !== 'resume') return;
    expect(offer.tick).toBe(1234);
    expect(offer.recording.inputs).toEqual(rec.inputs);
    expect(offer.recording.hashes).toEqual(rec.hashes);
    expect(offer.recording.params).toEqual(rec.params);
    expect(offer.recording.header.replayKey).toBe(KEY);
    expect(store.savedReplayKey()).toBe(KEY);
  });

  it('refuses a recording from another replay key with the notice, and keeps it for the debug file', () => {
    const storage = memoryStorage();
    createRecordingStore({ keyPrefix: PREFIX, storage }).save(recording(600, 'code-old+content-a'));
    const store = createRecordingStore({ keyPrefix: PREFIX, storage });
    const offer = store.offer(KEY);
    expect(offer).toMatchObject({ kind: 'stale', replayKey: 'code-old+content-a', notice: NOTICE_STALE });
    expect(storage.map.has(recordingKey(PREFIX))).toBe(false);
    expect(storage.map.has(staleRecordingKey(PREFIX))).toBe(true);
    expect(store.stale()?.inputs).toHaveLength(600);
    // Kept across a reload too, and never offered again.
    const later = createRecordingStore({ keyPrefix: PREFIX, storage });
    expect(later.offer(KEY)).toEqual({ kind: 'none' });
    expect(later.stale()?.header.replayKey).toBe('code-old+content-a');
    // The notice is one line.
    expect(NOTICE_STALE).not.toMatch(/\n/);
  });

  it('offers nothing for a finished race or an empty one, and clears it', () => {
    const storage = memoryStorage();
    const store = createRecordingStore({ keyPrefix: PREFIX, storage });
    const done = recording(300);
    done.end = { tick: 299, hash: 1 };
    store.save(done);
    expect(store.offer(KEY)).toEqual({ kind: 'none' });
    expect(storage.map.has(recordingKey(PREFIX))).toBe(false);
    store.save(recording(0));
    expect(store.offer(KEY)).toEqual({ kind: 'none' });
  });

  it('moves an unreadable recording aside with a notice', () => {
    const storage = memoryStorage();
    storage.setItem(recordingKey(PREFIX), '{"header": not json');
    const offer = createRecordingStore({ keyPrefix: PREFIX, storage }).offer(KEY);
    expect(offer).toMatchObject({ kind: 'stale', recording: null, notice: NOTICE_UNREADABLE });
    expect(storage.map.get(staleRecordingKey(PREFIX))).toBe('{"header": not json');
    // A newer replay format is unreadable here too.
    const newer = JSON.stringify({
      header: { ...header(), formatVersion: 99 },
      inputs: { ticks: 0, slots: [] },
    });
    storage.setItem(recordingKey(PREFIX), newer);
    expect(createRecordingStore({ keyPrefix: PREFIX, storage }).offer(KEY).kind).toBe('stale');
  });

  it('never throws on missing, full or blocked storage', () => {
    const none = createRecordingStore({ keyPrefix: PREFIX, storage: null });
    expect(none.save(recording(60)).ok).toBe(false);
    expect(none.offer(KEY)).toEqual({ kind: 'none' });
    expect(none.savedReplayKey()).toBeNull();

    const full: RecordingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(createRecordingStore({ keyPrefix: PREFIX, storage: full }).save(recording(60)).ok).toBe(false);

    const blocked: RecordingStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createRecordingStore({ keyPrefix: PREFIX, storage: blocked });
    expect(() => store.save(recording(60))).not.toThrow();
    expect(store.offer(KEY)).toEqual({ kind: 'none' });
    expect(() => store.clear()).not.toThrow();
    expect(store.stale()).toBeNull();
  });
});

describe('replay/store: the autosave interval', () => {
  it(`saves every ${SAVE_EVERY_TICKS} ticks (5 s) and at once on a pause or hide`, () => {
    const storage = memoryStorage();
    const store = createRecordingStore({ keyPrefix: PREFIX, storage });
    const auto = createAutosave(store);
    const r = createInputRecorder();
    r.begin(header());
    const savedAt: number[] = [];
    for (let t = 0; t < 1000; t++) {
      r.record(t, [input(t)]);
      if (auto.afterTick(t + 1, r.current())) savedAt.push(t + 1);
    }
    expect(savedAt).toEqual([300, 600, 900]);
    expect(store.lastSave()?.tick).toBe(900);
    // A pause at tick 1000: saved now, whatever the interval.
    expect(auto.flush(r.current())?.tick).toBe(1000);
    // The interval restarts from the flush.
    r.record(1000, [input(1000)]);
    expect(auto.afterTick(1001, r.current())).toBe(false);
    // A finished recording is not saved (the race is over; app/ clears it).
    r.finish(1000, 5);
    expect(auto.flush(r.current())).toBeNull();
    expect(auto.afterTick(5000, r.current())).toBe(false);
  });

  it('a non-default interval changes when it saves', () => {
    const store = createRecordingStore({ keyPrefix: PREFIX, storage: memoryStorage() });
    const auto = createAutosave(store, 120);
    const rec = recording(10);
    expect(auto.afterTick(119, rec)).toBe(false);
    expect(auto.afterTick(120, rec)).toBe(true);
    auto.reset(500);
    expect(auto.afterTick(600, rec)).toBe(false);
    expect(auto.afterTick(620, rec)).toBe(true);
  });
});

describe('replay: the recorder carries on a resumed recording', () => {
  it('records the next tick after the saved ones, without the old end marker', () => {
    const saved = recording(700);
    saved.end = { tick: 699, hash: 3 };
    const r = createInputRecorder();
    r.resume(saved);
    expect(() => r.record(699, [input(699)])).toThrow(/expected tick 700/);
    r.record(700, [input(700)]);
    expect(r.current()?.inputs).toHaveLength(701);
    expect(r.current()?.end).toBeUndefined();
    // A copy: the saved recording is not changed by recording on.
    expect(saved.inputs).toHaveLength(700);
  });
});
