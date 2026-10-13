// APP's atomic saved attempt. Replay/profile formats stay unchanged.
import {
  decodeReplay,
  recordingKey,
  REPLAY_FORMAT_VERSION,
  type Recording,
  type RecordingStorage,
  type ReplayFile,
} from '../replay';
import { sanitiseSettings, migrateProfile, sanitiseProfile, type Profile, type Settings } from '../save';

export const SAVED_RACE_VERSION = 1;
/** Bump when APP's historical objective/settlement semantics change. */
export const RESUME_LOGIC_VERSION = 1;
export const MAX_SAVED_RACE_CHARS = 2 * 1024 * 1024;
export const MAX_SAVED_RACE_TICKS = 60 * 60 * 60;

export type SavedRaceContext =
  | {
      kind: 'quick';
      eventId: string;
      route: string | null;
      settings: Settings;
      contextKey: string;
    }
  | {
      kind: 'career';
      eventId: string;
      careerKey: string;
      nodeId: string;
      regionId: string;
      length: string | null;
      profileGuard: string;
      contextKey: string;
    };

export interface FrozenRaceResult {
  build: string;
  at: string;
}

interface SavedRaceBase {
  format: 'saved-race';
  version: number;
  logicVersion: number;
  recording: ReplayFile;
  context: SavedRaceContext;
  savedHash: number;
}

export type SavedRaceEnvelope = SavedRaceBase &
  ({ phase: 'riding'; result?: never } | { phase: 'pending-result'; result: FrozenRaceResult });

export type SavedRaceRefusal = 'legacy' | 'newer' | 'incompatible' | 'malformed' | 'too-large';
export type SavedRaceRead =
  | { kind: 'empty' }
  | { kind: 'blocked' }
  | { kind: 'saved'; envelope: SavedRaceEnvelope; raw: string }
  | { kind: 'refused'; reason: SavedRaceRefusal; raw: string; replayKey?: string };

export interface SavedRaceWrite {
  ok: boolean;
  tick: number;
  chars: number;
  reason: 'not-owned' | 'changed' | 'blocked' | 'invalid' | 'too-large' | null;
}

export interface SavedRaceStore {
  read(): SavedRaceRead;
  /** Claim only the exact attempt the player chose to recover. Does not delete it. */
  adopt(raw: string): boolean;
  save(envelope: SavedRaceEnvelope): SavedRaceWrite;
  /** APP calls only after successful settlement or an explicit abandon choice. */
  clear(): boolean;
}

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= lo && v <= hi;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const id = (v: unknown): v is string => text(v) && /^(?:[a-z0-9-]+:)?[a-z0-9]+(?:[-/#.][a-z0-9]+)*$/.test(v);
const qualified = (v: unknown): v is string => id(v) && v.includes(':');
const unsigned = (v: unknown): v is number => integer(v, 0, 0xffffffff);

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (object(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedValue(value[key])]),
    );
  return value;
}

/** Exact plain-data identity; object insertion order does not change compatibility. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortedValue(value)) ?? 'null';
}

/** Pure inspection, never ProfileStore's failed-write memory or migration backup writes. */
export function profileFromGuard(raw: string): Profile | null {
  if (raw.length > MAX_SAVED_RACE_CHARS) return null;
  try {
    const migrated = migrateProfile(JSON.parse(raw));
    return migrated.kind === 'ok' && object(migrated.data) ? sanitiseProfile(migrated.data) : null;
  } catch {
    return null;
  }
}

function finiteConfig(value: unknown, depth = 0): boolean {
  if (depth > 40) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => finiteConfig(v, depth + 1));
  if (object(value)) return Object.values(value).every((v) => finiteConfig(v, depth + 1));
  return value === null || typeof value === 'string' || typeof value === 'boolean';
}

function numericMap(value: unknown): boolean {
  return object(value) && Object.entries(value).every(([key, v]) => text(key) && finite(v));
}

