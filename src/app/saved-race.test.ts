import { describe, expect, it, vi } from 'vitest';
import { loadBasePack } from '../content';
import { encodeReplay, replayHeader, type Recording, type RecordingStorage } from '../replay';
import { DEFAULT_SETTINGS, DEFAULT_PROFILE, PROFILE_VERSION, type Profile } from '../save';
import { quantizeInput } from '../sim/api';
import { createHeadlessRace } from './headless';
import * as career from './career-flow';
import { recoveryCareer } from './recovery-context';
import {
  createSavedRaceStore,
  decodeSavedRecording,
  MAX_SAVED_RACE_CHARS,
  MAX_SAVED_RACE_TICKS,
  profileFromGuard,
  RESUME_LOGIC_VERSION,
  SAVED_RACE_VERSION,
  type SavedRaceEnvelope,
  type SavedRaceRefusal,
  type SavedRaceStore,
} from './saved-race';

const PREFIX = 'unit';
const KEY = 'unit:race';
const header = replayHeader(createHeadlessRace({ seed: 77 }).config, 'code+content');
const rec = (): Recording => ({
  header: structuredClone(header),
  inputs: [[quantizeInput({ steer: 0.2, throttle: 1, brake: 0, flags: 0 })]],
  params: [],
  hashes: [{ tick: 0, hash: 123 }],
});
function riding(): SavedRaceEnvelope {
  return {
    format: 'saved-race',
    version: SAVED_RACE_VERSION,
    logicVersion: RESUME_LOGIC_VERSION,
    phase: 'riding',
    recording: encodeReplay(rec()),
    context: {
      kind: 'quick',
      eventId: header.eventId,
      route: null,
      settings: structuredClone(DEFAULT_SETTINGS),
      contextKey: 'original-objectives',
    },
    savedHash: 123,
  };
}
function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[KEY, initial]]);
  const storage: RecordingStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return { data, storage, store: createSavedRaceStore({ keyPrefix: PREFIX, storage }) };
}

function expectRefusal(store: SavedRaceStore, reason: SavedRaceRefusal, raw: string): void {
  const read = store.read();
  expect(read.kind).toBe('refused');
  if (read.kind !== 'refused') throw new Error('Input was not refused');
  expect(read.reason).toBe(reason);
  expect(read.raw).toBe(raw);
}

describe('APP atomic saved attempt', () => {
  it('saves recording, context and saved hash together after an empty-slot read', () => {
    const { store } = memory();
    const attempt = riding();
    expect(store.read()).toEqual({ kind: 'empty' });
    expect(store.save(attempt).ok).toBe(true);
    const read = store.read();
    expect(read.kind).toBe('saved');
    if (read.kind !== 'saved') throw new Error('Saved attempt missing');
    expect(read.envelope).toEqual(attempt);
    expect(decodeSavedRecording(read.envelope)).toEqual(rec());
  });

  it('retains a terminal end marker and frozen result metadata', () => {
    const attempt: SavedRaceEnvelope = {
      ...riding(),
      phase: 'pending-result',
      recording: { ...riding().recording, end: { tick: 0, hash: 123 } },
      result: { build: 'original-build', at: '2026-10-12T12:00:00.000Z' },
    };
    const { store } = memory();
    store.read();
    expect(store.save(attempt).ok).toBe(true);
    const read = store.read();
    if (read.kind !== 'saved') throw new Error('Pending result missing');
    expect(read.envelope).toEqual(attempt);
    expect(decodeSavedRecording(read.envelope).end).toEqual({ tick: 0, hash: 123 });
  });

  it('never writes an unknown slot after a blocked read, including after storage becomes writable', () => {
    const original = JSON.stringify(riding());
    const { data, storage } = memory(original);
    let blocked = true;
    const get = storage.getItem.bind(storage);
    storage.getItem = (key) => {
      if (blocked) throw new Error('Blocked');
      return get(key);
    };
    const store = createSavedRaceStore({ keyPrefix: PREFIX, storage });
    expect(store.read()).toEqual({ kind: 'blocked' });
    expect(store.save(riding()).ok).toBe(false);
    blocked = false;
    expect(store.save({ ...riding(), savedHash: 456 }).ok).toBe(false);
    expect(data.get(KEY)).toBe(original);
    expect(store.read().kind).toBe('saved');
    expect(store.adopt(original)).toBe(true);
    expect(store.save({ ...riding(), savedHash: 456 }).ok).toBe(true);
  });

  it('requires adoption before overwriting an existing attempt, and checks its exact text', () => {
    const original = JSON.stringify(riding());
    const { data, store } = memory(original);
    expect(store.read().kind).toBe('saved');
    expect(store.save(riding()).ok).toBe(false);
    expect(store.adopt(original + ' ')).toBe(false);
    expect(store.adopt(original)).toBe(true);
    data.set(KEY, JSON.stringify({ ...riding(), savedHash: 789 }));
    expect(store.save(riding()).ok).toBe(false);
    expect((JSON.parse(data.get(KEY)!) as { savedHash: number }).savedHash).toBe(789);
  });

  it.each([
    ['legacy', JSON.stringify(encodeReplay(rec()))],
    ['newer', JSON.stringify({ ...riding(), version: SAVED_RACE_VERSION + 1 })],
    ['newer', JSON.stringify({ ...riding(), logicVersion: RESUME_LOGIC_VERSION + 1 })],
    ['malformed', '{bad-json'],
  ] as const)('retains %s input without granting replacement', (reason, raw) => {
    const { data, store } = memory(raw);
    expectRefusal(store, reason, raw);
    expect(store.adopt(raw)).toBe(false);
    expect(store.save(riding()).ok).toBe(false);
    expect(data.get(KEY)).toBe(raw);
  });

  it('reports a readable refused replay key without decoding or discarding the attempt', () => {
    const raw = JSON.stringify(encodeReplay(rec()));
    const read = memory(raw).store.read();
    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') throw new Error('Legacy attempt was not refused');
    expect('replayKey' in read ? read.replayKey : null).toBe(header.replayKey);
  });

  it.each([
    [
      'negative ticks',
      (a: SavedRaceEnvelope) => {
        a.recording.inputs.ticks = -1;
      },
    ],
    [
      'too many ticks',
      (a: SavedRaceEnvelope) => {
        a.recording.inputs.ticks = MAX_SAVED_RACE_TICKS + 1;
      },
    ],
    [
      'unsafe run count',
      (a: SavedRaceEnvelope) => {
        a.recording.inputs.slots[0]![0] = Number.MAX_SAFE_INTEGER;
      },
    ],
    [
      'wrong run sum',
      (a: SavedRaceEnvelope) => {
        a.recording.inputs.slots[0]![0] = 2;
      },
    ],
    [
      'fractional input',
      (a: SavedRaceEnvelope) => {
        a.recording.inputs.slots[0]![1] = 0.5;
      },
    ],
    [
      'out-of-range throttle',
      (a: SavedRaceEnvelope) => {
        a.recording.inputs.slots[0]![2] = 256;
      },
    ],
    [
      'extra slot',
      (a: SavedRaceEnvelope) => {
        a.recording.inputs.slots.push([...a.recording.inputs.slots[0]!]);
      },
    ],
    [
      'header slot mismatch',
      (a: SavedRaceEnvelope) => {
        a.recording.header.playerSlots = 2;
      },
    ],
    [
      'negative hash',
      (a: SavedRaceEnvelope) => {
        a.savedHash = -1;
      },
    ],
    [
      'checkpoint outside recording',
      (a: SavedRaceEnvelope) => {
        a.recording.hashes[0]!.tick = 1;
      },
    ],
    [
      'parameter outside recording',
      (a: SavedRaceEnvelope) => {
        a.recording.params.push({ tick: 1, id: 'riders.steerScale', value: 1 });
      },
    ],
    [
      'context event mismatch',
      (a: SavedRaceEnvelope) => {
        a.context.eventId = 'base:different-event';
      },
    ],
    [
      'config seed mismatch',
      (a: SavedRaceEnvelope) => {
        a.recording.header.config!.seed++;
      },
    ],
    [
      'riding with end marker',
      (a: SavedRaceEnvelope) => {
        a.recording.end = { tick: 0, hash: 123 };
      },
    ],
  ] as const)('refuses %s before replay expansion', (_name, corrupt) => {
    const attempt = riding();
    corrupt(attempt);
    const raw = JSON.stringify(attempt);
    const { data, store } = memory(raw);
    expectRefusal(store, 'malformed', raw);
    expect(data.get(KEY)).toBe(raw);
  });

  it('checks the whole text ceiling before JSON.parse', () => {
    const raw = ' '.repeat(MAX_SAVED_RACE_CHARS) + JSON.stringify(riding());
    const { store } = memory(raw);
    const parse = vi.spyOn(JSON, 'parse');
    try {
      expectRefusal(store, 'too-large', raw);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it('keeps the prior slot when a write fails and reports failed removal honestly', () => {
    const original = JSON.stringify(riding());
    const { data, storage } = memory(original);
    const store = createSavedRaceStore({ keyPrefix: PREFIX, storage });
    store.read();
    store.adopt(original);
    storage.setItem = () => {
      throw new Error('Quota');
    };
    expect(store.save({ ...riding(), savedHash: 456 }).ok).toBe(false);
    expect(data.get(KEY)).toBe(original);
    storage.removeItem = () => undefined;
    expect(store.clear()).toBe(false);
    expect(data.get(KEY)).toBe(original);
  });

  it('does not clear an unknown or subsequently changed slot', () => {
    const original = JSON.stringify(riding());
    const { data, store } = memory(original);
    expect(store.clear()).toBe(false);
    expect(data.get(KEY)).toBe(original);
    store.read();
    const replacement = JSON.stringify({ ...riding(), savedHash: 456 });
    data.set(KEY, replacement);
    expect(store.clear()).toBe(false);
    expect(data.get(KEY)).toBe(replacement);
    store.read();
    expect(store.clear()).toBe(true);
    expect(data.has(KEY)).toBe(false);
  });

  it('revokes ownership after a failed adoption, even if the previous text comes back', () => {
    const original = JSON.stringify(riding());
    const { data, store } = memory(original);
    store.read();
    expect(store.adopt(original)).toBe(true);
    data.set(KEY, JSON.stringify({ ...riding(), savedHash: 456 }));
    expect(store.adopt(original)).toBe(false);
    data.set(KEY, original);
    expect(store.save(riding()).ok).toBe(false);
  });

  it('does not report a no-op write as persisted', () => {
    const { storage, store } = memory();
    store.read();
    storage.setItem = () => undefined;
    expect(store.save(riding()).ok).toBe(false);
    expect(store.read()).toEqual({ kind: 'empty' });
  });

  it('cannot replace a pending result with riding, but can retry the terminal save', () => {
    const pending: SavedRaceEnvelope = {
      ...riding(),
      phase: 'pending-result',
      recording: { ...riding().recording, end: { tick: 0, hash: 123 } },
      result: { build: 'original-build', at: '2026-10-12T12:00:00.000Z' },
    };
    const { data, store } = memory();
    store.read();
    expect(store.save(pending).ok).toBe(true);
    expect(store.save(riding()).ok).toBe(false);
    expect((JSON.parse(data.get(KEY)!) as { phase: string }).phase).toBe('pending-result');
    expect(store.save(pending).ok).toBe(true);
  });

  it.each(['missing end', 'wrong end tick', 'wrong end hash', 'missing result', 'invalid time'])(
    'rejects a pending result with %s',
    (damage) => {
      const pending = {
        ...riding(),
        phase: 'pending-result',
        recording: { ...riding().recording, end: { tick: 0, hash: 123 } },
        result: { build: 'original-build', at: '2026-10-12T12:00:00.000Z' },
      };
      if (damage === 'missing end') Reflect.deleteProperty(pending.recording, 'end');
      if (damage === 'wrong end tick') pending.recording.end.tick = 1;
      if (damage === 'wrong end hash') pending.recording.end.hash = 456;
      if (damage === 'missing result') Reflect.deleteProperty(pending, 'result');
      if (damage === 'invalid time') pending.result.at = 'not-a-date';
      const raw = JSON.stringify(pending);
      expectRefusal(memory(raw).store, 'malformed', raw);
    },
  );

  it.each(['metadata', 'context', 'terminal hash', 'recorded input'])(
    'keeps a pending result frozen when its %s changes',
    (damage) => {
      const pending: SavedRaceEnvelope = {
        ...riding(),
        phase: 'pending-result',
        recording: { ...riding().recording, end: { tick: 0, hash: 123 } },
        result: { build: 'original-build', at: '2026-10-12T12:00:00.000Z' },
      };
      const { data, store } = memory();
      store.read();
      expect(store.save(pending).ok).toBe(true);
      const original = data.get(KEY);
      const changed = structuredClone(pending);
      if (damage === 'metadata') changed.result.at = '2026-10-12T13:00:00.000Z';
      if (damage === 'context') changed.context.contextKey = 'other-rules';
      if (damage === 'terminal hash') {
        changed.savedHash = 456;
        changed.recording.end!.hash = 456;
      }
      if (damage === 'recorded input') changed.recording.inputs.slots[0]![1] = 0;
      expect(store.save(changed).ok).toBe(false);
      expect(data.get(KEY)).toBe(original);
      const resumed = createSavedRaceStore({ keyPrefix: PREFIX, storage: memory(original).storage });
      resumed.read();
      expect(resumed.adopt(original!)).toBe(true);
      expect(resumed.save(changed).ok).toBe(false);
      expect(resumed.save(pending).ok).toBe(true);
    },
  );

  it('bounds direct profile inspection before parsing, and sanitises only supported profile records', () => {
    const wrap = (version: number, data: unknown) =>
      JSON.stringify({
        format: 'profile',
        version,
        build: 'fixture',
        savedAt: '2026-10-12T12:00:00.000Z',
        data,
      });
    expect(profileFromGuard(wrap(PROFILE_VERSION, DEFAULT_PROFILE))).toEqual(DEFAULT_PROFILE);
    expect(profileFromGuard(wrap(PROFILE_VERSION, { cash: 123.4 }))?.cash).toBe(123);
    expect(profileFromGuard('{bad')).toBeNull();
    expect(profileFromGuard(wrap(PROFILE_VERSION + 1, DEFAULT_PROFILE))).toBeNull();
    const parse = vi.spyOn(JSON, 'parse');
    try {
      expect(profileFromGuard(' '.repeat(MAX_SAVED_RACE_CHARS + 1))).toBeNull();
      expect(parse.mock.calls.length).toBe(0);
    } finally {
      parse.mockRestore();
    }
  });

  it('accepts complete representative long recordings and a large supported career profile', () => {
    const reg = loadBasePack();
    const defs = career.careerDefs(reg);
    const def = defs[0]!;
    const node = def.nodes[0]!;
    const profile: Profile = career.startCareer(defs, structuredClone(DEFAULT_PROFILE));
    const representativeHeader = replayHeader(
      createHeadlessRace(
        { seed: 77, eventId: node.event, playerBike: profile.bikes.current!, freePlay: false },
        { registry: reg },
      ).config,
      'code+content',
    );
    profile.history = Array.from({ length: 200 }, (_, n) => ({
      event: node.event,
      node: node.id,
      region: def.regionId,
      place: 1,
      outcome: 'won',
      cash: n,
      takedowns: 1,
      build: 'fixture',
      at: '2026-10-12T12:00:00.000Z',
    }));
    profile.careerBackups = Array.from({ length: 3 }, () => ({
      code: 'EC1.' + 'x'.repeat(190_000),
      at: '2026-10-12T12:00:00.000Z',
      season: 1,
    }));
    const guard = JSON.stringify({
      format: 'profile',
      version: PROFILE_VERSION,
      build: 'fixture',
      savedAt: '2026-10-12T12:00:00.000Z',
      data: profile,
    });
    for (const [ticks, changing] of [
      [6 * 60 * 60, true],
      [15 * 60 * 60, false],
    ] as const) {
      const recording = rec();
      recording.header = representativeHeader;
      recording.inputs = Array.from({ length: ticks }, (_, t) => [
        quantizeInput({
          steer: changing ? ((t % 255) - 127) / 127 : 0,
          throttle: 1,
          brake: 0,
          flags: 0,
        }),
      ]);
      const original = {
        kind: 'career' as const,
        eventId: node.event,
        careerKey: def.key,
        nodeId: node.id,
        regionId: def.regionId,
        length: node.length,
        profileGuard: guard,
      };
      const attempt: SavedRaceEnvelope = {
        ...riding(),
        recording: encodeReplay(recording),
        context: {
          ...original,
          contextKey: recoveryCareer(career, reg, defs, original, representativeHeader).key,
        },
      };
      const { store } = memory();
      store.read();
      const saved = store.save(attempt);
      console.log(
        `[examined] saved attempt fixture: ${ticks} ticks, changing steering ${changing}, ${saved.chars} complete envelope characters; actual derived career identity, synthetic supported history/backup slots`,
      );
      expect(saved.ok).toBe(true);
      expect(saved.chars).toBeLessThan(MAX_SAVED_RACE_CHARS);
      const read = store.read();
      if (read.kind !== 'saved') throw new Error('Long recording refused');
      expect(decodeSavedRecording(read.envelope).inputs.length).toBe(ticks);
      expect(read.envelope.context).toEqual(attempt.context);
    }
  });
});