function validEnvelope(raw: unknown): raw is SavedRaceEnvelope {
  if (
    !object(raw) ||
    raw['format'] !== 'saved-race' ||
    raw['version'] !== SAVED_RACE_VERSION ||
    raw['logicVersion'] !== RESUME_LOGIC_VERSION ||
    !unsigned(raw['savedHash'])
  )
    return false;
  const file = raw['recording'];
  if (!object(file)) return false;
  const header = file['header'],
    inputs = file['inputs'];
  if (
    !object(header) ||
    header['formatVersion'] !== REPLAY_FORMAT_VERSION ||
    !text(header['replayKey'], 256) ||
    !qualified(header['eventId']) ||
    !unsigned(header['seed']) ||
    header['playerSlots'] !== 1 ||
    !numericMap(header['tuning']) ||
    !object(inputs)
  )
    return false;
  const ticks = inputs['ticks'],
    slots = inputs['slots'];
  if (!integer(ticks, 1, MAX_SAVED_RACE_TICKS) || !Array.isArray(slots) || slots.length !== 1) return false;
  const runs: unknown = slots[0];
  if (!Array.isArray(runs) || runs.length === 0 || runs.length % 5 !== 0 || runs.length > ticks * 5)
    return false;
  let total = 0;
  for (let i = 0; i < runs.length; i += 5) {
    const count: unknown = runs[i];
    if (
      !integer(count, 1, ticks) ||
      !integer(runs[i + 1], -127, 127) ||
      !integer(runs[i + 2], 0, 255) ||
      !integer(runs[i + 3], 0, 255) ||
      !integer(runs[i + 4], 0, 0xffff)
    )
      return false;
    total += count;
    if (!Number.isSafeInteger(total) || total > ticks) return false;
  }
  if (total !== ticks) return false;
  const config = header['config'];
  if (
    !object(config) ||
    !finiteConfig(config) ||
    config['seed'] !== header['seed'] ||
    config['playerSlots'] !== 1 ||
    !object(config['event']) ||
    config['event']['contentId'] !== header['eventId'] ||
    !numericMap(config['tuning']) ||
    canonicalJson(config['tuning']) !== canonicalJson(header['tuning'])
  )
    return false;
  const riders = config['riders'];
  if (
    !Array.isArray(riders) ||
    riders.length === 0 ||
    !riders.every(
      (r: unknown) =>
        object(r) && object(r['controller']) && object(r['bike']) && qualified(r['bike']['contentId']),
    )
  )
    return false;
  if (
    riders.filter(
      (r: unknown) => object(r) && object(r['controller']) && r['controller']['kind'] === 'player',
    ).length !== 1
  )
    return false;
  const params = file['params'],
    hashes = file['hashes'];
  if (
    !Array.isArray(params) ||
    !params.every(
      (p: unknown) => object(p) && integer(p['tick'], 0, ticks - 1) && text(p['id']) && finite(p['value']),
    )
  )
    return false;
  if (!Array.isArray(hashes)) return false;
  let lastHashTick = -1;
  for (const hash of hashes as unknown[]) {
    if (
      !object(hash) ||
      !integer(hash['tick'], 0, ticks - 1) ||
      hash['tick'] <= lastHashTick ||
      !unsigned(hash['hash'])
    )
      return false;
    lastHashTick = hash['tick'];
  }
  if (raw['phase'] === 'riding') {
    if (file['end'] !== undefined || raw['result'] !== undefined) return false;
  } else if (raw['phase'] === 'pending-result') {
    const end = file['end'],
      result = raw['result'];
    if (
      !object(end) ||
      end['tick'] !== ticks - 1 ||
      !unsigned(end['hash']) ||
      end['hash'] !== raw['savedHash'] ||
      !object(result) ||
      !text(result['build'], 64) ||
      !text(result['at'], 40) ||
      !Number.isFinite(Date.parse(result['at']))
    )
      return false;
  } else return false;
  const context = raw['context'];
  if (
    !object(context) ||
    context['eventId'] !== header['eventId'] ||
    !text(context['contextKey'], MAX_SAVED_RACE_CHARS)
  )
    return false;
  if (context['kind'] === 'quick')
    return (
      (context['route'] === null || qualified(context['route'])) &&
      object(context['settings']) &&
      canonicalJson(context['settings']) === canonicalJson(sanitiseSettings(context['settings']))
    );
  if (
    context['kind'] !== 'career' ||
    !qualified(context['careerKey']) ||
    !id(context['nodeId']) ||
    !id(context['regionId']) ||
    !(context['length'] === null || id(context['length'])) ||
    !text(context['profileGuard'], MAX_SAVED_RACE_CHARS)
  )
    return false;
  return profileFromGuard(context['profileGuard']) !== null;
}

function parseAttempt(raw: string): Exclude<SavedRaceRead, { kind: 'empty' | 'blocked' }> {
  const refused = (
    reason: SavedRaceRefusal,
    value?: unknown,
  ): Extract<SavedRaceRead, { kind: 'refused' }> => {
    const header = object(value)
      ? object(value['recording'])
        ? value['recording']['header']
        : value['header']
      : null;
    const key = object(header) && text(header['replayKey'], 256) ? header['replayKey'] : null;
    return { kind: 'refused', reason, raw, ...(key === null ? {} : { replayKey: key }) };
  };
  if (raw.length > MAX_SAVED_RACE_CHARS) return refused('too-large');
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value)) return refused('malformed');
    if (value['format'] !== 'saved-race')
      return refused(object(value['header']) && object(value['inputs']) ? 'legacy' : 'malformed', value);
    const header = object(value['recording']) ? value['recording']['header'] : null;
    if (
      integer(value['version'], SAVED_RACE_VERSION + 1, Number.MAX_SAFE_INTEGER) ||
      integer(value['logicVersion'], RESUME_LOGIC_VERSION + 1, Number.MAX_SAFE_INTEGER) ||
      (object(header) && integer(header['formatVersion'], REPLAY_FORMAT_VERSION + 1, Number.MAX_SAFE_INTEGER))
    )
      return refused('newer', value);
    if (integer(value['logicVersion'], 1, RESUME_LOGIC_VERSION - 1)) return refused('incompatible', value);
    if (!validEnvelope(value)) return refused('malformed', value);
    return { kind: 'saved', envelope: value, raw };
  } catch {
    return refused('malformed');
  }
}

export function createSavedRaceStore(opts: {
  keyPrefix: string;
  storage: RecordingStorage | null;
}): SavedRaceStore {
  const key = recordingKey(opts.keyPrefix);
  let owned = false;
  let expected: string | null = null;
  let pending = false;
  return {
    read() {
      try {
        if (!opts.storage) {
          owned = false;
          return { kind: 'blocked' };
        }
        const raw = opts.storage.getItem(key);
        if (raw === null) {
          owned = true;
          expected = null;
          pending = false;
          return { kind: 'empty' };
        }
        if (raw !== expected) owned = false;
        expected = raw;
        return parseAttempt(raw);
      } catch {
        owned = false;
        return { kind: 'blocked' };
      }
    },
    adopt(raw) {
      owned = false;
      try {
        if (!opts.storage || opts.storage.getItem(key) !== raw) return false;
        const read = parseAttempt(raw);
        if (read.kind !== 'saved') return false;
        owned = true;
        expected = raw;
        pending = read.envelope.phase === 'pending-result';
        return true;
      } catch {
        owned = false;
        return false;
      }
    },
    save(envelope) {
      const tick = envelope.recording.inputs.ticks;
      let raw: string;
      try {
        raw = JSON.stringify(envelope);
      } catch {
        return { ok: false, tick, chars: 0, reason: 'invalid' };
      }
      const result = (ok: boolean, reason: SavedRaceWrite['reason']): SavedRaceWrite => ({
        ok,
        tick,
        chars: raw.length,
        reason,
      });
      if (raw.length > MAX_SAVED_RACE_CHARS) return result(false, 'too-large');
      if (!validEnvelope(envelope)) return result(false, 'invalid');
      // A terminal attempt is frozen. A retry may persist the identical text, never a different
      // result/context/recording merely because it also calls itself pending-result.
      if (!owned || (pending && raw !== expected)) return result(false, 'not-owned');
      try {
        if (!opts.storage) throw new Error('Storage unavailable');
        if (opts.storage.getItem(key) !== expected) {
          owned = false;
          return result(false, 'changed');
        }
        opts.storage.setItem(key, raw);
        if (opts.storage.getItem(key) !== raw) {
          owned = false;
          return result(false, 'blocked');
        }
        expected = raw;
        pending = envelope.phase === 'pending-result';
        return result(true, null);
      } catch {
        return result(false, 'blocked');
      }
    },
    clear() {
      try {
        if (!opts.storage) return false;
        if (opts.storage.getItem(key) !== expected) {
          owned = false;
          return false;
        }
        opts.storage.removeItem(key);
        if (opts.storage.getItem(key) !== null) {
          owned = false;
          return false;
        }
        owned = true;
        expected = null;
        pending = false;
        return true;
      } catch {
        owned = false;
        return false;
      }
    },
  };
}

export function decodeSavedRecording(envelope: SavedRaceEnvelope): Recording {
  if (!validEnvelope(envelope)) throw new Error('Saved race data is invalid');
  return decodeReplay(envelope.recording);
}
